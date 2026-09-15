/* NEST :: the app once two people are in it.
   Everything above this file is onboarding. The game state belongs to the
   nest, not the device, so both paired tabs read and write the same record
   and tell each other when it changes. */
"use strict";

const GAME_VERSION = 3;

/* The four method seam is unchanged, it just sits on the nest record now. */
const Store = {
  async load(nestId){ return Api.db.game[nestId] || null; },
  async save(g){
    if(!g || !g.nest_id) return false;
    Api.db.game[g.nest_id] = g;
    Api.saveGame(g);                      // a real backend writes it to the nest row too
    try{ localStorage.setItem("nest.db.v1", JSON.stringify(Api.db)); }
    catch(err){ console.warn("save failed, this session is memory only", err); return false; }
    return true;
  },
  async listShowcase(g){
    const mine = g && g.showcase.published ? [ownCard(g)] : [];
    const seeds = seedCards();
    return [...mine, ...seeds].map(h => ({ ...h, charm:charmOf(h.placed) })).sort((a, b) => b.charm - a.charm);
  },
  async likeHouse(g, id){
    const arr = g.showcase.likesGiven, at = arr.indexOf(id);
    if(at >= 0) arr.splice(at, 1); else arr.push(id);
    await this.save(g);
    return at < 0;
  },
};

const SEED_HOUSES = [
  { id:"seed-1", name:"The Long Room", partners:"Bea and Cass", since:"2014-05-01", likes:1240,
    tagline:"Everything in here has a story.",
    placed:[["sofa","living",2,4],["fireplc","living",3,0],["books","living",0,1],["photos","living",7,1],
            ["vows","living",8,5],["heartst","living",0,6],["guitar","living",6,5],["plant","living",9,0],
            ["table","kitchen",3,2],["coffee","kitchen",0,0],["fountain","garden",4,3],["tree","garden",8,6]] },
  { id:"seed-2", name:"Hillside", partners:"Ana and Rue", since:"2016-06-25", likes:903,
    tagline:"Ten years and the tree is finally big.",
    placed:[["sofa","living",1,1],["tv","living",6,0],["armchair","living",7,5],["books","living",0,5],
            ["photos","living",4,6],["heartst","living",8,2],["tree","garden",3,3],["bench","garden",7,7],
            ["tulips","garden",1,7],["firepit","garden",8,1]] },
  { id:"seed-3", name:"Flat 9B", partners:"Dee and Sam", since:"2022-11-18", likes:188,
    tagline:"Small flat, big plans.",
    placed:[["sofa","living",3,3],["console","living",8,1],["plant","living",0,0],["armchair","living",1,6],
            ["photos","living",8,6],["books","living",6,6]] },
  { id:"seed-4", name:"The Boat Shed", partners:"Kip and Noor", since:"2021-01-09", likes:265,
    tagline:"We argue about the thermostat.",
    placed:[["sofa","living",4,2],["armchair","living",0,0],["plant","living",9,0],["tv","living",5,6],
            ["photos","living",0,6],["fireplc","living",0,3]] },
  { id:"seed-5", name:"Number 12", partners:"Jo and Ines", since:"2023-08-14", likes:97,
    tagline:"Two years in, still buying chairs.",
    placed:[["armchair","living",2,2],["armchair","living",5,2],["plant","living",8,4],["books","living",0,6]] },
  { id:"seed-6", name:"The Tan House", partners:"Mai and Ollie", since:"2019-03-02", likes:412,
    tagline:"Six years, one very loud kettle.",
    placed:[["sofa","living",1,3],["tv","living",6,0],["books","living",9,4],["fireplc","living",0,0],
            ["plant","living",4,6],["photos","living",7,6],["heartst","living",9,0],
            ["stove","kitchen",1,1],["fridge","kitchen",4,1],["table","kitchen",3,4]] },
];

/* The sample homes as street cards. They fill the street until there are
   enough real couples on it, and they say what they are. */
function seedCards(){
  return SEED_HOUSES.map(h => ({ ...h, mine:false, sample:true,
    placed:h.placed.map((p, i) => ({ itemId:p[0], room:p[1], x:p[2], y:p[3], rot:p[4] || 0, instanceId:h.id + "_" + i })) }))
    .map(h => ({ ...h, charm:charmOf(h.placed) }));
}
/* The street from the database when there is one, topped up with sample
   homes while it is still quiet. Hearts on a sample home are this device's
   own; hearts on a real one are counted once per person by the database. */
async function loadStreet(){
  let real = null;
  try{ real = await Api.call("GET", "/street"); }catch(err){ real = null; }
  if(!real || real.local) return (await Store.listShowcase(state)).map(h => ({ ...h, local:true }));
  const homes = (real.homes || []).map(h => ({ ...h, placed:h.placed || [], tagline:h.tagline || "" }));
  const fill = homes.length >= 6 ? [] : seedCards().slice(0, 6 - homes.length);
  return homes.concat(fill).sort((a, b) => b.charm - a.charm);
}
function heartOf(h){ return h.sample || h.local ? state.showcase.likesGiven.includes(h.id) : !!h.liked; }
function heartsOf(h){ return h.sample || h.local ? h.likes + (heartOf(h) ? 1 : 0) : h.likes; }
async function toggleHeart(h){
  if(h.sample || h.local) return Store.likeHouse(state, h.id);
  try{
    const r = await Api.call("POST", "/street/" + h.id + "/like", {});
    h.liked = r.liked; h.likes = r.likes;
  }catch(err){ toast(err.code === "own_home" ? "That one is yours" : "That did not go through. Try again?"); }
}

const GAME_ICON = { ritual:"clock", duel:"heartst", memory:"cat" };

/* ---- state ---- */
let state = null;                 // the nest's game record
let route = { tab:"home", view:null };
let held = null;
let shopFilter = "living";
let viewingLot = null;

function newGame(nest){
  const rooms = {};
  (typeof ROOMS !== "undefined" ? ROOMS : [{ id:"living", price:0 }]).forEach(r => { rooms[r.id] = { unlocked:r.price === 0 }; });
  return {
    version:GAME_VERSION, nest_id:nest.id,
    wallet:{ coins:BALANCE.startingCoins, lifetimeEarned:0 },
    bond:0,
    streak:{ count:0, lastCheckIn:null, day:null, a:false, b:false, aAns:null, bAns:null },
    daily:{ day:null, duel:0, memory:0 },
    /* The duel round is shared rather than per device, so each of you plays
       your own half of it. The plan is what a founder laid out while they
       were waiting on their own: positions, no purchase. */
    duel:null,
    plan:[],
    house:{ rooms, inventory:[], placed:[] },
    showcase:{ published:false, likesGiven:[], tagline:"" },
    stats:{ gamesPlayed:0, duelsPlayed:0, bestDuel:0 },
    ceremony_pending:false,
  };
}

/* A document the database wrote from scratch carries only what the database
   decides: the wallet, the rooms, what is owned. Every section the screens
   and the merge read gets its default here, so nothing reaches into a part of
   the document that is not there. */
function normalizeGame(g, nestId){
  const id = nestId || (g && g.nest_id);
  const base = newGame({ id });
  if(!g || typeof g !== "object") return base;
  const obj = v => (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
  const out = { ...base, ...g };
  ["wallet", "streak", "daily", "showcase", "stats"].forEach(k => { out[k] = { ...base[k], ...obj(g[k]) }; });
  const house = obj(g.house);
  out.house = { ...base.house, ...house, rooms:{ ...base.house.rooms, ...obj(house.rooms) } };
  out.house.inventory = Array.isArray(house.inventory) ? house.inventory : [];
  out.house.placed = Array.isArray(house.placed) ? house.placed : [];
  out.showcase.likesGiven = Array.isArray(out.showcase.likesGiven) ? out.showcase.likesGiven : [];
  out.plan = Array.isArray(g.plan) ? g.plan : [];
  out.nest_id = id;
  return out;
}

/* An instanceId is the only handle a placed thing has, and pick up removes
   every row that matches it: two things sharing an id means lifting one
   deletes both and hands back one, which is how a player loses furniture they
   paid for. The tutorial used to write "start_plant" on every tap, so saves
   already in the wild carry the damage and repairing on load is the only way
   to reach them. Nothing is deleted here. The duplicate keeps its place on the
   floor and gets an id of its own. */
function repairInstanceIds(g){
  if(!g || !g.house) return false;
  const seen = new Set();
  let fixed = 0;
  const claim = item => {
    if(!item || !item.instanceId) return;
    if(seen.has(item.instanceId)){
      item.instanceId = item.itemId + "_fix_" + uid();
      fixed++;
    }
    seen.add(item.instanceId);
  };
  (g.house.inventory || []).forEach(claim);
  (g.house.placed || []).forEach(claim);
  return fixed > 0;
}

/* Three way merge, for the save the database refused because the other person
   got there first. The three documents are what this device started from, what
   it has now, and what is actually stored, and every field in the game has an
   obvious right answer given all three: coins move by the amount this device
   moved them, furniture is added and removed rather than replaced wholesale, a
   room that either of them unlocked stays unlocked. Last write wins is what
   makes one partner's afternoon disappear, so nothing here overwrites a field
   it did not change. */
function mergeGame(base, mine, theirs){
  theirs = normalizeGame(theirs);
  if(!base || !mine) return theirs;             // nothing to rebase, take the truth
  base = normalizeGame(base); mine = normalizeGame(mine);
  const out = JSON.parse(JSON.stringify(theirs));
  const delta = (b, m) => (m || 0) - (b || 0);

  out.wallet.coins = Math.max(0, (theirs.wallet.coins || 0) + delta(base.wallet.coins, mine.wallet.coins));
  out.wallet.lifetimeEarned = (theirs.wallet.lifetimeEarned || 0) +
    delta(base.wallet.lifetimeEarned, mine.wallet.lifetimeEarned);
  out.bond = (theirs.bond || 0) + delta(base.bond, mine.bond);
  ["gamesPlayed", "duelsPlayed"].forEach(k => {
    out.stats[k] = (theirs.stats[k] || 0) + delta(base.stats[k], mine.stats[k]);
  });
  out.stats.bestDuel = Math.max(theirs.stats.bestDuel || 0, mine.stats.bestDuel || 0);

  // a room either of them paid for is unlocked for both
  Object.keys(mine.house.rooms).forEach(id => {
    if(mine.house.rooms[id].unlocked) out.house.rooms[id] = { unlocked:true };
  });

  // furniture by identity: what this device added, minus what it took away
  const byId = arr => { const m = {}; (arr || []).forEach(p => { m[p.instanceId] = p; }); return m; };
  const baseP = byId(base.house.placed), mineP = byId(mine.house.placed);
  const merged = byId(theirs.house.placed);
  Object.keys(baseP).forEach(id => { if(!mineP[id]) delete merged[id]; });   // removed here
  Object.keys(mineP).forEach(id => { merged[id] = mineP[id]; });             // added or moved here
  out.house.placed = Object.keys(merged).map(id => merged[id]);

  /* Storage by identity too. These rows arrive as parsed JSON, so comparing
     them as objects never matched: every refused save put everything this
     device held back into storage a second time, and repairInstanceIds then
     gave each copy an id of its own, turning three starter items into nine. */
  const baseInv = byId(base.house.inventory), mineInv = byId(mine.house.inventory);
  const inv = byId(theirs.house.inventory);
  Object.keys(baseInv).forEach(id => { if(!mineInv[id]) delete inv[id]; });   // taken out here
  Object.keys(mineInv).forEach(id => { if(!baseInv[id]) inv[id] = mineInv[id]; });   // put in here
  // a thing is either on the floor or in storage, never both
  Object.keys(inv).forEach(id => { if(merged[id]) delete inv[id]; });
  out.house.inventory = Object.keys(inv).map(id => inv[id]);

  /* The streak belongs to the day. A count and a check in only move forward,
     and each answer belongs to the person who gave it, so two devices that
     each recorded their own half of the same day keep both halves. */
  out.streak = mergeStreak(mine.streak || {}, theirs.streak || {});
  if(mine.daily.day && mine.daily.day >= (theirs.daily.day || "")){
    out.daily = { day:mine.daily.day,
      duel:Math.max(mine.daily.duel || 0, theirs.daily.day === mine.daily.day ? theirs.daily.duel || 0 : 0),
      memory:Math.max(mine.daily.memory || 0, theirs.daily.day === mine.daily.day ? theirs.daily.memory || 0 : 0) };
  }
  /* The duel round is one round with two halves, and the only way it moves is
     forward, so whichever copy has more of it filled in is the true one. */
  const filled = d => !d ? -1 : (d.settled ? 1000 : 0) + (d.answers || []).length + (d.guesses || []).length;
  if(filled(mine.duel) > filled(theirs.duel)) out.duel = mine.duel;
  // the plan is one person's sketch, so the copy that changed is the copy
  if(JSON.stringify(mine.plan || []) !== JSON.stringify(base.plan || [])) out.plan = mine.plan;

  if(mine.showcase.published !== base.showcase.published ||
     mine.showcase.tagline !== base.showcase.tagline) out.showcase = mine.showcase;
  if(mine.ritualLog && (!theirs.ritualLog || mine.ritualLog.length > theirs.ritualLog.length))
    out.ritualLog = mine.ritualLog;
  out.ceremony_pending = mine.ceremony_pending && theirs.ceremony_pending;
  if(mine.firstRitualPaid || theirs.firstRitualPaid) out.firstRitualPaid = true;
  return out;
}
function mergeStreak(mine, theirs){
  const out = { ...theirs };
  if((mine.lastCheckIn || "") > (theirs.lastCheckIn || "")){
    out.lastCheckIn = mine.lastCheckIn;
    out.count = mine.count;
  }else if(mine.lastCheckIn === theirs.lastCheckIn){
    out.count = Math.max(mine.count || 0, theirs.count || 0);
  }
  const day = (mine.day || "") > (theirs.day || "") ? mine.day : theirs.day;
  out.day = day;
  ["a", "b"].forEach(k => {
    const pick = [mine, theirs].find(s => s.day === day && s[k + "Ans"] !== null && s[k + "Ans"] !== undefined);
    out[k + "Ans"] = pick ? pick[k + "Ans"] : null;
    out[k] = !!pick;
  });
  return out;
}

/* Settings had nothing to say about notifications, which left the primer in
   onboarding as the only time anybody was ever asked. Browsers do not let a
   page take a permission back, so the honest switch is our own: the
   permission if we do not have it, and a mute of our own that notify()
   obeys if we do. */
/* Once there is a database it is the only authority on money: the wallet,
   the bond, the streak, which rooms are open and how many plays are left
   today. Any merge on this device keeps those from the database's copy. */
function serverOwned(merged, truth){
  if(!merged || !truth) return merged;
  if(truth.wallet) merged.wallet = { ...truth.wallet };
  if(truth.bond !== undefined) merged.bond = truth.bond;
  if(truth.firstRitualPaid !== undefined) merged.firstRitualPaid = truth.firstRitualPaid;
  if(truth.streak){
    merged.streak = { ...(merged.streak || {}), count:truth.streak.count, lastCheckIn:truth.streak.lastCheckIn };
    if(truth.streak.day === merged.streak.day) ["a", "b"].forEach(k => {
      const v = truth.streak[k + "Ans"];
      if(v !== null && v !== undefined){ merged.streak[k + "Ans"] = v; merged.streak[k] = true; }
    });
  }
  if(truth.house && truth.house.rooms && merged.house) merged.house.rooms = JSON.parse(JSON.stringify(truth.house.rooms));
  if(truth.daily && merged.daily && truth.daily.day === merged.daily.day) merged.daily = { ...truth.daily };
  return merged;
}
/* Key order is not meaning. jsonb hands keys back in its own order, so two
   identical documents can stringify differently. */
function stableJSON(v){
  if(Array.isArray(v)) return "[" + v.map(stableJSON).join(",") + "]";
  if(v && typeof v === "object") return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + stableJSON(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
}

/* The screens show a change the moment it is made. This is where it is
   confirmed: with a database the answer is the truth and is adopted by the
   transport, and a refusal is handed back so the screen can undo itself. */
const Economy = {
  async call(path, body){
    if(!App.me || !App.me.nest) return null;
    try{ return await Api.call("POST", "/nests/" + App.me.nest.id + path, body || {}); }
    catch(err){ return { error:err.code || "failed" }; }
  },
  refusal(code){
    if(typeof Sound !== "undefined") Sound.play("error");
    return ({ not_enough_coins:"Not enough coins", room_locked:"Unlock that room first",
              frozen:"This nest is frozen", not_paired:"Your partner needs to be here" })[code]
      || "That did not go through. Try again?";
  },
};

const Push = {
  KEY:"nest.push_muted",
  muted(){
    try{ return localStorage.getItem(this.KEY) === "1"; }catch(err){ return false; }
  },
  setMuted(v){
    try{ localStorage.setItem(this.KEY, v ? "1" : "0"); }catch(err){ /* memory only */ }
  },
  permission(){
    try{ return typeof Notification === "undefined" ? "unsupported" : Notification.permission; }
    catch(err){ return "unsupported"; }
  },
  async ask(){
    try{ return (await Notification.requestPermission()) === "granted"; }
    catch(err){ return false; }
  },
  supported(){
    return typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof window.PushManager !== "undefined";
  },
  /* iPhone and iPad only deliver web push to a site added to the Home Screen */
  needsHomeScreen(){
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const standalone = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone;
    return ios && !standalone;
  },
  /* A browser subscription, handed to the database with the local time zone,
     so the partner notifications and the seven o'clock reminder have somewhere
     to go. Quietly does nothing where push cannot work. */
  async subscribe(){
    if(!Api.backend || !this.supported() || this.permission() !== "granted" || this.muted()) return false;
    try{
      const reg = await navigator.serviceWorker.register("sw.js");
      let sub = await reg.pushManager.getSubscription();
      if(!sub){
        const { key } = await Api.call("GET", "/push/key");
        if(!key) return false;
        sub = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:base64Url(key) });
      }
      const j = sub.toJSON();
      await Api.call("POST", "/push/subscribe", { endpoint:j.endpoint, p256dh:j.keys.p256dh, auth:j.keys.auth,
                                                  tz_offset:-new Date().getTimezoneOffset() });
      return true;
    }catch(err){ console.warn("push subscription failed", err); return false; }
  },
  async unsubscribe(){
    if(!this.supported()) return;
    try{
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      if(!sub) return;
      if(Api.backend) await Api.call("POST", "/push/unsubscribe", { endpoint:sub.endpoint });
      await sub.unsubscribe();
    }catch(err){ /* the database drops dead subscriptions on its own */ }
  },
};
function base64Url(s){
  const pad = "=".repeat((4 - s.length % 4) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
/* Tell the other person something happened. Fire and forget: the push
   function decides whether it is worth a notification and throttles it. */
function notifyPartner(kind){
  if(!Api.backend || !App.me || !App.me.nest) return;
  Api.call("POST", "/nests/" + App.me.nest.id + "/notify", { kind }).catch(() => {});
}

/* Only one pair of hands at a time. Two people dragging furniture around the
   same room at once is not collaboration, it is a fight the loser does not
   know they are in, so the build tab is a turn rather than a free for all.
   The hold expires by itself, because a partner who closes the tab halfway
   through arranging must not lock the other one out of their own house. */
const Build = {
  mine:false, builder:null, name:null, until:0, beat:null,
  get heldByPartner(){ return !!this.builder && !this.mine; },
  apply(r){
    this.mine = !!(r && r.mine);
    this.builder = (r && r.builder) || null;
    this.name = (r && r.builder_name) || this.name;
    this.until = (r && (typeof r.until === "number" ? r.until : Date.parse(r.until))) || 0;
    return this;
  },
  async take(){
    if(!App.me || !App.me.nest) return this;
    try{ this.apply(await Api.call("POST", "/nests/" + App.me.nest.id + "/build/claim", {})); }
    catch(err){ this.mine = false; }
    this.pump();
    return this;
  },
  async release(){
    this.stop();
    if(!this.mine || !App.me || !App.me.nest) return;
    this.mine = false; this.builder = null;
    try{ await Api.call("POST", "/nests/" + App.me.nest.id + "/build/release", {}); }
    catch(err){ /* it expires on its own */ }
  },
  /* the hold is short so a dead tab frees it quickly, which means a live one
     has to keep saying it is still here */
  pump(){
    this.stop();
    if(!this.mine) return;
    this.beat = setInterval(() => {
      if(route.tab !== "build" || !this.mine) return this.release();
      Api.call("POST", "/nests/" + App.me.nest.id + "/build/claim", {})
        .then(r => this.apply(r)).catch(() => {});
    }, 15000);
  },
  stop(){ clearInterval(this.beat); this.beat = null; },
};

/* The one document for this nest is whatever Api.db holds, and a sync replaces
   that object rather than editing it. Anything still holding the old object
   then writes its change onto a copy the database has moved past, and saving
   it tells the merge that this phone undid everything in between: that is how
   the first ritual's reward was paid, stored, and then taken back again as if
   it had been spent. So `state` follows the live document, always. */
function liveGame(){
  if(!state || !state.nest_id) return state;
  const live = Api.db.game[state.nest_id];
  if(live && live !== state){
    const couple = state.couple;
    state = live;
    if(couple && !state.couple) state.couple = couple;
  }
  return state;
}

const App = {
  me:null, get game(){ return liveGame(); },

  ensureGame(nestId){
    Api.db.game[nestId] = Api.db.game[nestId] ? normalizeGame(Api.db.game[nestId], nestId) : newGame({ id:nestId });
    state = Api.db.game[nestId];
    state.nest_id = nestId;
    if(repairInstanceIds(state)) Store.save(state);
    return state;
  },
  saveGame(){
    Store.save(state);
    /* The document rides with the message on the local store. localStorage is
       not consistent across renderer processes on write, so a tab told to go
       and re-read can still be looking at the value from before the write
       that prompted the message: the other phone then sits on the ritual or
       the duel showing a state that has already moved on, and only a reload
       catches it up. A database does not have this problem, and its own
       message carries no document because it has already pulled the row. */
    Api.Realtime.emit("game.changed", Api.Realtime.usesLocalDB
      ? { nest_id:state.nest_id, game:state }
      : { nest_id:state.nest_id });
  },

  /* Onboarding hands over here, and only here. Reaching this point means
     two active memberships exist, which is what makes the solo rules in
     section 5 structural rather than a screen that has to remember. */
  async enter(me){
    this.me = me;
    Onboard.finish();
    this.ensureGame(me.nest.id);
    if(state.ceremony_pending){
      // this pair is owed a ceremony, in full, once
      document.body.classList.add("onboarding");
      $("#onboard").hidden = false;
      Onboard.go("ceremony", me);
      return;
    }
    state.couple = this.couple(me);
    render();
    refreshWorld();
    Economy.call("/items/restore");          // anything owned the document lost, back into storage
    Push.subscribe();                          // refresh the subscription and the time zone it sends at
    Api.Realtime.on(msg => {
      if(!state || msg.payload.nest_id !== state.nest_id) return;
      if(msg.type === "game.changed"){
        // what arrived beats what the store has had time to tell us
        const fresh = msg.payload.game || Api.db.game[state.nest_id];
        if(fresh){
          Api.db.game[state.nest_id] = fresh;
          state = fresh;
          state.couple = this.couple(this.me);
          /* If the document that just arrived already accounts for the thing
             in your hands, your hands are empty, whatever they were doing a
             moment ago. Without this the same piece exists twice: once in the
             room and once still held, and putting it back into storage makes
             a second copy of a thing there is only one of. */
          if(held && (fresh.house.placed.some(p => p.instanceId === held.instanceId) ||
                      fresh.house.inventory.some(i => i.instanceId === held.instanceId))){
            held = null;
            Diorama.setHeld(null);
          }
          refreshWorld(); render();
        }
      }
      if(msg.type === "build.lock"){
        Build.apply({ mine:msg.payload.builder === Api.Session.userId,
                      builder:msg.payload.builder, builder_name:msg.payload.builder_name,
                      until:msg.payload.until });
        if(route.tab === "build") render();
      }
      if(msg.type === "nest.named"){ this.me.nest.name = msg.payload.name; render(); }
      if(msg.type === "nest.frozen" && msg.payload.by !== Api.Session.userId){
        toast("This nest has been frozen.");
        setTimeout(() => App.restart(), 1800);
      }
    });
  },
  couple(me){
    const a = me.members.find(m => m.role === "founder"), b = me.members.find(m => m.role === "partner");
    return {
      name: me.nest.name || "Our nest",
      partnerA: a && a.user ? a.user.display_name : "One",
      partnerB: b && b.user ? b.user.display_name : "Two",
      togetherSince: localDay(new Date(me.nest.created_at)),
    };
  },
  /* one notification path, so the nudge rules cannot be bypassed by a caller,
     and one switch, so the setting cannot be bypassed either */
  notify(body){
    try{
      if(typeof Notification !== "undefined" && Notification.permission === "granted" && !Push.muted()){
        new Notification("NEST", { body });
        return;
      }
    }catch(err){ /* fall through to the in app version */ }
    toast(body);
  },
  /* Leaving or deleting drops you back to the start of the flow in place.
     Reloading the page would do it too, and would also throw away the frame
     for a beat on the one screen where a white flash is least welcome. */
  restart(){
    state = null; held = null; viewingLot = null; activeGame = null;
    this.me = null;
    route = { tab:"home", view:null };
    $("#sheet").innerHTML = "";
    $("#bar").hidden = $("#tabs").hidden = $("#tools").hidden = true;
    Diorama.setHeld(null);
    Diorama.pulseTarget(null);
    Onboard.demoShown = false;
    Onboard.begin();
  },

  /* Settings is where the two irreversible things live, and both of them say
     exactly what will happen before they happen. No modal confirms: the
     consequences need more room than a dialog gives them. */
  async openSettings(host){
    const s = host || $("#sheet");
    if(!host) route = { tab:"home", view:null };
    s.innerHTML = "";
    const me = this.me;
    const other = me && me.members.find(m => m.user_id !== Api.Session.userId);
    /* Settings took over the sheet with no way back but guessing that a tab
       would do it. Inside onboarding the flow draws its own Back. */
    if(!host && state){
      const back = el(`<button class="btn back">Back</button>`);
      back.onclick = () => go(route.tab || "home");
      s.appendChild(back);
    }
    if(me && me.nest){
      s.appendChild(el(`<div class="card">
        <p class="h">${esc(me.nest.name || "Your nest")}</p>
        <p class="s dim">${other && other.user ? "With " + esc(other.user.display_name) : "Just you"} ·
          started ${formatDate(me.nest.created_at)}</p></div>`));
      const rename = el(`<div class="card">
        <p class="h">Rename this nest</p>
        <p class="s dim">You both named it together. Either of you can change it, and the
        other one is told.</p>
        <label class="f" style="margin-top:12px"><span>Name</span>
          <input id="set-name" maxlength="28" value="${esc(me.nest.name || "")}"></label>
        <button class="btn" id="set-rename">Save the name</button></div>`);
      rename.querySelector("#set-rename").onclick = async () => {
        const name = rename.querySelector("#set-name").value.trim();
        if(!name) return toast("It needs a name");
        if(name === me.nest.name) return;
        try{
          await Api.call("POST", "/nests/" + me.nest.id + "/name", { name });
          me.nest.name = name;
          toast("Renamed");
          render();
        }catch(err){ toast("That did not save. Try again?"); }
      };
      s.appendChild(rename);

      const leave = el(`<div class="card">
        <p class="h">Leave this nest</p>
        <p class="s dim">The nest stops here for both of you. Nothing is deleted and nobody
        keeps it: it freezes exactly as it is, and neither of you can place anything, earn
        anything or rename it again. You will both still be able to look at it from
        settings, and you will both be free to start a new one.</p>
        <button class="btn" id="set-leave" style="margin-top:12px">Leave this nest</button></div>`);
      leave.querySelector("#set-leave").onclick = () => this.confirmLeave(s, me);
      s.appendChild(leave);
    }

    const arch = await Api.call("GET", "/nests/archived");
    if(arch.nests.length){
      s.appendChild(el(`<p class="lbl">Nests you have left</p>`));
      arch.nests.forEach(n => {
        const names = n.members.map(m => m.name || "Someone").join(" and ");
        const card = el(`<button class="row"><div><p class="h">${esc(n.name || "A nest")}</p>
          <p class="s dim">${esc(names)} · frozen ${formatDate(n.archived_at)}</p></div></button>`);
        card.onclick = () => this.showArchived(n);
        s.appendChild(card);
      });
    }

    /* Settings held nothing but the two irreversible things. Signing out is
       the ordinary way to hand the device back, and without it the only ways
       off an account were leaving the nest or deleting it. */
    const out = el(`<div class="card">
      <p class="h">Sign out</p>
      <p class="s dim">Nothing is deleted and the nest is untouched. Signing back in with the
      same account puts you exactly here.</p>
      <button class="btn" id="set-out" style="margin-top:12px">Sign out</button></div>`);
    out.querySelector("#set-out").onclick = () => {
      Api.Session.clear();
      Track.fire("signed_out", { from:"settings" });
      this.restart();
    };
    s.appendChild(out);

    /* A guest account lives in this browser only. Linking a sign in keeps the
       same account and nest, and makes both recoverable on any device. */
    if(Api.backend){
      Api.call("GET", "/auth/identity").then(id => {
        if(!id || !id.anonymous || !id.available.length || !out.isConnected) return;
        const names = { apple:"Apple", google:"Google" };
        const keep = el(`<div class="card">
          <p class="h">Keep your nest safe</p>
          <p class="s dim">Right now your account lives only in this browser. Link a sign in and you can
          get back to this nest from any device, even if this browser is cleared.</p>
          <div class="ob-stack" id="link-ways"></div></div>`);
        id.available.forEach(p => {
          const b = el(`<button class="btn">Link ${names[p]}</button>`);
          b.onclick = async () => {
            b.disabled = true;
            try{ await Api.call("POST", "/auth/link", { provider:p }); }
            catch(err){
              b.disabled = false;
              toast(err.code === "linking_disabled" ? "Linking is not switched on yet" : "That did not work. Try again?");
            }
          };
          keep.querySelector("#link-ways").appendChild(b);
        });
        out.after(keep);
      }).catch(() => {});
    }

    const perm = Push.permission();
    const on = perm === "granted" && !Push.muted();
    const note = el(`<div class="card">
      <p class="h">Notifications</p>
      <p class="s dim">${
        perm === "unsupported" ? "This browser has no notifications, so there is nothing to turn on."
        : perm === "denied" ? "Your browser is blocking them for this site. That switch is in the browser, not here, and we cannot turn it back on for you."
        : on ? "On. We ping you when " + (other && other.user ? esc(other.user.display_name) : "your partner") +
               " does something in your nest, or when it is time for your daily moment. Nothing else, ever."
        : perm === "granted" ? "Muted. Nothing will be sent until you turn them back on."
        : "Off. Turn them on and we will ping you when your partner does something, or when it is time for your daily moment."}</p>
      ${perm === "unsupported" || perm === "denied" ? ""
        : `<button class="btn" id="set-push" style="margin-top:12px">${
            on ? "Mute notifications" : perm === "granted" ? "Turn them back on" : "Turn on notifications"}</button>`}</div>`);
    if(Push.needsHomeScreen() && perm !== "denied"){
      note.appendChild(el(`<p class="s dim" style="margin-top:8px">On iPhone and iPad, add NEST to your Home
        Screen first (Share, then Add to Home Screen) and open it from there. That is the only place Apple
        delivers notifications from a web app.</p>`));
    }
    if(note.querySelector("#set-push")) note.querySelector("#set-push").onclick = async () => {
      if(on){ Push.setMuted(true); await Push.unsubscribe(); toast("Muted"); return this.openSettings(host); }
      if(perm !== "granted"){
        const got = await Push.ask();
        Track.fire(got ? "push_granted" : "push_denied", { via:"settings" });
        if(!got) toast("Your browser said no");
      }
      Push.setMuted(false);
      Push.subscribe();
      this.openSettings(host);
    };
    s.appendChild(note);

    const soundOn = !Sound.muted();
    const sound = el(`<div class="card">
      <p class="h">Sound</p>
      <p class="s dim">${soundOn ? "On. Soft sounds when you place things, earn and answer." : "Off."}</p>
      <button class="btn" id="set-sound" style="margin-top:12px">${soundOn ? "Turn sound off" : "Turn sound on"}</button></div>`);
    sound.querySelector("#set-sound").onclick = () => {
      Sound.setMuted(soundOn);
      if(!soundOn) Sound.play("tap");
      this.openSettings(host);
    };
    s.appendChild(sound);

    const help = el(`<div class="card">
      <p class="h">Help and legal</p>
      <p class="s dim">Something wrong, or a question about your data? Write to
        <a href="mailto:${CONTACT_EMAIL}">${esc(CONTACT_EMAIL)}</a> and a person answers.</p>
      <p class="s dim"><a href="support.html" target="_blank" rel="noopener">Support</a> ·
        <a href="terms.html" target="_blank" rel="noopener">Terms</a> ·
        <a href="privacy.html" target="_blank" rel="noopener">Privacy Policy</a> ·
        <a href="community.html" target="_blank" rel="noopener">Community Guidelines</a></p></div>`);
    s.appendChild(help);

    const del = el(`<div class="card" style="margin-top:14px">
      <p class="h">Delete your account</p>
      <p class="s dim">Your name, your birthday and your answers are erased and cannot be
      recovered. Any nest you are in freezes, the same as leaving, because the other person
      built it too and it is theirs as much as yours. Your name is removed from it.</p>
      <label class="f" style="margin-top:12px"><span>Type delete to confirm</span>
        <input id="set-del-word" autocomplete="off" placeholder="delete"></label>
      <button class="btn" id="set-del">Delete my account</button></div>`);
    del.querySelector("#set-del").onclick = async () => {
      if(del.querySelector("#set-del-word").value.trim().toLowerCase() !== "delete")
        return toast("Type delete to confirm");
      const btn = del.querySelector("#set-del");
      btn.disabled = true; btn.textContent = "Deleting";
      try{
        await Api.call("POST", "/users/me/delete", {});
      }catch(err){
        // nothing was deleted, so say so and give the button back
        btn.disabled = false; btn.textContent = "Delete my account";
        return toast("That did not go through. Nothing was deleted. Try again?");
      }
      toast("Your account is gone");
      this.restart();
    };
    s.appendChild(del);
  },
  confirmLeave(s, me){
    const other = me.members.find(m => m.user_id !== Api.Session.userId);
    s.innerHTML = "";
    const card = el(`<div class="card">
      <p class="h">Freeze this nest?</p>
      <p class="s dim">${other && other.user ? esc(other.user.display_name) + " will be told." : ""}
      Neither of you will be able to change it again. It stays where you can both see it.</p>
      <button class="btn go" id="yes" style="margin-top:14px">Yes, freeze it</button>
      <button class="ob-quiet" id="no">Not now</button></div>`);
    card.querySelector("#no").onclick = () => this.openSettings();
    card.querySelector("#yes").onclick = async () => {
      const yes = card.querySelector("#yes");
      yes.disabled = true;
      try{ await Api.call("POST", "/nests/" + me.nest.id + "/leave", {}); }
      catch(err){
        yes.disabled = false;
        return toast("That did not go through. The nest is unchanged. Try again?");
      }
      this.restart();
    };
    s.appendChild(card);
  },
  /* A nest you have left is read only, and reachable from settings and from
     nowhere else, so a previous relationship never appears in the flow. */
  showArchived(nest){
    const g = Api.db.game[nest.id];
    const names = nest.members.map(m => m.name || "Someone");
    document.body.classList.add("onboarding");
    $("#onboard").hidden = false;
    Diorama.frameShift = 0.34;
    Diorama.setBase(nest.base_material, nest.terrain_type);
    Diorama.setLot(g ? g.house : { rooms:{ living:{ unlocked:true } }, placed:[] },
      { partnerA:names[0] || "", partnerB:names[1] || "" }, "frozen");
    Diorama.applyState("resting", seasonNow());
    Diorama.applyView();
    $("#ob-top").innerHTML = "";
    const sheet = $("#ob-sheet");
    sheet.innerHTML = "";
    sheet.hidden = false;
    const card = el(`<div class="ob-card">
      <p class="ob-h">${esc(nest.name || "A nest")}</p>
      <p class="s dim">${esc(names.map(n => n || "Someone").join(" and "))} · ${
        g ? g.house.placed.length : 0} things placed · frozen ${
        formatDate(nest.archived_at)}</p>
      <p class="s dim">This one is finished. You can look at it, and that is all.</p>
      <button class="btn go" id="arch-back" style="margin-top:12px">Close</button></div>`);
    card.querySelector("#arch-back").onclick = () => App.restart();
    sheet.appendChild(card);
  },
};

/* ---- money and scoring ---- */
const save = () => App.saveGame();
const uid = () => Math.random().toString(36).slice(2, 10);
/* Spec section 5: a solo user earns nothing and places nothing. The guard is
   here as well as structural, so a future screen cannot route around it. */
function frozen(){ return !!(state && state.frozen); }
function paired(){
  if(frozen()) return false;
  return !!(App.me && App.me.nest && App.me.nest.status === "active" &&
            App.me.members.filter(m => m.status === "active").length === 2);
}
function earn(n, why){
  if(!paired()) return;
  state.wallet.coins += n; state.wallet.lifetimeEarned += n;
  save(); toast("+" + n + " coins, " + why);
  if(typeof Sound !== "undefined") Sound.play("coins");
}
function spend(n){
  if(!paired()) return false;
  if(state.wallet.coins < n) return false;
  state.wallet.coins -= n; save(); return true;
}
function charmOf(placed){ return (placed || []).reduce((s, p) => s + ((ITEM_BY_ID[p.itemId] || {}).charm || 0), 0); }
function daysTogether(since){
  if(!since) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(since + "T00:00:00").getTime()) / 86400000));
}
function ownCard(g){
  const c = g.couple || { name:"Our nest", partnerA:"One", partnerB:"Two", togetherSince:today() };
  return { id:"mine", name:c.name, partners:c.partnerA + " and " + c.partnerB,
    since:c.togetherSince, tagline:g.showcase.tagline || "Still building.", likes:0, mine:true, placed:g.house.placed };
}
function currentDomeState(){
  if(!state.streak.lastCheckIn) return "new";
  return domeState(currentStreak(), daysSince(state.streak.lastCheckIn));
}

/* ---- the world ---- */
function refreshWorld(){
  if(!Diorama.ready || !state) return;
  const season = seasonNow();
  // setLot measures the lot, applyState draws the terrain into it, so the
  // order matters: the ground has to be built after the world is sized
  if(viewingLot){
    const rooms = {};
    ROOMS.forEach(r => { rooms[r.id] = { unlocked:viewingLot.placed.some(p => p.room === r.id) }; });
    rooms.living.unlocked = true;
    const names = viewingLot.partners.split(" and ");
    Diorama.setLot({ rooms, placed:viewingLot.placed }, { partnerA:names[0], partnerB:names[1] }, viewingLot.tagline);
    Diorama.applyState(viewingLot.stateId || viewingLot.state || "steady", season);
    Diorama.setPlan(null);                      // somebody else's house, not your sketch
    return;
  }
  const nest = App.me && App.me.nest;
  if(nest) Diorama.setBase(nest.base_material, nest.terrain_type);
  const st = currentDomeState();
  Diorama.setLot(state.house, state.couple, SEASON_STATES[st].label.toLowerCase() + " · " + currentStreak() + " days");
  Diorama.applyState(st, season);
  Diorama.setPlan(livePlan());
}

/* A planned spot stops being a plan the moment something real is standing on
   it, so the sketch quietly empties itself as the room gets built rather than
   needing to be tidied away. */
function livePlan(){
  if(!state || !state.plan || !state.plan.length) return [];
  const taken = state.house.placed.map(p => p.room + ":" + p.x + ":" + p.y);
  return state.plan.filter(p => taken.indexOf(p.room + ":" + p.x + ":" + p.y) < 0);
}

/* ---- ui helpers ---- */
const $ = s => document.querySelector(s);
function el(html){
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.children.length > 1 ? t.content : t.content.firstElementChild;
}
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }
let toastTimer = null;
/* 9/10/2026 is two different days depending on who is reading it, and the
   browser locale is not the same question as the one the account answered at
   signup. A named month is the same day in every locale. */
function formatDate(value){
  const d = value instanceof Date ? value : new Date(value);
  if(isNaN(d)) return "";
  return d.toLocaleDateString(undefined, { day:"numeric", month:"short", year:"numeric" });
}

function toast(msg){
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), 1900);
}
/* A toast is about the screen it was raised on. "Jo wants to join your nest"
   following someone through the naming ceremony and into the app is a message
   about a moment that has already happened. */
function clearToast(){
  const t = $("#toast");
  if(!t) return;
  clearTimeout(toastTimer);
  t.classList.remove("on");
}
function go(tab, view){
  clearToast();
  if(tab !== "show" && viewingLot){ viewingLot = null; refreshWorld(); }
  const was = route.tab;
  route = { tab, view:view || null };
  if(tab === "build" && was !== "build"){
    if(held){ held = null; Diorama.setHeld(null); }
    Build.take().then(render);
  }else if(was === "build" && tab !== "build"){
    if(held){ held = null; Diorama.setHeld(null); }
    Build.release();
  }
  const sheet = $("#sheet");
  if(sheet) sheet.scrollTop = 0;
  render();
}

/* ---- screens ---- */
function screenHome(root){
  const st = currentDomeState(), s = SEASON_STATES[st], season = seasonNow();
  rollDay();
  const done = state.streak.lastCheckIn === today();
  const streak = currentStreak();
  /* "New weather" read as a forecast, and "0 day streak" as a telling off on
     the first morning. Say what the dome is doing and what the streak needs. */
  root.appendChild(el(`<div class="card">
    <div class="spread"><div><p class="h">${st === "new" ? "A fresh dome" : s.label + (st === "resting" ? "" : " weather")}</p>
    <p class="s dim">${s.note} ${season.label} outside.</p></div>
    <span class="chip warm">${streak ? streak + (streak === 1 ? " day" : " days") + " in a row" : "Answer to start a streak"}</span></div></div>`));
  if(!done){
    const c = el(`<div class="card"><div class="spread"><div><p class="h">Today's question is waiting</p>
      <p class="s dim">Both of you answer and the light shifts.</p></div>
      <button class="btn sm">Answer</button></div></div>`);
    c.querySelector("button").onclick = () => go("play", { game:"ritual" });
    root.appendChild(c);
  }
  root.appendChild(el(`<div class="stats">
    <div class="stat"><b>${state.wallet.coins.toLocaleString()}</b><span>coins</span></div>
    <div class="stat"><b>${state.bond}</b><span>bond</span></div>\n    <div class="stat"><b>${charmOf(state.house.placed)}</b><span>charm</span></div>
    <div class="stat"><b>${daysTogether(state.couple.togetherSince).toLocaleString()}</b><span>days</span></div></div>`));
  Object.values(GAMES).forEach(g => {
    const b = el(`<button class="row"><img src="${Offscreen.icon(GAME_ICON[g.id], 96)}" alt="">
      <div><p class="h">${g.title}</p><p class="s dim">${esc(g.blurb)}</p></div></button>`);
    b.onclick = () => { activeGame = null; go("play", { game:g.id }); };
    root.appendChild(b);
  });
}

function screenPlay(root){
  if(route.view && route.view.game){
    const g = GAMES[route.view.game];
    const back = el(`<button class="btn back">All games</button>`);
    back.onclick = () => { activeGame = null; go("play"); };
    root.appendChild(back);
    g.render(root);
    return;
  }
  Object.values(GAMES).forEach(g => {
    const b = el(`<button class="row"><img src="${Offscreen.icon(GAME_ICON[g.id], 96)}" alt="">
      <div><p class="h">${g.title}</p><p class="s dim">${esc(g.blurb)}</p>
      <p class="s dim"><b>${esc(capNote(g.id))}</b></p></div></button>`);
    b.onclick = () => { activeGame = null; go("play", { game:g.id }); };
    root.appendChild(b);
  });
  root.appendChild(el(`<p class="s dim mid">${state.stats.gamesPlayed} rounds played · ${state.wallet.lifetimeEarned.toLocaleString()} coins earned</p>`));
  Ads.slot(root, "play");
}

function screenBuild(root){
  /* Whose turn it is, said plainly and before anything else on the screen, so
     nobody discovers it by tapping and having nothing happen. */
  if(Build.heldByPartner){
    const who = Build.name || "Your partner";
    const card = el(`<div class="card">
      <p class="h">${esc(who)} is arranging the room</p>
      <p class="s dim">You can watch. The dome updates as they move things. It comes back
        to you when they leave the build screen, or shortly after they put the phone down.</p>
      <button class="btn" id="build-retry" style="margin-top:12px">Ask for a turn</button></div>`);
    card.querySelector("#build-retry").onclick = async () => {
      const r = await Build.take();
      toast(r.mine ? "Your turn" : (Build.name || "Your partner") + " is still arranging");
      render();
    };
    root.appendChild(card);
    return;
  }
  const chips = el(`<div class="chips"></div>`);
  ROOMS.forEach(r => {
    const open = state.house.rooms[r.id].unlocked;
    const b = el(`<button class="chip ${open ? "" : "locked"}" aria-current="${shopFilter === r.id}">
      ${esc(r.name)}${open ? "" : " · " + r.price}</button>`);
    b.onclick = () => {
      if(open){ shopFilter = r.id; render(); return; }
      if(state.wallet.coins < r.price) return toast("Need " + (r.price - state.wallet.coins) + " more coins");
      spend(r.price);
      state.house.rooms[r.id].unlocked = true;
      shopFilter = r.id;
      save(); refreshWorld(); toast(r.name + " built"); render();
      Sound.play("unlock");
      Economy.call("/rooms/unlock", { room:r.id }).then(res => {
        if(!res || !res.error) return;
        liveGame();
        state.house.rooms[r.id].unlocked = false;
        if(shopFilter === r.id) shopFilter = "living";
        save(); refreshWorld(); render();
        toast(Economy.refusal(res.error));
      });
    };
    chips.appendChild(b);
  });
  const mem = el(`<button class="chip" aria-current="${shopFilter === "any"}">Mementos</button>`);
  mem.onclick = () => { shopFilter = "any"; render(); };
  chips.appendChild(mem);
  root.appendChild(chips);

  if(held){
    const item = ITEM_BY_ID[held.itemId];
    const bar = el(`<div class="held">
      <img src="${Offscreen.icon(held.itemId, 96)}" alt="">
      <b>${esc(item.name)}</b><span class="s">tap the ground</span>
      <button class="btn sm" id="rot">Turn</button><button class="btn sm" id="stow">Store</button></div>`);
    bar.querySelector("#rot").onclick = () => { held.rot = (held.rot + 1) % 4; Diorama.setHeld(held.itemId, held.rot); render(); };
    bar.querySelector("#stow").onclick = () => {
      state.house.inventory.push({ instanceId:held.instanceId, itemId:held.itemId });
      held = null; Diorama.setHeld(null); save(); render();
    };
    root.appendChild(bar);
  }

  if(state.house.inventory.length){
    root.appendChild(el(`<p class="lbl">In storage</p>`));
    const strip = el(`<div class="strip"></div>`);
    state.house.inventory.forEach(inv => {
      const item = ITEM_BY_ID[inv.itemId];
      const c = el(`<button class="tile"><img src="${Offscreen.icon(inv.itemId, 128)}" alt=""><span>${esc(item.name)}</span></button>`);
      c.onclick = () => {
        if(held) return toast("Put down what you are holding first");
        state.house.inventory = state.house.inventory.filter(q => q.instanceId !== inv.instanceId);
        held = { instanceId:inv.instanceId, itemId:inv.itemId, rot:0 };
        Diorama.setHeld(held.itemId, 0);
        save(); render();
      };
      strip.appendChild(c);
    });
    root.appendChild(strip);
  }

  /* Whatever the founder sketched out while they were waiting on their own is
     standing in the room as an outline. It is not a purchase and not a
     decision: it is one person saying here is what I was thinking. */
  const plan = livePlan();
  if(plan.length){
    const names = App.me && App.me.members.find(m => m.role === "founder");
    const who = names && names.user ? names.user.display_name : state.couple.partnerA;
    const card = el(`<div class="card">
      <p class="h">The plan from while you waited</p>
      <p class="s dim">${plan.length === 1 ? "One spot" : plan.length + " spots"} ${esc(who)}
      sketched out before the two of you were here. Nothing was bought. Build over them,
      or clear them and start from an empty floor.</p>
      <button class="btn" id="plan-clear" style="margin-top:12px">Clear the plan</button></div>`);
    card.querySelector("#plan-clear").onclick = () => {
      state.plan = [];
      save(); refreshWorld(); toast("Plan cleared"); render();
    };
    root.appendChild(card);
  }

  root.appendChild(el(`<p class="lbl">Workshop</p>`));
  const grid = el(`<div class="grid"></div>`);
  const planned = {};
  plan.forEach(p => { planned[p.itemId] = (planned[p.itemId] || 0) + 1; });
  CATALOGUE.filter(i => i.room === shopFilter).forEach(item => {
    const afford = state.wallet.coins >= item.price;
    const c = el(`<div class="tile buy"><img src="${Offscreen.icon(item.id, 128)}" alt="">
      <span>${esc(item.name)}</span><em>${planned[item.id] ? "planned · " : ""}${item.charm} charm</em>
      <button class="btn sm ${afford ? "go" : ""}" ${afford ? "" : "disabled"}>${item.price}</button></div>`);
    c.querySelector("button").onclick = () => {
      if(!spend(item.price)) return toast("Not enough coins");
      const instanceId = item.id + "_" + uid();
      state.house.inventory.push({ instanceId, itemId:item.id });
      save(); toast(item.name + " delivered"); render();
      Sound.play("buy");
      Economy.call("/shop/buy", { item:item.id, instance:instanceId }).then(res => {
        if(!res || !res.error) return;
        liveGame();
        state.house.inventory = state.house.inventory.filter(i => i.instanceId !== instanceId);
        if(held && held.instanceId === instanceId){ held = null; Diorama.setHeld(null); }
        save(); render();
        toast(Economy.refusal(res.error));
      });
    };
    grid.appendChild(c);
  });
  root.appendChild(grid);
}

/* Reporting names what is wrong, hides it from you immediately, and tells you
   what happens next. Nobody should have to keep looking at something while a
   queue is worked through. */
function reportSheet(h){
  const s = $("#sheet");
  s.innerHTML = "";
  const card = el(`<div class="card"><p class="h">Report ${esc(h.name)}</p>
    <p class="s dim">Tell us what is wrong. It disappears from your street straight away,
    and a person looks at it within a day.</p><div class="opts" id="rr"></div>
    <button class="ob-quiet" id="rcancel">Cancel</button></div>`);
  s.appendChild(card);
  card.querySelector("#rcancel").onclick = () => { viewingLot = null; refreshWorld(); go("show"); };
  ["Hateful or abusive", "Sexual content", "Harassment of someone I know",
   "Spam or advertising", "Something else"].forEach(reason => {
    const b = el(`<button class="opt">${esc(reason)}</button>`);
    b.onclick = async () => {
      card.querySelectorAll(".opt").forEach(o => { o.disabled = true; });
      try{ await Api.call("POST", "/nests/" + h.id + "/report", { reason }); }
      catch(err){
        card.querySelectorAll(".opt").forEach(o => { o.disabled = false; });
        return toast("That report did not send. Try again?");
      }
      toast("Reported. It is off your street.");
      viewingLot = null; refreshWorld(); go("show");
    };
    card.querySelector("#rr").appendChild(b);
  });
}

async function screenShowcase(root){
  if(route.view && route.view.house){
    const h = route.view.house;
    const liked = heartOf(h);
    const back = el(`<button class="btn back">The street</button>`);
    back.onclick = () => { viewingLot = null; refreshWorld(); go("show"); };
    root.appendChild(back);
    root.appendChild(el(`<div class="card"><p class="h">${esc(h.name)}</p>
      <p class="s dim">${esc(h.partners)} · ${daysTogether(h.since).toLocaleString()} days together</p>
      <p class="s">${esc(h.tagline)}</p>
      <div class="spread" style="margin-top:10px"><span class="chip warm">${h.charm} charm</span>
      <span class="chip">${heartsOf(h).toLocaleString()} hearts given</span></div>
      ${h.sample ? '<p class="s dim" style="margin-top:8px">A sample home, here until the street fills up.</p>' : ""}
      ${h.mine && h.hidden ? '<p class="s dim" style="margin-top:8px">Hidden from the street while reports about it are reviewed.</p>' : ""}</div>`));
    if(!h.mine){
      const b = el(`<button class="btn ${liked ? "" : "go"}">${liked ? "Loved" : "Leave a heart"}</button>`);
      b.onclick = async () => { b.disabled = true; await toggleHeart(h); render(); };
      root.appendChild(b);
      const row = el(`<div class="ob-row2" style="margin-top:9px">
        <button class="btn sm" id="rep">Report</button>
        <button class="btn sm" id="blk">Block</button></div>`);
      row.querySelector("#rep").onclick = () => reportSheet(h);
      row.querySelector("#blk").onclick = async () => {
        let r;
        try{ r = await Api.call("POST", "/nests/" + h.id + "/block", {}); }
        catch(err){ return toast("That did not go through. Try again?"); }
        toast(r.blocked ? "Hidden from your street" : "Unblocked");
        viewingLot = null; refreshWorld(); go("show");
      };
      root.appendChild(row);
    }else if(App.me && App.me.nest){
      const off = el(`<button class="btn" style="margin-top:9px;width:100%">Take it off the street</button>`);
      off.onclick = async () => {
        off.disabled = true;
        try{ await Api.call("POST", "/nests/" + App.me.nest.id + "/unpublish", {}); }
        catch(err){ off.disabled = false; return toast("That did not go through. Try again?"); }
        liveGame();
        state.showcase.published = false;
        save(); toast("Your nest is private again");
        viewingLot = null; refreshWorld(); go("show");
      };
      root.appendChild(off);
    }
    return;
  }

  if(!Api.backend) root.appendChild(el(`<p class="note">A local preview of the street. Real couples appear once NEST goes online.</p>`));
  const mod = await Api.call("GET", "/moderation");
  if(!state.showcase.published){
    const c = el(`<div class="card"><p class="h">Your nest is private</p>
      <p class="s dim">Publish it and it joins the street, ranked by charm.</p>
      <label class="f"><span>One line about you two</span><input id="tag" maxlength="52" placeholder="Still buying chairs."></label>
      <button class="btn go" id="pub">Publish</button></div>`);
    c.querySelector("#pub").onclick = async () => {
      const btn = c.querySelector("#pub");
      btn.disabled = true; btn.textContent = "Publishing";
      try{
        const r = await Api.call("POST", "/nests/" + App.me.nest.id + "/publish",
          { tagline:c.querySelector("#tag").value.trim() });
        state.showcase.tagline = r.tagline;
        state.showcase.published = true;
        await save(); toast("You are on the street"); render();
      }catch(err){
        btn.disabled = false; btn.textContent = "Publish";
        c.appendChild(el(`<div class="ob-err">${esc(err.reason || "That did not publish. Try again?")}</div>`));
      }
    };
    root.appendChild(c);
  }

  const all = await loadStreet();
  const houses = all.filter(h => mod.blocked.indexOf(h.id) < 0);
  const hidden = all.length - houses.length;
  houses.forEach((h, i) => {
    const card = el(`<button class="hcard">
      <img src="${Offscreen.lotThumb(h.placed, 260, seasonNow().ground)}" alt="">
      <div class="meta"><div class="spread"><p class="h">${esc(h.name)}</p><span class="chip warm">${h.charm}</span></div>
      <p class="s dim">${esc(h.partners)} · ${daysTogether(h.since).toLocaleString()} days${h.mine ? " · yours" : h.sample ? " · sample home" : ""}</p>
      <p class="s">${esc(h.tagline)} <span class="dim">· ${heartsOf(h).toLocaleString()} hearts</span></p></div>
      <span class="rank">${i + 1}</span></button>`);
    card.onclick = () => { viewingLot = h; refreshWorld(); go("show", { house:h }); };
    root.appendChild(card);
    if(i === 2) Ads.slot(root, "street");
  });
  root.appendChild(el(`<p class="s dim mid" style="margin-top:16px">${
    hidden ? hidden + (hidden === 1 ? " home is" : " homes are") + " hidden because you blocked or reported "
      + (hidden === 1 ? "it" : "them") + ". " : ""}Something wrong on the street? Report it from the
    home itself, or write to ${esc(mod.contact)}.</p>`));
}

/* ---- render ---- */
/* The street waits on the network, and a render can be asked for again while
   it waits: a partner's change, a like, a tab tap. Each of those used to clear
   the sheet and then append the whole street a second time underneath the
   first, so only the newest render is allowed to put anything on screen. */
let renderSeq = 0;
async function render(){
  const seq = ++renderSeq;
  const sheet = $("#sheet");
  sheet.innerHTML = "";
  const bar = $("#bar"), tabs = $("#tabs"), tools = $("#tools");
  if(!state) return;
  bar.hidden = tabs.hidden = tools.hidden = false;
  bar.innerHTML = "";
  bar.appendChild(el(`<div class="barin"><div><p class="brand">NEST</p>
    <p class="s dim">${esc((App.me && App.me.nest.name) || state.couple.name)}</p></div>
    <span class="purse">${state.wallet.coins.toLocaleString()}</span>
    <button class="cog" id="cog" title="Settings" aria-label="Settings">···</button></div>`));
  bar.querySelector("#cog").onclick = () => App.openSettings();
  tabs.querySelectorAll("button").forEach(b => b.setAttribute("aria-current", String(b.dataset.tab === route.tab)));
  if(route.tab === "home") screenHome(sheet);
  else if(route.tab === "play") screenPlay(sheet);
  else if(route.tab === "build") screenBuild(sheet);
  else{
    const host = document.createDocumentFragment();
    await screenShowcase(host);
    if(seq !== renderSeq) return;                 // a newer render owns the sheet now
    sheet.appendChild(host);
  }
  if(App.measureSheet) App.measureSheet();
}

/* ---- boot ----
   onboarding.js loads after this file, so boot waits for the document
   rather than running the moment app.js is parsed */
/* The stage is whatever the sheet leaves, so the sheet has to say how much
   that is. Measured rather than assumed, and the camera reframes to the box
   it actually gets: on a short sheet the lot stops being cropped with half
   the screen empty under it, and on a long one the last row stops hiding
   behind the tab bar. */
function watchSheet(){
  const sheet = $("#sheet"), root = document.documentElement;
  let queued = false;
  const apply = () => {
    queued = false;
    if(document.body.classList.contains("onboarding")) return;   // the flow frames itself
    const h = Math.round(sheet.getBoundingClientRect().height);
    if(!h) return;
    root.style.setProperty("--sheet", h + "px");
    Diorama.resize();
  };
  const queue = () => { if(!queued){ queued = true; requestAnimationFrame(apply); } };
  if(typeof ResizeObserver !== "undefined") new ResizeObserver(queue).observe(sheet);
  addEventListener("resize", queue);
  App.measureSheet = queue;
  queue();
}

addEventListener("DOMContentLoaded", async function boot(){
  /* Registered before anything else listens, and before onboarding hands
     over to App.enter, so every screen that writes the game (the ceremony,
     the first ritual, the tutorial) is already holding the live document by
     the time its own handler runs. */
  Api.Realtime.on(msg => { if(msg && msg.type === "game.changed") liveGame(); });
  Diorama.init($("#stage"));
  Diorama.onPlace = spot => {
    if(!held || !paired()) return;
    if(!Build.mine) return toast(Build.name ? Build.name + " is arranging the room" : "Tap Build to take a turn");
    state.house.placed.push({ instanceId:held.instanceId, itemId:held.itemId, room:spot.room, x:spot.x, y:spot.y, rot:held.rot });
    Diorama.addProp(state.house.placed[state.house.placed.length - 1]);
    held = null;
    Diorama.setHeld(null);
    save(); render();
    Sound.play("place");
    notifyPartner("build");
  };
  Diorama.onPick = p => {
    if(held || viewingLot || !paired()) return;
    if(!Build.mine) return toast(Build.name ? Build.name + " is arranging the room" : "Tap Build to take a turn");
    state.house.placed = state.house.placed.filter(q => q.instanceId !== p.instanceId);
    Diorama.removeProp(p.instanceId);
    held = { instanceId:p.instanceId, itemId:p.itemId, rot:p.rot };
    Diorama.setHeld(held.itemId, held.rot);
    Sound.play("pick");
    save();
    if(route.tab !== "build") go("build"); else render();
  };
  $("#rot-l").onclick = () => Diorama.rotate(-1);
  $("#rot-r").onclick = () => Diorama.rotate(1);
  $("#zoom").onclick = () => { $("#zoom").textContent = Diorama.cycleZoom(); };
  $("#tabs").addEventListener("click", e => {
    const b = e.target.closest("button[data-tab]");
    if(!b) return;
    if(b.dataset.tab === "play") activeGame = null;
    go(b.dataset.tab);
  });
  /* Off by default. #dev on the URL brings them back for whoever needs them,
     which is us and never a couple looking at their living room. */
  if(/[#&]dev\b/.test(location.hash)) $("#devbtn").hidden = $("#funbtn").hidden = false;
  $("#devbtn").onclick = () => openBible();
  $("#funbtn").onclick = () => openFunnel();
  /* The service worker only receives notifications; it caches nothing. */
  if("serviceWorker" in navigator && (location.protocol === "https:" || /^(localhost|127\.0\.0\.1)$/.test(location.hostname)))
    navigator.serviceWorker.register("sw.js").catch(() => {});
  watchSheet();
  setTimeout(() => { const sp = $("#splash"); if(sp) sp.classList.add("gone"); }, 380);
  Onboard.begin();
});

/* ---- the funnel, spec section 9 ---- */
function openFunnel(){
  const wrap = $("#dev");
  wrap.hidden = false;
  wrap.innerHTML = "";
  const rate = Track.pairedActivationRate(), lat = Track.inviteLatency();
  const head = el(`<div class="devhead"><div><p class="h">Funnel</p>
    <p class="s dim">paired activation ${(rate * 100).toFixed(0)}% · invite latency ${
      lat === null ? "no pair yet" : Math.round(lat / 1000) + "s"}</p></div>
    <button class="btn sm" id="devclose">Close</button></div>`);
  wrap.appendChild(head);
  wrap.querySelector("#devclose").onclick = () => { wrap.hidden = true; };
  const list = el(`<div class="devlist"></div>`);
  Track.funnel().forEach(step => {
    list.appendChild(el(`<div class="devrow ${step.n ? "ok" : "bad"}">
      <div><p class="s"><b>${esc(step.label)}</b> · ${step.n}</p>
      <p class="s dim">${esc(step.name)}</p></div></div>`));
  });
  wrap.appendChild(list);
  const raw = el(`<div class="devlist" style="margin-top:12px"></div>`);
  Track.log.slice(-24).reverse().forEach(e => {
    raw.appendChild(el(`<div class="devrow"><div><p class="s">${esc(e.name)}</p>
      <p class="s dim">${esc(JSON.stringify(e.props))}</p></div></div>`));
  });
  wrap.appendChild(raw);
}

/* ---- the section 16 panel ---- */
function openBible(){
  const report = runBibleChecks();
  const wrap = $("#dev");
  wrap.hidden = false;
  wrap.innerHTML = "";
  const head = el(`<div class="devhead"><div><p class="h">Asset review, section 16</p>
    <p class="s dim">${report.passed} of ${report.total} pass · ${report.warned} thin for class · catalogue ${report.lotTris.toLocaleString()} tris, lot budget ${report.lotBudget.toLocaleString()} · ${Diorama.fps} fps</p></div>
    <button class="btn sm" id="devclose">Close</button></div>`);
  wrap.appendChild(head);
  wrap.querySelector("#devclose").onclick = () => { wrap.hidden = true; };
  const list = el(`<div class="devlist"></div>`);
  report.rows.forEach(r => {
    const fails = Object.keys(r.checks).filter(k => !r.checks[k]).map(k => CHECK_LABELS[k]);
    list.appendChild(el(`<div class="devrow ${r.pass ? "ok" : "bad"}">
      <img src="${Offscreen.icon(r.id, 64)}" alt="">
      <div><p class="s"><b>${esc(r.name)}</b> · ${r.cls} · ${r.tris.toLocaleString()} tris (${r.budget[0]} to ${r.budget[1]})</p>
      <p class="s dim">${r.pass ? "all checks pass" : "fails: " + fails.join(", ")}</p></div></div>`));
  });
  wrap.appendChild(list);
}
