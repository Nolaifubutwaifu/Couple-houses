#!/usr/bin/env node
/* Lifts index.html into the shape the Artifact publisher wants:
   page content only, no doctype / html / head / body wrapper. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const src = resolve(process.argv[2] || "index.html");
const out = resolve(process.argv[3] || "build/artifact.html");
const html = readFileSync(src, "utf8");

const pick = (open, close) => {
  const a = html.indexOf(open);
  const b = html.indexOf(close, a);
  if (a < 0 || b < 0) throw new Error(`missing ${open} in ${src}`);
  return html.slice(a, b + close.length);
};

const parts = [
  pick("<title>", "</title>"),
  pick("<style>", "</style>"),
  html.slice(html.indexOf("<body>") + "<body>".length, html.lastIndexOf("</body>")).trim(),
];

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, parts.join("\n\n") + "\n");
console.log(`wrote ${out} (${parts.join("").length} chars)`);
