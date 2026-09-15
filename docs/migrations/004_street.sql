/* NEST :: the street, for real.

   The street was six couples written into the page. A published home is now a
   row other people can see: a snapshot of what is standing in it, ranked by
   charm the server adds up from its own price list, with hearts counted once
   per person. Every write goes through a function, and the tables have no
   policies at all, so nothing reaches them from a client except through
   those.

   Moderation, Guideline 1.2: the publish filter runs here, not on the phone;
   three separate reports hide a home from everyone until a person looks at
   it; a frozen nest leaves the street by itself. The word list lives in
   `moderation_terms` so it can be kept up to date from the dashboard without
   a deploy. */

create table if not exists public.street_homes (
  nest_id      uuid primary key references public.nests(id) on delete cascade,
  name         text not null,
  partners     text not null,
  tagline      text not null default '',
  since        date,
  placed       jsonb not null default '[]',
  rooms        text[] not null default '{living}',
  charm        integer not null default 0,
  likes        integer not null default 0,
  state        text not null default 'steady',
  hidden       boolean not null default false,
  published_at timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists street_rank on public.street_homes (charm desc, likes desc) where not hidden;

create table if not exists public.street_likes (
  nest_id    uuid not null references public.street_homes(nest_id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (nest_id, user_id)
);

create table if not exists public.moderation_terms (
  term text primary key check (char_length(term) between 2 and 60)
);

alter table public.street_homes     enable row level security;
alter table public.street_likes     enable row level security;
alter table public.moderation_terms enable row level security;
revoke all on public.street_homes, public.street_likes, public.moderation_terms from anon, authenticated;

/* A reason to refuse, or null. Links, emails and phone numbers are refused
   for the couple's own safety as much as anybody else's. */
create or replace function nest_private.moderate(t text) returns text
  language plpgsql stable security definer set search_path to 'public' as $$
declare s text := lower(coalesce(t, ''));
begin
  if btrim(s) = '' then return null; end if;
  if exists (select 1 from moderation_terms m where s like '%' || lower(m.term) || '%') then
    return 'That word cannot go on the street.';
  end if;
  if s ~ '(https?://|www\.|\.(com|net|org|io|co|app|xyz|au)(\s|/|$))' then return 'Links are not allowed here.'; end if;
  if s ~ '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' then return 'Leave your email out of it, for your own sake.'; end if;
  if s ~ '\+?[0-9][0-9 ().-]{7,}[0-9]' then return 'Leave phone numbers out of it, for your own sake.'; end if;
  return null;
end $$;

create or replace function nest_private.charm_of(placed jsonb) returns integer
  language sql stable security definer set search_path to 'public' as $$
  select coalesce(sum(c.charm), 0)::integer
    from jsonb_array_elements(case when jsonb_typeof(placed) = 'array' then placed else '[]'::jsonb end) e
    join catalogue_items c on c.id = e->>'itemId';
$$;

/* the weather a visitor sees, from the same streak the couple's own dome uses */
create or replace function nest_private.dome_state(r public.nests) returns text
  language sql stable as $$
  select case
    when r.streak_last is null then 'new'
    when current_date - r.streak_last >= 3 then 'resting'
    when r.streak_count >= 10 then 'strong'
    when r.streak_count >= 3 then 'steady'
    else 'new' end;
$$;

/* A published home follows the house: every stored document refreshes the
   snapshot, so the street shows what is really there. */
create or replace function nest_private.refresh_street(r public.nests, doc jsonb) returns void
  language plpgsql security definer set search_path to 'public' as $$
begin
  update street_homes set
    placed = coalesce(doc->'house'->'placed', '[]'::jsonb),
    rooms = r.rooms_unlocked,
    charm = nest_private.charm_of(doc->'house'->'placed'),
    name = coalesce(r.name, name),
    state = nest_private.dome_state(r),
    updated_at = now()
   where nest_id = r.id;
end $$;

/* store_game again, now keeping the street in step */
create or replace function nest_private.store_game(n uuid, doc jsonb) returns json
  language plpgsql security definer set search_path to 'public' as $$
declare r nests;
begin
  update nests set game = doc, game_rev = game_rev + 1, updated_at = now()
   where id = n returning * into r;
  perform nest_private.refresh_street(r, doc);
  return json_build_object('rev', r.game_rev, 'game', doc);
end $$;

create or replace function public.publish_home(n uuid, tagline text) returns json
  language plpgsql security definer set search_path to 'public' as $$
declare r nests; reason text; line text := left(btrim(coalesce(tagline, '')), 52); names text; g jsonb; out json;
begin
  r := nest_private.lock_nest(n);
  reason := coalesce(nest_private.moderate(line), nest_private.moderate(r.name));
  if reason is not null then return json_build_object('ok', false, 'reason', reason); end if;
  select string_agg(coalesce(p.display_name, 'Someone'), ' and ' order by m.role) into names
    from memberships m join profiles p on p.id = m.user_id
   where m.nest_id = n and m.status = 'active';
  insert into street_homes (nest_id, name, partners, tagline, since, placed, rooms, charm, state)
  values (n, coalesce(r.name, 'Our nest'), coalesce(names, 'Two people'), line, r.created_at::date,
          coalesce(r.game->'house'->'placed', '[]'::jsonb), r.rooms_unlocked,
          nest_private.charm_of(r.game->'house'->'placed'), nest_private.dome_state(r))
  on conflict (nest_id) do update set tagline = excluded.tagline, partners = excluded.partners,
    name = excluded.name, placed = excluded.placed, rooms = excluded.rooms, charm = excluded.charm,
    state = excluded.state, updated_at = now();
  g := case when jsonb_typeof(r.game) = 'object' then r.game else '{}'::jsonb end;
  g := g || jsonb_build_object('showcase', coalesce(g->'showcase', '{}'::jsonb) ||
                                           jsonb_build_object('published', true, 'tagline', line));
  out := nest_private.store_game(n, nest_private.enforce_game(r, g));
  return json_build_object('ok', true, 'tagline', line, 'rev', out->'rev', 'game', out->'game');
end $$;

create or replace function public.unpublish_home(n uuid) returns json
  language plpgsql security definer set search_path to 'public' as $$
declare r nests; g jsonb; out json;
begin
  r := nest_private.lock_nest(n);
  delete from street_homes where nest_id = n;
  g := case when jsonb_typeof(r.game) = 'object' then r.game else '{}'::jsonb end;
  g := g || jsonb_build_object('showcase', coalesce(g->'showcase', '{}'::jsonb) ||
                                           jsonb_build_object('published', false));
  out := nest_private.store_game(n, nest_private.enforce_game(r, g));
  return json_build_object('ok', true, 'rev', out->'rev', 'game', out->'game');
end $$;

/* The top of the street, less whatever this person has blocked or reported.
   Their own home is always in it, hidden or not, so they can see where it
   stands and why it might not be showing. */
create or replace function public.list_street(lim integer default 40) returns json
  language plpgsql stable security definer set search_path to 'public' as $$
declare me uuid := auth.uid(); blocked text[]; mine uuid[];
begin
  if me is null then raise exception 'no_session'; end if;
  select coalesce(p.blocked, '{}') into blocked from profiles p where p.id = me;
  select coalesce(array_agg(m.nest_id), '{}') into mine from memberships m where m.user_id = me and m.status = 'active';
  return coalesce((
    select json_agg(h) from (
      select s.nest_id as id, s.name, s.partners, s.tagline, s.since, s.placed, s.rooms, s.charm,
             s.likes, s.state, s.hidden, (s.nest_id = any(mine)) as mine,
             exists (select 1 from street_likes l where l.nest_id = s.nest_id and l.user_id = me) as liked
        from street_homes s
       where (s.nest_id = any(mine)) or (not s.hidden and not (s.nest_id::text = any(coalesce(blocked, '{}'))))
       order by s.charm desc, s.likes desc, s.updated_at desc
       limit least(greatest(coalesce(lim, 40), 1), 100)) h), '[]'::json);
end $$;

create or replace function public.toggle_like(target uuid) returns json
  language plpgsql security definer set search_path to 'public' as $$
declare me uuid := auth.uid(); liked boolean; total integer;
begin
  if me is null then raise exception 'no_session'; end if;
  if not exists (select 1 from street_homes where nest_id = target) then raise exception 'no_home'; end if;
  if nest_private.ever_member_of(target) then raise exception 'own_home'; end if;
  delete from street_likes where nest_id = target and user_id = me;
  if found then liked := false;
  else insert into street_likes (nest_id, user_id) values (target, me); liked := true; end if;
  select count(*) into total from street_likes where nest_id = target;
  update street_homes set likes = total where nest_id = target;
  return json_build_object('liked', liked, 'likes', total);
end $$;

/* three different people is a pattern, not a grudge: the home comes off the
   street for everyone until a person reviews the reports */
create or replace function nest_private.on_report() returns trigger
  language plpgsql security definer set search_path to 'public' as $$
begin
  if new.target ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    update street_homes set hidden = true
     where nest_id = new.target::uuid
       and (select count(distinct reported_by) from reports where target = new.target and status = 'open') >= 3;
  end if;
  return new;
end $$;
drop trigger if exists reports_hide_home on public.reports;
create trigger reports_hide_home after insert on public.reports
  for each row execute function nest_private.on_report();

/* a frozen nest is nobody's to show */
create or replace function nest_private.on_freeze() returns trigger
  language plpgsql security definer set search_path to 'public' as $$
begin
  if new.frozen and not coalesce(old.frozen, false) then
    delete from street_homes where nest_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists nests_leave_street on public.nests;
create trigger nests_leave_street after update of frozen on public.nests
  for each row execute function nest_private.on_freeze();

revoke execute on function nest_private.moderate(text)                 from anon, public, authenticated;
revoke execute on function nest_private.charm_of(jsonb)                from anon, public, authenticated;
revoke execute on function nest_private.dome_state(public.nests)       from anon, public, authenticated;
revoke execute on function nest_private.refresh_street(public.nests, jsonb) from anon, public, authenticated;
revoke execute on function nest_private.store_game(uuid, jsonb)        from anon, public, authenticated;
revoke execute on function nest_private.on_report()                    from anon, public, authenticated;
revoke execute on function nest_private.on_freeze()                    from anon, public, authenticated;
revoke execute on function public.publish_home(uuid, text)             from anon, public;
revoke execute on function public.unpublish_home(uuid)                 from anon, public;
revoke execute on function public.list_street(integer)                 from anon, public;
revoke execute on function public.toggle_like(uuid)                    from anon, public;
grant  execute on function public.publish_home(uuid, text)             to authenticated;
grant  execute on function public.unpublish_home(uuid)                 to authenticated;
grant  execute on function public.list_street(integer)                 to authenticated;
grant  execute on function public.toggle_like(uuid)                    to authenticated;
