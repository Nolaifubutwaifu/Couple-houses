/* NEST :: data model and endpoints. Onboarding spec sections 7 and 8.
   The store is local and the transport is a function call, but the model,
   the routes and the rules are the spec's. Swapping in a real backend is a
   transport change: keep Api.call's shape and the screens do not move. */
"use strict";

const DB_KEY = "nest.db.v1";
const SESSION_KEY = "nest.session";      // per tab, so two tabs are two people
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";   // no I L O 0 1
const INVITE_TTL = 7 * 24 * 3600 * 1000;
const EMAIL_CODE_TTL = 10 * 60 * 1000;
const MIN_AGE = 16;
const BUILD_LOCK_MS = 40 * 1000;
const LATENCY = 220;                     // enough to make pending states real

const now = () => Date.now();
const rid = p => p + "_" + Math.random().toString(36).slice(2, 11);

/* ---------------- the store ---------------- */
function blankDB(){
  return { users:{}, nests:{}, memberships:{}, invites:{}, game:{}, identities:{}, emailCodes:{}, seq:0 };
}
let DB = blankDB();
let dbBroken = false;

function loadDB(){
  try{
    const raw = localStorage.getItem(DB_KEY);
    DB = raw ? JSON.parse(raw) : blankDB();
  }catch(err){
    console.warn("store unreadable, this session is memory only", err);
    DB = blankDB(); dbBroken = true;
  }
}
function saveDB(){
  if(dbBroken) return;
  try{ localStorage.setItem(DB_KEY, JSON.stringify(DB)); }
  catch(err){ console.warn("store unwritable, this session is memory only", err); dbBroken = true; }
}
/* Another tab is another person, so re-read before every request. This
   REPLACES the object graph, so it may only be called before a route starts
   reading: a sync in the middle of a route leaves the route mutating an
   orphaned copy and the write is silently lost. */
function syncDB(){ if(!dbBroken) loadDB(); }

/* Re-reading before a request is not enough on its own. localStorage is not
   consistent across renderer processes on write, so read-then-write from two
   tabs is a lost update rather than a transaction, and the request that lost
   is gone without an error: that is how a redemption vanished and left the
   invited partner waiting on a screen with nothing to tap. Hold a real mutex
   across the whole read-run-write instead. Web Locks is the right primitive
   and is everywhere the product ships; the token fallback is for the rest,
   and expires so a tab that dies mid write cannot wedge the others. */
const LOCK_KEY = DB_KEY + ".lock";
const LOCK_MS = 2000;
const LOCK_TOKEN = "lk_" + Math.random().toString(36).slice(2, 11);
async function withStoreLock(fn){
  if(dbBroken) return fn();
  if(typeof navigator !== "undefined" && navigator.locks && navigator.locks.request){
    return navigator.locks.request(DB_KEY, () => fn());
  }
  for(let i = 0; i < 40; i++){
    let held = null;
    try{ held = JSON.parse(localStorage.getItem(LOCK_KEY) || "null"); }catch(err){ held = null; }
    if(!held || held.until < now()){
      try{ localStorage.setItem(LOCK_KEY, JSON.stringify({ token:LOCK_TOKEN, until:now() + LOCK_MS })); }
      catch(err){ break; }
      let back = null;
      try{ back = JSON.parse(localStorage.getItem(LOCK_KEY) || "null"); }catch(err){ back = null; }
      if(back && back.token === LOCK_TOKEN){
        try{ return await fn(); }
        finally{ try{ localStorage.removeItem(LOCK_KEY); }catch(err){ /* nothing to release */ } }
      }
    }
    await new Promise(r => setTimeout(r, 25));
  }
  return fn();                       // a second of contention is a wedged lock
}
/* A read of the newest committed rows that does not swap the graph, for the
   one check that has to see a racing tab's write. */
function committed(){
  if(dbBroken) return DB;
  try{ const raw = localStorage.getItem(DB_KEY); return raw ? JSON.parse(raw) : DB; }
  catch(err){ return DB; }
}

/* ---------------- realtime, one channel per nest ---------------- */
const Realtime = {
  chan: null,
  subs: [],
  online: true,
  /* the local store is the one that has to be re-read before a message is
     handled. A backend has already told us what changed. */
  usesLocalDB: true,
  init(){
    try{
      this.chan = new BroadcastChannel("nest.realtime");
      this.chan.onmessage = e => this.deliver(e.data);
    }catch(err){
      // storage events reach other tabs too, just less directly
      addEventListener("storage", e => {
        if(e.key === "nest.bus" && e.newValue) this.deliver(JSON.parse(e.newValue));
      });
    }
  },
  emit(type, payload){
    const msg = { type, payload, at:now(), from:Session.userId };
    if(this.chan) this.chan.postMessage(msg);
    else try{ localStorage.setItem("nest.bus", JSON.stringify(msg)); }catch(err){ /* best effort */ }
  },
  deliver(msg){
    if(this.usesLocalDB) syncDB();
    if(!this.online){ this.queued.push(msg); return; }
    this.subs.forEach(fn => { try{ fn(msg); }catch(err){ console.warn(err); } });
  },
  queued: [],
  on(fn){ this.subs.push(fn); },
  setOnline(v){
    this.online = v;
    if(v){ const q = this.queued; this.queued = []; q.forEach(m => this.deliver(m)); }
  },
};

/* ---------------- session, one identity per tab ---------------- */
const Session = {
  userId: null,
  fromDevice: false,          // resumed from the device, not from this tab
  load(){
    try{ this.userId = sessionStorage.getItem(SESSION_KEY) || null; }catch(err){ this.userId = null; }
    // A tab with no session of its own falls back to the last identity on
    // this device, which is what a reinstall or a new device looks like.
    // Arriving on an invite link does not: the person opening it is the one
    // being invited, so they authenticate as themselves.
    const onInvite = /[?#&]j=[A-Za-z0-9]{6}/.test(location.search + location.hash);
    /* On a shared laptop or a passed phone that fallback is whoever signed in
       most recently, which is how an ordinary reload resumed as the wrong
       partner. Resume it, because a reinstall has to land somewhere, but flag
       it so the screen can ask before the session is treated as yours. */
    this.fromDevice = false;
    if(!this.userId && !onInvite){
      try{
        const last = localStorage.getItem(SESSION_KEY + ".last") || null;
        if(last){ this.userId = last; this.fromDevice = true; }
      }catch(err){ /* ignore */ }
    }
    const u = this.userId ? DB.users[this.userId] : null;
    if(!u || u.deleted){ this.userId = null; this.fromDevice = false; }
    return this.userId;
  },
  /* the person on this device said the resumed identity is theirs */
  claimDevice(){
    this.fromDevice = false;
    if(this.userId) this.set(this.userId);
  },
  set(id){
    this.userId = id;
    this.fromDevice = false;
    try{ sessionStorage.setItem(SESSION_KEY, id); localStorage.setItem(SESSION_KEY + ".last", id); }
    catch(err){ /* memory only */ }
  },
  clear(){
    this.userId = null;
    this.fromDevice = false;
    try{ sessionStorage.removeItem(SESSION_KEY); localStorage.removeItem(SESSION_KEY + ".last"); }catch(err){}
  },
  get user(){ return this.userId ? DB.users[this.userId] : null; },
};

/* ---------------- helpers over the model ---------------- */
function inviteCode(){
  let c = "";
  const buf = new Uint32Array(6);
  (crypto.getRandomValues ? crypto : { getRandomValues: a => a.forEach((_, i) => a[i] = Math.random() * 2 ** 32) })
    .getRandomValues(buf);
  for(let i = 0; i < 6; i++) c += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  return c;
}
function membershipsOf(nestId, status){
  return Object.values(DB.memberships).filter(m => m.nest_id === nestId && (!status || m.status === status));
}
function activeMembershipFor(userId){
  return Object.values(DB.memberships).find(m => m.user_id === userId && m.status === "active");
}
function pendingMembershipFor(userId){
  return Object.values(DB.memberships).find(m => m.user_id === userId && m.status === "invited");
}
function ageOf(birthdate){
  const b = new Date(birthdate + "T00:00:00"), t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if(m < 0 || (m === 0 && t.getDate() < b.getDate())) a--;
  return a;
}
function expireInvite(inv){
  if(inv.status === "open" && now() > inv.expires_at) inv.status = "expired";
  return inv;
}
function nestPreview(nest){
  const founder = membershipsOf(nest.id).find(m => m.role === "founder");
  const fu = founder ? DB.users[founder.user_id] : null;
  return { id:nest.id, name:nest.name, founder_name:fu ? fu.display_name : "Someone", status:nest.status };
}

/* Spec section 7: a nest may have at most two active memberships. In
   production this is a database constraint, a partial unique index on
   (nest_id) where status = 'active' with a count check, or a two row
   partition. Here it is the one gate every activation has to pass, and it
   re-reads the store first so a second tab racing the same code loses. */
function assertRoom(nestId){
  const live = committed();
  const n = Object.values(live.memberships || {})
    .filter(m => m.nest_id === nestId && m.status === "active").length;
  if(Math.max(n, membershipsOf(nestId, "active").length) >= 2) throw apiError(409, "nest_full");
}
function apiError(status, code, extra){
  const e = new Error(code);
  e.status = status; e.code = code;
  Object.assign(e, extra || {});
  return e;
}

/* ---------------- the endpoints, spec section 8 ---------------- */
const routes = {
  /* provider token in, session out. The backend decides sign up or log in,
     the interface never makes the user choose. */
  "POST /auth/session"({ provider, subject }){
    const key = provider + ":" + subject;
    let userId = DB.identities[key];
    let isNew = false;
    if(!userId || !DB.users[userId]){
      userId = rid("usr");
      DB.users[userId] = {
        id:userId, auth_provider:provider, auth_subject:subject, display_name:null,
        birthdate:null, created_at:now(), locale:navigator.language || "en",
        push_token:null, age_verified:false,
      };
      DB.identities[key] = userId;
      isNew = true;
    }
    saveDB();
    Session.set(userId);
    return { user:DB.users[userId], is_new:isNew };
  },

  /* email one time code. No password exists anywhere in the product. */
  "POST /auth/email/start"({ email }){
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || "")) throw apiError(400, "bad_email");
    const code = String(Math.floor(100000 + Math.random() * 900000));
    DB.emailCodes[email.toLowerCase()] = { code, sent_at:now(), expires_at:now() + EMAIL_CODE_TTL, tries:0 };
    saveDB();
    // a real backend mails this. Nothing can send mail from a page, so the
    // code comes back and the screen shows it, clearly marked.
    return { sent_to:email, expires_in:EMAIL_CODE_TTL, dev_code:code };
  },
  "POST /auth/email/verify"({ email, code }){
    const rec = DB.emailCodes[(email || "").toLowerCase()];
    if(!rec) throw apiError(400, "no_code");
    if(now() > rec.expires_at) throw apiError(410, "code_expired");
    rec.tries++;
    if(rec.tries > 6) throw apiError(429, "too_many_tries");
    if(rec.code !== String(code).trim()) { saveDB(); throw apiError(401, "code_wrong"); }
    delete DB.emailCodes[email.toLowerCase()];
    return routes["POST /auth/session"]({ provider:"email", subject:email.toLowerCase() });
  },

  "POST /users/me"({ display_name, birthdate }){
    const u = Session.user;
    if(!u) throw apiError(401, "no_session");
    const name = (display_name || "").trim();
    if(name.length < 1 || name.length > 24) throw apiError(400, "bad_name");
    if(!birthdate) throw apiError(400, "bad_birthdate");
    const age = ageOf(birthdate);
    /* Check before you keep. The screen this leads to says the rule is about
       how we handle personal information, so keeping a self declared minor's
       name and exact date of birth on the way to showing it is the one thing
       it must not do. Nothing survives the block but the fact of it. */
    if(age < MIN_AGE){
      u.display_name = null;
      u.birthdate = null;
      u.age_verified = false;
      u.age_blocked = true;                // enough to refuse, and nothing more
      saveDB();
      throw apiError(403, "under_age", { min_age:MIN_AGE });
    }
    u.display_name = name;
    u.birthdate = birthdate;               // stored once, not silently editable later
    u.age_verified = true;
    u.age_blocked = false;
    saveDB();
    return { user:u };
  },

  "POST /nests"(){
    const u = Session.user;
    if(!u) throw apiError(401, "no_session");
    if(!u.age_verified) throw apiError(403, "under_age");
    const existing = activeMembershipFor(u.id);
    if(existing) throw apiError(409, "already_in_nest", { nest_id:existing.nest_id });

    // a founder who never paired keeps the one pending nest rather than
    // stacking empties every time they come back to the fork
    let nest = Object.values(DB.nests).find(n => n.status === "pending" &&
      membershipsOf(n.id).some(m => m.user_id === u.id));
    if(!nest){
      nest = { id:rid("nst"), name:null, created_at:now(), status:"pending",
               base_material:"ceramic", terrain_type:"grass", season_state:"new", streak_count:0 };
      DB.nests[nest.id] = nest;
      const m = { id:rid("mem"), nest_id:nest.id, user_id:u.id, role:"founder",
                  joined_at:now(), status:"active" };
      DB.memberships[m.id] = m;
    }
    const invite = issueInvite(nest.id, u.id);
    saveDB();
    return { nest, invite };
  },

  /* Enough to name the person on the other end of a link and nothing else.
     Whoever is asking already has the code, and a link that says who invited
     you converts better than one that opens on "Begin". */
  "GET /invites/{code}"({ code }){
    const inv = DB.invites[String(code || "").toUpperCase()];
    if(!inv) throw apiError(404, "code_not_found");
    if(expireInvite(inv).status !== "open") throw apiError(410, "code_expired");
    const nest = DB.nests[inv.nest_id];
    if(!nest) throw apiError(404, "code_not_found");
    return { nest:nestPreview(nest) };
  },

  "POST /invites/{code}/revoke"({ code }){
    const inv = DB.invites[code];
    if(inv){ inv.status = "revoked"; }
    const nestId = inv ? inv.nest_id : (activeMembershipFor(Session.userId) || {}).nest_id;
    if(!nestId) throw apiError(404, "no_nest");
    const invite = issueInvite(nestId, Session.userId);
    saveDB();
    return { invite };
  },

  /* B enters the code. This creates a pending membership and nothing else:
     joining is never done by code alone, both people have to confirm. */
  "POST /invites/{code}/claim"({ code }){
    const u = Session.user;
    if(!u) throw apiError(401, "no_session");
    if(!u.age_verified) throw apiError(403, "under_age");
    const mine = activeMembershipFor(u.id);
    if(mine){
      const other = membershipsOf(mine.nest_id, "active").find(m => m.user_id !== u.id);
      throw apiError(409, "already_in_nest", {
        partner_name: other ? (DB.users[other.user_id] || {}).display_name : null,
        nest_id: mine.nest_id,
      });
    }
    const inv = DB.invites[String(code || "").toUpperCase()];
    if(!inv) throw apiError(404, "code_not_found");
    expireInvite(inv);
    if(inv.status === "expired") throw apiError(410, "code_expired");
    if(inv.status !== "open") throw apiError(410, "code_used");
    // single use means single claimant: the first person to enter it owns it
    // until the founder decides, otherwise two people can queue on one code
    if(inv.claimed_by && inv.claimed_by !== u.id) throw apiError(410, "code_used");
    const nest = DB.nests[inv.nest_id];
    if(!nest) throw apiError(404, "code_not_found");
    assertRoom(nest.id);
    if(membershipsOf(nest.id).some(m => m.user_id === u.id)) throw apiError(409, "own_nest");

    let m = pendingMembershipFor(u.id);
    if(m && m.nest_id !== nest.id){ m.status = "left"; m = null; }
    if(!m){
      m = { id:rid("mem"), nest_id:nest.id, user_id:u.id, role:"partner",
            joined_at:null, status:"invited" };
      DB.memberships[m.id] = m;
    }
    inv.claimed_by = u.id;
    saveDB();
    Realtime.emit("invite.claimed", { nest_id:nest.id, code:inv.code, user:{ id:u.id, display_name:u.display_name } });
    return { nest:nestPreview(nest), membership:m };
  },

  /* The founder accepts. Both memberships go active together, and this is
     the one place a nest can become full, so the constraint sits here. */
  "POST /invites/{code}/confirm"({ code, accept }){
    const inv = DB.invites[String(code || "").toUpperCase()];
    if(!inv) throw apiError(404, "code_not_found");
    const nest = DB.nests[inv.nest_id];
    if(!nest) throw apiError(404, "code_not_found");
    const claimant = inv.claimed_by ? DB.users[inv.claimed_by] : null;
    const pend = Object.values(DB.memberships).find(m => m.nest_id === nest.id && m.status === "invited");
    if(!claimant || !pend) throw apiError(404, "nothing_to_confirm");

    if(accept === false){
      pend.status = "left";
      inv.status = "revoked";
      saveDB();
      Realtime.emit("pair.declined", { nest_id:nest.id, user_id:claimant.id });
      return { declined:true };
    }
    assertRoom(nest.id);
    pend.status = "active";
    pend.joined_at = now();
    inv.status = "consumed";
    inv.consumed_at = now();
    nest.status = "active";
    // whoever accepts first wins: an empty unfurnished nest the joiner
    // founded on their own is cleaned up rather than left orphaned
    const stale = Object.values(DB.nests).find(n => n.status === "pending" && n.id !== nest.id &&
      membershipsOf(n.id).some(m => m.user_id === claimant.id));
    let discarded = null;
    if(stale && !(DB.game[stale.id] && DB.game[stale.id].house.placed.length)){
      membershipsOf(stale.id).forEach(m => { delete DB.memberships[m.id]; });
      Object.values(DB.invites).forEach(i => { if(i.nest_id === stale.id) i.status = "revoked"; });
      delete DB.nests[stale.id]; delete DB.game[stale.id];
      discarded = true;
    }
    saveDB();
    Realtime.emit("pair.activated", { nest_id:nest.id });
    return { nest, discarded_empty_nest:discarded };
  },

  "POST /nests/{id}/name"({ id, name }){
    const nest = DB.nests[id];
    if(!nest) throw apiError(404, "no_nest");
    if(membershipsOf(nest.id, "active").length < 2) throw apiError(409, "not_paired");
    const n = (name || "").trim();
    if(n.length < 1 || n.length > 20) throw apiError(400, "bad_name");
    const check = moderate(n);
    if(!check.ok) throw apiError(422, "rejected", { reason:check.reason });
    nest.name = n;
    saveDB();
    Realtime.emit("nest.named", { nest_id:nest.id, name:n });
    return { nest };
  },

  /* One pair of hands at a time. With no backend the two players are two tabs
     of one browser, so the lock lives in the shared store and behaves exactly
     as the database one does, expiry included. */
  "POST /nests/{id}/build/claim"({ id }){
    const nest = DB.nests[id];
    if(!nest) throw apiError(404, "no_nest");
    const held = nest.builder && nest.builder_until > now() && nest.builder !== Session.userId;
    if(held) return { mine:false, builder:nest.builder,
                      builder_name:nameOf(nest.builder), until:nest.builder_until };
    nest.builder = Session.userId;
    nest.builder_until = now() + BUILD_LOCK_MS;
    saveDB();
    Realtime.emit("build.lock", { nest_id:id, builder:nest.builder, mine:false });
    return { mine:true, builder:nest.builder, until:nest.builder_until };
  },
  "POST /nests/{id}/build/release"({ id }){
    const nest = DB.nests[id];
    if(!nest) throw apiError(404, "no_nest");
    if(nest.builder === Session.userId){ nest.builder = null; nest.builder_until = null; saveDB(); }
    Realtime.emit("build.lock", { nest_id:id, builder:null, mine:false });
    return { released:true };
  },

  /* The money routes. With a database these are where coins, rooms and items
     are decided (see src/backend.js). The local store is one browser playing
     both people, the screens have already applied the change, and there is
     nobody to protect it from, so they only answer, which keeps both
     transports carrying the same calls. */
  "POST /nests/{id}/ritual/answer"(){ return { ok:true, local:true }; },
  "POST /nests/{id}/duel/finish"(){ return { ok:true, local:true }; },
  "POST /nests/{id}/memory/finish"(){ return { ok:true, local:true }; },
  "POST /nests/{id}/shop/buy"(){ return { ok:true, local:true }; },
  "POST /nests/{id}/rooms/unlock"(){ return { ok:true, local:true }; },
  "POST /nests/{id}/items/restore"(){ return { ok:true, local:true }; },

  /* The street. With no database there is no one else on it, so the screen
     shows the sample homes and this device's own. */
  "GET /street"(){ return { local:true, homes:[] }; },
  "POST /street/{id}/like"(){ return { local:true }; },
  "POST /nests/{id}/unpublish"({ id }){
    const g = DB.game[id];
    if(g && g.showcase) g.showcase.published = false;
    saveDB();
    return { ok:true };
  },

  "POST /nests/{id}/settings"({ id, base_material, terrain_type }){
    const nest = DB.nests[id];
    if(!nest) throw apiError(404, "no_nest");
    if(base_material) nest.base_material = base_material;
    if(terrain_type) nest.terrain_type = terrain_type;
    saveDB();
    Realtime.emit("nest.settings", { nest_id:nest.id });
    return { nest };
  },

  "GET /nests/mine"(){
    const u = Session.user;
    if(!u) return { user:null };
    const m = activeMembershipFor(u.id) || pendingMembershipFor(u.id);
    if(!m) return { user:u, nest:null };
    const nest = DB.nests[m.nest_id];
    if(!nest || nest.status === "archived") return { user:u, nest:null };
    const members = membershipsOf(nest.id).filter(x => x.status !== "left").map(x => ({
      ...x, user:DB.users[x.user_id],
    }));
    const invite = Object.values(DB.invites).find(i => i.nest_id === nest.id && expireInvite(i).status === "open");
    const pending = members.find(x => x.status === "invited");
    return { user:u, nest, membership:m, members, invite,
             pending_partner: pending ? DB.users[pending.user_id] : null };
  },

  /* Leaving freezes the nest for both people. It is not deleted and it is not
     handed to whoever stayed: it becomes a record neither of them can change.
     Both keep the ability to look at it, neither can add to it, and both are
     free to start again with someone else. */
  "POST /nests/{id}/leave"({ id }){
    const nest = DB.nests[id];
    if(!nest) throw apiError(404, "no_nest");
    const mine = Object.values(DB.memberships).find(x => x.nest_id === id && x.user_id === Session.userId);
    if(!mine || mine.status !== "active") throw apiError(409, "not_a_member");
    freezeNest(nest, Session.userId, "left");
    saveDB();
    Realtime.emit("nest.frozen", { nest_id:nest.id, by:Session.userId });
    return { nest };
  },

  /* Guideline 5.1.1(v): an account can be deleted from inside the app. The
     person's own data goes. The nest does not, because the other person has an
     equal claim to the same record, so it freezes exactly as leaving does and
     the departed name is replaced rather than kept. */
  "POST /users/me/delete"(){
    const u = Session.user;
    if(!u) throw apiError(401, "no_session");
    Object.values(DB.memberships)
      .filter(m => m.user_id === u.id)
      .forEach(m => {
        const nest = DB.nests[m.nest_id];
        if(nest && nest.status !== "archived") freezeNest(nest, u.id, "deleted");
        // the answers were theirs, so they go with them
        const g = DB.game[m.nest_id];
        if(g && g.streak){
          const side = m.role === "founder" ? "a" : "b";
          g.streak[side + "Ans"] = null;
          if(g.ritualLog) g.ritualLog.forEach(r => { delete r[side]; });
        }
      });
    Object.keys(DB.identities).forEach(k => { if(DB.identities[k] === u.id) delete DB.identities[k]; });
    Object.keys(DB.emailCodes).forEach(k => { if(k === u.auth_subject) delete DB.emailCodes[k]; });
    DB.users[u.id] = {
      id:u.id, deleted:true, deleted_at:now(),
      auth_provider:null, auth_subject:null, display_name:null, birthdate:null,
      created_at:u.created_at, locale:null, push_token:null, age_verified:false,
    };
    saveDB();
    Realtime.emit("user.deleted", { user_id:u.id });
    Session.clear();
    return { deleted:true };
  },

  /* Archived nests are reachable from settings and from nowhere else, so the
     onboarding flow never surfaces a previous relationship. */
  /* Publishing is the moment text becomes other people's problem, so the
     filter sits here rather than on the input. */
  "POST /nests/{id}/publish"({ id, tagline }){
    const nest = DB.nests[id];
    if(!nest) throw apiError(404, "no_nest");
    const check = moderate(tagline);
    if(!check.ok) throw apiError(422, "rejected", { reason:check.reason });
    const g = DB.game[id];
    if(g){ g.showcase.tagline = check.text; g.showcase.published = true; }
    saveDB();
    return { tagline:check.text };
  },

  "POST /nests/{id}/report"({ id, reason }){
    const u = Session.user;
    if(!u) throw apiError(401, "no_session");
    DB.reports = DB.reports || {};
    const r = { id:rid("rep"), target:id, by:u.id, reason:reason || "unspecified",
                at:now(), status:"open" };
    DB.reports[r.id] = r;
    // hidden from the reporter straight away: they should not have to keep
    // looking at it while a person works through the queue
    u.blocked = u.blocked || [];
    if(u.blocked.indexOf(id) < 0) u.blocked.push(id);
    saveDB();
    return { report:r, contact:CONTACT_EMAIL };
  },
  "POST /nests/{id}/block"({ id }){
    const u = Session.user;
    if(!u) throw apiError(401, "no_session");
    u.blocked = u.blocked || [];
    const at = u.blocked.indexOf(id);
    if(at >= 0) u.blocked.splice(at, 1); else u.blocked.push(id);
    saveDB();
    return { blocked:u.blocked.indexOf(id) >= 0 };
  },
  "GET /moderation"(){
    const u = Session.user;
    DB.reports = DB.reports || {};
    return { blocked:(u && u.blocked) || [], contact:CONTACT_EMAIL,
             open_reports:Object.values(DB.reports).filter(r => r.status === "open").length };
  },

  "GET /nests/archived"(){
    const u = Session.user;
    if(!u) return { nests:[] };
    return { nests: Object.values(DB.memberships)
      .filter(m => m.user_id === u.id && m.status === "left")
      .map(m => DB.nests[m.nest_id])
      .filter(n => n && n.status === "archived")
      .map(n => ({ ...n, members: membershipsOf(n.id).map(x => ({
        role:x.role, name:nameOf(x.user_id) })) }))
      .sort((a, b) => (b.archived_at || 0) - (a.archived_at || 0)) };
  },
};

/* ---- moderation, Guideline 1.2 ----
   The street is content one couple publishes for strangers, which means a
   filter, a way to report, a way to block, a published contact and a human
   who acts within a day. The first four are here. The fifth is a commitment
   a team makes, not a function, and this list is a stand in: a real build
   sends text to a service that keeps up with how people actually evade one. */
const BLOCKED_WORDS = ["slur1", "slur2", "hateword"];   // placeholder, see above
const CONTACT_EMAIL = "safety@nest.app";
function moderate(text){
  const t = String(text || "");
  if(!t.trim()) return { ok:true, text:t };
  const low = t.toLowerCase();
  if(BLOCKED_WORDS.some(w => low.includes(w)))
    return { ok:false, reason:"That word cannot go on the street." };
  if(/https?:\/\/|www\.|\.(com|net|org|io|co)\b/i.test(t))
    return { ok:false, reason:"Links are not allowed here." };
  if(/[\w.+-]+@[\w-]+\.[\w.]+/.test(t))
    return { ok:false, reason:"Leave your email out of it, for your own sake." };
  if(/(\+?\d[\d\s().-]{7,}\d)/.test(t))
    return { ok:false, reason:"Leave phone numbers out of it, for your own sake." };
  return { ok:true, text:t.trim() };
}

/* One place decides what freezing means, so leaving and deleting cannot drift
   apart and neither can be made to skip a step. */
function freezeNest(nest, byUserId, reason){
  nest.status = "archived";
  nest.archived_at = now();
  nest.archived_by = byUserId;
  nest.archive_reason = reason;
  membershipsOf(nest.id).forEach(m => { if(m.status === "active") m.status = "left"; });
  Object.values(DB.invites).forEach(i => { if(i.nest_id === nest.id && i.status === "open") i.status = "revoked"; });
  const g = DB.game[nest.id];
  if(g){ g.frozen = true; g.frozen_at = now(); }
}
function nameOf(userId){
  const u = DB.users[userId];
  if(!u) return "Someone";
  return u.deleted ? null : u.display_name;
}

function issueInvite(nestId, byUserId){
  Object.values(DB.invites).forEach(i => {
    if(i.nest_id === nestId && i.status === "open") i.status = "revoked";   // regenerating kills the old one
  });
  let code = inviteCode();
  while(DB.invites[code]) code = inviteCode();
  const inv = { code, nest_id:nestId, created_by:byUserId, created_at:now(),
                expires_at:now() + INVITE_TTL, consumed_at:null, status:"open", claimed_by:null };
  DB.invites[code] = inv;
  return inv;
}

/* Match a path against the route table segment by segment. Guessing which
   segment is an id from its shape works right up until an id does not look
   the way you guessed, which is how a seeded house stopped being reportable. */
const ROUTE_TABLE = Object.keys(routes).map(k => {
  const sp = k.indexOf(" ");
  return { key:k, method:k.slice(0, sp), parts:k.slice(sp + 1).split("/").filter(Boolean) };
});
function matchRoute(method, path){
  const parts = path.split("?")[0].split("/").filter(Boolean);
  for(const r of ROUTE_TABLE){
    if(r.method !== method || r.parts.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for(let i = 0; i < parts.length; i++){
      const t = r.parts[i];
      if(t.charAt(0) === "{") params[t.slice(1, -1)] = decodeURIComponent(parts[i]);
      else if(t !== parts[i]){ ok = false; break; }
    }
    if(ok) return { route:routes[r.key], params, key:r.key };
  }
  return null;
}

/* One entry point, shaped like the transport it replaces. Latency is real
   so every screen has to have something to show while it waits. */
const Api = {
  Realtime, Session,
  /* src/backend.js sets these two when a database is reachable. Every call
     waits on the decision once, so no screen has to know which one it got. */
  backend: null, readyP: null,
  get db(){ return DB; },
  async call(method, path, body){
    if(this.readyP) await this.readyP;
    if(this.backend) return this.backend.call(method, path, body);
    await new Promise(r => setTimeout(r, LATENCY));
    if(!Realtime.online) throw apiError(0, "offline");
    const hit = matchRoute(method, path);
    if(!hit) throw apiError(404, "no_route:" + method + " " + path);
    return withStoreLock(() => {
      syncDB();
      const out = hit.route({ ...hit.params, ...(body || {}) });
      saveDB();
      return out;
    });
  },
  /* The game document belongs to the nest, so where the nest lives decides
     where it is written. Locally that is the same localStorage blob the
     store already wrote, so this is a no op. */
  saveGame(g){
    if(this.backend) return this.backend.saveGame(g);
  },
  reset(){
    if(this.backend) this.backend.sb.auth.signOut();
    DB = blankDB(); saveDB(); Session.clear();
  },
};

loadDB();
Realtime.init();
Session.load();
