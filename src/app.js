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
    const seeds = SEED_HOUSES.map(h => ({ ...h, mine:false,
      placed:h.placed.map(p => ({ itemId:p[0], room:p[1], x:p[2], y:p[3], rot:p[4] || 0, instanceId:"s" + Math.random() })) }));
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

const GAME_ICON = { ritual:"clock", duel:"heartst", memory:"cat" };

/* ---- state ---- */
let state = null;                 // the nest's game record
let route = { tab:"home", view:null };
let held = null;
let shopFilter = "living";
let viewingLot = null;

function newGame(nest){
  const rooms = {};
  ROOMS.forEach(r => { rooms[r.id] = { unlocked:r.price === 0 }; });
  return {
    version:GAME_VERSION, nest_id:nest.id,
    wallet:{ coins:BALANCE.startingCoins, lifetimeEarned:0 },
    bond:0,
    streak:{ count:0, lastCheckIn:null, day:null, a:false, b:false, aAns:null, bAns:null },
    daily:{ day:null, duel:0, memory:0 },
    house:{ rooms, inventory:[], placed:[] },
    showcase:{ published:false, likesGiven:[], tagline:"" },
    stats:{ gamesPlayed:0, duelsPlayed:0, bestDuel:0 },
    ceremony_pending:false,
  };
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
  if(!base) return theirs;                      // nothing to rebase, take the truth
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

  const baseI = (base.house.inventory || []).slice(), mineI = mine.house.inventory || [];
  const took = baseI.filter(x => mineI.indexOf(x) < 0);
  out.house.inventory = (theirs.house.inventory || []).slice();
  took.forEach(x => { const at = out.house.inventory.indexOf(x); if(at >= 0) out.house.inventory.splice(at, 1); });
  mineI.filter(x => baseI.indexOf(x) < 0).forEach(x => out.house.inventory.push(x));

  // the streak belongs to the day, so whichever record is further along wins
  if((mine.streak.count || 0) > (theirs.streak.count || 0) ||
     (mine.streak.day && mine.streak.day > (theirs.streak.day || ""))) out.streak = mine.streak;
  if(mine.daily.day && mine.daily.day >= (theirs.daily.day || "")){
    out.daily = { day:mine.daily.day,
      duel:Math.max(mine.daily.duel || 0, theirs.daily.day === mine.daily.day ? theirs.daily.duel || 0 : 0),
      memory:Math.max(mine.daily.memory || 0, theirs.daily.day === mine.daily.day ? theirs.daily.memory || 0 : 0) };
  }
  if(mine.showcase.published !== base.showcase.published ||
     mine.showcase.tagline !== base.showcase.tagline) out.showcase = mine.showcase;
  if(mine.ritualLog && (!theirs.ritualLog || mine.ritualLog.length > theirs.ritualLog.length))
    out.ritualLog = mine.ritualLog;
  out.ceremony_pending = mine.ceremony_pending && theirs.ceremony_pending;
  return out;
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

const App = {
  me:null, get game(){ return state; },

  ensureGame(nestId){
    if(!Api.db.game[nestId]) Api.db.game[nestId] = newGame({ id:nestId });
    state = Api.db.game[nestId];
    state.nest_id = nestId;
    return state;
  },
  saveGame(){
    Store.save(state);
    Api.Realtime.emit("game.changed", { nest_id:state.nest_id });
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
    Api.Realtime.on(msg => {
      if(!state || msg.payload.nest_id !== state.nest_id) return;
      if(msg.type === "game.changed"){
        const fresh = Api.db.game[state.nest_id];
        if(fresh){
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
      togetherSince: new Date(me.nest.created_at).toISOString().slice(0, 10),
    };
  },
  /* one notification path, so the nudge rules cannot be bypassed by a caller */
  notify(body){
    try{
      if(typeof Notification !== "undefined" && Notification.permission === "granted"){
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
    if(me && me.nest){
      s.appendChild(el(`<div class="card">
        <p class="h">${esc(me.nest.name || "Your nest")}</p>
        <p class="s dim">${other && other.user ? "With " + esc(other.user.display_name) : "Just you"} ·
          started ${new Date(me.nest.created_at).toLocaleDateString()}</p></div>`));
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
          <p class="s dim">${esc(names)} · frozen ${new Date(n.archived_at).toLocaleDateString()}</p></div></button>`);
        card.onclick = () => this.showArchived(n);
        s.appendChild(card);
      });
    }

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
      await Api.call("POST", "/users/me/delete", {});
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
      card.querySelector("#yes").disabled = true;
      await Api.call("POST", "/nests/" + me.nest.id + "/leave", {});
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
        new Date(nest.archived_at).toLocaleDateString()}</p>
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
    Diorama.applyState(viewingLot.stateId || "steady", season);
    return;
  }
  const nest = App.me && App.me.nest;
  if(nest) Diorama.setBase(nest.base_material, nest.terrain_type);
  const st = currentDomeState();
  Diorama.setLot(state.house, state.couple, SEASON_STATES[st].label.toLowerCase() + " · " + currentStreak() + " days");
  Diorama.applyState(st, season);
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
function toast(msg){
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), 1900);
}
function go(tab, view){
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
  root.appendChild(el(`<div class="card">
    <div class="spread"><div><p class="h">${s.label}${st === "resting" ? "" : " weather"}</p>
    <p class="s dim">${s.note} ${season.label} outside.</p></div>
    <span class="chip warm">${currentStreak()} day streak</span></div></div>`));
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

  root.appendChild(el(`<p class="lbl">Workshop</p>`));
  const grid = el(`<div class="grid"></div>`);
  CATALOGUE.filter(i => i.room === shopFilter).forEach(item => {
    const afford = state.wallet.coins >= item.price;
    const c = el(`<div class="tile buy"><img src="${Offscreen.icon(item.id, 128)}" alt="">
      <span>${esc(item.name)}</span><em>${item.charm} charm</em>
      <button class="btn sm ${afford ? "go" : ""}" ${afford ? "" : "disabled"}>${item.price}</button></div>`);
    c.querySelector("button").onclick = () => {
      if(!spend(item.price)) return toast("Not enough coins");
      state.house.inventory.push({ instanceId:uid(), itemId:item.id });
      save(); toast(item.name + " delivered"); render();
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
      const r = await Api.call("POST", "/nests/" + h.id + "/report", { reason });
      toast("Reported. It is off your street.");
      viewingLot = null; refreshWorld(); go("show");
    };
    card.querySelector("#rr").appendChild(b);
  });
}

async function screenShowcase(root){
  if(route.view && route.view.house){
    const h = route.view.house;
    const liked = state.showcase.likesGiven.includes(h.id);
    const back = el(`<button class="btn back">The street</button>`);
    back.onclick = () => { viewingLot = null; refreshWorld(); go("show"); };
    root.appendChild(back);
    root.appendChild(el(`<div class="card"><p class="h">${esc(h.name)}</p>
      <p class="s dim">${esc(h.partners)} · ${daysTogether(h.since).toLocaleString()} days together</p>
      <p class="s">${esc(h.tagline)}</p>
      <div class="spread" style="margin-top:10px"><span class="chip warm">${h.charm} charm</span>
      <span class="chip">${(h.likes + (liked ? 1 : 0)).toLocaleString()} hearts given</span></div></div>`));
    if(!h.mine){
      const b = el(`<button class="btn ${liked ? "" : "go"}">${liked ? "Loved" : "Leave a heart"}</button>`);
      b.onclick = async () => { await Store.likeHouse(state, h.id); render(); };
      root.appendChild(b);
      const row = el(`<div class="ob-row2" style="margin-top:9px">
        <button class="btn sm" id="rep">Report</button>
        <button class="btn sm" id="blk">Block</button></div>`);
      row.querySelector("#rep").onclick = () => reportSheet(h);
      row.querySelector("#blk").onclick = async () => {
        const r = await Api.call("POST", "/nests/" + h.id + "/block", {});
        toast(r.blocked ? "Hidden from your street" : "Unblocked");
        viewingLot = null; refreshWorld(); go("show");
      };
      root.appendChild(row);
    }
    return;
  }

  root.appendChild(el(`<p class="note">A local preview of the street. Real couples appear once NEST goes online.</p>`));
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

  const all = await Store.listShowcase(state);
  const houses = all.filter(h => mod.blocked.indexOf(h.id) < 0);
  const hidden = all.length - houses.length;
  houses.forEach((h, i) => {
    const liked = state.showcase.likesGiven.includes(h.id);
    const card = el(`<button class="hcard">
      <img src="${Offscreen.lotThumb(h.placed, 260, seasonNow().ground)}" alt="">
      <div class="meta"><div class="spread"><p class="h">${esc(h.name)}</p><span class="chip warm">${h.charm}</span></div>
      <p class="s dim">${esc(h.partners)} · ${daysTogether(h.since).toLocaleString()} days${h.mine ? " · yours" : ""}</p>
      <p class="s">${esc(h.tagline)} <span class="dim">· ${(h.likes + (liked ? 1 : 0)).toLocaleString()} hearts</span></p></div>
      <span class="rank">${i + 1}</span></button>`);
    card.onclick = () => { viewingLot = h; refreshWorld(); go("show", { house:h }); };
    root.appendChild(card);
  });
  root.appendChild(el(`<p class="s dim mid" style="margin-top:16px">${
    hidden ? hidden + (hidden === 1 ? " home is" : " homes are") + " hidden because you blocked or reported "
      + (hidden === 1 ? "it" : "them") + ". " : ""}Something wrong on the street? Report it from the
    home itself, or write to ${esc(mod.contact)}.</p>`));
}

/* ---- render ---- */
async function render(){
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
  else await screenShowcase(sheet);
}

/* ---- boot ----
   onboarding.js loads after this file, so boot waits for the document
   rather than running the moment app.js is parsed */
addEventListener("DOMContentLoaded", async function boot(){
  Diorama.init($("#stage"));
  Diorama.onPlace = spot => {
    if(!held || !paired()) return;
    if(!Build.mine) return toast(Build.name ? Build.name + " is arranging the room" : "Tap Build to take a turn");
    state.house.placed.push({ instanceId:held.instanceId, itemId:held.itemId, room:spot.room, x:spot.x, y:spot.y, rot:held.rot });
    Diorama.addProp(state.house.placed[state.house.placed.length - 1]);
    held = null;
    Diorama.setHeld(null);
    save(); render();
  };
  Diorama.onPick = p => {
    if(held || viewingLot || !paired()) return;
    if(!Build.mine) return toast(Build.name ? Build.name + " is arranging the room" : "Tap Build to take a turn");
    state.house.placed = state.house.placed.filter(q => q.instanceId !== p.instanceId);
    Diorama.removeProp(p.instanceId);
    held = { instanceId:p.instanceId, itemId:p.itemId, rot:p.rot };
    Diorama.setHeld(held.itemId, held.rot);
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
  $("#devbtn").onclick = () => openBible();
  $("#funbtn").onclick = () => openFunnel();
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
