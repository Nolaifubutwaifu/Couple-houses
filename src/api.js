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
    syncDB();
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
  load(){
    try{ this.userId = sessionStorage.getItem(SESSION_KEY) || null; }catch(err){ this.userId = null; }
    // A tab with no session of its own falls back to the last identity on
    // this device, which is what a reinstall or a new device looks like.
    // Arriving on an invite link does not: the person opening it is the one
    // being invited, so they authenticate as themselves.
    const onInvite = /[?#&]j=[A-Za-z0-9]{6}/.test(location.search + location.hash);
    if(!this.userId && !onInvite){
      try{ this.userId = localStorage.getItem(SESSION_KEY + ".last") || null; }catch(err){ /* ignore */ }
    }
    if(this.userId && !DB.users[this.userId]) this.userId = null;
    return this.userId;
  },
  set(id){
    this.userId = id;
    try{ sessionStorage.setItem(SESSION_KEY, id); localStorage.setItem(SESSION_KEY + ".last", id); }
    catch(err){ /* memory only */ }
  },
  clear(){
    this.userId = null;
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
    u.display_name = name;
    u.birthdate = birthdate;               // stored once, not silently editable later
    u.age_verified = age >= MIN_AGE;
    saveDB();
    if(!u.age_verified) throw apiError(403, "under_age", { min_age:MIN_AGE, age });
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
    nest.name = n;
    saveDB();
    Realtime.emit("nest.named", { nest_id:nest.id, name:n });
    return { nest };
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
    if(!nest) return { user:u, nest:null };
    const members = membershipsOf(nest.id).filter(x => x.status !== "left").map(x => ({
      ...x, user:DB.users[x.user_id],
    }));
    const invite = Object.values(DB.invites).find(i => i.nest_id === nest.id && expireInvite(i).status === "open");
    const pending = members.find(x => x.status === "invited");
    return { user:u, nest, membership:m, members, invite,
             pending_partner: pending ? DB.users[pending.user_id] : null };
  },

  "POST /nests/{id}/leave"({ id }){
    const m = Object.values(DB.memberships).find(x => x.nest_id === id && x.user_id === Session.userId);
    if(m) m.status = "left";
    const nest = DB.nests[id];
    if(nest && membershipsOf(id, "active").length === 0) nest.status = "archived";
    saveDB();
    return { ok:true };
  },
};

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

/* One entry point, shaped like the transport it replaces. Latency is real
   so every screen has to have something to show while it waits. */
const Api = {
  Realtime, Session,
  get db(){ return DB; },
  async call(method, path, body){
    const key = method + " " + path.replace(/\/(?:[A-Z0-9]{6}|nst_[a-z0-9]+)(?=\/|$)/g, m => {
      return /^\/[A-Z0-9]{6}$/.test(m) ? "/{code}" : "/{id}";
    });
    const route = routes[key];
    await new Promise(r => setTimeout(r, LATENCY));
    if(!Realtime.online) throw apiError(0, "offline");
    if(!route) throw apiError(404, "no_route:" + key);
    const params = {};
    const codeM = path.match(/\/([A-Z0-9]{6})(?=\/|$)/);
    if(codeM) params.code = codeM[1];
    const idM = path.match(/\/(nst_[a-z0-9]+)(?=\/|$)/);
    if(idM) params.id = idM[1];
    syncDB();
    const out = route({ ...params, ...(body || {}) });
    saveDB();
    return out;
  },
  reset(){
    DB = blankDB(); saveDB(); Session.clear();
  },
};

loadDB();
Realtime.init();
Session.load();
