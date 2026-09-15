#!/usr/bin/env node
/* The three way merge, with no browser and no server. mergeGame is the one
   function that decides what survives when both phones save at once, and it
   was duplicating every item in storage on every refused save because it
   compared rows by object identity. This loads src/app.js and src/games.js
   into a bare context and asks the questions that matter directly. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const noop = () => {};
const ctx = vm.createContext({
  console, JSON, Math, Date, Object, Array, String, Number, Set, Map, Promise, setTimeout, clearTimeout,
  addEventListener:noop, document:{ querySelector:() => null, addEventListener:noop },
  localStorage:{ getItem:() => null, setItem:noop, removeItem:noop },
  location:{ search:"", hash:"", protocol:"http:", origin:"http://x", pathname:"/" },
});
["src/games.js", "src/app.js"].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename:f }));
vm.runInContext("globalThis.__ = { mergeGame, mergeStreak, today, localDay };", ctx);
const { mergeGame, mergeStreak, today, localDay } = ctx.__;

const pass = [], fail = [];
const ok = (n, c, note) => { const l = n + (note ? " :: " + note : "");
  (c ? pass : fail).push(l); console.log((c ? "  ok   " : "  FAIL ") + l); };
const clone = o => JSON.parse(JSON.stringify(o));

function doc(){
  return {
    nest_id:"n1", wallet:{ coins:300, lifetimeEarned:40 }, bond:1,
    streak:{ count:0, lastCheckIn:null, day:"2026-09-15", a:false, b:false, aAns:null, bAns:null },
    daily:{ day:"2026-09-15", duel:0, memory:0 }, duel:null, plan:[],
    house:{ rooms:{ living:{ unlocked:true }, kitchen:{ unlocked:false } },
      inventory:[{ instanceId:"start_plant", itemId:"plant" }, { instanceId:"start_armchair", itemId:"armchair" },
                 { instanceId:"start_photos", itemId:"photos" }],
      placed:[{ instanceId:"first", itemId:"plant", room:"living", x:4, y:3, rot:0 }] },
    showcase:{ published:false, likesGiven:[], tagline:"" },
    stats:{ gamesPlayed:0, duelsPlayed:0, bestDuel:0 },
  };
}

/* ---- storage is merged by identity ---- */
{
  const base = doc(), mine = clone(base), theirs = clone(base);
  // this phone placed the plant; the other phone placed the armchair
  mine.house.inventory = mine.house.inventory.filter(i => i.instanceId !== "start_plant");
  mine.house.placed.push({ instanceId:"start_plant", itemId:"plant", room:"living", x:2, y:5, rot:0 });
  theirs.house.inventory = theirs.house.inventory.filter(i => i.instanceId !== "start_armchair");
  theirs.house.placed.push({ instanceId:"start_armchair", itemId:"armchair", room:"living", x:6, y:2, rot:0 });
  const out = mergeGame(base, mine, theirs);
  const inv = out.house.inventory.map(i => i.instanceId).sort();
  const placed = out.house.placed.map(p => p.instanceId).sort();
  ok("two phones placing two starter items leaves one item in storage", inv.length === 1 && inv[0] === "start_photos",
     JSON.stringify(inv));
  ok("and both placements survive", placed.join() === "first,start_armchair,start_plant", JSON.stringify(placed));
}
{
  const base = doc(), mine = clone(base), theirs = clone(base);
  mine.wallet.coins += 5;                       // a change that touches nothing in storage
  const out = mergeGame(base, mine, theirs);
  ok("an unrelated change does not copy storage", out.house.inventory.length === 3,
     "inventory " + out.house.inventory.length);
}
{
  const base = doc(), mine = clone(base), theirs = clone(base);
  mine.house.inventory.push({ instanceId:"sofa_1", itemId:"sofa" });
  theirs.house.inventory.push({ instanceId:"lamp_1", itemId:"lamp" });
  const out = mergeGame(base, mine, theirs);
  const inv = out.house.inventory.map(i => i.instanceId).sort();
  ok("both purchases arrive once each", inv.join() === "lamp_1,sofa_1,start_armchair,start_photos,start_plant",
     JSON.stringify(inv));
}
{
  const base = doc(), mine = clone(base), theirs = clone(base);
  // picked up here and put into storage: it must not also stay on the floor
  mine.house.placed = [];
  mine.house.inventory.push({ instanceId:"first", itemId:"plant" });
  const out = mergeGame(base, mine, theirs);
  ok("a thing is never both on the floor and in storage",
     !(out.house.placed.some(p => p.instanceId === "first") && out.house.inventory.some(i => i.instanceId === "first")));
}

/* ---- coins move by what each phone did ---- */
{
  const base = doc(), mine = clone(base), theirs = clone(base);
  mine.wallet.coins -= 100; theirs.wallet.coins += 33;
  const out = mergeGame(base, mine, theirs);
  ok("a purchase here and a reward there both count", out.wallet.coins === 233, "coins " + out.wallet.coins);
}

/* ---- the streak keeps both halves of the same day ---- */
{
  const s = mergeStreak({ day:"2026-09-15", aAns:2, a:true, bAns:null, count:0, lastCheckIn:null },
                        { day:"2026-09-15", aAns:null, bAns:1, b:true, count:0, lastCheckIn:null });
  ok("two phones answering their own row keep both answers", s.aAns === 2 && s.bAns === 1, JSON.stringify(s));
}
{
  const s = mergeStreak({ day:"2026-09-16", aAns:null, bAns:null, count:4, lastCheckIn:"2026-09-15" },
                        { day:"2026-09-15", aAns:3, bAns:3, count:4, lastCheckIn:"2026-09-15" });
  ok("yesterday's answers do not leak into today", s.aAns === null && s.bAns === null && s.count === 4, JSON.stringify(s));
}
{
  const s = mergeStreak({ day:"2026-09-15", aAns:1, bAns:0, count:5, lastCheckIn:"2026-09-15" },
                        { day:"2026-09-15", aAns:1, bAns:null, count:4, lastCheckIn:"2026-09-14" });
  ok("a check in only moves forward", s.count === 5 && s.lastCheckIn === "2026-09-15", JSON.stringify(s));
}

/* ---- the first ritual pays once ---- */
{
  const base = doc(), mine = clone(base), theirs = clone(base);
  theirs.firstRitualPaid = true;
  const out = mergeGame(base, mine, theirs);
  ok("the first ritual flag survives a merge from the phone that did not pay", out.firstRitualPaid === true);
}

/* ---- the day is the local one ---- */
{
  const d = new Date(2026, 8, 15, 23, 30);
  ok("the day is the local calendar day", localDay(d) === "2026-09-15", localDay(d));
  const n = new Date();
  ok("today() agrees with the local clock", today() === localDay(n));
}

console.log("\nPASS " + pass.length + "  FAIL " + fail.length);
fail.forEach(l => console.log("  FAIL " + l));
process.exit(fail.length ? 1 : 0);
