/* NEST :: economy v1, the switch over.

   001 added the money functions without changing anything the deployed client
   already relies on. This is the half that does: save_game starts enforcing
   the server owned fields, and the column grants stop a client writing coins,
   rooms or its own age check directly. Applied together with the client that
   calls the new functions, so there is no window where the old client is
   locked out of a write it still makes. */

/* ---------------- saving the document ---------------- */
create or replace function public.save_game(n uuid, doc jsonb, base_rev integer) returns json
  language plpgsql security definer set search_path to 'public' as $$
declare r nests; clean jsonb;
begin
  if not nest_private.is_member_of(n) then raise exception 'not_a_member'; end if;
  select * into r from nests where id = n for update;
  if r.id is null then raise exception 'no_nest'; end if;
  if r.frozen then raise exception 'frozen'; end if;
  if base_rev is distinct from r.game_rev then
    return json_build_object('ok', false, 'rev', r.game_rev, 'game', r.game);
  end if;
  clean := nest_private.enforce_game(r, doc);
  update nests set game = clean, game_rev = r.game_rev + 1, updated_at = now() where id = n;
  return json_build_object('ok', true, 'rev', r.game_rev + 1, 'game', clean);
end $$;


/* ---------------- who may write what ----------------
   Row policies said "a member may update the nest", which covered every
   column, coins included. Column grants narrow that to the three settings the
   client legitimately changes. Everything else goes through a function. */
revoke insert, update, delete on all tables in schema public from anon;
revoke insert, update, delete on public.nests, public.memberships, public.invites from authenticated;
grant  update (name, base_material, terrain_type, updated_at) on public.nests to authenticated;
revoke insert, update, delete on public.profiles from authenticated;
grant  insert (id) on public.profiles to authenticated;
grant  update (locale, blocked, push_token) on public.profiles to authenticated;
revoke update, delete on public.reports from authenticated;
revoke insert, update, delete on public.catalogue_items, public.room_prices, public.ledger,
                                 public.owned_items, public.ritual_answers from authenticated;

revoke execute on function public.save_game(uuid, jsonb, integer)          from anon, public;
grant  execute on function public.save_game(uuid, jsonb, integer)          to authenticated;
