#!/usr/bin/env node
/* The two transports are one API with two implementations, and nothing until
   now checked that they answered the same set of questions. They had already
   drifted: GET /invites/{code} existed in src/api.js and not in
   src/backend.js, so an invite link named the person who sent it on the local
   store and silently named nobody the moment a database was reachable. The
   caller swallows the 404 by design, which is why it was quiet.

   So this reads both route tables and every Api.call in the app, and fails on
   three things:

     - a route one transport serves and the other does not
     - a screen calling a path that neither table can match
     - a screen calling a path only one of them can match

   Static, no browser, well under a second. The point is that the next gap of
   this kind is loud on the way in rather than a year later in somebody's
   hands. */
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.join(__dirname, "..");
const HOLE = "*";                      // stands in for anything that is not a literal
const EXPECTED = 4;
const pass = [], fail = [];
const ok = (n, c, note) => { const l = n + (note ? " :: " + note : "");
  (c ? pass : fail).push(l); console.log((c ? "  ok   " : "  FAIL ") + l); };
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

/* A route key is a property whose name is a method and a path, which is the
   one convention both tables are built on. */
function routesOf(file){
  const out = new Set();
  read(file).split("\n").forEach(line => {
    const m = line.match(/^\s*(?:async\s+)?"([A-Z]+) (\/[^"]*)"\s*[(:]/);
    if(m) out.add(shape(m[1], m[2]));
  });
  return out;
}

/* A declared route and a called path come down to the same thing: a method
   and a list of segments in which anything variable is a hole. So
   "POST /invites/{code}/claim" and "/invites/" + code + "/claim" are the same
   shape, and that is what has to line up. */
function shape(method, pathText){
  const parts = pathText.split("?")[0].split("/").filter(Boolean)
    .map(p => (p.indexOf("{") >= 0 || p.indexOf(HOLE) >= 0) ? "{}" : p);
  return method + " /" + parts.join("/");
}

/* Scanning rather than matching, because the path argument can carry calls
   and ternaries of its own and a regex stops at the wrong bracket. */
function callsOf(file){
  const src = read(file), out = [];
  let i = 0;
  while((i = src.indexOf("Api.call(", i)) >= 0){
    const open = i + "Api.call(".length;
    const close = endOfArgs(src, open);
    const args = splitTop(src.slice(open, close));
    i = close + 1;
    if(args.length < 2) continue;
    if(/\+\s*path\s*$/.test(args[1].trim())) continue;     // Economy.call's own call, read below
    const method = (args[0].trim().match(/^"([A-Z]+)"$/) || [])[1];
    const p = method ? flatten(args[1]) : null;
    out.push({ file, method, literal:p });
  }
  /* Economy.call is the one wrapper that owns part of the path itself: it is
     always a POST, always under the nest the person is in. Its own Api.call
     reads as a hole and is skipped above, so the paths are read from here. */
  i = 0;
  while((i = src.indexOf("Economy.call(", i)) >= 0){
    const open = i + "Economy.call(".length;
    const close = endOfArgs(src, open);
    const args = splitTop(src.slice(open, close));
    i = close + 1;
    const tail = args.length ? flatten(args[0]) : null;
    out.push({ file, method:"POST", literal:tail ? "/nests/" + HOLE + tail : null });
  }
  return out;
}

function endOfArgs(src, from){
  let depth = 1, i = from, quote = null;
  for(; i < src.length && depth; i++){
    const c = src[i];
    if(quote){ if(c === "\\") i++; else if(c === quote) quote = null; continue; }
    if(c === '"' || c === "'" || c === "`") quote = c;
    else if("([{".indexOf(c) >= 0) depth++;
    else if(")]}".indexOf(c) >= 0) depth--;
  }
  return i - 1;
}

function splitTop(s){
  const out = []; let depth = 0, last = 0, quote = null;
  for(let i = 0; i < s.length; i++){
    const c = s[i];
    if(quote){ if(c === "\\") i++; else if(c === quote) quote = null; continue; }
    if(c === '"' || c === "'" || c === "`") quote = c;
    else if("([{".indexOf(c) >= 0) depth++;
    else if(")]}".indexOf(c) >= 0) depth--;
    else if(c === "," && !depth){ out.push(s.slice(last, i)); last = i + 1; }
  }
  out.push(s.slice(last));
  return out;
}

/* Every string literal in the expression is kept as written, and everything
   between them becomes one hole, which is how the path reads at runtime. */
function flatten(expr){
  let out = "", i = 0, gap = false;
  while(i < expr.length){
    const c = expr[i];
    if(c === '"' || c === "'"){
      let j = i + 1, lit = "";
      for(; j < expr.length && expr[j] !== c; j++){
        if(expr[j] === "\\") j++;
        lit += expr[j];
      }
      if(gap){ out += HOLE; gap = false; }
      out += lit;
      i = j + 1;
    }else{
      if(!/[\s+()]/.test(c)) gap = true;
      i++;
    }
  }
  if(gap) out += HOLE;
  return out.charAt(0) === "/" ? out : null;    // a path passed in whole, nothing to read
}

const local = routesOf("src/api.js");
const backend = routesOf("src/backend.js");
const missB = [...local].filter(r => !backend.has(r));
const missL = [...backend].filter(r => !local.has(r));

ok("both route tables were read", local.size > 10 && backend.size > 10,
   "local " + local.size + ", backend " + backend.size);
ok("every route the local store serves, the database serves too",
   missB.length === 0, missB.join(", "));
ok("and there is nothing in the database table the local store cannot answer",
   missL.length === 0, missL.join(", "));

const FILES = ["src/app.js", "src/onboarding.js", "src/games.js", "src/build.js", "src/street.js"];
const calls = [].concat(...FILES.filter(f => fs.existsSync(path.join(ROOT, f))).map(callsOf));
const orphans = [];
calls.forEach(c => {
  if(!c.literal) return;                        // a wrapper passing a path straight through
  const s = shape(c.method, c.literal);
  const inL = local.has(s), inB = backend.has(s);
  if(!inL || !inB) orphans.push(s + "  (" + c.file + ", local:" + inL + " backend:" + inB + ")");
});
ok("and every path a screen asks for is answered by both",
   orphans.length === 0, orphans.length ? "\n         " + orphans.join("\n         ") : "");

const short = pass.length + fail.length < EXPECTED;
console.log("\nPASS " + pass.length + "  FAIL " + fail.length +
  (short ? "  (INCOMPLETE, expected " + EXPECTED + ")" : ""));
console.log("  " + calls.filter(c => c.literal).length + " call sites read, " +
  calls.filter(c => !c.literal).length + " handed a path through a variable");
process.exit(fail.length || short ? 1 : 0);
