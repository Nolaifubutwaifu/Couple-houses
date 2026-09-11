/* NEST :: the same endpoints, against a real database.
   src/api.js is the model, the rules and the routes, written against local
   storage. This file is the transport swap it was written for: identical
   Api.call shapes, identical error codes, backed by Postgres so that two
   people on two devices can be one couple. When there is no backend
   configured, or the network cannot reach it, nothing here loads and the
   local store runs exactly as before. */
"use strict";

const BACKEND = Object.assign({
  url: "https://odwvgdabygvhtgmbltgp.supabase.co",
  key: "sb_publishable_TT94VLZs_4LOXzmrTx0rxA_z5S1we49",   // publishable by design, RLS is the guard
  lib: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.58.0/dist/umd/supabase.js",
  probeMs: 4000,
  pollMs: 4000,
  /* Email is on in the project but the templates still send a link rather
     than the six digit code this product asks for, and the built in mailer
     only reaches the project's own team. So email is not a usable way in yet,
     and saying so here is better than finding out at the code screen. Flip
     this when the templates carry {{ .Token }} and SMTP is real. */
  emailReady: false,
}, (typeof window !== "undefined" && window.NEST_CONFIG) || {});

/* One browser is normally one person. ?as=2 gives this tab its own auth
   storage, which is the only way to be two people on one machine. */
const AS_TAG = (location.search.match(/[?&]as=([A-Za-z0-9]{1,8})/) || [])[1] || "";

const Backend = {
  on:false, sb:null, uid:null, reason:"not started", nestId:null, chan:null,

  /* ---------- boot ---------- */
  async boot(){
    if(!BACKEND.url || !BACKEND.key) return this.off("not configured");
    if(location.protocol === "file:") return this.off("file:// cannot reach a backend");
    try{
      const settings = await this.probe();
      if(!settings) return this.off("backend unreachable");
      /* A database nobody can sign in to is worse than no database, because
         the failure lands on a person at the sign in screen instead of here.
         So the project's own settings decide: the moment a way in is enabled
         this turns itself on, and until then the local store runs. */
      this.providers = this.waysIn(settings);
      if(!this.providers.length) return this.off("no sign in method is enabled on the project");
      const lib = await this.library();
      if(!lib) return this.off("client library blocked");
      this.sb = lib.createClient(BACKEND.url, BACKEND.key, {
        auth:{ storageKey:"nest.sb.auth" + (AS_TAG ? "." + AS_TAG : ""),
               persistSession:true, autoRefreshToken:true, detectSessionInUrl:false },
      });
      const { data } = await this.sb.auth.getSession();
      this.uid = data && data.session ? data.session.user.id : null;
      if(this.uid) Session.set(this.uid); else Session.clear();
      this.on = true; this.reason = "live";
      Realtime.usesLocalDB = false;
      Realtime.emit = (type, payload) => this.emit(type, payload);
      console.info("NEST backend live" + (AS_TAG ? " as tab " + AS_TAG : ""));
      return true;
    }catch(err){
      return this.off("boot failed: " + (err && err.message));
    }
  },
  off(why){ this.on = false; this.reason = why; console.info("NEST backend off:", why); return false; },

  /* The probe is the whole feature flag. A sandbox that blocks fetch, an
     offline phone and a project that has been paused all look the same from
     here, and all three should quietly fall back rather than fail to boot. */
  async probe(){
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), BACKEND.probeMs);
    try{
      const r = await fetch(BACKEND.url + "/auth/v1/settings",
        { headers:{ apikey:BACKEND.key }, signal:ctl.signal });
      return r.ok ? await r.json() : null;
    }catch(err){ return null; }
    finally{ clearTimeout(t); }
  },
  /* Only ways in that actually work, in the order the screen should offer
     them. A provider the project has switched off is not an option, and
     neither is email while the code never arrives. */
  waysIn(settings){
    if(BACKEND.providers) return BACKEND.providers;      // told, rather than asked
    const ext = (settings && settings.external) || {};
    const out = [];
    if(ext.anonymous_users) out.push("guest");
    if(ext.apple) out.push("apple");
    if(ext.google) out.push("google");
    if(ext.email && BACKEND.emailReady) out.push("email");
    return out;
  },
  providers: [],
  library(){
    if(window.supabase && window.supabase.createClient) return Promise.resolve(window.supabase);
    return new Promise(res => {
      const s = document.createElement("script");
      const done = ok => { s.onload = s.onerror = null; res(ok ? window.supabase : null); };
      s.onload = () => done(window.supabase && window.supabase.createClient);
      s.onerror = () => done(false);
      s.src = BACKEND.lib;
      document.head.appendChild(s);
      setTimeout(() => done(window.supabase && window.supabase.createClient), BACKEND.probeMs);
    });
  },

  /* ---------- plumbing ---------- */
  /* PostgREST hands back the message a raise exception wrote, which is why
     every rule in the database is spelled the same as the code the screens
     already switch on. */
  fail(error, fallback){
    const msg = (error && error.message) || "";
    const map = {
      code_not_found:404, code_used:410, code_expired:410, own_nest:409,
      not_a_member:409, nothing_to_confirm:404, already_in_nest:409, under_age:403,
    };
    const known = Object.keys(map).find(k => msg.indexOf(k) >= 0);
    if(known) throw apiError(map[known], known);
    if(/duplicate key|23505/.test(msg)) throw apiError(409, "already_in_nest");
    console.warn("backend error:", msg);
    throw apiError(500, fallback || "backend_error");
  },
  ok(res, fallback){
    if(res.error) this.fail(res.error, fallback);
    return res.data;
  },
  need(){
    if(!this.uid) throw apiError(401, "no_session");
    return this.uid;
  },
  async profile(id){
    const r = await this.sb.from("profiles").select("*").eq("id", id || this.need()).maybeSingle();
    return this.ok(r, "no_profile");
  },
  async setSession(session){
    this.uid = session ? session.user.id : null;
    if(this.uid) Session.set(this.uid); else Session.clear();
    return this.uid;
  },
  /* Issuing a code revokes the one before it, rolls six characters from the
     spec's alphabet and dates it seven days out. All of that is a rule about
     who may invite whom, so it lives in the database rather than here: the
     client cannot write the invites table at all. */
  async issueInvite(nestId){
    this.need();
    return this.ok(await this.sb.rpc("issue_invite", { n:nestId }), "invite_failed");
  },
  async members(nestId){
    const ms = this.ok(await this.sb.from("memberships").select("*").eq("nest_id", nestId));
    const ids = ms.map(m => m.user_id);
    const ps = ids.length ? this.ok(await this.sb.from("profiles").select("*").in("id", ids)) : [];
    const byId = {};
    ps.forEach(p => { byId[p.id] = p; });
    return ms.map(m => ({ ...m, user: byId[m.user_id] || null }));
  },

  /* ---------- game state ----------
     The game is one jsonb column on the nest, so both people read and write
     the same document. rev is what makes a stale write visible: a device
     that saves over a revision it has not seen loses the race and reloads. */
  /* base is what this device last agreed with the database about. It is the
     third document a merge needs, and without it a refused save can only
     surrender or clobber. */
  rev:0, base:null, saving:false, dirty:false,
  clone(g){ return JSON.parse(JSON.stringify(g)); },
  cache(nestId, game, rev){
    if(game){
      Api.db.game[nestId] = game;
      this.rev = rev === undefined ? this.rev : rev;
      this.base = this.clone(game);
    }
    return Api.db.game[nestId];
  },
  /* Every save moves the epoch on. A poll that started before it is asking
     about a world that no longer exists, and must not be allowed to answer. */
  epoch:0,
  /* One writer, in a loop, always writing whatever the document currently
     says rather than whatever it said when the call was made. The version
     before this tried to track a pending write by hand and had a hole in it:
     a change that arrived while a save was in flight could have its flag
     cleared by that save and then be dropped, which looks exactly like your
     partner's furniture never having existed. A loop that re-reads the live
     document and only stops when nothing is left cannot lose a write. */
  async saveGame(g){
    if(!g || !g.nest_id || g.frozen) return;
    const nest = g.nest_id;
    this.epoch++;
    this.dirty = true;
    if(this.saving) return;                 // the loop below will pick it up
    this.saving = true;
    try{
      while(this.dirty){
        this.dirty = false;
        await new Promise(r => setTimeout(r, 180));   // one write per burst of taps
        const doc = Api.db.game[nest];
        if(!doc || doc.frozen) break;
        const r = await this.sb.rpc("save_game", { n:nest, doc, base_rev:this.rev });
        if(r.error){
          console.warn("game not saved:", r.error.message);
          break;                                       // the next change tries again
        }
        if(r.data && r.data.ok){
          this.rev = r.data.rev;
          this.base = this.clone(doc);
          continue;
        }
        /* Refused, because the other person saved first. Put this device's
           change on top of theirs rather than over it, and go round again to
           write the result. */
        const merged = mergeGame(this.base, doc, r.data.game);
        merged.nest_id = nest;
        Api.db.game[nest] = merged;
        this.rev = r.data.rev;
        this.base = this.clone(merged);
        this.epoch++;
        Realtime.deliver({ type:"game.changed", payload:{ nest_id:nest }, from:"merge" });
        this.dirty = true;
      }
    }finally{ this.saving = false; }
  },

  /* ---------- one pair of hands at a time ---------- */
  lock:{ mine:false, builder:null, builder_name:null, until:0 },
  async takeLock(nestId){
    const r = await this.sb.rpc("take_build_lock", { n:nestId, seconds:40 });
    if(r.error) this.fail(r.error, "lock_failed");
    this.lock = { mine:!!r.data.mine, builder:r.data.builder,
                  builder_name:r.data.builder_name || null,
                  until:Date.parse(r.data.until) || 0 };
    this.retune();
    return this.lock;
  },
  async dropLock(nestId){
    this.lock = { mine:false, builder:null, builder_name:null, until:0 };
    this.retune();
    const r = await this.sb.rpc("release_build_lock", { n:nestId });
    if(r.error) console.warn("lock not released:", r.error.message);
    return { released:true };
  },

  /* ---------- live ----------
     Two paths, because they fail differently. Broadcast is instant and needs
     a websocket. Polling is a few seconds late and needs nothing, so the
     transitions that must not be missed, pairing and freezing and the other
     person's spending, are the ones that ride on it. */
  emit(type, payload){
    const msg = { type, payload, at:Date.now(), from:this.uid };
    if(this.chan) try{ this.chan.send({ type:"broadcast", event:"msg", payload:msg }); }catch(err){ /* poll covers it */ }
  },
  watch(nestId, nest){
    if(this.nestId === nestId) return;
    this.unwatch();
    this.nestId = nestId;
    this.stamp = nest && nest.updated_at;
    try{
      this.chan = this.sb.channel("nest:" + nestId, { config:{ broadcast:{ self:false } } });
      this.chan.on("broadcast", { event:"msg" }, e => this.onBroadcast(e.payload));
      this.chan.subscribe();
    }catch(err){ this.chan = null; }
    this.tick = BACKEND.pollMs;
    this.timer = setInterval(() => this.pull(), this.tick);
    if(!this.wake){
      // a backgrounded tab is not polled, so coming back has to catch up at
      // once rather than after however long the next tick happens to be
      this.wake = () => { if(!document.hidden) this.pull(); };
      document.addEventListener("visibilitychange", this.wake);
    }
  },
  unwatch(){
    clearInterval(this.timer);
    this.tick = 0;
    if(this.chan) try{ this.sb.removeChannel(this.chan); }catch(err){ /* fine */ }
    this.chan = null; this.nestId = null;
  },
  /* A small question asked often, and the big answer fetched only when the
     revision says there is something new to fetch. */
  async pull(){
    // a fetch that overlaps a write comes back describing the past
    if(!this.nestId || document.hidden || this.saving || this.pulling) return;
    this.pulling = true;
    /* Checking this on the way in is not enough. The answer arrives some
       hundreds of milliseconds later, and if a save started in between then
       what came back is already history: adopting it throws away the change
       this device just made, and the next save writes the old document back
       over the new one. So the question is asked again on the way out. */
    const epoch = this.epoch;
    const moved = () => this.saving || this.epoch !== epoch;
    try{
      const r = await this.sb.rpc("nest_pulse", { n:this.nestId });
      if(r.error || !r.data) return;
      const p = r.data;
      const was = this.lock.builder, wasMine = this.lock.mine;
      this.lock = { mine:p.builder === this.uid, builder:p.builder || null,
                    builder_name:p.builder_name || null, until:Date.parse(p.builder_until) || 0 };
      if(was !== this.lock.builder || wasMine !== this.lock.mine){
        this.retune();
        Realtime.deliver({ type:"build.lock", payload:{ nest_id:this.nestId, ...this.lock }, from:"poll" });
      }

      if((p.rev || 0) > this.rev && !moved()){
        const full = await this.sb.from("nests").select("game")
          .eq("id", this.nestId).maybeSingle();
        if(!full.error && full.data && full.data.game && full.data.game.nest_id &&
           (p.rev || 0) > this.rev && !moved()){
          this.cache(this.nestId, full.data.game, p.rev);
          Realtime.deliver({ type:"game.changed", payload:{ nest_id:this.nestId }, from:"poll" });
        }
      }
      if(p.frozen)
        Realtime.deliver({ type:"nest.frozen", payload:{ nest_id:this.nestId, by:"partner" }, from:"poll" });
      else if(p.name && p.name !== this.lastName){
        this.lastName = p.name;
        Realtime.deliver({ type:"nest.named", payload:{ nest_id:this.nestId, name:p.name }, from:"poll" });
      }
    }finally{ this.pulling = false; }
  },
  /* The channel says "something changed", never what, so the answer is always
     to go and look rather than to trust a payload that could be stale. */
  onBroadcast(msg){
    if(msg && msg.type === "game.changed"){ this.pull(); return; }
    Realtime.deliver(msg);
  },
  /* While the other person is arranging the room, this is a live view of
     their hands, so it asks far more often than it does at rest. */
  retune(){
    const busy = this.lock.builder && !this.lock.mine;
    const want = busy ? 1000 : BACKEND.pollMs;
    if(this.tick === want) return;
    this.tick = want;
    clearInterval(this.timer);
    this.timer = setInterval(() => this.pull(), want);
  },

  /* ---------- the routes ---------- */
  async call(method, path, body){
    const hit = matchB(method, path);
    if(!hit) throw apiError(404, "no_route:" + method + " " + path);
    return hit.route.call(this, { ...hit.params, ...(body || {}) });
  },
};

const BROUTES = {
  /* Providers are real here rather than stand ins, so they either work or
     they are honestly unavailable. Guest is a real Supabase account with no
     email on it: it pairs, it earns, it owns a nest, and it can be given an
     email later without losing any of that. What it cannot survive is a
     cleared browser, which is the whole of the trade. */
  async "POST /auth/session"({ provider }){
    if(provider !== "guest") throw apiError(501, "provider_unavailable:" + provider);
    const r = await this.sb.auth.signInAnonymously();
    if(r.error){
      if(/anonymous/i.test(r.error.message || "")) throw apiError(501, "provider_unavailable:guest");
      throw apiError(500, "auth_failed");
    }
    await this.setSession(r.data.session);
    let p = await this.profile();
    if(!p) p = this.ok(await this.sb.from("profiles").insert({ id:this.uid }).select().single());
    return { user:p, is_new:!p.display_name };
  },

  async "POST /auth/email/start"({ email }){
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || "")) throw apiError(400, "bad_email");
    const r = await this.sb.auth.signInWithOtp({ email, options:{ shouldCreateUser:true } });
    if(r.error) throw apiError(400, "bad_email");
    return { sent_to:email, expires_in:3600e3, dev_code:null };   // a real inbox, so no code to show
  },
  async "POST /auth/email/verify"({ email, code }){
    const r = await this.sb.auth.verifyOtp({ email, token:String(code).trim(), type:"email" });
    if(r.error){
      const m = (r.error.message || "").toLowerCase();
      if(m.indexOf("expired") >= 0) throw apiError(410, "code_expired");
      if(m.indexOf("rate") >= 0) throw apiError(429, "too_many_tries");
      throw apiError(401, "code_wrong");
    }
    await this.setSession(r.data.session);
    let p = await this.profile();
    // the trigger writes the row, but a first login can arrive before it
    if(!p) p = this.ok(await this.sb.from("profiles").insert({ id:this.uid }).select().single());
    return { user:p, is_new:!p.display_name };
  },

  async "POST /users/me"({ display_name, birthdate }){
    this.need();
    const name = (display_name || "").trim();
    if(name.length < 1 || name.length > 24) throw apiError(400, "bad_name");
    if(!birthdate) throw apiError(400, "bad_birthdate");
    const age = ageOf(birthdate);
    /* Age is decided here, before anything is written. A row that fails the
       check keeps neither the name nor the date: the screen it leads to says
       the rule is about how personal information is handled, and storing a
       self declared minor's name and date of birth on the way to saying so is
       exactly what it promises not to do. */
    if(age < MIN_AGE){
      /* age_blocked is the whole of what a refusal leaves behind, and a
         project that predates it has not got the column. Clearing the name
         and the date is the part that must not be skipped, so that write goes
         first and the flag is added on top where it exists. Without it the
         block still refuses, it just stops surviving a second attempt, and
         docs/backend.sql carries the one line that fixes that. */
      await this.sb.from("profiles")
        .update({ display_name:null, birthdate:null, age_verified:false })
        .eq("id", this.uid);
      await this.sb.from("profiles").update({ age_blocked:true }).eq("id", this.uid);
      throw apiError(403, "under_age", { min_age:MIN_AGE });
    }
    const p = this.ok(await this.sb.from("profiles").update({
      display_name:name, birthdate, age_verified:true,
      locale: navigator.language || "en",
    }).eq("id", this.uid).select().single(), "save_failed");
    await this.sb.from("profiles").update({ age_blocked:false }).eq("id", this.uid);
    return { user:p };
  },

  async "POST /nests"(){
    const me = this.need();
    const p = await this.profile();
    if(!p || !p.age_verified) throw apiError(403, "under_age");
    const live = this.ok(await this.sb.from("memberships").select("nest_id,status,role")
      .eq("user_id", me).neq("status", "left"));
    if(live.length){
      const n = this.ok(await this.sb.from("nests").select("status").eq("id", live[0].nest_id).maybeSingle());
      // the fork is reachable again after a founder gives up on a code, and
      // the same person coming back to it keeps the same pending nest
      if(!n || n.status !== "pending") throw apiError(409, "already_in_nest", { nest_id:live[0].nest_id });
    }
    const nest = this.ok(await this.sb.rpc("create_nest"), "nest_failed");
    return { nest, invite: await this.issueInvite(nest.id) };
  },

  async "POST /invites/{code}/revoke"({ code }){
    const me = this.need();
    let nestId = null;
    if(code){
      const inv = this.ok(await this.sb.from("invites").select("nest_id").eq("code", code).maybeSingle());
      nestId = inv && inv.nest_id;
    }
    if(!nestId){
      const live = this.ok(await this.sb.from("memberships").select("nest_id")
        .eq("user_id", me).neq("status", "left"));
      nestId = live.length ? live[0].nest_id : null;
    }
    if(!nestId) throw apiError(404, "no_nest");
    return { invite: await this.issueInvite(nestId) };
  },

  async "POST /invites/{code}/claim"({ code }){
    const me = this.need();
    const p = await this.profile();
    if(!p || !p.age_verified) throw apiError(403, "under_age");
    // the same precheck the local route does, so the screen can name the
    // person you are already with instead of showing a constraint violation
    const live = this.ok(await this.sb.from("memberships").select("nest_id,status")
      .eq("user_id", me).neq("status", "left"));
    if(live.length){
      const others = (await this.members(live[0].nest_id)).filter(m => m.user_id !== me);
      throw apiError(409, "already_in_nest", {
        nest_id:live[0].nest_id,
        partner_name: others.length && others[0].user ? others[0].user.display_name : null,
      });
    }
    const r = await this.sb.rpc("claim_invite", { invite_code:String(code || "").toUpperCase() });
    const out = this.ok(r, "claim_failed");
    const mine = this.ok(await this.sb.from("memberships").select("*")
      .eq("nest_id", out.nest_id).eq("user_id", me).maybeSingle());
    // joining the nest's channel before announcing it, because until this
    // moment there was no nest to be subscribed to and the announcement had
    // nowhere to go
    this.watch(out.nest_id, null);
    this.emit("invite.claimed", { nest_id:out.nest_id, code:String(code).toUpperCase(),
                                  user:{ id:me, display_name:p.display_name } });
    return { nest:{ id:out.nest_id, name:out.name, founder_name:out.founder_name, status:"pending" },
             membership:mine };
  },

  async "POST /invites/{code}/confirm"({ code, accept }){
    this.need();
    const r = await this.sb.rpc("confirm_invite",
      { invite_code:String(code || "").toUpperCase(), accept:accept !== false });
    const out = this.ok(r, "confirm_failed");
    if(out.declined){
      this.emit("pair.declined", { nest_id:this.nestId });
      return { declined:true };
    }
    const nest = this.ok(await this.sb.from("nests").select("*").eq("id", out.nest_id).maybeSingle());
    this.emit("pair.activated", { nest_id:out.nest_id });
    return { nest, discarded_empty_nest:null };
  },

  async "POST /nests/{id}/name"({ id, name }){
    this.need();
    const ms = await this.members(id);
    if(ms.filter(m => m.status === "active").length < 2) throw apiError(409, "not_paired");
    const n = (name || "").trim();
    if(n.length < 1 || n.length > 20) throw apiError(400, "bad_name");
    const check = moderate(n);
    if(!check.ok) throw apiError(422, "rejected", { reason:check.reason });
    const nest = this.ok(await this.sb.from("nests")
      .update({ name:n, updated_at:new Date().toISOString() })
      .eq("id", id).select().single(), "no_nest");
    this.emit("nest.named", { nest_id:id, name:n });
    return { nest };
  },

  async "POST /nests/{id}/settings"({ id, base_material, terrain_type }){
    this.need();
    const patch = { updated_at:new Date().toISOString() };
    if(base_material) patch.base_material = base_material;
    if(terrain_type) patch.terrain_type = terrain_type;
    const nest = this.ok(await this.sb.from("nests").update(patch).eq("id", id).select().single(), "no_nest");
    this.emit("nest.settings", { nest_id:id });
    return { nest };
  },

  /* One round trip, because the invite and waiting screens call this on a
     timer while a person watches. The snapshot leaves the game document out,
     so that is fetched once when it is not already in hand and kept current
     by the watcher rather than by this. */
  async "GET /nests/mine"(){
    if(!this.uid) return { user:null };
    const snap = this.ok(await this.sb.rpc("nest_snapshot"), "no_profile");
    if(!snap || !snap.user) return { user:null };
    if(!snap.nest){ this.unwatch(); return { user:snap.user, nest:null }; }
    if(!Api.db.game[snap.nest.id] || this.nestId !== snap.nest.id){
      const g = this.ok(await this.sb.from("nests").select("game,game_rev")
        .eq("id", snap.nest.id).maybeSingle());
      if(g && g.game && g.game.nest_id) this.cache(snap.nest.id, g.game, g.game_rev);
      else this.rev = (g && g.game_rev) || 0;
    }
    this.watch(snap.nest.id, snap.nest);
    return { user:snap.user, nest:snap.nest, membership:snap.membership,
             members:snap.members || [], invite:snap.invite || null,
             pending_partner:snap.pending_partner || null };
  },

  async "POST /nests/{id}/build/claim"({ id }){
    this.need();
    return await this.takeLock(id);
  },
  async "POST /nests/{id}/build/release"({ id }){
    this.need();
    return await this.dropLock(id);
  },

  async "POST /nests/{id}/leave"({ id }){
    this.need();
    const r = await this.sb.rpc("freeze_nest", { n:id, reason:"left" });
    if(r.error) this.fail(r.error, "leave_failed");
    this.emit("nest.frozen", { nest_id:id, by:this.uid });
    this.unwatch();
    const nest = this.ok(await this.sb.from("nests").select("*").eq("id", id).maybeSingle());
    return { nest };
  },

  async "POST /users/me/delete"(){
    this.need();
    const r = await this.sb.rpc("delete_me");
    if(r.error) this.fail(r.error, "delete_failed");
    this.emit("user.deleted", { user_id:this.uid });
    this.unwatch();
    await this.sb.auth.signOut();
    await this.setSession(null);
    return { deleted:true };
  },

  async "POST /nests/{id}/publish"({ id, tagline }){
    this.need();
    const check = moderate(tagline);
    if(!check.ok) throw apiError(422, "rejected", { reason:check.reason });
    const g = Api.db.game[id];
    if(g){ g.showcase.tagline = check.text; g.showcase.published = true; await this.saveGame(g); }
    return { tagline:check.text };
  },

  async "POST /nests/{id}/report"({ id, reason }){
    const me = this.need();
    const rep = this.ok(await this.sb.from("reports")
      .insert({ target:id, reported_by:me, reason:reason || "unspecified" })
      .select().single(), "report_failed");
    const p = await this.profile();
    const blocked = p.blocked || [];
    if(blocked.indexOf(id) < 0){
      blocked.push(id);
      await this.sb.from("profiles").update({ blocked }).eq("id", me);
    }
    return { report:{ ...rep, by:rep.reported_by, at:Date.parse(rep.created_at) }, contact:CONTACT_EMAIL };
  },
  async "POST /nests/{id}/block"({ id }){
    const me = this.need();
    const p = await this.profile();
    const blocked = p.blocked || [];
    const at = blocked.indexOf(id);
    if(at >= 0) blocked.splice(at, 1); else blocked.push(id);
    await this.sb.from("profiles").update({ blocked }).eq("id", me);
    return { blocked: blocked.indexOf(id) >= 0 };
  },
  async "GET /moderation"(){
    if(!this.uid) return { blocked:[], contact:CONTACT_EMAIL, open_reports:0 };
    const p = await this.profile();
    const r = await this.sb.from("reports").select("id", { count:"exact", head:true }).eq("status", "open");
    return { blocked:(p && p.blocked) || [], contact:CONTACT_EMAIL, open_reports:r.count || 0 };
  },

  async "GET /nests/archived"(){
    if(!this.uid) return { nests:[] };
    const left = this.ok(await this.sb.from("memberships").select("nest_id")
      .eq("user_id", this.uid).eq("status", "left"));
    if(!left.length) return { nests:[] };
    const rows = this.ok(await this.sb.from("nests").select("*")
      .in("id", left.map(m => m.nest_id)).eq("status", "archived"));
    const out = [];
    for(const n of rows){
      if(n.game && n.game.nest_id) this.cache(n.id, n.game);
      const ms = await this.members(n.id);
      out.push({ ...n, members: ms.map(x => ({ role:x.role, name:x.user ? x.user.display_name : null })) });
    }
    return { nests: out.sort((a, b) => Date.parse(b.archived_at || 0) - Date.parse(a.archived_at || 0)) };
  },
};

/* The same segment matcher the local router uses, over the same keys. */
const BTABLE = Object.keys(BROUTES).map(k => {
  const sp = k.indexOf(" ");
  return { key:k, method:k.slice(0, sp), parts:k.slice(sp + 1).split("/").filter(Boolean) };
});
function matchB(method, path){
  const parts = path.split("?")[0].split("/").filter(Boolean);
  for(const r of BTABLE){
    if(r.method !== method || r.parts.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for(let i = 0; i < parts.length; i++){
      const t = r.parts[i];
      if(t.charAt(0) === "{") params[t.slice(1, -1)] = decodeURIComponent(parts[i]);
      else if(t !== parts[i]){ ok = false; break; }
    }
    if(ok) return { route:BROUTES[r.key], params, key:r.key };
  }
  return null;
}

/* Boot starts now and every request waits on it, so no screen has to know
   which store it is talking to. */
Api.readyP = Backend.boot().then(live => { if(live) Api.backend = Backend; return live; });
