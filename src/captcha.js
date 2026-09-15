/* NEST :: a CAPTCHA in front of guest sign up. Off until a Cloudflare
   Turnstile site key is set in site-config.js.

   Guest accounts cost nothing to make, which is the point of them and also
   what makes them easy to create by the thousand. Supabase can require a
   CAPTCHA token for anonymous sign in; this fetches one. Turnstile's
   "interaction only" appearance means almost everyone sees nothing at all,
   and the few it is unsure about get one tap.

   Order matters when switching it on: deploy the site key first, then enable
   CAPTCHA protection in Supabase. The other way round, sign up stops working
   until the key ships. */
"use strict";

const Captcha = {
  script: null,

  key(){ return (window.NEST_SITE && window.NEST_SITE.turnstileSiteKey) || ""; },
  enabled(){ return /^[0-9A-Za-z_-]{10,}$/.test(this.key()); },

  load(){
    if(this.script) return this.script;
    this.script = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = () => window.turnstile ? resolve(window.turnstile) : reject(new Error("captcha_unavailable"));
      s.onerror = () => { this.script = null; reject(new Error("captcha_blocked")); };
      document.head.appendChild(s);
    });
    return this.script;
  },

  /* A fresh token for one sign in, or null when CAPTCHA is not configured. */
  async token(){
    if(!this.enabled()) return null;
    const ts = await this.load();
    return new Promise((resolve, reject) => {
      let host = document.getElementById("captcha");
      if(!host){
        host = document.createElement("div");
        host.id = "captcha";
        document.body.appendChild(host);
      }
      host.hidden = false;
      host.innerHTML = "";
      let widget = null;
      const done = fn => v => {
        host.hidden = true;
        setTimeout(() => { try{ if(widget !== null) ts.remove(widget); }catch(err){ /* already gone */ } }, 0);
        fn(v);
      };
      widget = ts.render(host, {
        sitekey: this.key(),
        appearance: "interaction-only",
        theme: "light",
        callback: done(resolve),
        "error-callback": done(() => reject(new Error("captcha_failed"))),
        "expired-callback": done(() => reject(new Error("captcha_expired"))),
      });
    });
  },
};
