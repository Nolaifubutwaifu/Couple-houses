/* NEST :: move pg_net out of the public schema, where the security advisor
   flagged it. Its functions live in the `net` schema either way, so
   nest_private.push_cron keeps calling net.http_post unchanged. Applied to the
   live `nest` project on 2026-09-15. */
drop extension if exists pg_net;
create extension if not exists pg_net with schema extensions;
