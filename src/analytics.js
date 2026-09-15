/* NEST :: the funnel. Onboarding spec section 9.
   These names are fired exactly as written. Anything not on this list is
   not an event, so the funnel cannot drift from the spec by accident. */
"use strict";

const EVENTS = [
  "install",
  "intro_started", "intro_skipped", "intro_completed",
  "auth_started", "auth_completed", "auth_failed",
  "details_completed",
  "pair_fork_chosen",
  "invite_code_created",
  "invite_shared",
  "invite_link_opened",
  "code_entry_started", "code_entry_failed",
  "partner_confirm_shown", "partner_confirmed", "partner_declined",
  "nest_activated",                 // north star
  "ceremony_completed",
  "first_ritual_completed",
  "first_item_placed",
  "push_primer_shown", "push_granted", "push_denied",
  /* Not part of the funnel, but a device can now be handed back rather than
     only left or deleted, and how often that happens is worth knowing. */
  "signed_out",
];
const EVENT_SET = new Set(EVENTS);
const TRACK_KEY = "nest.analytics.v1";

const Track = {
  log: [],
  load(){
    try{ this.log = JSON.parse(localStorage.getItem(TRACK_KEY) || "[]"); }
    catch(err){ this.log = []; }
  },
  save(){
    try{ localStorage.setItem(TRACK_KEY, JSON.stringify(this.log.slice(-400))); }catch(err){ /* fine */ }
  },
  fire(name, props){
    if(!EVENT_SET.has(name)){ console.warn("event not in the spec:", name); return; }
    this.log.push({ name, props:props || {}, at:Date.now(), user:Api.Session.userId });
    if(typeof Monitor !== "undefined") Monitor.event(name, props);
    this.save();
  },
  /* fires once ever per device, so funnel denominators stay honest */
  once(name, props){
    if(this.log.some(e => e.name === name)) return;
    this.fire(name, props);
  },
  count(name){ return this.log.filter(e => e.name === name).length; },
  first(name){ return this.log.find(e => e.name === name); },
  last(name){ return [...this.log].reverse().find(e => e.name === name); },

  /* the two numbers the spec asks to report */
  pairedActivationRate(){
    const installs = Math.max(1, this.count("install"));
    return this.count("nest_activated") / installs;
  },
  inviteLatency(){
    const shared = this.first("invite_shared"), activated = this.first("nest_activated");
    if(!shared || !activated) return null;
    return activated.at - shared.at;
  },
  funnel(){
    const steps = [
      ["install", "install"],
      ["intro_completed", "intro seen"],
      ["auth_completed", "authenticated"],
      ["details_completed", "details given"],
      ["pair_fork_chosen", "chose a path"],
      ["invite_code_created", "code created"],
      ["invite_shared", "invite shared"],
      ["partner_confirm_shown", "confirm shown"],
      ["nest_activated", "nest activated"],
      ["ceremony_completed", "ceremony done"],
      ["first_ritual_completed", "first ritual"],
      ["first_item_placed", "first item"],
      ["push_granted", "push granted"],
    ];
    return steps.map(([name, label]) => ({ name, label, n:this.count(name) }));
  },
  clear(){ this.log = []; this.save(); },
};
Track.load();
