/* NEST :: state, storage and screens.
   The storage seam is unchanged from the first build: four methods, and
   swapping in a real backend touches nothing else. */
"use strict";

const SCHEMA_VERSION = 2;
const STORE_KEY = "nest.v2";
const OLD_KEY = "couplehouses.v1";

const LocalStore = {
  async load(){
    try{
      const raw = localStorage.getItem(STORE_KEY);
      if(raw) return migrate(JSON.parse(raw));
      const old = localStorage.getItem(OLD_KEY);
      if(old) return migrate(JSON.parse(old));
      return null;
    }catch(err){ console.warn("load failed, starting fresh", err); return null; }
  },
  async save(s){
    try{ localStorage.setItem(STORE_KEY, JSON.stringify(s)); return true; }
    catch(err){ console.warn("save failed, this session is memory only", err); return false; }
  },
  async listShowcase(s){
    const mine = s && s.showcase.published ? [ownCard(s)] : [];
    const seeds = SEED_HOUSES.map(h => ({ ...h, mine:false,
      placed:h.placed.map(p => ({ itemId:p[0], room:p[1], x:p[2], y:p[3], rot:p[4] || 0, instanceId:"s" + Math.random() })) }));
    return [...mine, ...seeds].map(h => ({ ...h, charm:charmOf(h.placed) })).sort((a, b) => b.charm - a.charm);
  },
  async likeHouse(s, id){
    const g = s.showcase.likesGiven, at = g.indexOf(id);
    if(at >= 0) g.splice(at, 1); else g.push(id);
    await this.save(s);
    return at < 0;
  },
};
const Store = LocalStore;

/* v1 kept its own room sizes and footprints. Hearts, streak and the couple
   survive the move; the old layout cannot, so the home starts empty. */
function migrate(s){
  if(!s || typeof s !== "object") return null;
  if(s.schemaVersion === SCHEMA_VERSION) return s;
  const fresh = freshState(s.couple || { name:"Our nest", partnerA:"One", partnerB:"Two", togetherSince:today() });
  fresh.wallet = s.wallet || fresh.wallet;
  fresh.streak = Object.assign(fresh.streak, s.streak || {});
  fresh.stats = Object.assign(fresh.stats, s.stats || {});
  return fresh;
}

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

/* ---- state ---- */
let state = null;
let route = { tab:"home", view:null };
let held = null;
let shopFilter = "living";
let viewingLot = null;

function freshState(couple){
  const rooms = {};
  ROOMS.forEach(r => { rooms[r.id] = { unlocked:r.price === 0 }; });
  return {
    schemaVersion:SCHEMA_VERSION, couple,
    wallet:{ hearts:BALANCE.startingHearts, lifetimeEarned:0 },
    streak:{ count:0, lastCheckIn:null, day:null, a:false, b:false },
    house:{ rooms, inventory:[], placed:[] },
    showcase:{ published:false, likesGiven:[], tagline:"" },
    stats:{ gamesPlayed:0, duelsPlayed:0, bestDuel:0 },
  };
}
const save = () => Store.save(state);
const today = () => new Date().toISOString().slice(0, 10);
const uid = () => Math.random().toString(36).slice(2, 10);
function earn(n, why){ state.wallet.hearts += n; state.wallet.lifetimeEarned += n; save(); toast("+" + n + " hearts, " + why); }
function spend(n){ if(state.wallet.hearts < n) return false; state.wallet.hearts -= n; save(); return true; }
function charmOf(placed){ return (placed || []).reduce((s, p) => s + ((ITEM_BY_ID[p.itemId] || {}).charm || 0), 0); }
function daysTogether(since){
  if(!since) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(since + "T00:00:00").getTime()) / 86400000));
}
function ownCard(s){
  return { id:"mine", name:s.couple.name, partners:s.couple.partnerA + " and " + s.couple.partnerB,
    since:s.couple.togetherSince, tagline:s.showcase.tagline || "Still building.", likes:0, mine:true, placed:s.house.placed };
}
function currentDomeState(){
  if(!state.streak.lastCheckIn) return "new";
  return domeState(currentStreak(), daysSince(state.streak.lastCheckIn));
}

/* ---- the world ---- */
function refreshWorld(){
  if(!Diorama.ready) return;
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
  route = { tab, view:view || null };
  const sheet = $("#sheet");
  if(sheet) sheet.scrollTop = 0;
  render();
}

/* ---- screens ---- */
function screenSetup(root){
  root.appendChild(el(`<div class="card">
    <p class="h">Make your nest</p>
    <p class="s dim">Two names and a date. Everything else you build.</p>
    <label class="f"><span>What do you call it</span><input id="f-name" placeholder="The long room" maxlength="28"></label>
    <label class="f"><span>One of you</span><input id="f-a" placeholder="Robin" maxlength="14"></label>
    <label class="f"><span>The other</span><input id="f-b" placeholder="Sasha" maxlength="14"></label>
    <label class="f"><span>Together since</span><input id="f-since" type="date"></label>
    <button class="btn go" id="f-go">Move in</button></div>`));
  root.querySelector("#f-go").onclick = async () => {
    const a = root.querySelector("#f-a").value.trim(), b = root.querySelector("#f-b").value.trim();
    if(!a || !b) return toast("Both names, please");
    const name = root.querySelector("#f-name").value.trim();
    const since = root.querySelector("#f-since").value;
    state = freshState({ name:name || a + " and " + b, partnerA:a, partnerB:b, togetherSince:since || today() });
    await save();
    refreshWorld();
    go("home");
  };
}

function screenHome(root){
  const st = currentDomeState(), s = SEASON_STATES[st], season = seasonNow();
  rollCheckinDay();
  const done = state.streak.lastCheckIn === today();
  root.appendChild(el(`<div class="card">
    <div class="spread"><div><p class="h">${s.label}${st === "resting" ? "" : " weather"}</p>
    <p class="s dim">${s.note} ${season.label} outside.</p></div>
    <span class="chip warm">${currentStreak()} day streak</span></div></div>`));
  if(!done){
    const c = el(`<div class="card"><div class="spread"><div><p class="h">Today is unclaimed</p>
      <p class="s dim">Both of you tap in and the light shifts.</p></div>
      <button class="btn sm">Check in</button></div></div>`);
    c.querySelector("button").onclick = () => go("play", { game:"checkin" });
    root.appendChild(c);
  }
  root.appendChild(el(`<div class="stats">
    <div class="stat"><b>${state.wallet.hearts.toLocaleString()}</b><span>hearts</span></div>
    <div class="stat"><b>${charmOf(state.house.placed)}</b><span>charm</span></div>
    <div class="stat"><b>${daysTogether(state.couple.togetherSince).toLocaleString()}</b><span>days</span></div></div>`));
  Object.values(GAMES).forEach(g => {
    const b = el(`<button class="row"><img src="${Offscreen.icon(g.id === "checkin" ? "clock" : g.id === "duel" ? "heartst" : "cat", 96)}" alt="">
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
    const b = el(`<button class="row"><img src="${Offscreen.icon(g.id === "checkin" ? "clock" : g.id === "duel" ? "heartst" : "cat", 96)}" alt="">
      <div><p class="h">${g.title}</p><p class="s dim">${esc(g.blurb)}</p></div></button>`);
    b.onclick = () => { activeGame = null; go("play", { game:g.id }); };
    root.appendChild(b);
  });
  root.appendChild(el(`<p class="s dim mid">${state.stats.gamesPlayed} rounds played · ${state.wallet.lifetimeEarned.toLocaleString()} hearts earned</p>`));
}

function screenBuild(root){
  const chips = el(`<div class="chips"></div>`);
  ROOMS.forEach(r => {
    const open = state.house.rooms[r.id].unlocked;
    const b = el(`<button class="chip ${open ? "" : "locked"}" aria-current="${shopFilter === r.id}">
      ${esc(r.name)}${open ? "" : " · " + r.price}</button>`);
    b.onclick = () => {
      if(open){ shopFilter = r.id; render(); return; }
      if(state.wallet.hearts < r.price) return toast("Need " + (r.price - state.wallet.hearts) + " more hearts");
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
    const afford = state.wallet.hearts >= item.price;
    const c = el(`<div class="tile buy"><img src="${Offscreen.icon(item.id, 128)}" alt="">
      <span>${esc(item.name)}</span><em>${item.charm} charm</em>
      <button class="btn sm ${afford ? "go" : ""}" ${afford ? "" : "disabled"}>${item.price}</button></div>`);
    c.querySelector("button").onclick = () => {
      if(!spend(item.price)) return toast("Not enough hearts");
      state.house.inventory.push({ instanceId:uid(), itemId:item.id });
      save(); toast(item.name + " delivered"); render();
    };
    grid.appendChild(c);
  });
  root.appendChild(grid);
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
    }
    return;
  }

  root.appendChild(el(`<p class="note">A local preview of the street. Real couples appear once NEST goes online.</p>`));
  if(!state.showcase.published){
    const c = el(`<div class="card"><p class="h">Your nest is private</p>
      <p class="s dim">Publish it and it joins the street, ranked by charm.</p>
      <label class="f"><span>One line about you two</span><input id="tag" maxlength="52" placeholder="Still buying chairs."></label>
      <button class="btn go" id="pub">Publish</button></div>`);
    c.querySelector("#pub").onclick = async () => {
      state.showcase.tagline = c.querySelector("#tag").value.trim();
      state.showcase.published = true;
      await save(); toast("You are on the street"); render();
    };
    root.appendChild(c);
  }

  const houses = await Store.listShowcase(state);
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
}

/* ---- render ---- */
async function render(){
  const sheet = $("#sheet");
  sheet.innerHTML = "";
  const bar = $("#bar"), tabs = $("#tabs"), tools = $("#tools");
  if(!state){
    bar.hidden = tabs.hidden = tools.hidden = true;
    screenSetup(sheet);
    return;
  }
  bar.hidden = tabs.hidden = tools.hidden = false;
  bar.innerHTML = "";
  bar.appendChild(el(`<div class="barin"><div><p class="brand">NEST</p>
    <p class="s dim">${esc(state.couple.name)}</p></div>
    <span class="purse">${state.wallet.hearts.toLocaleString()}</span></div>`));
  tabs.querySelectorAll("button").forEach(b => b.setAttribute("aria-current", String(b.dataset.tab === route.tab)));
  if(route.tab === "home") screenHome(sheet);
  else if(route.tab === "play") screenPlay(sheet);
  else if(route.tab === "build") screenBuild(sheet);
  else await screenShowcase(sheet);
}

/* ---- boot ---- */
(async function boot(){
  state = await Store.load();
  Diorama.init($("#stage"));
  Diorama.onPlace = spot => {
    if(!held) return;
    state.house.placed.push({ instanceId:held.instanceId, itemId:held.itemId, room:spot.room, x:spot.x, y:spot.y, rot:held.rot });
    Diorama.addProp(state.house.placed[state.house.placed.length - 1]);
    held = null;
    Diorama.setHeld(null);
    save(); render();
  };
  Diorama.onPick = p => {
    if(held || viewingLot) return;
    state.house.placed = state.house.placed.filter(q => q.instanceId !== p.instanceId);
    Diorama.removeProp(p.instanceId);
    held = { instanceId:p.instanceId, itemId:p.itemId, rot:p.rot };
    Diorama.setHeld(held.itemId, held.rot);
    save();
    if(route.tab !== "build") go("build"); else render();
  };
  $("#rot-l").onclick = () => Diorama.rotate(-1);
  $("#rot-r").onclick = () => Diorama.rotate(1);
  $("#zoom").onclick = () => { Diorama.setZoom((Diorama.zoomStop + 1) % 3); $("#zoom").textContent = ["wide","home","close"][Diorama.zoomStop]; };
  $("#tabs").addEventListener("click", e => {
    const b = e.target.closest("button[data-tab]");
    if(!b) return;
    if(b.dataset.tab === "play") activeGame = null;
    go(b.dataset.tab);
  });
  $("#devbtn").onclick = () => openBible();
  if(state) refreshWorld();
  render();
})();

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
