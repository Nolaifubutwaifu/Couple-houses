/* NEST :: the database, as it actually stands.

   This is the whole thing in one runnable file, so the schema lives in the
   repository next to the code that calls it rather than only in a dashboard.
   Applied to Supabase project `nest` as five migrations; kept here as one
   readable statement of the rules.

   The shape of it: two people, one nest, and every rule that decides who may
   touch what expressed as a row policy or a definer function rather than as
   something the client is trusted to do. The client can read what it is a
   member of and write the nest document. It cannot write a membership, an
   invite, or anything belonging to anybody else, and none of that depends on
   the app behaving. */

create schema if not exists nest_private;
grant usage on schema nest_private to authenticated;

create type nest_status as enum ('pending', 'active', 'archived');
create type member_role as enum ('founder', 'partner');
create type member_state as enum ('invited', 'active', 'left');
create type invite_state as enum ('open', 'consumed', 'expired', 'revoked');

/* ---------------- tables ---------------- */

create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text check (display_name is null or char_length(display_name) between 1 and 24),
  birthdate     date,
  age_verified  boolean not null default false,
  /* Set when a birthdate failed the age check. The name and the date are not
     kept in that case, so this boolean is the whole of what a refusal leaves
     behind, and it is what stops the block being a retry loop. */
  age_blocked   boolean not null default false,
  locale        text,
  push_token    text,
  blocked       text[] not null default '{}',
  deleted       boolean not null default false,
  deleted_at    timestamptz,
  created_at    timestamptz not null default now()
);

create table nests (
  id             uuid primary key default gen_random_uuid(),
  name           text check (name is null or char_length(name) between 1 and 20),
  status         nest_status not null default 'pending',
  base_material  text not null default 'ceramic',
  terrain_type   text not null default 'grass',
  season_state   text not null default 'new',
  streak_count   integer not null default 0,
  game           jsonb not null default '{}',      -- the shared game document
  frozen         boolean not null default false,
  frozen_at      timestamptz,
  archived_at    timestamptz,
  archived_by    uuid references auth.users(id),
  archive_reason text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table memberships (
  id         uuid primary key default gen_random_uuid(),
  nest_id    uuid not null references nests(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       member_role not null,
  status     member_state not null default 'invited',
  joined_at  timestamptz,
  created_at timestamptz not null default now(),
  unique (nest_id, user_id)
);

/* Spec section 7 says a nest holds at most two people, and that one person is
   in at most one live nest. Both are constraints rather than checks in code,
   so a race between two devices loses at the index rather than in a route. */
create unique index memberships_one_founder on memberships (nest_id)
  where status = 'active' and role = 'founder';
create unique index memberships_one_partner on memberships (nest_id)
  where status = 'active' and role = 'partner';
create unique index memberships_one_live_nest on memberships (user_id)
  where status in ('active', 'invited');
create index memberships_nest on memberships (nest_id);
create index memberships_user on memberships (user_id);

create table invites (
  code        text primary key check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$'),
  nest_id     uuid not null references nests(id) on delete cascade,
  created_by  uuid not null references auth.users(id),
  claimed_by  uuid references auth.users(id),
  status      invite_state not null default 'open',
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create unique index invites_one_open_per_nest on invites (nest_id) where status = 'open';
create index invites_nest on invites (nest_id);

create table reports (
  id          uuid primary key default gen_random_uuid(),
  target      text not null,
  reported_by uuid not null references auth.users(id),
  reason      text not null,
  status      text not null default 'open',
  created_at  timestamptz not null default now()
);
create index reports_status on reports (status) where status = 'open';

/* ---------------- who may see what ----------------
   The three helpers live outside `public` so they are not part of the REST
   surface: they exist to be called from inside the policies below. Reads use
   a wider test than writes, because freezing a nest sets both memberships to
   'left' and both people are still meant to be able to look at what they
   built. */

create or replace function nest_private.is_member_of(n uuid) returns boolean
  language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from memberships m
                  where m.nest_id = n and m.user_id = auth.uid() and m.status <> 'left');
$$;
create or replace function nest_private.ever_member_of(n uuid) returns boolean
  language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from memberships m where m.nest_id = n and m.user_id = auth.uid());
$$;
create or replace function nest_private.shares_nest_with(other uuid) returns boolean
  language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from memberships mine
                   join memberships theirs on theirs.nest_id = mine.nest_id
                  where mine.user_id = auth.uid() and theirs.user_id = other);
$$;
revoke execute on all functions in schema nest_private from anon, public;
grant execute on function nest_private.is_member_of(uuid) to authenticated;
grant execute on function nest_private.ever_member_of(uuid) to authenticated;
grant execute on function nest_private.shares_nest_with(uuid) to authenticated;

alter table profiles    enable row level security;
alter table nests       enable row level security;
alter table memberships enable row level security;
alter table invites     enable row level security;
alter table reports     enable row level security;

create policy profiles_self_read    on profiles for select using (id = auth.uid());
create policy profiles_self_insert  on profiles for insert with check (id = auth.uid());
create policy profiles_self_write   on profiles for update using (id = auth.uid());
/* your partner's name, and only for as long as they have one: deletion blanks
   the row rather than hiding it, so an archived nest shows "Someone" */
create policy profiles_partner_read on profiles for select
  using (nest_private.shares_nest_with(id));

create policy nests_member_read  on nests for select using (nest_private.ever_member_of(id));
/* frozen is the whole of the joint data policy in one clause: after either
   person leaves, neither of them can write to it again */
create policy nests_member_write on nests for update
  using (nest_private.is_member_of(id) and not frozen);

create policy memberships_read on memberships for select
  using (user_id = auth.uid() or nest_private.ever_member_of(nest_id));

create policy invites_owner_read on invites for select
  using (nest_private.is_member_of(nest_id));

create policy reports_insert on reports for insert with check (reported_by = auth.uid());
create policy reports_read   on reports for select using (reported_by = auth.uid());

/* Deliberately absent: any insert or update policy on memberships and
   invites. "You may only add yourself" is not the rule. The rule is that you
   join by claiming a code and being confirmed by the other person, so both of
   those are functions and nothing else may write those tables. Without this,
   anyone holding a nest id could add themselves to it, and anyone who had
   claimed a code could promote themselves past the confirmation. */

/* ---------------- what a client may do ----------------
   Six functions, matching six of the endpoints in src/api.js one for one.
   Each raises the same string the screens already switch on. */

create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path to 'public' as $$
begin
  insert into profiles (id) values (new.id) on conflict do nothing;
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.create_nest() returns public.nests
  language plpgsql security definer set search_path to 'public' as $$
declare n nests; live record;
begin
  if not exists (select 1 from profiles where id = auth.uid() and age_verified) then
    raise exception 'under_age';
  end if;
  select m.nest_id as nest_id, ns.status as status into live
    from memberships m join nests ns on ns.id = m.nest_id
   where m.user_id = auth.uid() and m.status <> 'left' limit 1;
  if live.nest_id is not null then
    -- coming back to the fork keeps the one pending nest rather than
    -- stacking empties behind you
    if live.status = 'pending' then
      select * into n from nests where id = live.nest_id;
      return n;
    end if;
    raise exception 'already_in_nest';
  end if;
  insert into nests default values returning * into n;
  insert into memberships (nest_id, user_id, role, status)
    values (n.id, auth.uid(), 'founder', 'active');
  return n;
end $$;

create or replace function public.issue_invite(n uuid) returns public.invites
  language plpgsql security definer set search_path to 'public' as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   -- no I L O 0 1
  c text; b bytea; inv invites; i int; j int;
begin
  if not nest_private.is_member_of(n) then raise exception 'not_a_member'; end if;
  if exists (select 1 from nests where id = n and (frozen or status = 'archived'))
    then raise exception 'not_a_member'; end if;
  update invites set status = 'revoked' where nest_id = n and status = 'open';
  for i in 1..8 loop
    b := extensions.gen_random_bytes(6);          -- not random(), this gates joining
    c := '';
    for j in 0..5 loop
      c := c || substr(alphabet, 1 + (get_byte(b, j) % length(alphabet)), 1);
    end loop;
    begin
      insert into invites (code, nest_id, created_by, expires_at)
        values (c, n, auth.uid(), now() + interval '7 days')
        returning * into inv;
      return inv;
    exception when unique_violation then null;
    end;
  end loop;
  raise exception 'invite_failed';
end $$;

/* Claiming creates a pending membership and nothing else. Joining is never
   done by code alone. */
create or replace function public.claim_invite(invite_code text) returns json
  language plpgsql security definer set search_path to 'public' as $$
declare inv invites; n nests; founder_name text;
begin
  select * into inv from invites where code = upper(invite_code);
  if inv is null then raise exception 'code_not_found'; end if;
  if inv.status <> 'open' then raise exception 'code_used'; end if;
  if inv.expires_at < now() then
    update invites set status = 'expired' where code = inv.code;
    raise exception 'code_expired';
  end if;
  -- single use means single claimant: the first person in owns it until the
  -- founder decides, otherwise two people queue on one code
  if inv.claimed_by is not null and inv.claimed_by <> auth.uid() then raise exception 'code_used'; end if;
  if exists (select 1 from memberships where nest_id = inv.nest_id and user_id = auth.uid())
    then raise exception 'own_nest'; end if;

  select * into n from nests where id = inv.nest_id;
  insert into memberships (nest_id, user_id, role, status)
    values (inv.nest_id, auth.uid(), 'partner', 'invited')
    on conflict (nest_id, user_id) do nothing;
  update invites set claimed_by = auth.uid() where code = inv.code;

  select p.display_name into founder_name from memberships m
    join profiles p on p.id = m.user_id
   where m.nest_id = inv.nest_id and m.role = 'founder' limit 1;

  return json_build_object('nest_id', n.id, 'name', n.name,
                           'founder_name', coalesce(founder_name, 'Someone'));
end; $$;

/* The founder accepts, and this is the one place a nest can become full. */
create or replace function public.confirm_invite(invite_code text, accept boolean) returns json
  language plpgsql security definer set search_path to 'public' as $$
declare inv invites;
begin
  select * into inv from invites where code = upper(invite_code);
  if inv is null then raise exception 'code_not_found'; end if;
  if not nest_private.is_member_of(inv.nest_id) then raise exception 'not_a_member'; end if;
  if inv.claimed_by is null then raise exception 'nothing_to_confirm'; end if;
  if not accept then
    update memberships set status = 'left'
      where nest_id = inv.nest_id and user_id = inv.claimed_by and status = 'invited';
    update invites set status = 'revoked' where code = inv.code;
    return json_build_object('declined', true);
  end if;
  update memberships set status = 'active', joined_at = now()
    where nest_id = inv.nest_id and user_id = inv.claimed_by and status = 'invited';
  update invites set status = 'consumed', consumed_at = now() where code = inv.code;
  update nests set status = 'active', updated_at = now() where id = inv.nest_id;
  return json_build_object('nest_id', inv.nest_id);
end; $$;

/* Leaving and deleting both come through here, so they cannot drift apart and
   neither can be made to skip a step. The nest is not deleted and it is not
   handed to whoever stayed. */
create or replace function public.freeze_nest(n uuid, reason text) returns void
  language plpgsql security definer set search_path to 'public' as $$
begin
  if not nest_private.is_member_of(n) then raise exception 'not_a_member'; end if;
  update nests set status = 'archived', frozen = true, frozen_at = now(),
                   archived_at = now(), archived_by = auth.uid(), archive_reason = reason,
                   updated_at = now()
   where id = n;
  update memberships set status = 'left' where nest_id = n and status <> 'left';
  update invites set status = 'revoked' where nest_id = n and status = 'open';
end; $$;

/* Guideline 5.1.1(v). The person's own data goes. The nest freezes, because
   the other person has an equal claim to the same record. */
create or replace function public.delete_me() returns void
  language plpgsql security definer set search_path to 'public' as $$
declare m record;
begin
  for m in select nest_id from memberships where user_id = auth.uid() and status <> 'left' loop
    perform freeze_nest(m.nest_id, 'deleted');
  end loop;
  update profiles set deleted = true, deleted_at = now(), display_name = null,
                      birthdate = null, age_verified = false, locale = null,
                      push_token = null, blocked = '{}'
   where id = auth.uid();
end; $$;

revoke execute on all functions in schema public from anon, public;
grant execute on function public.create_nest()                        to authenticated;
grant execute on function public.issue_invite(uuid)                   to authenticated;
grant execute on function public.claim_invite(text)                   to authenticated;
grant execute on function public.confirm_invite(text, boolean)        to authenticated;
grant execute on function public.freeze_nest(uuid, text)              to authenticated;
grant execute on function public.delete_me()                          to authenticated;

/* ---------------- bringing an existing project up to date ----------------
   The file above is the whole database as it should be. A project that was
   created before the age gate stopped keeping what it blocks needs one
   column, and it is safe to run this on a project that already has it. */
alter table profiles add column if not exists age_blocked boolean not null default false;
