#!/usr/bin/env node
/* Lifts index.html into the shape the Artifact publisher wants: page content
   only, no document wrapper. Local scripts are inlined and the vendored
   three.js is swapped for the cdnjs build the sandbox allows. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";

const root = resolve(process.argv[2] || ".");
const out = resolve(process.argv[3] || "build/artifact.html");
const THREE_CDN = "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.149.0/three.min.js";

const html = readFileSync(join(root, "index.html"), "utf8");
const pick = (open, close) => {
  const a = html.indexOf(open), b = html.indexOf(close, a);
  if (a < 0 || b < 0) throw new Error(`missing ${open}`);
  return html.slice(a, b + close.length);
};

let body = html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>")).trim();

/* The Artifact sandbox blocks fetch, XHR and websockets to every host, so a
   published page can never reach the database. Saying so up front is better
   than a four second probe that was always going to fail: the artifact is
   the local demo, and the hosted site is the one that pairs. */
body = body.replace(/<script src="vendor\/three\.min\.js"><\/script>/,
  `<script>window.NEST_CONFIG = { url:"" };  /* artifact build: local store only */</script>\n` +
  `<script src="${THREE_CDN}"></script>`);
body = body.replace(/<script src="(src\/[^"]+)"><\/script>/g, (_, src) => {
  const code = readFileSync(join(root, src), "utf8");
  return `<script>\n/* ${src} */\n${code}\n</script>`;
});
if (/<script src="(?!https:)/.test(body)) throw new Error("a local script was not inlined");

const head = [
  pick("<title>", "</title>"),
  pick('<link rel="preconnect" href="https://fonts.googleapis.com">', "&display=swap\">"),
  pick("<style>", "</style>"),
];

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, head.join("\n") + "\n\n" + body + "\n");
console.log(`wrote ${out} (${(body.length / 1024).toFixed(0)} KB of page)`);
