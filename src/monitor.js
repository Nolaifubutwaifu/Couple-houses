/* NEST :: what went wrong, and what happened, somewhere a person can look.

   Errors and funnel events used to live in each person's own browser, which
   is to say nowhere: nobody could see that a screen was throwing on a phone
   model we do not own. With a database they are written to two insert only
   tables (client_errors, client_events), readable from the dashboard and
   never by another player, and kept for ninety days.

   Monitoring must never be the thing that breaks the app, so every path in
   here swallows its own failures, sends in small batches, and gives up
   quietly after twenty errors a session. */
"use strict";

const Monitor = {
  VERSION: "2026.09.15",
  MAX_ERRORS: 20,
  sentErrors: 0,
  seen: new Set(),
  queue: [],
  timer: null,

  init(){
    addEventListener("error", e => {
      if(!e || !e.message) return;                 // a failed image or script load, not a script error
      this.error(e.message, e.error && e.error.stack, (e.filename || "") + ":" + (e.lineno || 0));
    });
    addEventListener("unhandledrejection", e => {
      const r = (e && e.reason) || {};
      this.error(String(r.message || r), r.stack, "promise");
    });
    addEventListener("pagehide", () => this.flush());
    document.addEventListener("visibilitychange", () => { if(document.hidden) this.flush(); });
  },

  screen(){
    try{
      if(typeof Onboard !== "undefined" && Onboard.step) return "onboard:" + Onboard.step;
      if(typeof route !== "undefined" && route) return "app:" + route.tab;
    }catch(err){ /* not booted yet */ }
    return "";
  },

  error(message, stack, source){
    const key = String(message).slice(0, 120) + "|" + (source || "");
    if(this.seen.has(key) || this.sentErrors >= this.MAX_ERRORS) return;
    this.seen.add(key);
    this.sentErrors++;
    this.push("client_errors", {
      message: String(message).slice(0, 500),
      stack: stack ? String(stack).slice(0, 4000) : null,
      source: source ? String(source).slice(0, 300) : null,
      screen: this.screen().slice(0, 60),
      ua: (navigator.userAgent || "").slice(0, 300),
      app_version: this.VERSION,
    });
  },

  event(name, props){
    if(!/^[a-z_]{2,40}$/.test(name || "")) return;
    let p = props || {};
    try{ if(JSON.stringify(p).length > 1500) p = { truncated:true }; }catch(err){ p = {}; }
    this.push("client_events", { name, props:p });
  },

  push(table, row){
    this.queue.push({ table, row });
    if(this.queue.length > 60) this.queue.shift();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 5000);
  },

  async flush(){
    clearTimeout(this.timer);
    if(!this.queue.length) return;
    try{
      if(typeof Api === "undefined" || !Api.readyP) return;
      await Api.readyP;
      if(!Api.backend || typeof Backend === "undefined" || !Backend.sb){ this.queue = []; return; }
      const batch = this.queue.splice(0);
      const byTable = {};
      batch.forEach(b => { (byTable[b.table] = byTable[b.table] || []).push(b.row); });
      for(const t of Object.keys(byTable)){
        try{ await Backend.sb.from(t).insert(byTable[t]); }catch(err){ /* never break the app */ }
      }
    }catch(err){ /* never break the app */ }
  },
};

Monitor.init();
