/* NEST :: sound. The game had none at all.

   Everything here is synthesised with Web Audio rather than loaded, so there
   are no files to fetch, no licences to track and nothing to wait for. Every
   sound is short, soft and pitched to the same warm major scale, because the
   art direction is a small object held in the hand and a clattering game
   show would break it. Nothing plays until the person has touched the
   screen, which is also what browsers require. */
"use strict";

const Sound = {
  KEY: "nest.sound_muted",
  ctx: null,
  master: null,

  muted(){
    try{ return localStorage.getItem(this.KEY) === "1"; }catch(err){ return false; }
  },
  setMuted(v){
    try{ localStorage.setItem(this.KEY, v ? "1" : "0"); }catch(err){ /* memory only */ }
    if(v && this.ctx) this.ctx.suspend().catch(() => {});
  },

  ensure(){
    if(this.muted()) return null;
    try{
      if(!this.ctx){
        const C = window.AudioContext || window.webkitAudioContext;
        if(!C) return null;
        this.ctx = new C();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.45;
        this.master.connect(this.ctx.destination);
      }
      if(this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      return this.ctx;
    }catch(err){ return null; }
  },

  /* one soft note: a quick rise and an exponential fall, which reads as a
     tap on ceramic rather than a beep */
  tone(freq, at, dur, type, vol){
    const c = this.ctx;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, at);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol || 0.15, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(this.master);
    o.start(at); o.stop(at + dur + 0.03);
  },

  SOUNDS: {
    tap:    (s, t) => s.tone(660, t, 0.07, "triangle", 0.06),
    pick:   (s, t) => s.tone(523, t, 0.1, "triangle", 0.1),
    place:  (s, t) => { s.tone(196, t, 0.2, "sine", 0.22); s.tone(392, t + 0.02, 0.12, "triangle", 0.07); },
    coins:  (s, t) => [988, 1319].forEach((f, i) => s.tone(f, t + i * 0.07, 0.18, "triangle", 0.1)),
    buy:    (s, t) => [523, 659, 784].forEach((f, i) => s.tone(f, t + i * 0.06, 0.2, "sine", 0.12)),
    unlock: (s, t) => [392, 523, 659, 784, 1047].forEach((f, i) => s.tone(f, t + i * 0.08, 0.34, "sine", 0.1)),
    reveal: (s, t) => [659, 784, 988].forEach((f, i) => s.tone(f, t + i * 0.12, 0.55, "sine", 0.1)),
    match:  (s, t) => [784, 1047].forEach((f, i) => s.tone(f, t + i * 0.05, 0.14, "triangle", 0.09)),
    miss:   (s, t) => s.tone(262, t, 0.14, "sine", 0.07),
    error:  (s, t) => [330, 262].forEach((f, i) => s.tone(f, t + i * 0.09, 0.16, "sine", 0.08)),
  },

  play(name){
    const fn = this.SOUNDS[name];
    if(!fn) return;
    const c = this.ensure();
    if(!c) return;
    try{ fn(this, c.currentTime + 0.01); }catch(err){ /* sound never breaks the app */ }
  },
};
