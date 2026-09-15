/* NEST :: economy v1, carrying existing nests across.

   Every nest that already has a game keeps what its document says: the coins,
   the lifetime total, the bond, the rooms it unlocked, the streak, and every
   item standing in the room or waiting in storage. A nest that has earned
   anything has been through its first ritual, so it is marked as paid and
   will not be paid the starter reward a second time. Nothing here takes
   anything away. */

create or replace function nest_private.int_or(t text, fallback integer) returns integer
  language sql immutable as $$
  select case when t ~ '^-?\d{1,9}$' then t::integer else fallback end;
$$;

update public.nests n set
  coins           = greatest(0, nest_private.int_or(n.game->'wallet'->>'coins', 260)),
  lifetime_earned = greatest(0, nest_private.int_or(n.game->'wallet'->>'lifetimeEarned', 0)),
  bond            = greatest(0, nest_private.int_or(n.game->>'bond', 0)),
  rooms_unlocked  = array(select distinct x from unnest(array['living'] || coalesce(
                      (select array_agg(key) from jsonb_each(case when jsonb_typeof(n.game->'house'->'rooms') = 'object'
                                                                 then n.game->'house'->'rooms' else '{}'::jsonb end)
                        where value->>'unlocked' = 'true'
                          and key in (select id from public.room_prices)), '{}')) x),
  streak_count    = greatest(0, nest_private.int_or(n.game->'streak'->>'count', n.streak_count)),
  streak_last     = nest_private.as_date(n.game->'streak'->>'lastCheckIn')
where n.game ? 'wallet';

insert into public.owned_items (nest_id, instance_id, item_id)
select n.id, e->>'instanceId', e->>'itemId'
  from public.nests n,
       jsonb_array_elements(
         (case when jsonb_typeof(n.game->'house'->'placed') = 'array' then n.game->'house'->'placed' else '[]'::jsonb end) ||
         (case when jsonb_typeof(n.game->'house'->'inventory') = 'array' then n.game->'house'->'inventory' else '[]'::jsonb end)) e
 where n.game ? 'wallet'
   and e->>'instanceId' is not null and e->>'instanceId' <> 'first'
   and e->>'itemId' in (select id from public.catalogue_items)
on conflict do nothing;

insert into public.ledger (nest_id, kind, amount, meta)
select n.id, 'first_ritual', 0, '{"migrated": true}'::jsonb
  from public.nests n
 where n.game ? 'wallet'
   and (nest_private.int_or(n.game->'wallet'->>'lifetimeEarned', 0) > 0
        or n.game->>'firstRitualPaid' = 'true'
        or exists (select 1 from public.owned_items o where o.nest_id = n.id and o.instance_id like 'start\_%'))
on conflict do nothing;

revoke execute on function nest_private.int_or(text, integer) from anon, public;
