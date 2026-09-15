/* NEST :: monitoring and push. Applied to the live `nest` project on 2026-09-15.

   Monitoring: two insert only tables. A client can add an error or an event
   and can never read either back; a person reads them in the dashboard. Both
   are pruned after ninety days by the `nest-retention` cron job.

   Push: subscriptions are written through two functions, never directly. The
   VAPID key pair and the cron secret live in `nest_private.push_keys`, which
   no client role can reach; the `push` edge function (supabase/functions/push)
   creates the pair the first time it is asked for the public key, so the
   private half never passes through a repository or a terminal. pg_cron calls
   the function hourly, and the function sends the reminder to whoever it is
   seven in the evening for. */

create extension if not exists pg_net;
create extension if not exists pg_cron;

/* ---------------- monitoring ---------------- */
create table if not exists public.client_errors (
  id          bigserial primary key,
  user_id     uuid default auth.uid() references auth.users(id) on delete set null,
  message     text not null check (char_length(message) <= 500),
  stack       text check (char_length(stack) <= 4000),
  source      text check (char_length(source) <= 300),
  screen      text check (char_length(screen) <= 60),
  ua          text check (char_length(ua) <= 300),
  app_version text check (char_length(app_version) <= 40),
  created_at  timestamptz not null default now()
);
create table if not exists public.client_events (
  id         bigserial primary key,
  user_id    uuid default auth.uid() references auth.users(id) on delete set null,
  name       text not null check (name ~ '^[a-z_]{2,40}$'),
  props      jsonb not null default '{}' check (pg_column_size(props) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists client_errors_recent on public.client_errors (created_at desc);
create index if not exists client_events_name on public.client_events (name, created_at desc);
alter table public.client_errors enable row level security;
alter table public.client_events enable row level security;
revoke all on public.client_errors, public.client_events from anon, authenticated;
grant insert (message, stack, source, screen, ua, app_version) on public.client_errors to anon, authenticated;
grant insert (name, props) on public.client_events to anon, authenticated;
grant usage on sequence public.client_errors_id_seq, public.client_events_id_seq to anon, authenticated;
drop policy if exists client_errors_insert on public.client_errors;
drop policy if exists client_events_insert on public.client_events;
create policy client_errors_insert on public.client_errors for insert to anon, authenticated
  with check (user_id is not distinct from auth.uid());
create policy client_events_insert on public.client_events for insert to anon, authenticated
  with check (user_id is not distinct from auth.uid());

/* ---------------- push ---------------- */
create table if not exists public.push_subscriptions (
  endpoint      text primary key check (endpoint ~ '^https://' and char_length(endpoint) <= 800),
  user_id       uuid not null references auth.users(id) on delete cascade,
  p256dh        text not null check (char_length(p256dh) <= 200),
  auth          text not null check (char_length(auth) <= 100),
  tz_offset     integer not null default 0 check (tz_offset between -840 and 840),
  created_at    timestamptz not null default now(),
  last_sent_at  timestamptz,
  daily_sent_at timestamptz,
  failures      integer not null default 0
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

create table if not exists nest_private.push_keys (
  id          integer primary key default 1 check (id = 1),
  public_key  text not null,
  private_key text not null,
  subject     text not null,
  cron_secret text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  created_at  timestamptz not null default now()
);
create table if not exists nest_private.push_log (
  nest_id uuid not null,
  sender  uuid not null,
  kind    text not null,
  sent_at timestamptz not null default now()
);
create index if not exists push_log_recent on nest_private.push_log (nest_id, sender, kind, sent_at desc);
revoke all on nest_private.push_keys, nest_private.push_log from anon, authenticated, public;

create or replace function public.save_push_subscription(endpoint text, p256dh text, auth text, tz_offset integer)
  returns json language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'no_session'; end if;
  insert into push_subscriptions (endpoint, user_id, p256dh, auth, tz_offset)
  values (save_push_subscription.endpoint, auth.uid(), save_push_subscription.p256dh,
          save_push_subscription.auth, greatest(-840, least(840, coalesce(save_push_subscription.tz_offset, 0))))
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth,
    tz_offset = excluded.tz_offset, failures = 0;
  return json_build_object('ok', true);
end $$;

create or replace function public.delete_push_subscription(endpoint text)
  returns json language plpgsql security definer set search_path to 'public' as $$
begin
  delete from push_subscriptions p where p.endpoint = delete_push_subscription.endpoint and p.user_id = auth.uid();
  return json_build_object('ok', true);
end $$;

create or replace function public.push_admin_keys() returns json
  language sql stable security definer set search_path to 'public' as $$
  select to_json(k) from nest_private.push_keys k where k.id = 1;
$$;

create or replace function public.push_admin_set_keys(pub text, priv text, subj text) returns json
  language plpgsql security definer set search_path to 'public' as $$
begin
  insert into nest_private.push_keys (id, public_key, private_key, subject) values (1, pub, priv, subj)
    on conflict (id) do nothing;
  return json_build_object('ok', true);
end $$;

/* the other active member, if the sender really is in that nest, and not more
   than once per kind in the window, so moving six chairs is one notification */
create or replace function public.push_admin_partner_targets(n uuid, sender uuid, kind text, minutes integer)
  returns table (endpoint text, p256dh text, auth text, sender_name text)
  language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from memberships m join nests ns on ns.id = m.nest_id
                  where m.nest_id = n and m.user_id = sender and m.status = 'active'
                    and ns.status = 'active' and not ns.frozen) then
    return;
  end if;
  if exists (select 1 from nest_private.push_log l
              where l.nest_id = n and l.sender = push_admin_partner_targets.sender and l.kind = push_admin_partner_targets.kind
                and l.sent_at > now() - make_interval(mins => greatest(1, minutes))) then
    return;
  end if;
  insert into nest_private.push_log (nest_id, sender, kind) values (n, sender, kind);
  return query
    select p.endpoint, p.p256dh, p.auth, (select display_name from profiles where id = push_admin_partner_targets.sender)
      from memberships m join push_subscriptions p on p.user_id = m.user_id
     where m.nest_id = n and m.status = 'active' and m.user_id <> push_admin_partner_targets.sender;
end $$;

/* seven in the evening local time, for anyone whose nest has not done today's
   question yet, claimed as it is read so an overlapping run cannot send twice */
create or replace function public.push_admin_daily_targets()
  returns table (endpoint text, p256dh text, auth text, partner_answered boolean)
  language plpgsql security definer set search_path to 'public' as $$
begin
  return query
  with due as (
    select p.endpoint, p.user_id, m.nest_id,
           ((now() at time zone 'utc') + make_interval(mins => p.tz_offset))::date as local_day
      from push_subscriptions p
      join memberships m on m.user_id = p.user_id and m.status = 'active'
      join nests ns on ns.id = m.nest_id and ns.status = 'active' and not ns.frozen
     where extract(hour from (now() at time zone 'utc') + make_interval(mins => p.tz_offset)) = 19
       and (p.daily_sent_at is null or p.daily_sent_at < now() - interval '20 hours')
  ), open_days as (
    select d.* from due d
     where not exists (select 1 from ledger l where l.nest_id = d.nest_id and l.day = d.local_day
                         and l.kind in ('ritual', 'first_ritual'))
       and not exists (select 1 from ritual_answers ra where ra.nest_id = d.nest_id
                         and ra.day = d.local_day and ra.user_id = d.user_id)
  ), claimed as (
    update push_subscriptions p set daily_sent_at = now()
      from open_days o where p.endpoint = o.endpoint
    returning p.endpoint, p.p256dh, p.auth, o.nest_id, o.local_day, o.user_id
  )
  select c.endpoint, c.p256dh, c.auth,
         exists (select 1 from ritual_answers ra where ra.nest_id = c.nest_id and ra.day = c.local_day
                   and ra.user_id <> c.user_id)
    from claimed c;
end $$;

create or replace function public.push_admin_mark(ep text, ok boolean, gone boolean) returns void
  language plpgsql security definer set search_path to 'public' as $$
begin
  if gone then delete from push_subscriptions where endpoint = ep; return; end if;
  if ok then update push_subscriptions set last_sent_at = now(), failures = 0 where endpoint = ep;
  else
    update push_subscriptions set failures = failures + 1 where endpoint = ep;
    delete from push_subscriptions where endpoint = ep and failures >= 5;
  end if;
end $$;

create or replace function nest_private.push_cron() returns void
  language plpgsql security definer set search_path to 'public' as $$
declare secret text;
begin
  select cron_secret into secret from nest_private.push_keys where id = 1;
  if secret is null then return; end if;
  perform net.http_post(
    url := 'https://odwvgdabygvhtgmbltgp.supabase.co/functions/v1/push',
    body := jsonb_build_object('action', 'daily'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-nest-cron', secret));
end $$;

create or replace function public.delete_me() returns void
  language plpgsql security definer set search_path to 'public' as $$
declare m record;
begin
  for m in select nest_id from memberships where user_id = auth.uid() and status <> 'left' loop
    perform freeze_nest(m.nest_id, 'deleted');
  end loop;
  delete from ritual_answers where user_id = auth.uid();
  delete from push_subscriptions where user_id = auth.uid();
  update profiles set deleted = true, deleted_at = now(), display_name = null,
                      birthdate = null, age_verified = false, locale = null,
                      push_token = null, blocked = '{}'
   where id = auth.uid();
end; $$;

revoke execute on function public.save_push_subscription(text, text, text, integer) from anon, public;
revoke execute on function public.delete_push_subscription(text)                    from anon, public;
grant  execute on function public.save_push_subscription(text, text, text, integer) to authenticated;
grant  execute on function public.delete_push_subscription(text)                    to authenticated;
revoke execute on function public.push_admin_keys()                                 from anon, authenticated, public;
revoke execute on function public.push_admin_set_keys(text, text, text)             from anon, authenticated, public;
revoke execute on function public.push_admin_partner_targets(uuid, uuid, text, integer) from anon, authenticated, public;
revoke execute on function public.push_admin_daily_targets()                        from anon, authenticated, public;
revoke execute on function public.push_admin_mark(text, boolean, boolean)           from anon, authenticated, public;
revoke execute on function nest_private.push_cron()                                 from anon, authenticated, public;
grant  execute on function public.push_admin_keys()                                 to service_role;
grant  execute on function public.push_admin_set_keys(text, text, text)             to service_role;
grant  execute on function public.push_admin_partner_targets(uuid, uuid, text, integer) to service_role;
grant  execute on function public.push_admin_daily_targets()                        to service_role;
grant  execute on function public.push_admin_mark(text, boolean, boolean)           to service_role;
revoke execute on function public.delete_me() from anon, public;
grant  execute on function public.delete_me() to authenticated;

select cron.schedule('nest-daily-push', '0 * * * *', 'select nest_private.push_cron()');
select cron.schedule('nest-retention', '17 3 * * *', $job$
  delete from public.client_errors where created_at < now() - interval '90 days';
  delete from public.client_events where created_at < now() - interval '90 days';
  delete from nest_private.push_log where sent_at < now() - interval '2 days';
$job$);
