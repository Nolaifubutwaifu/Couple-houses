#!/usr/bin/env node
/* The server the database suites were always written against, and which was
   not in the repository.

   tools/pairing-test.js, guest-pair-test.js, screen-pair-test.js and
   room-sync-test.js all set NEST_CONFIG to { url: location.origin, lib:
   "/_lib/supabase.js" }. That is a deliberate choice and not a shortcut: it
   means the page never makes a cross origin request and never opens its own
   TLS connection to anywhere, so the suites run the same on a laptop, in CI
   and inside a sandbox whose egress goes through a policy proxy. What it
   needs in return is a server that serves this directory AND forwards the six
   Supabase paths, including the realtime socket. Without one, those four
   suites cannot start: the probe 404s on its own origin and the run stops at
   "backend unreachable" having asserted nothing.

   So this is that server. Static files from the repository root, the client
   library cached once from the CDN, /auth /rest /realtime /storage /functions
   /pg forwarded, and the websocket upgrade tunnelled. The outbound leg is
   Node's, which means it picks up HTTPS_PROXY and the CA bundle the way every
   other tool on the machine does, with verification on.

     node tools/serve.js                 # port 8811, the project in src/backend.js
     NEST_SUPABASE_URL=https://other.supabase.co node tools/serve.js
     PORT=9000 node tools/serve.js

   It holds no key of its own. Whatever the page sends, including the
   publishable key and the bearer token, is what goes upstream. */
"use strict";

const http = require("node:http");
const net = require("node:net");
const tls = require("node:tls");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT || 8811);
const LIB_URL = process.env.NEST_SUPABASE_LIB ||
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.58.0/dist/umd/supabase.js";
const CACHE = path.join(require("node:os").tmpdir(), "nest-supabase-umd.js");
const FORWARD = /^\/(auth|rest|realtime|storage|functions|pg)\//;

/* The project the client already points at, so the suites need no argument. */
function target(){
  if(process.env.NEST_SUPABASE_URL) return new URL(process.env.NEST_SUPABASE_URL);
  const src = fs.readFileSync(path.join(ROOT, "src", "backend.js"), "utf8");
  const m = src.match(/url:\s*"(https:\/\/[^"]+)"/);
  if(!m) throw new Error("no Supabase url in src/backend.js and no NEST_SUPABASE_URL");
  return new URL(m[1]);
}
const UP = target();

const TYPES = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8", ".json":"application/json", ".svg":"image/svg+xml",
  ".png":"image/png", ".jpg":"image/jpeg", ".webp":"image/webp", ".woff2":"font/woff2",
  ".mp3":"audio/mpeg", ".ico":"image/x-icon", ".md":"text/plain; charset=utf-8",
  ".sql":"text/plain; charset=utf-8" };

/* ---------- the client library, fetched once and kept ---------- */
async function library(){
  if(fs.existsSync(CACHE)) return fs.readFileSync(CACHE);
  process.env.NODE_USE_ENV_PROXY = "1";
  const r = await fetch(LIB_URL);
  if(!r.ok) throw new Error("could not fetch " + LIB_URL + ": " + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(CACHE, buf);
  return buf;
}

/* ---------- ordinary requests ---------- */
const server = http.createServer(async (req, res) => {
  try{
    if(req.url.split("?")[0] === "/_lib/supabase.js"){
      const buf = await library();
      res.writeHead(200, { "content-type":"text/javascript; charset=utf-8",
                           "cache-control":"public, max-age=86400" });
      return res.end(buf);
    }
    if(FORWARD.test(req.url)) return forward(req, res);
    return statics(req, res);
  }catch(err){
    res.writeHead(502, { "content-type":"text/plain" });
    res.end("serve.js: " + err.message);
  }
});

async function forward(req, res){
  process.env.NODE_USE_ENV_PROXY = "1";
  const headers = {};
  Object.keys(req.headers).forEach(k => {
    if(/^(host|connection|content-length|accept-encoding)$/i.test(k)) return;
    headers[k] = req.headers[k];
  });
  headers.host = UP.host;
  const body = /^(GET|HEAD)$/.test(req.method) ? undefined : await read(req);
  let up;
  try{
    up = await fetch(UP.origin + req.url, { method:req.method, headers, body, redirect:"manual" });
  }catch(err){
    res.writeHead(502, { "content-type":"application/json" });
    return res.end(JSON.stringify({ message:"upstream unreachable: " + err.message }));
  }
  const out = {};
  up.headers.forEach((v, k) => { if(!/^(content-encoding|content-length|transfer-encoding)$/i.test(k)) out[k] = v; });
  const buf = Buffer.from(await up.arrayBuffer());
  out["content-length"] = String(buf.length);
  res.writeHead(up.status, out);
  res.end(buf);
}

const read = req => new Promise((resolve, reject) => {
  const parts = [];
  req.on("data", d => parts.push(d));
  req.on("end", () => resolve(Buffer.concat(parts)));
  req.on("error", reject);
});

function statics(req, res){
  let p = decodeURIComponent(req.url.split("?")[0]);
  if(p === "/") p = "/index.html";
  const file = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ""));
  if(!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
    res.writeHead(404, { "content-type":"text/plain" });
    return res.end("File not found");
  }
  res.writeHead(200, { "content-type":TYPES[path.extname(file)] || "application/octet-stream",
                       "cache-control":"no-store" });
  fs.createReadStream(file).pipe(res);
}

/* ---------- the realtime socket ---------- */
/* Nothing here reads the websocket frames. The upgrade request is replayed
   upstream over TLS and the two sockets are piped together, so subscribing,
   the heartbeat and every broadcast are the real ones. */
server.on("upgrade", async (req, socket) => {
  if(!FORWARD.test(req.url)) return socket.destroy();
  let up;
  try{ up = await connect(UP.hostname, 443); }
  catch(err){ return socket.destroy(); }

  const lines = ["GET " + req.url + " HTTP/1.1", "Host: " + UP.host];
  Object.keys(req.headers).forEach(k => {
    if(/^host$/i.test(k)) return;
    const v = req.headers[k];
    (Array.isArray(v) ? v : [v]).forEach(one => lines.push(k + ": " + one));
  });
  up.write(lines.join("\r\n") + "\r\n\r\n");
  up.pipe(socket);
  socket.pipe(up);
  const bye = () => { up.destroy(); socket.destroy(); };
  up.on("error", bye);
  socket.on("error", bye);
});

/* One outbound connection, through the proxy when there is one. The CA the
   proxy presents is the one Node is already configured to trust, so nothing
   here weakens verification. */
function connect(host, port){
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const secure = sock => tls.connect({ socket:sock, servername:host });
  if(!proxy) return new Promise((resolve, reject) => {
    const s = tls.connect({ host, port, servername:host }, () => resolve(s));
    s.on("error", reject);
  });
  const u = new URL(proxy);
  return new Promise((resolve, reject) => {
    const raw = net.connect(Number(u.port || 80), u.hostname, () => {
      raw.write("CONNECT " + host + ":" + port + " HTTP/1.1\r\nHost: " + host + ":" + port + "\r\n\r\n");
    });
    raw.once("data", chunk => {
      const head = chunk.toString("latin1");
      if(!/^HTTP\/1\.[01] 200/.test(head)) return reject(new Error("proxy refused: " + head.split("\r\n")[0]));
      const t = secure(raw);
      t.on("secureConnect", () => resolve(t));
      t.on("error", reject);
    });
    raw.on("error", reject);
  });
}

server.listen(PORT, "127.0.0.1", () => {
  console.log("NEST on http://127.0.0.1:" + PORT + "  files from " + ROOT);
  console.log("  forwarding " + FORWARD + " to " + UP.origin +
    (process.env.HTTPS_PROXY ? " via " + process.env.HTTPS_PROXY : ""));
});
