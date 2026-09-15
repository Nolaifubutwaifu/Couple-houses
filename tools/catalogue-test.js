#!/usr/bin/env node
/* The server's price list is generated from the client's catalogue, so the
   two can only drift if somebody edits one and forgets the other. This fails
   when docs/migrations/002_catalogue.sql no longer says what
   tools/catalogue-sql.js would say today. */
"use strict";
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const pass = [], fail = [];
const ok = (n, c, note) => { const l = n + (note ? " :: " + note : "");
  (c ? pass : fail).push(l); console.log((c ? "  ok   " : "  FAIL ") + l); };

let fresh = "", err = null;
try{ fresh = execFileSync("node", [path.join(__dirname, "catalogue-sql.js")], { encoding:"utf8" }); }
catch(e){ err = e.message; }
ok("the catalogue can be read", !err, err || "");

const file = path.join(ROOT, "docs", "migrations", "002_catalogue.sql");
const stored = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
ok("the stored price list matches the catalogue", stored.trim() === fresh.trim(),
   "regenerate with: node tools/catalogue-sql.js > docs/migrations/002_catalogue.sql");

const n = (fresh.match(/^\s*\('[a-z0-9]+', '[a-z]+', \d+/gm) || []).length;
ok("every item has a room and a price", n >= 50, n + " items");

console.log("\nPASS " + pass.length + "  FAIL " + fail.length);
fail.forEach(l => console.log("  FAIL " + l));
process.exit(fail.length ? 1 : 0);
