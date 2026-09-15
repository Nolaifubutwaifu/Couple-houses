/* NEST :: economy v1. The database is the authority on money.

   Until this migration the whole game was one jsonb document the client
   wrote, and any member could also update the nests row directly, so a
   player could give themselves any number of coins, unlock every room and
   own every item. The street ranks homes by what is in them, which makes
   that a fairness problem for everyone else, not only a cheat.

   What moves server side:
   - coins, lifetime earnings and bond live in columns on nests
   - every earning is a row in `ledger`, paid by a function that checks the
     daily cap: one ritual, one duel, two memory rounds
   - every purchase is a row in `owned_items`, paid by `buy_item`
   - rooms unlock through `unlock_room`
   - the streak count and last check in are written only by `answer_ritual`

   What stays client side: where things stand in the room, the duel questions,
   stats, the showcase copy. `save_game` still accepts the document, but runs
   it through `enforce_game` first, which overwrites every server owned field
   and drops any item the nest does not own. A client that lies about its
   wallet saves the truth instead.

   Applied to the live `nest` project on 2026-09-15. Existing nests keep their
   balances, their rooms and every item already in their document. */

/* ---------------- prices, read by everyone ---------------- */
create table if not exists public.catalogue_items (
  id      text primary key,
  room    text not null,
  price   integer not null check (price >= 0),
  charm   integer not null default 0 check (charm >= 0),
  memento boolean not null default false
);
create table if not exists public.room_prices (
  id    text primary key,
  price integer not null check (price >= 0)
);
alter table public.catalogue_items enable row level security;
alter table public.room_prices     enable row level security;
drop policy if exists catalogue_read on public.catalogue_items;
drop policy if exists room_prices_read on public.room_prices;
create policy catalogue_read   on public.catalogue_items for select using (true);
create policy room_prices_read on public.room_prices     for select using (true);

/* ---------------- the wallet ---------------- */
alter table public.nests add column if not exists coins           integer not null default 260;
alter table public.nests add column if not exists lifetime_earned integer not null default 0;
alter table public.nests add column if not exists bond            integer not null default 0;
alter table public.nests add column if not exists rooms_unlocked  text[]  not null default '{living}';
alter table public.nests add column if not exists streak_last     date;

create table if not exists public.ledger (
  id         bigserial primary key,
  nest_id    uuid not null references public.nests(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,
  kind       text not null check (kind in ('first_ritual','ritual','duel','memory','buy','unlock','grant')),
  day        date,
  amount     integer not null,
  meta       jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create unique index if not exists ledger_first_ritual_once on public.ledger (nest_id) where kind = 'first_ritual';
create unique index if not exists ledger_ritual_per_day    on public.ledger (nest_id, day) where kind = 'ritual';
create unique index if not exists ledger_duel_per_day      on public.ledger (nest_id, day) where kind = 'duel';
create index        if not exists ledger_nest_day          on public.ledger (nest_id, day, kind);

create table if not exists public.owned_items (
  nest_id     uuid not null references public.nests(id) on delete cascade,
  instance_id text not null,
  item_id     text not null,
  created_at  timestamptz not null default now(),
  primary key (nest_id, instance_id)
);

create table if not exists public.ritual_answers (
  nest_id    uuid not null references public.nests(id) on delete cascade,
  day        date not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  answer     smallint not null check (answer between 0 and 3),
  created_at timestamptz not null default now(),
  primary key (nest_id, day, user_id)
);

alter table public.ledger         enable row level security;
alter table public.owned_items    enable row level security;
alter table public.ritual_answers enable row level security;
drop policy if exists ledger_member_read on public.ledger;
drop policy if exists owned_member_read on public.owned_items;
drop policy if exists ritual_member_read on public.ritual_answers;
create policy ledger_member_read on public.ledger         for select using (nest_private.ever_member_of(nest_id));
create policy owned_member_read  on public.owned_items    for select using (nest_private.ever_member_of(nest_id));
create policy ritual_member_read on public.ritual_answers for select using (nest_private.ever_member_of(nest_id));

/* ---------------- helpers ---------------- */

/* The client names the day, because the day is the couple's local calendar
   and the server has no idea where they live. What it cannot do is name a
   day that is not today somewhere on Earth. */
create or replace function nest_private.valid_day(d date) returns boolean
  language sql stable as $$
  select d between (now() at time zone 'utc')::date - 1 and (now() at time zone 'utc')::date + 1;
$$;

/* Every money function starts here: a member, of a paired nest that is not
   frozen, holding the row lock for the rest of the call so two phones cannot
   both spend the same coins. */
create or replace function nest_private.lock_nest(n uuid) returns public.nests
  language plpgsql security definer set search_path to 'public' as $$
declare r nests;
begin
  if not nest_private.is_member_of(n) then raise exception 'not_a_member'; end if;
  select * into r from nests where id = n for update;
  if r.id is null then raise exception 'no_nest'; end if;
  if r.frozen then raise exception 'frozen'; end if;
  if r.status <> 'active' then raise exception 'not_paired'; end if;
  return r;
end $$;

create or replace function nest_private.as_date(t text) returns date
  language plpgsql immutable as $$
begin
  if t is null or t !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return t::date;
exception when others then return null;
end $$;

/* The document as the database will store it: whatever the client said, with
   every server owned field replaced by the truth. */
create or replace function nest_private.enforce_game(r public.nests, doc jsonb) returns jsonb
  language plpgsql stable security definer set search_path to 'public' as $$
declare
  g jsonb := case when jsonb_typeof(doc) = 'object' then doc else '{}'::jsonb end;
  house jsonb; streak jsonb; rooms jsonb := '{}'; placed jsonb := '[]'; inv jsonb := '[]';
  seen text[] := '{}'; e jsonb; x record; d date; iid text;
begin
  g := g || jsonb_build_object(
    'wallet', jsonb_build_object('coins', r.coins, 'lifetimeEarned', r.lifetime_earned),
    'bond', r.bond,
    'firstRitualPaid', exists (select 1 from ledger where nest_id = r.id and kind = 'first_ritual'));

  streak := case when jsonb_typeof(g->'streak') = 'object' then g->'streak' else '{}'::jsonb end;
  streak := streak || jsonb_build_object('count', r.streak_count,
    'lastCheckIn', case when r.streak_last is null then null else to_char(r.streak_last, 'YYYY-MM-DD') end);
  d := nest_private.as_date(streak->>'day');
  if d is not null then
    for x in select ra.answer, m.role from ritual_answers ra
               join memberships m on m.nest_id = ra.nest_id and m.user_id = ra.user_id
              where ra.nest_id = r.id and ra.day = d loop
      if x.role = 'founder' then streak := streak || jsonb_build_object('aAns', x.answer, 'a', true);
      else                       streak := streak || jsonb_build_object('bAns', x.answer, 'b', true); end if;
    end loop;
  end if;
  g := g || jsonb_build_object('streak', streak);

  d := nest_private.as_date(g->'daily'->>'day');
  if d is not null then
    g := g || jsonb_build_object('daily', jsonb_build_object('day', g->'daily'->>'day',
      'duel',   (select count(*) from ledger where nest_id = r.id and day = d and kind = 'duel'),
      'memory', (select count(*) from ledger where nest_id = r.id and day = d and kind = 'memory')));
  end if;

  for x in select id from room_prices loop
    rooms := rooms || jsonb_build_object(x.id, jsonb_build_object('unlocked', x.id = any(r.rooms_unlocked)));
  end loop;

  house := case when jsonb_typeof(g->'house') = 'object' then g->'house' else '{}'::jsonb end;
  for e in select value from jsonb_array_elements(case when jsonb_typeof(house->'placed') = 'array'
                                                        then house->'placed' else '[]'::jsonb end) loop
    iid := e->>'instanceId';
    if iid is null or iid = any(seen) then continue; end if;
    if (iid = 'first' and e->>'itemId' = 'plant') or exists (select 1 from owned_items o
         where o.nest_id = r.id and o.instance_id = iid and o.item_id = e->>'itemId') then
      placed := placed || jsonb_build_array(e); seen := seen || iid;
    end if;
  end loop;
  for e in select value from jsonb_array_elements(case when jsonb_typeof(house->'inventory') = 'array'
                                                        then house->'inventory' else '[]'::jsonb end) loop
    iid := e->>'instanceId';
    if iid is null or iid = any(seen) then continue; end if;
    if exists (select 1 from owned_items o
         where o.nest_id = r.id and o.instance_id = iid and o.item_id = e->>'itemId') then
      inv := inv || jsonb_build_array(e); seen := seen || iid;
    end if;
  end loop;
  house := house || jsonb_build_object('rooms', rooms, 'placed', placed, 'inventory', inv);
  return g || jsonb_build_object('house', house);
end $$;

/* Owned things the document has lost track of go back into storage. Not part
   of every save, because an item in somebody's hands mid move is in neither
   list, and putting it back into storage would snatch it out of them. */
create or replace function nest_private.with_owned(r public.nests, doc jsonb) returns jsonb
  language plpgsql stable security definer set search_path to 'public' as $$
declare g jsonb := nest_private.enforce_game(r, doc); inv jsonb; have text[]; x record;
begin
  select coalesce(array_agg(v->>'instanceId'), '{}') into have
    from jsonb_array_elements((g->'house'->'placed') || (g->'house'->'inventory')) v;
  inv := g->'house'->'inventory';
  for x in select instance_id, item_id from owned_items
            where nest_id = r.id and not (instance_id = any(have)) order by created_at loop
    inv := inv || jsonb_build_array(jsonb_build_object('instanceId', x.instance_id, 'itemId', x.item_id));
  end loop;
  return jsonb_set(g, '{house,inventory}', inv);
end $$;

/* Write the document, move the revision on, and hand back both, so the caller
   adopts the truth in the same round trip. */
create or replace function nest_private.store_game(n uuid, doc jsonb) returns json
  language plpgsql security definer set search_path to 'public' as $$
declare rev integer;
begin
  update nests set game = doc, game_rev = game_rev + 1, updated_at = now()
   where id = n returning game_rev into rev;
  return json_build_object('rev', rev, 'game', doc);
end $$;

/* ---------------- earning ---------------- */

/* Each partner answers their own row. The second answer of the day pays: 40
   and the three starter items the first time a nest ever does it, and the
   streak rate after that. Answers for a day that is not today somewhere are
   refused, and a day older than the last check in records the answer but
   pays nothing. */
create or replace function public.answer_ritual(n uuid, d date, a integer) returns json
  language plpgsql security definer set search_path to 'public' as $$
declare r nests; answered integer; reward integer := 0; kind text; next_count integer;
        g jsonb; streak jsonb; paid boolean := false; out json;
begin
  r := nest_private.lock_nest(n);
  if not nest_private.valid_day(d) then raise exception 'bad_day'; end if;
  if a is null or a not between 0 and 3 then raise exception 'bad_answer'; end if;

  insert into ritual_answers (nest_id, day, user_id, answer) values (n, d, auth.uid(), a)
    on conflict do nothing;
  select count(*) into answered from ritual_answers ra
    join memberships m on m.nest_id = ra.nest_id and m.user_id = ra.user_id and m.status = 'active'
   where ra.nest_id = n and ra.day = d;

  if answered >= 2
     and not exists (select 1 from ledger l where l.nest_id = n and l.day = d and l.kind in ('ritual', 'first_ritual'))
     and (r.streak_last is null or d > r.streak_last) then
    next_count := case when r.streak_last = d - 1 then r.streak_count + 1 else 1 end;
    if not exists (select 1 from ledger l where l.nest_id = n and l.kind = 'first_ritual') then
      kind := 'first_ritual'; reward := 40;
      insert into owned_items (nest_id, instance_id, item_id)
        values (n, 'start_plant', 'plant'), (n, 'start_armchair', 'armchair'), (n, 'start_photos', 'photos')
        on conflict do nothing;
    else
      kind := 'ritual'; reward := 30 + least(3 * next_count, 60);
    end if;
    insert into ledger (nest_id, user_id, kind, day, amount, meta)
      values (n, auth.uid(), kind, d, reward, jsonb_build_object('streak', next_count));
    update nests set coins = coins + reward, lifetime_earned = lifetime_earned + reward,
                     bond = bond + 1, streak_count = next_count, streak_last = d
     where id = n returning * into r;
    paid := true;
  end if;

  g := case when jsonb_typeof(r.game) = 'object' then r.game else '{}'::jsonb end;
  streak := coalesce(g->'streak', '{}'::jsonb);
  if nest_private.as_date(streak->>'day') is distinct from d
     and coalesce(nest_private.as_date(streak->>'day'), d - 1) < d then
    streak := streak || jsonb_build_object('day', to_char(d, 'YYYY-MM-DD'),
                                           'a', false, 'b', false, 'aAns', null, 'bAns', null);
    g := g || jsonb_build_object('streak', streak);
  end if;
  g := case when paid and kind = 'first_ritual' then nest_private.with_owned(r, g)
            else nest_private.enforce_game(r, g) end;
  out := nest_private.store_game(n, g);
  return json_build_object('ok', true, 'paid', paid, 'reward', reward, 'both', answered >= 2,
                           'rev', out->'rev', 'game', out->'game');
end $$;

/* The duel pays from the round in the stored document, so the save that
   finished it has to land first. Matches are counted here, not reported. */
create or replace function public.finish_duel(n uuid, d date) returns json
  language plpgsql security definer set search_path to 'public' as $$
declare r nests; duel jsonb; q integer; i integer; matches integer := 0; reward integer := 0;
        paid boolean := false; out json;
begin
  r := nest_private.lock_nest(n);
  if not nest_private.valid_day(d) then raise exception 'bad_day'; end if;
  duel := r.game->'duel';
  if duel is null or jsonb_typeof(duel) <> 'object' or duel->>'day' is distinct from to_char(d, 'YYYY-MM-DD') then
    raise exception 'no_duel';
  end if;
  q := least(coalesce(jsonb_array_length(duel->'qs'), 0), 6);
  if q = 0 or coalesce(jsonb_array_length(duel->'answers'), 0) < q
           or coalesce(jsonb_array_length(duel->'guesses'), 0) < q then
    raise exception 'duel_unfinished';
  end if;
  for i in 0..q - 1 loop
    if (duel->'answers'->>i) = (duel->'guesses'->>i) then matches := matches + 1; end if;
  end loop;
  if not exists (select 1 from ledger where nest_id = n and day = d and kind = 'duel') then
    reward := matches * 9;
    insert into ledger (nest_id, user_id, kind, day, amount, meta)
      values (n, auth.uid(), 'duel', d, reward, jsonb_build_object('matches', matches));
    update nests set coins = coins + reward, lifetime_earned = lifetime_earned + reward
     where id = n returning * into r;
    paid := true;
  end if;
  out := nest_private.store_game(n, nest_private.enforce_game(r, r.game));
  return json_build_object('ok', true, 'paid', paid, 'reward', reward, 'matches', matches,
                           'rev', out->'rev', 'game', out->'game');
end $$;

/* Memory is solo, so the moves are the player's word. The cap is what keeps
   that honest: two rounds a day, 30 at the very most. */
create or replace function public.finish_memory(n uuid, d date, moves integer) returns json
  language plpgsql security definer set search_path to 'public' as $$
declare r nests; played integer; reward integer := 0; paid boolean := false; out json;
begin
  r := nest_private.lock_nest(n);
  if not nest_private.valid_day(d) then raise exception 'bad_day'; end if;
  select count(*) into played from ledger where nest_id = n and day = d and kind = 'memory';
  if played < 2 then
    reward := greatest(8, 30 - greatest(0, greatest(coalesce(moves, 0), 6) - 10) * 3);
    insert into ledger (nest_id, user_id, kind, day, amount, meta)
      values (n, auth.uid(), 'memory', d, reward, jsonb_build_object('moves', moves));
    update nests set coins = coins + reward, lifetime_earned = lifetime_earned + reward
     where id = n returning * into r;
    paid := true;
  end if;
  out := nest_private.store_game(n, nest_private.enforce_game(r, r.game));
  return json_build_object('ok', true, 'paid', paid, 'reward', reward,
                           'rev', out->'rev', 'game', out->'game');
end $$;

/* ---------------- spending ---------------- */
create or replace function public.buy_item(n uuid, item text, instance text) returns json
  language plpgsql security definer set search_path to 'public' as $$
declare r nests; it catalogue_items; g jsonb; out json;
begin
  r := nest_private.lock_nest(n);
  select * into it from catalogue_items where id = item;
  if it.id is null then raise exception 'no_item'; end if;
  if instance is null or instance !~ '^[A-Za-z0-9_-]{4,48}$' then raise exception 'bad_instance'; end if;
  if it.room <> 'any' and not (it.room = any(r.rooms_unlocked)) then raise exception 'room_locked'; end if;
  if exists (select 1 from owned_items where nest_id = n and instance_id = instance) then
    raise exception 'duplicate_instance';
  end if;
  if r.coins < it.price then raise exception 'not_enough_coins'; end if;

  insert into owned_items (nest_id, instance_id, item_id) values (n, instance, item);
  insert into ledger (nest_id, user_id, kind, amount, meta)
    values (n, auth.uid(), 'buy', -it.price, jsonb_build_object('item', item, 'instance', instance));
  update nests set coins = coins - it.price where id = n returning * into r;

  g := case when jsonb_typeof(r.game) = 'object' then r.game else '{}'::jsonb end;
  if not exists (select 1 from jsonb_array_elements(coalesce(g->'house'->'inventory', '[]') ||
                                                    coalesce(g->'house'->'placed', '[]')) v
                  where v->>'instanceId' = instance) then
    g := jsonb_set(g, '{house}', coalesce(g->'house', '{}'::jsonb), true);
    g := jsonb_set(g, '{house,inventory}', coalesce(g->'house'->'inventory', '[]'::jsonb) ||
                   jsonb_build_array(jsonb_build_object('instanceId', instance, 'itemId', item)), true);
  end if;
  out := nest_private.store_game(n, nest_private.enforce_game(r, g));
  return json_build_object('ok', true, 'coins', r.coins, 'rev', out->'rev', 'game', out->'game');
end $$;

create or replace function public.unlock_room(n uuid, room text) returns json
  language plpgsql security definer set search_path to 'public' as $$
declare r nests; p integer; out json;
begin
  r := nest_private.lock_nest(n);
  select price into p from room_prices where id = room;
  if p is null then raise exception 'no_room'; end if;
  if not (room = any(r.rooms_unlocked)) then
    if r.coins < p then raise exception 'not_enough_coins'; end if;
    insert into ledger (nest_id, user_id, kind, amount, meta)
      values (n, auth.uid(), 'unlock', -p, jsonb_build_object('room', room));
    update nests set coins = coins - p, rooms_unlocked = rooms_unlocked || room
     where id = n returning * into r;
  end if;
  out := nest_private.store_game(n, nest_private.enforce_game(r, r.game));
  return json_build_object('ok', true, 'coins', r.coins, 'rev', out->'rev', 'game', out->'game');
end $$;

/* Called when a person enters the app, the one moment nothing is in anybody's
   hands, so every owned thing the document lost is safely back in storage. */
create or replace function public.restore_items(n uuid) returns json
  language plpgsql security definer set search_path to 'public' as $$
declare r nests; g jsonb; out json;
begin
  if not nest_private.is_member_of(n) then raise exception 'not_a_member'; end if;
  select * into r from nests where id = n for update;
  if r.id is null or r.frozen or jsonb_typeof(r.game) <> 'object' or not (r.game ? 'house') then
    return json_build_object('ok', true, 'rev', r.game_rev, 'game', r.game);
  end if;
  g := nest_private.with_owned(r, r.game);
  if g = r.game then return json_build_object('ok', true, 'rev', r.game_rev, 'game', r.game); end if;
  out := nest_private.store_game(n, g);
  return json_build_object('ok', true, 'rev', out->'rev', 'game', out->'game');
end $$;

/* ---------------- the profile, and the age check ----------------
   The client used to write age_verified itself, which made the age gate a
   suggestion. It is decided here now, and a refusal is a value rather than an
   exception, because an exception would roll back the one thing a refusal
   has to keep: the flag that stops it being a retry loop. */
create or replace function public.set_profile(display_name text, birthdate date, locale text default null)
  returns json language plpgsql security definer set search_path to 'public' as $$
declare nm text := btrim(coalesce(display_name, '')); p profiles;
begin
  if auth.uid() is null then raise exception 'no_session'; end if;
  if char_length(nm) not between 1 and 24 then raise exception 'bad_name'; end if;
  if birthdate is null or birthdate > current_date then raise exception 'bad_birthdate'; end if;
  insert into profiles (id) values (auth.uid()) on conflict do nothing;
  if extract(year from age(current_date, birthdate)) < 16 then
    update profiles set display_name = null, birthdate = null, age_verified = false, age_blocked = true
     where id = auth.uid();
    return json_build_object('error', 'under_age', 'min_age', 16);
  end if;
  update profiles set display_name = nm, birthdate = set_profile.birthdate, age_verified = true,
                      age_blocked = false, locale = coalesce(set_profile.locale, profiles.locale)
   where id = auth.uid() and not age_blocked returning * into p;
  if p.id is null then return json_build_object('error', 'under_age', 'min_age', 16); end if;
  return json_build_object('user', to_json(p));
end $$;

/* delete_me also takes the person's own ritual answers, which are theirs. */
create or replace function public.delete_me() returns void
  language plpgsql security definer set search_path to 'public' as $$
declare m record;
begin
  for m in select nest_id from memberships where user_id = auth.uid() and status <> 'left' loop
    perform freeze_nest(m.nest_id, 'deleted');
  end loop;
  delete from ritual_answers where user_id = auth.uid();
  update profiles set deleted = true, deleted_at = now(), display_name = null,
                      birthdate = null, age_verified = false, locale = null,
                      push_token = null, blocked = '{}'
   where id = auth.uid();
end; $$;


/* Execute rights for the functions above. The table grants that stop a client
   writing coins directly are in 004, applied with the client that stops
   needing them. */
revoke execute on function nest_private.valid_day(date)                    from anon, public;
revoke execute on function nest_private.lock_nest(uuid)                    from anon, public, authenticated;
revoke execute on function nest_private.as_date(text)                      from anon, public;
revoke execute on function nest_private.enforce_game(public.nests, jsonb)  from anon, public, authenticated;
revoke execute on function nest_private.with_owned(public.nests, jsonb)    from anon, public, authenticated;
revoke execute on function nest_private.store_game(uuid, jsonb)            from anon, public, authenticated;
revoke execute on function public.answer_ritual(uuid, date, integer)       from anon, public;
revoke execute on function public.finish_duel(uuid, date)                  from anon, public;
revoke execute on function public.finish_memory(uuid, date, integer)       from anon, public;
revoke execute on function public.buy_item(uuid, text, text)               from anon, public;
revoke execute on function public.unlock_room(uuid, text)                  from anon, public;
revoke execute on function public.restore_items(uuid)                      from anon, public;
revoke execute on function public.set_profile(text, date, text)            from anon, public;
revoke execute on function public.delete_me()                              from anon, public;
grant  execute on function public.answer_ritual(uuid, date, integer)       to authenticated;
grant  execute on function public.finish_duel(uuid, date)                  to authenticated;
grant  execute on function public.finish_memory(uuid, date, integer)       to authenticated;
grant  execute on function public.buy_item(uuid, text, text)               to authenticated;
grant  execute on function public.unlock_room(uuid, text)                  to authenticated;
grant  execute on function public.restore_items(uuid)                      to authenticated;
grant  execute on function public.set_profile(text, date, text)            to authenticated;
grant  execute on function public.delete_me()                              to authenticated;
