#!/usr/bin/env node
/* The suites make their own people and share nothing, so they can overlap.
   Not by much, though: five Chromium instances on one small box spend their
   time fighting each other, and measured that way all five at once was no
   faster than one at a time and timed two of them out. Two at a time is
   where the curve turns. Pass a name to run just one. */
const { spawn } = require("node:child_process");
const SUITES = ["local-test", "pairing-test", "guest-pair-test", "screen-pair-test", "room-sync-test"];
const only = process.argv.slice(2);
const list = only.length ? SUITES.filter(s => only.some(o => s.indexOf(o) >= 0)) : SUITES;

const run = name => new Promise(res => {
  const t = Date.now();
  const p = spawn("node", ["tools/" + name + ".js"], { cwd:process.cwd() });
  let out = "";
  p.stdout.on("data", d => out += d);
  p.stderr.on("data", d => out += d);
  p.on("close", code => {
    const line = (out.match(/^PASS \d+  FAIL \d+.*$/m) || ["no result"])[0];
    const fails = out.split("\n").filter(l => /^  FAIL /.test(l));
    res({ name, code, line, fails, secs:((Date.now() - t) / 1000).toFixed(0), out });
  });
});

async function pool(items, width){
  const out = [], queue = items.slice();
  await Promise.all(Array.from({ length:Math.min(width, queue.length) }, async () => {
    while(queue.length) out.push(await run(queue.shift()));
  }));
  return out;
}

/* pairing-test opens three browsers of its own, and this box cannot carry
   that plus another suite: measured, it times out on page load rather than
   finishing faster. So it runs alone and the light ones pair up. */
const HEAVY = ["pairing-test"];

(async () => {
  const t = Date.now();
  const heavy = list.filter(n => HEAVY.indexOf(n) >= 0);
  const light = list.filter(n => HEAVY.indexOf(n) < 0);
  const results = (await pool(heavy, 1)).concat(await pool(light, 2));
  let bad = 0;
  results.forEach(r => {
    console.log((r.code === 0 ? "  ok   " : "  FAIL ") + r.name.padEnd(18) + r.line + "  (" + r.secs + "s)");
    r.fails.forEach(f => console.log("         " + f.trim()));
    if(r.code !== 0){ bad++; }
  });
  if(bad) results.filter(r => r.code !== 0).forEach(r => {
    console.log("\n----- " + r.name + " -----\n" + r.out.split("\n").filter(l => !/Warning|GroupMarker|WebGL|WebSocket|ERR_CONN|404/.test(l)).join("\n"));
  });
  console.log("\n" + (bad ? bad + " suite(s) failing" : "all suites green") +
              " in " + ((Date.now() - t) / 1000).toFixed(0) + "s");
  process.exit(bad ? 1 : 0);
})();
