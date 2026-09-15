/* NEST :: push. Three jobs.

   key      hands out the public VAPID key, making the key pair the first time
            it is asked, so the private half is generated here and never
            leaves the database.
   partner  tells the other person in a nest that something happened. The
            caller's own session proves who they are, and the database checks
            they are in that nest and rate limits by kind.
   daily    the seven o'clock reminder, called by pg_cron with a secret that
            also lives only in the database.

   verify_jwt is off because the cron call carries no user session; every
   action that needs one checks it itself.

   Deployed to the `nest` project as the `push` function. Redeploy with the
   Supabase CLI (`supabase functions deploy push --no-verify-jwt`) after
   changing this file. */
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const APP_URL = "https://couple-houses.vercel.app";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Keys = { public_key: string; private_key: string; subject: string; cron_secret: string };

async function keys(): Promise<Keys> {
  const r = await admin.rpc("push_admin_keys");
  if (r.error) throw new Error(r.error.message);
  if (r.data && r.data.public_key) return r.data as Keys;
  const made = webpush.generateVAPIDKeys();
  const s = await admin.rpc("push_admin_set_keys", { pub: made.publicKey, priv: made.privateKey, subj: APP_URL });
  if (s.error) throw new Error(s.error.message);
  const again = await admin.rpc("push_admin_keys");
  if (again.error || !again.data) throw new Error("keys unavailable");
  return again.data as Keys;
}

const COPY: Record<string, (name: string) => { body: string; tag: string }> = {
  ritual: (n) => ({ body: `${n} answered today's question. Your turn.`, tag: "ritual" }),
  duel_answer: (n) => ({ body: `${n} finished answering. Time to guess.`, tag: "duel" }),
  duel_done: () => ({ body: "The duel is done. See how well you know each other.", tag: "duel" }),
  build: (n) => ({ body: `${n} changed something in your home.`, tag: "build" }),
};

type Target = { endpoint: string; p256dh: string; auth: string };

async function send(targets: Target[], message: { body: string; tag: string }, k: Keys) {
  webpush.setVapidDetails(k.subject, k.public_key, k.private_key);
  let sent = 0;
  for (const t of targets) {
    try {
      await webpush.sendNotification(
        { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
        JSON.stringify({ title: "NEST", body: message.body, tag: message.tag, url: APP_URL + "/" }),
        { TTL: 6 * 3600 },
      );
      sent++;
      await admin.rpc("push_admin_mark", { ep: t.endpoint, ok: true, gone: false });
    } catch (err) {
      const code = (err as { statusCode?: number })?.statusCode;
      await admin.rpc("push_admin_mark", { ep: t.endpoint, ok: false, gone: code === 404 || code === 410 });
    }
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_) { /* empty body */ }

  try {
    if (body.action === "key") {
      const k = await keys();
      return json({ key: k.public_key });
    }

    if (body.action === "partner") {
      const authHeader = req.headers.get("Authorization") || "";
      const asUser = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
      });
      const { data: who } = await asUser.auth.getUser();
      if (!who || !who.user) return json({ error: "no_session" }, 401);
      const kind = typeof body.kind === "string" && COPY[body.kind] ? body.kind : null;
      const nest = typeof body.nest_id === "string" ? body.nest_id : null;
      if (!kind || !nest) return json({ error: "bad_request" }, 400);
      const t = await admin.rpc("push_admin_partner_targets", {
        n: nest, sender: who.user.id, kind, minutes: kind === "build" ? 30 : 5,
      });
      if (t.error) return json({ error: t.error.message }, 400);
      const rows = (t.data || []) as (Target & { sender_name: string | null })[];
      if (!rows.length) return json({ sent: 0 });
      const k = await keys();
      return json({ sent: await send(rows, COPY[kind](rows[0].sender_name || "Your partner"), k) });
    }

    if (body.action === "daily") {
      const k = await keys();
      if (req.headers.get("x-nest-cron") !== k.cron_secret) return json({ error: "forbidden" }, 403);
      const t = await admin.rpc("push_admin_daily_targets");
      if (t.error) return json({ error: t.error.message }, 500);
      const rows = (t.data || []) as (Target & { partner_answered: boolean })[];
      const waiting = rows.filter((r) => r.partner_answered);
      const fresh = rows.filter((r) => !r.partner_answered);
      let sent = 0;
      if (waiting.length) sent += await send(waiting, { body: "Your partner already answered today's question.", tag: "ritual" }, k);
      if (fresh.length) sent += await send(fresh, { body: "Today's question is waiting for you both.", tag: "ritual" }, k);
      return json({ sent, targets: rows.length });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
