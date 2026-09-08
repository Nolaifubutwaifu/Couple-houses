/* NEST :: onboarding, authentication and pairing. Spec sections 4, 5 and 6.
   The flow exists to get two people into one nest, so the invite is the
   conversion event and a solo user is deliberately kept from building. */
"use strict";

/* S0: a hand authored showcase nest, not procedural. Treat it as a
   marketing asset and change it with the season. */
const DEMO_LOT = [
  ["sofa","living",2,4],["fireplc","living",6,0],["books","living",0,1],["tv","living",3,0],
  ["armchair","living",7,4],["plant","living",0,6],["photos","living",8,6],["heartst","living",9,2],
  ["table","kitchen",3,3],["stove","kitchen",1,0],["fridge","kitchen",4,0],["coffee","kitchen",8,1],
  ["bed","bedroom",3,2],["wardrobe","bedroom",0,0],["mirror","bedroom",8,6],["cat","bedroom",7,6],
  ["tree","garden",1,1],["pool","garden",5,5],["bench","garden",1,7],["fountain","garden",8,7],
].map((p, i) => ({ instanceId:"demo" + i, itemId:p[0], room:p[1], x:p[2], y:p[3], rot:p[4] || 0 }));

const INTRO_BEATS = [
  { copy:"This is a home for two people.",            camera:"wide"   },
  { copy:"You build it together, a little at a time.", camera:"inside" },
  { copy:"The more you show up, the more it grows.",   camera:"golden" },
];
const BASE_MATERIALS = [
  { id:"ceramic", name:"Ceramic", colour:"oat" },
  { id:"sand",    name:"Sandstone", colour:"warmSand" },
  { id:"clay",    name:"Clay", colour:"softClay" },
  { id:"cream",   name:"Porcelain", colour:"cream" },
];
const TERRAIN_TYPES = [
  { id:"grass", name:"Grass", colour:"sage" },
  { id:"sand",  name:"Sand",  colour:"warmSand" },
  { id:"stone", name:"Stone", colour:"mist" },
  { id:"snow",  name:"Snow",  colour:"cream" },
];
const STARTER_ITEMS = ["plant", "armchair", "photos"];
const NUDGES = [
  { at: 24 * 3600e3, copy:"Your nest is still waiting. Want to resend the invite?" },
  { at: 72 * 3600e3, copy:"Still no partner. Try sending the invite another way?" },
  { at:  7 * 24 * 3600e3, copy:"Your invite code has expired. Want a fresh one?" },
];
const PUSH_SNOOZE = 14 * 24 * 3600e3;

const Onboard = {
  step:null, ctx:{}, introTimer:null, beat:0, pendingCode:null, nudgeTimer:null,

  /* ---------- entry ---------- */
  async begin(){
    Track.once("install");
    document.body.classList.add("onboarding");
    $("#onboard").hidden = false;
    Diorama.frameShift = 0.34;
    Diorama.applyView();
    this.readDeepLink();
    const me = await Api.call("GET", "/nests/mine");
    // a returning identity restores its nest, it never gets a second one
    if(me.user && me.user.age_verified === false && me.user.birthdate) return this.go("blocked");
    if(me.nest && me.membership.status === "active" && me.nest.status === "active") return App.enter(me);
    if(me.nest && me.membership.status === "invited") return this.go("awaitConfirm", { nest:me.nest });
    if(me.nest && me.nest.status === "pending") return this.go("waiting", me);
    if(me.user && me.user.display_name) return this.go(this.pendingCode ? "redeem" : "fork");
    if(me.user) return this.go("details");
    // criterion 2: the intro never replays on a later launch
    this.go(this.introSeen() ? "auth" : "cold");
  },
  readDeepLink(){
    const m = (location.search + location.hash).match(/[?#&]j=([A-Za-z0-9]{6})/);
    let code = m ? m[1].toUpperCase() : null;
    if(code){
      Track.fire("invite_link_opened", { code });
      // deferred: the link is remembered across the install, then read back
      try{ localStorage.setItem("nest.deferred_code", code); }catch(err){ /* fine */ }
    }else{
      try{ code = localStorage.getItem("nest.deferred_code"); }catch(err){ code = null; }
    }
    this.pendingCode = code;
  },
  clearDeepLink(){
    this.pendingCode = null;
    try{ localStorage.removeItem("nest.deferred_code"); }catch(err){ /* fine */ }
  },
  finish(){
    Diorama.frameShift = 0;
    Diorama.applyView();
    document.body.classList.remove("onboarding");
    $("#onboard").hidden = true;
    $("#ob-top").innerHTML = "";
    $("#ob-sheet").innerHTML = "";
    Diorama.orbit = 0;
  },

  go(step, ctx){
    this.step = step;
    this.ctx = ctx || {};
    window.scrollTo(0, 0);
    this.render();
  },
  top(html){ $("#ob-top").innerHTML = ""; if(html) $("#ob-top").appendChild(el(html)); },
  sheet(html){
    const s = $("#ob-sheet");
    s.innerHTML = "";
    if(html) s.appendChild(el(html));
    s.hidden = !html;
    return s;
  },

  render(){
    const fn = this["s_" + this.step];
    if(fn) fn.call(this, this.ctx);
  },

  /* ---------- S0 cold open ---------- */
  showDemo(state){
    Diorama.setBase(null, null);
    Diorama.setLot({ rooms:Object.fromEntries(ROOMS.map(r => [r.id, { unlocked:true }])), placed:DEMO_LOT },
      { partnerA:"", partnerB:"" }, "");
    Diorama.applyState(state || "steady", seasonNow());
    Diorama.setZoomK(Diorama.ZOOM_K[1]);
    this.demoShown = true;
  },
  s_cold(){
    this.sheet(null);
    this.top(null);
    this.showDemo();
    Diorama.orbit = 4 * Math.PI / 180;      // 4 degrees a second
    // no interface at all for the first 1.2 seconds
    setTimeout(() => { if(this.step === "cold") this.go("intro"); }, 1200);
  },

  /* ---------- S1 intro, three beats ---------- */
  s_intro(){
    this.beat = 0;
    Track.fire("intro_started");
    this.sheet(null);
    this.playBeat();
  },
  playBeat(){
    if(this.step !== "intro") return;
    const b = INTRO_BEATS[this.beat];
    if(!b) return this.introDone();
    this.top(`<div class="ob-beat">
        <div class="ob-tap" id="obtap"></div>
        <p class="ob-line" id="obline">${esc(b.copy)}</p>
        <button class="ob-skip" id="obskip">Skip</button>
      </div>`);
    const line = $("#obline");
    $("#obskip").onclick = e => { e.stopPropagation(); Track.fire("intro_skipped", { beat:this.beat + 1 }); this.introDone(true); };
    $("#obtap").onclick = () => this.nextBeat();

    if(b.camera === "wide") Diorama.flyTo({ zoomK:Diorama.ZOOM_K[0], target:Diorama.lotCentre(), ms:1800 });
    if(b.camera === "inside") Diorama.flyTo({ zoomK:Diorama.ZOOM_K[2] * 0.85, target:Diorama.roomCentre("living"), ms:1800 });
    if(b.camera === "golden"){
      Diorama.flyTo({ zoomK:Diorama.ZOOM_K[1], target:Diorama.lotCentre(), ms:1800 });
      Diorama.applyState("strong", seasonNow());
    }
    // 300ms in, 2.6s hold, 250ms out
    line.style.opacity = "0";
    requestAnimationFrame(() => { line.style.transition = "opacity 300ms ease"; line.style.opacity = "1"; });
    clearTimeout(this.introTimer);
    this.introTimer = setTimeout(() => {
      line.style.transition = "opacity 250ms ease";
      line.style.opacity = "0";
      this.introTimer = setTimeout(() => this.nextBeat(), 250);
    }, 300 + 2600);
  },
  nextBeat(){
    if(this.step !== "intro") return;
    clearTimeout(this.introTimer);
    this.beat++;
    if(this.beat >= INTRO_BEATS.length) return this.introDone();
    this.playBeat();
  },
  introDone(skipped){
    clearTimeout(this.introTimer);
    if(!skipped) Track.fire("intro_completed");
    try{ localStorage.setItem("nest.intro_seen", "1"); }catch(err){ /* fine */ }
    this.go("auth");
  },
  introSeen(){
    try{ return !!localStorage.getItem("nest.intro_seen"); }catch(err){ return false; }
  },

  /* ---------- S2 auth. The world stays visible. ---------- */
  s_auth(){
    this.top(null);
    if(!this.demoShown) this.showDemo();
    Diorama.orbit = 4 * Math.PI / 180;
    const s = this.sheet(`<div class="ob-card">
      <p class="ob-h">Begin</p>
      <p class="s dim">One tap. No passwords, ever.</p>
      <div class="ob-auth">${Api.backend ? `
        <button class="btn go" data-p="email">Continue with email</button>` : `
        <button class="btn go ob-apple" data-p="apple">Sign in with Apple</button>
        <button class="btn ob-prov" data-p="google">Continue with Google</button>
        <button class="btn ob-prov" data-p="email">Continue with email</button>`}
      </div>
      <p class="ob-legal">By continuing you agree to our <a href="#terms" id="ob-terms">Terms</a> and
        <a href="#privacy" id="ob-priv">Privacy Policy</a>.</p>
      <button class="ob-quiet" id="ob-have">I already have a nest</button>
    </div>`);
    s.querySelectorAll("[data-p]").forEach(b => {
      b.onclick = () => this.authWith(b.dataset.p);
    });
    s.querySelector("#ob-have").onclick = () => this.authWith(Api.backend ? "email" : "apple");
    ["#ob-terms", "#ob-priv"].forEach(id => {
      s.querySelector(id).onclick = e => { e.preventDefault(); this.legal(id === "#ob-terms" ? "Terms" : "Privacy Policy"); };
    });
  },
  legal(title){
    const s = this.sheet(`<div class="ob-card">
      <p class="ob-h">${esc(title)}</p>
      <p class="s dim">This prototype has no legal copy behind it yet. In the product this opens
        the real document in an in app browser without leaving the flow.</p>
      <button class="btn go" id="ob-back">Back</button></div>`);
    s.querySelector("#ob-back").onclick = () => this.render();
  },
  async authWith(provider){
    Track.fire("auth_started", { provider });
    if(provider === "email") return this.emailStart();
    // Apple and Google cannot really run in a page, so this stands in for
    // the provider's account sheet. The same handle restores the same
    // identity, which is what makes the reinstall case testable.
    const suggested = "you" + Math.floor(Math.random() * 9000 + 1000);
    const s = this.sheet(`<div class="ob-card">
      <p class="ob-h">${provider === "apple" ? "Apple" : "Google"} account</p>
      <p class="ob-sim">Stands in for the provider sheet. Signing in with the same handle
        restores the same person, exactly as the real one does.</p>
      <label class="f"><span>Account</span><input id="ob-sub" value="${suggested}" maxlength="32"></label>
      <button class="btn go" id="ob-auth">Continue</button>
      <button class="ob-quiet" id="ob-cancel">Back</button></div>`);
    s.querySelector("#ob-cancel").onclick = () => this.go("auth");
    s.querySelector("#ob-auth").onclick = async () => {
      const subject = s.querySelector("#ob-sub").value.trim();
      if(!subject) return toast("Pick an account");
      await this.completeAuth(provider, subject, s.querySelector("#ob-auth"));
    };
  },
  async completeAuth(provider, subject, btn){
    if(btn){ btn.disabled = true; btn.textContent = "One moment"; }
    try{
      const r = await Api.call("POST", "/auth/session", { provider, subject });
      Track.fire("auth_completed", { provider });
      const me = await Api.call("GET", "/nests/mine");
      if(me.user.birthdate && !me.user.age_verified) return this.go("blocked");
      if(me.nest && me.membership.status === "active" && me.nest.status === "active") return App.enter(me);
      if(me.nest && me.nest.status === "pending") return this.go("waiting", me);
      if(!r.user.display_name) return this.go("details");
      this.go(this.pendingCode ? "redeem" : "fork");
    }catch(err){
      Track.fire("auth_failed", { provider, reason:err.code || "unknown" });
      toast("That did not work. Try again?");
      if(btn){ btn.disabled = false; btn.textContent = "Continue"; }
    }
  },
  emailStart(){
    const s = this.sheet(`<div class="ob-card">
      <p class="ob-h">Your email</p>
      <p class="s dim">We send a six digit code. No password to forget.</p>
      <label class="f"><span>Email</span><input id="ob-email" type="email" inputmode="email"
        autocomplete="email" placeholder="you@example.com"></label>
      <button class="btn go" id="ob-send">Send the code</button>
      <button class="ob-quiet" id="ob-cancel">Back</button></div>`);
    s.querySelector("#ob-cancel").onclick = () => this.go("auth");
    s.querySelector("#ob-send").onclick = async () => {
      const email = s.querySelector("#ob-email").value.trim();
      const btn = s.querySelector("#ob-send");
      btn.disabled = true; btn.textContent = "Sending";
      try{
        const r = await Api.call("POST", "/auth/email/start", { email });
        this.emailCode(email, r.dev_code);
      }catch(err){
        btn.disabled = false; btn.textContent = "Send the code";
        this.inlineError(s, "That does not look like an email address.");
      }
    };
  },
  emailCode(email, devCode){
    const s = this.sheet(`<div class="ob-card">
      <p class="ob-h">Check your email</p>
      <p class="s dim">Six digits, sent to ${esc(email)}.${devCode ? " It expires in ten minutes." : ""}</p>
      <div class="ob-boxes" id="ob-code"></div>
      ${devCode ? `<p class="ob-sim">Nothing can send mail from a page, so here is the code the
        backend generated: <b>${esc(devCode)}</b></p>` : ``}
      <div class="ob-err" id="ob-err" hidden></div>
      <button class="ob-quiet" id="ob-resend" disabled>Resend in 30s</button></div>`);
    this.codeBoxes(s.querySelector("#ob-code"), 6, "numeric", async value => {
      try{
        await Api.call("POST", "/auth/email/verify", { email, code:value });
        Track.fire("auth_completed", { provider:"email" });
        const me = await Api.call("GET", "/nests/mine");
        if(me.user.birthdate && !me.user.age_verified) return this.go("blocked");
        if(me.nest && me.membership.status === "active" && me.nest.status === "active") return App.enter(me);
        if(me.nest && me.nest.status === "pending") return this.go("waiting", me);
        if(!me.user.display_name) return this.go("details");
        this.go(this.pendingCode ? "redeem" : "fork");
      }catch(err){
        Track.fire("auth_failed", { provider:"email", reason:err.code });
        const msg = err.code === "code_expired" ? "That code has expired. Send a new one?"
          : err.code === "too_many_tries" ? "Too many tries. Send a new code."
          : "That code is not right. Check the digits?";
        this.showError(s, msg);
      }
    });
    const resend = s.querySelector("#ob-resend");
    let left = 30;
    const tick = setInterval(() => {
      left--;
      if(left <= 0){
        clearInterval(tick);
        resend.disabled = false;
        resend.textContent = "Send another code";
        resend.onclick = async () => {
          const r = await Api.call("POST", "/auth/email/start", { email });
          this.emailCode(email, r.dev_code);
        };
      }else resend.textContent = "Resend in " + left + "s";
    }, 1000);
  },

  /* ---------- S3 your details ---------- */
  s_details(){
    this.top(null);
    const s = this.sheet(`<div class="ob-card">
      <p class="ob-h">A little about you</p>
      <label class="f"><span>What should we call you?</span>
        <input id="ob-name" maxlength="24" placeholder="Robin"></label>
      <label class="f"><span>Your birthday</span>
        <input id="ob-dob" type="date"></label>
      <p class="s dim">We use this to check your age and to decorate on your birthday.</p>
      <div class="ob-err" id="ob-err" hidden></div>
      <button class="btn go" id="ob-next">Continue</button></div>`);
    s.querySelector("#ob-next").onclick = async () => {
      const display_name = s.querySelector("#ob-name").value.trim();
      const birthdate = s.querySelector("#ob-dob").value;
      if(!display_name) return this.showError(s, "We need something to call you.");
      if(!birthdate) return this.showError(s, "We need your birthday to check your age.");
      const btn = s.querySelector("#ob-next");
      btn.disabled = true; btn.textContent = "One moment";
      try{
        await Api.call("POST", "/users/me", { display_name, birthdate });
        Track.fire("details_completed");
        this.go(this.pendingCode ? "redeem" : "fork");
      }catch(err){
        if(err.code === "under_age") return this.go("blocked");
        btn.disabled = false; btn.textContent = "Continue";
        this.showError(s, "That did not save. Try again?");
      }
    };
  },
  /* A soft block with no retry loop: there is no way back to the date field
     from here, because a retry loop just teaches the workaround. */
  s_blocked(){
    this.top(null);
    Diorama.orbit = 0;
    this.sheet(`<div class="ob-card">
      <p class="ob-h">Come back when you are sixteen</p>
      <p class="s dim">NEST is for people aged sixteen and over. That is a rule about how we
        handle personal information, not a judgement about you, and there is nothing to
        appeal here.</p>
      <p class="s dim">If you got here by mistake, an adult in your household can contact
        support and we will sort it out with them.</p></div>`);
  },

  /* ---------- S4 pair fork ---------- */
  s_fork(){
    this.top(null);
    if(!this.demoShown) this.showDemo();
    Diorama.orbit = 4 * Math.PI / 180;
    const s = this.sheet(`<div class="ob-card">
      <p class="ob-h">Nest works with two people</p>
      <div class="ob-stack">
        <button class="btn go" id="ob-invite">I want to invite my partner</button>
        <button class="btn" id="ob-redeem">My partner sent me a code</button>
      </div>
      <p class="s dim">Nest only works with two people. You can invite someone now or come
        back to it later.</p>
      <button class="ob-quiet" id="ob-solo">Look around on my own first</button></div>`);
    s.querySelector("#ob-invite").onclick = async () => {
      Track.fire("pair_fork_chosen", { choice:"invite" });
      const btn = s.querySelector("#ob-invite");
      btn.disabled = true; btn.textContent = "Making your nest";
      try{
        const r = await Api.call("POST", "/nests", {});
        Track.fire("invite_code_created");
        this.go("invite", { nest:r.nest, invite:r.invite });
      }catch(err){
        btn.disabled = false; btn.textContent = "I want to invite my partner";
        if(err.code === "already_in_nest") return this.begin();
        toast("Could not make the nest. Try again?");
      }
    };
    s.querySelector("#ob-redeem").onclick = () => {
      Track.fire("pair_fork_chosen", { choice:"redeem" });
      this.go("redeem");
    };
    s.querySelector("#ob-solo").onclick = () => {
      Track.fire("pair_fork_chosen", { choice:"solo" });
      this.go("tour");
    };
    // a nest you have left is reachable here and nowhere else in the flow
    Api.call("GET", "/nests/archived").then(a => {
      if(!a.nests.length || this.step !== "fork") return;
      const link = el(`<button class="ob-quiet">Settings and nests you have left</button>`);
      link.onclick = () => this.go("settings");
      s.appendChild(link);
    });
  },
  s_settings(){
    this.top(null);
    Diorama.orbit = 1.5 * Math.PI / 180;
    const sheet = this.sheet(`<div class="ob-card"><p class="ob-h">Settings</p>
      <div id="ob-set"></div>
      <button class="ob-quiet" id="ob-setback">Back</button></div>`);
    sheet.querySelector("#ob-setback").onclick = () => this.go("fork");
    App.openSettings(sheet.querySelector("#ob-set"));
  },

  /* A read only look at the demo nest, with the invite always one tap away. */
  s_tour(){
    Diorama.setLot({ rooms:Object.fromEntries(ROOMS.map(r => [r.id, { unlocked:true }])), placed:DEMO_LOT }, null, "");
    Diorama.applyState("strong", seasonNow());
    Diorama.orbit = 3 * Math.PI / 180;
    this.top(`<div class="ob-tourbar">Someone else's nest. Yours starts empty.</div>`);
    const s = this.sheet(`<div class="ob-card ob-thin">
      <p class="s dim">Turn it, look around. You cannot build until your partner is here.</p>
      <button class="btn go" id="ob-inv">Invite my partner</button>
      <button class="ob-quiet" id="ob-back">Back</button></div>`);
    s.querySelector("#ob-inv").onclick = () => this.go("fork");
    s.querySelector("#ob-back").onclick = () => this.go("fork");
  },

  /* ---------- S5a invite code ---------- */
  s_invite(){
    const { nest, invite } = this.ctx;
    Diorama.orbit = 2 * Math.PI / 180;
    this.showEmptyNest(nest);
    this.top(null);
    const link = "https://nest.app/j/" + invite.code;
    const s = this.sheet(`<div class="ob-card">
      <p class="ob-h">Your invite</p>
      <div class="ob-code">${invite.code.split("").map(c => `<b>${c}</b>`).join("")}</div>
      <button class="btn go" id="ob-share">Send invite</button>
      <div class="ob-row2">
        <button class="btn sm" id="ob-copy">Copy code</button>
        <button class="btn sm" id="ob-new">New code</button>
      </div>
      <p class="s dim">Single use, and it expires in seven days.</p></div>`);
    s.querySelector("#ob-share").onclick = async () => {
      const text = "I started a nest for us. Join me here: " + link;
      let channel = "share_sheet";
      try{
        if(navigator.share){ await navigator.share({ text }); }
        else { await navigator.clipboard.writeText(text); channel = "clipboard"; toast("Invite copied"); }
      }catch(err){
        if(err && err.name === "AbortError") return;          // they backed out, not a share
        channel = "clipboard_fallback";
        try{ await navigator.clipboard.writeText(text); toast("Invite copied"); }catch(e){ toast("Copy it by hand: " + link); }
      }
      Track.fire("invite_shared", { channel });
      this.go("waiting", await Api.call("GET", "/nests/mine"));
    };
    s.querySelector("#ob-copy").onclick = async () => {
      try{ await navigator.clipboard.writeText(invite.code); toast("Code copied"); }
      catch(err){ toast("Your code is " + invite.code); }
      Track.fire("invite_shared", { channel:"copy_code" });
    };
    s.querySelector("#ob-new").onclick = async () => {
      const r = await Api.call("POST", "/invites/" + invite.code + "/revoke", {});
      Track.fire("invite_code_created");
      this.go("invite", { nest, invite:r.invite });
    };
    this.watchForClaim(nest.id);
  },

  /* ---------- S5b enter code ---------- */
  s_redeem(){
    Diorama.orbit = 3 * Math.PI / 180;
    this.top(null);
    Track.fire("code_entry_started");
    const s = this.sheet(`<div class="ob-card">
      <p class="ob-h">Your partner's code</p>
      <div class="ob-boxes" id="ob-code"></div>
      <div class="ob-err" id="ob-err" hidden></div>
      <button class="ob-quiet" id="ob-back">Back</button></div>`);
    s.querySelector("#ob-back").onclick = () => { this.clearDeepLink(); this.go("fork"); };
    const boxes = this.codeBoxes(s.querySelector("#ob-code"), 6, "text", v => this.claim(v, s));
    if(this.pendingCode){
      // arriving on a link never shows this screen: it validates straight away
      boxes.set(this.pendingCode);
      this.claim(this.pendingCode, s);
    }
  },
  async claim(code, s){
    try{
      const r = await Api.call("POST", "/invites/" + code.toUpperCase() + "/claim", {});
      this.clearDeepLink();
      this.go("awaitConfirm", { nest:r.nest, code:code.toUpperCase() });
    }catch(err){
      Track.fire("code_entry_failed", { reason:err.code });
      const msg = {
        code_expired:"That code has expired. Ask your partner to send a new one.",
        code_used:"That code has already been used. Ask your partner to send a new one.",
        code_not_found:"We could not find that code. Check for typos?",
        nest_full:"That nest is already full.",
        own_nest:"That is your own code. Send it to your partner instead.",
        already_in_nest:"You are already in a nest with " + (err.partner_name || "someone") + ".",
      }[err.code] || "That did not work. Try again?";
      this.showError(s, msg);
      if(err.code === "already_in_nest"){
        const link = el(`<button class="ob-quiet" style="margin-top:6px">Open nest settings</button>`);
        link.onclick = () => { this.finish(); App.openSettings(); };
        s.querySelector("#ob-err").appendChild(link);
      }
    }
  },

  /* ---------- S6 confirm, from both sides ---------- */
  s_awaitConfirm(){
    const nest = this.ctx.nest;
    this.top(null);
    this.sheet(`<div class="ob-card mid">
      <p class="ob-h">Waiting for ${esc(nest.founder_name || "your partner")}</p>
      <p class="s dim">They have to say yes too. This only works if you both agree it is you.</p>
      <div class="ob-pulse"></div></div>`);
    Api.Realtime.on(msg => {
      if(this.step !== "awaitConfirm") return;
      if(msg.type === "pair.activated") this.afterPair();
      if(msg.type === "pair.declined"){
        this.sheet(`<div class="ob-card mid"><p class="ob-h">Not this time</p>
          <p class="s dim">They did not confirm. If that was a mistake, ask for a new code.</p>
          <button class="btn go" id="ob-again">Try another code</button></div>`);
        $("#ob-again").onclick = () => this.go("redeem");
      }
    });
    this.pollPair(nest.id);
  },
  /* the founder's side: a live prompt in app, a push if not */
  watchForClaim(nestId){
    Api.Realtime.on(async msg => {
      if(msg.type !== "invite.claimed" || msg.payload.nest_id !== nestId) return;
      const me = await Api.call("GET", "/nests/mine");
      if(me.pending_partner) this.confirmPrompt(me);
    });
    Api.call("GET", "/nests/mine").then(me => { if(me.pending_partner) this.confirmPrompt(me); });
  },
  confirmPrompt(me){
    if(this.step === "confirm") return;
    this.step = "confirm";
    Track.fire("partner_confirm_shown");
    App.notify(me.pending_partner.display_name + " wants to join your nest.");
    const s = this.sheet(`<div class="ob-card mid">
      <p class="ob-h">${esc(me.pending_partner.display_name)} wants to join your nest.</p>
      <p class="s dim">Only say yes if that is your partner.</p>
      <button class="btn go" id="ob-yes">Yes, that is my partner</button>
      <button class="ob-quiet" id="ob-no">Not them</button></div>`);
    s.querySelector("#ob-yes").onclick = async () => {
      s.querySelector("#ob-yes").disabled = true;
      await Api.call("POST", "/invites/" + me.invite.code + "/confirm", { accept:true });
      Track.fire("partner_confirmed");
      this.afterPair();
    };
    s.querySelector("#ob-no").onclick = async () => {
      await Api.call("POST", "/invites/" + me.invite.code + "/confirm", { accept:false });
      Track.fire("partner_declined");
      const r = await Api.call("POST", "/invites/" + me.invite.code + "/revoke", {});
      toast(me.pending_partner.display_name + " did not join.");
      this.go("invite", { nest:me.nest, invite:r.invite });
    };
  },
  pollPair(nestId){
    clearInterval(this._poll);
    this._poll = setInterval(async () => {
      if(this.step !== "awaitConfirm" && this.step !== "waiting"){ clearInterval(this._poll); return; }
      const me = await Api.call("GET", "/nests/mine");
      if(me.nest && me.nest.status === "active" && me.membership.status === "active"){
        clearInterval(this._poll);
        this.afterPair();
      }else if(this.step === "waiting" && me.pending_partner){
        clearInterval(this._poll);
        this.confirmPrompt(me);
      }
    }, 900);
  },

  async afterPair(){
    clearInterval(this._poll);
    Track.fire("nest_activated");                 // north star
    let me = null;
    try{ me = await Api.call("GET", "/nests/mine"); }
    catch(err){ return this.go("ceremonyQueued", {}); }
    App.ensureGame(me.nest.id);
    // The flag goes up at pairing and only comes down when the ceremony has
    // played all the way through. A client that dies halfway, or was offline
    // when the pair activated, gets the whole thing next launch, never half.
    App.game.ceremony_pending = true;
    App.saveGame();
    if(!Api.Realtime.online) return this.go("ceremonyQueued", me);
    this.go("ceremony", me);
  },
  s_ceremonyQueued(){
    this.sheet(`<div class="ob-card mid">
      <p class="ob-h">You are paired</p>
      <p class="s dim">You went offline. Your nest opening is waiting for you and will play
        in full the next time you are both connected.</p></div>`);
  },

  /* ---------- S7 the ceremony ---------- */
  s_ceremony(){
    const me = this.ctx;
    Diorama.orbit = 0;
    App.ensureGame(me.nest.id);
    const rooms = Object.fromEntries(ROOMS.map(r => [r.id, { unlocked:r.id === "living" }]));
    Diorama.setLot({ rooms, placed:[] }, this.partnerNames(me), "");
    Diorama.applyState("resting", seasonNow());
    Diorama.setZoomK(Diorama.ZOOM_K[1]);
    this.sheet(null);
    this.top(`<div class="ob-beat"><p class="ob-line" id="obline" style="opacity:0"></p></div>`);
    const line = $("#obline");
    Diorama.playCeremony("plant", n => {
      if(n === 4){
        const p = { instanceId:"first", itemId:"plant", room:"living", x:4, y:3, rot:0 };
        App.game.house.placed.push(p);
        Diorama.addProp(p);
      }
      if(n === 5){
        line.textContent = "Your nest is open.";
        line.style.transition = "opacity 400ms ease";
        line.style.opacity = "1";
      }
      if(n === 6){
        Track.fire("ceremony_completed");
        Diorama.applyState("new", seasonNow());
        App.game.ceremony_pending = false;     // it played in full, so it is done
        App.saveGame();
        this.go("nameNest", me);
      }
    });
  },
  partnerNames(me){
    const a = me.members.find(m => m.role === "founder"), b = me.members.find(m => m.role === "partner");
    return { partnerA:(a && a.user ? a.user.display_name : "One"), partnerB:(b && b.user ? b.user.display_name : "Two") };
  },

  /* name the nest together: one proposes, the other confirms or edits */
  s_nameNest(){
    const me = this.ctx;
    const iAmFounder = me.membership.role === "founder";
    this.top(null);
    if(iAmFounder){
      const s = this.sheet(`<div class="ob-card">
        <p class="ob-h">Name it together</p>
        <p class="s dim">You propose, ${esc(this.partnerNames(me).partnerB)} confirms.</p>
        <label class="f"><span>Our nest is called</span><input id="ob-nn" maxlength="20" placeholder="The long room"></label>
        <button class="btn go" id="ob-prop">Propose</button></div>`);
      s.querySelector("#ob-prop").onclick = async () => {
        const name = s.querySelector("#ob-nn").value.trim();
        if(!name) return toast("Give it a name");
        Api.Realtime.emit("nest.proposed", { nest_id:me.nest.id, name });
        this.sheet(`<div class="ob-card mid"><p class="ob-h">"${esc(name)}"</p>
          <p class="s dim">Waiting for ${esc(this.partnerNames(me).partnerB)} to agree.</p>
          <div class="ob-pulse"></div></div>`);
        this._proposed = name;
      };
      Api.Realtime.on(msg => {
        if(this.step === "nameNest" && msg.type === "nest.named") this.go("firstRitual", me);
      });
    }else{
      this.sheet(`<div class="ob-card mid"><p class="ob-h">Naming the nest</p>
        <p class="s dim">${esc(this.partnerNames(me).partnerA)} is proposing a name.</p>
        <div class="ob-pulse"></div></div>`);
      Api.Realtime.on(msg => {
        if(this.step !== "nameNest" || msg.type !== "nest.proposed") return;
        const s = this.sheet(`<div class="ob-card">
          <p class="ob-h">They suggest</p>
          <label class="f"><span>Our nest is called</span>
            <input id="ob-nn" maxlength="20" value="${esc(msg.payload.name)}"></label>
          <p class="s dim">Keep it or change it. Either way it is yours.</p>
          <button class="btn go" id="ob-ok">That is the one</button></div>`);
        s.querySelector("#ob-ok").onclick = async () => {
          const name = s.querySelector("#ob-nn").value.trim() || msg.payload.name;
          await Api.call("POST", "/nests/" + me.nest.id + "/name", { name });
          this.go("firstRitual", me);
        };
      });
    }
  },

  /* ---------- S8 first ritual, then first placement ---------- */
  s_firstRitual(){
    const me = this.ctx;
    const q = RITUAL_QUESTIONS[Math.floor(Math.random() * RITUAL_QUESTIONS.length)];
    this.top(null);
    const s = this.sheet(`<div class="ob-card">
      <p class="ob-h">${esc(q.q)}</p>
      <p class="s dim">You both answer. This is the thing you will do every day.</p>
      <div class="opts" id="ob-opts"></div></div>`);
    const opts = s.querySelector("#ob-opts");
    let mine = null, theirs = null;
    const settle = () => {
      if(mine === null || theirs === null) return;
      App.ensureGame(me.nest.id);
      App.game.wallet.coins += 40;
      App.game.wallet.lifetimeEarned += 40;
      App.game.bond += 1;
      App.game.house.inventory = STARTER_ITEMS.map(id => ({ instanceId:"start_" + id, itemId:id }));
      App.saveGame();
      Track.fire("first_ritual_completed");
      this.sheet(`<div class="ob-card mid">
        <p class="ob-h">${mine === theirs ? "The same answer" : "Two different answers"}</p>
        <p class="s dim">40 coins and your first bond. Now put something in the room.</p>
        <button class="btn go" id="ob-place">Place it</button></div>`);
      $("#ob-place").onclick = () => this.go("firstPlace", me);
    };
    q.o.forEach((text, i) => {
      const b = el(`<button class="opt">${esc(text)}</button>`);
      b.onclick = () => {
        if(mine !== null) return;
        mine = i;
        b.dataset.state = "pick";
        Api.Realtime.emit("ritual.answered", { nest_id:me.nest.id, i });
        if(theirs === null) s.querySelector(".dim").textContent = "Waiting for " +
          (me.membership.role === "founder" ? this.partnerNames(me).partnerB : this.partnerNames(me).partnerA) + ".";
        settle();
      };
      opts.appendChild(b);
    });
    Api.Realtime.on(msg => {
      if(this.step !== "firstRitual" || msg.type !== "ritual.answered") return;
      theirs = msg.payload.i;
      settle();
    });
  },

  /* placing the first item is the tutorial. One pulsing target, no text wall. */
  s_firstPlace(){
    const me = this.ctx;
    // aim at the room as well as zooming, or the pulsing tile can sit off screen
    Diorama.flyTo({ zoomK:Diorama.ZOOM_K[2] * 1.2, target:Diorama.roomCentre("living"), ms:900 });
    const item = App.game.house.inventory[0];
    this.top(`<div class="ob-tourbar">Tap the glowing tile</div>`);
    this.sheet(null);
    Diorama.setHeld(item.itemId, 0);
    Diorama.pulseTarget({ room:"living", x:2, y:5 });
    Diorama.onPlace = spot => {
      App.game.house.placed.push({ instanceId:item.instanceId, itemId:item.itemId,
        room:spot.room, x:spot.x, y:spot.y, rot:0 });
      App.game.house.inventory = App.game.house.inventory.filter(i => i.instanceId !== item.instanceId);
      Diorama.addProp(App.game.house.placed[App.game.house.placed.length - 1]);
      Diorama.setHeld(null);
      Diorama.pulseTarget(null);
      App.saveGame();
      Track.fire("first_item_placed");
      Diorama.flyTo({ zoomK:Diorama.ZOOM_K[1], target:Diorama.lotCentre(), ms:1400 });
      setTimeout(() => this.go("push", me), 900);
    };
  },

  /* ---------- S9 notification permission ---------- */
  s_push(){
    const me = this.ctx;
    const partner = me.membership.role === "founder" ? this.partnerNames(me).partnerB : this.partnerNames(me).partnerA;
    Track.fire("push_primer_shown");
    this.top(null);
    const s = this.sheet(`<div class="ob-card">
      <p class="ob-h">One last thing</p>
      <p class="s dim">We will only ping you when ${esc(partner)} does something in your nest,
        or when it is time for your daily moment.</p>
      <button class="btn go" id="ob-ok">Sounds good</button>
      <button class="ob-quiet" id="ob-not">Not now</button></div>`);
    s.querySelector("#ob-ok").onclick = async () => {
      let granted = false;
      try{
        if(typeof Notification !== "undefined"){
          const r = await Notification.requestPermission();
          granted = r === "granted";
        }
      }catch(err){ /* the system said no for us */ }
      Track.fire(granted ? "push_granted" : "push_denied", { via:"primer" });
      this.done(me);
    };
    s.querySelector("#ob-not").onclick = () => {
      Track.fire("push_denied", { via:"not_now" });
      try{ localStorage.setItem("nest.push_snooze", String(Date.now() + PUSH_SNOOZE)); }catch(err){ /* fine */ }
      this.done(me);
    };
  },
  async done(me){
    this.finish();
    App.enter(await Api.call("GET", "/nests/mine"));
  },

  /* ---------- section 5, the waiting state ---------- */
  s_waiting(me){
    me = me || this.ctx || {};
    const nest = me.nest || this.ctx.nest;
    Diorama.orbit = 1.5 * Math.PI / 180;
    this.showEmptyNest(nest);
    this.top(null);
    const invite = me.invite || this.ctx.invite;
    const s = this.sheet(`<div class="ob-card">
      <p class="ob-h">Waiting for your partner to join.</p>
      <p class="s dim">A nest is not a nest with one person in it.</p>
      <button class="btn go" id="ob-resend">Send the invite again</button>
      <p class="lbl">The base and the ground, while you wait</p>
      <div class="ob-swatches" id="ob-base"></div>
      <div class="ob-swatches" id="ob-terr"></div>
      <button class="ob-quiet" id="ob-else">Invite someone else</button></div>`);
    s.querySelector("#ob-resend").onclick = async () => {
      const fresh = invite && invite.status === "open" ? invite
        : (await Api.call("POST", "/invites/" + (invite ? invite.code : "AAAAAA") + "/revoke", {})).invite;
      this.go("invite", { nest, invite:fresh });
    };
    s.querySelector("#ob-else").onclick = async () => {
      const r = await Api.call("POST", "/invites/" + (invite ? invite.code : "AAAAAA") + "/revoke", {});
      toast("Fresh code, clean slate");
      this.go("invite", { nest, invite:r.invite });
    };
    const swatch = (host, list, current, apply) => {
      list.forEach(o => {
        const b = el(`<button class="ob-sw" aria-current="${current === o.id}"
          style="background:${PALETTE[o.colour]}"><span>${esc(o.name)}</span></button>`);
        b.onclick = async () => { await apply(o.id); this.go("waiting", await Api.call("GET", "/nests/mine")); };
        host.appendChild(b);
      });
    };
    swatch(s.querySelector("#ob-base"), BASE_MATERIALS, nest.base_material,
      id => Api.call("POST", "/nests/" + nest.id + "/settings", { base_material:id }));
    swatch(s.querySelector("#ob-terr"), TERRAIN_TYPES, nest.terrain_type,
      id => Api.call("POST", "/nests/" + nest.id + "/settings", { terrain_type:id }));

    this.watchForClaim(nest.id);
    this.pollPair(nest.id);
    this.scheduleNudges(nest, invite);
  },
  showEmptyNest(nest){
    const rooms = Object.fromEntries(ROOMS.map(r => [r.id, { unlocked:r.id === "living" }]));
    this.demoShown = false;
    Diorama.setBase(nest.base_material, nest.terrain_type);
    Diorama.setLot({ rooms, placed:[] }, null, "");
    Diorama.applyState("resting", seasonNow());
    Diorama.setZoomK(Diorama.ZOOM_K[1]);      // frame the whole dome, it is the point
    Diorama.flyTo({ zoomK:Diorama.ZOOM_K[1], target:Diorama.lotCentre(), ms:700 });
  },

  /* Nudges go to the founder only. Nothing is ever sent to the person who
     has not opted in, in any scenario, ever. */
  scheduleNudges(nest, invite){
    clearTimeout(this.nudgeTimer);
    const key = "nest.nudges." + nest.id;
    let sent = [];
    try{ sent = JSON.parse(localStorage.getItem(key) || "[]"); }catch(err){ sent = []; }
    const since = Date.now() - nest.created_at;
    const due = NUDGES.findIndex((n, i) => sent.indexOf(i) < 0 && since >= n.at);
    if(due >= 0 && sent.length < 3){
      sent.push(due);
      try{ localStorage.setItem(key, JSON.stringify(sent)); }catch(err){ /* fine */ }
      App.notify(NUDGES[due].copy);
    }
    const next = NUDGES.findIndex((n, i) => sent.indexOf(i) < 0);
    if(next >= 0 && sent.length < 3){
      this.nudgeTimer = setTimeout(() => this.scheduleNudges(nest, invite),
        Math.max(4000, NUDGES[next].at - since));
    }
  },

  /* ---------- shared bits ---------- */
  codeBoxes(host, n, mode, onFull){
    host.innerHTML = "";
    const inputs = [];
    for(let i = 0; i < n; i++){
      const inp = el(`<input class="ob-box" maxlength="1" inputmode="${mode === "numeric" ? "numeric" : "text"}"
        autocomplete="${mode === "numeric" ? "one-time-code" : "off"}" aria-label="character ${i + 1}">`);
      inp.oninput = () => {
        inp.value = mode === "numeric" ? inp.value.replace(/\D/g, "") : inp.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
        if(inp.value && inputs[i + 1]) inputs[i + 1].focus();
        const all = inputs.map(x => x.value).join("");
        if(all.length === n) onFull(all);
      };
      inp.onkeydown = e => {
        if(e.key === "Backspace" && !inp.value && inputs[i - 1]) inputs[i - 1].focus();
      };
      inp.onpaste = e => {
        e.preventDefault();
        const t = (e.clipboardData.getData("text") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, n);
        t.split("").forEach((c, k) => { if(inputs[k]) inputs[k].value = c; });
        if(t.length === n) onFull(t);
        else if(inputs[t.length]) inputs[t.length].focus();
      };
      inputs.push(inp);
      host.appendChild(inp);
    }
    setTimeout(() => inputs[0].focus(), 60);
    return { set(v){ v.split("").forEach((c, k) => { if(inputs[k]) inputs[k].value = c; }); } };
  },
  showError(scope, msg){
    const e = scope.querySelector("#ob-err");
    if(!e) return toast(msg);
    e.hidden = false;
    e.textContent = msg;
  },
  inlineError(scope, msg){ this.showError(scope, msg); },
};
