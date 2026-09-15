/* NEST :: advertising. Off until it is configured in site-config.js.

   Where ads may go is a design decision, not a slot count: never over the
   dome, never during onboarding, never in the middle of a game or a ritual,
   and always labelled. So there are exactly two placements, both cards in the
   sheet the player scrolls anyway: the foot of the Play list and part way
   down the street.

   Requests are non personalised, which is what the privacy policy promises.
   Google AdSense only approves a site on a domain you own, so this stays dark
   on a vercel.app address; in a native build the same two placements would
   use AdMob instead. */
"use strict";

const Ads = {
  loaded: false,

  cfg(){ return (window.NEST_SITE && window.NEST_SITE.ads) || {}; },

  enabled(){
    const c = this.cfg();
    return c.provider === "adsense" && /^ca-pub-\d{10,20}$/.test(c.client || "") && /^\d{6,12}$/.test(c.slot || "");
  },

  load(){
    if(this.loaded) return;
    this.loaded = true;
    const q = window.adsbygoogle = window.adsbygoogle || [];
    q.requestNonPersonalizedAds = 1;
    const s = document.createElement("script");
    s.async = true;
    s.crossOrigin = "anonymous";
    s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(this.cfg().client);
    document.head.appendChild(s);
  },

  slot(root, placement){
    if(!root || !this.enabled()) return;
    this.load();
    const c = this.cfg();
    const card = document.createElement("div");
    card.className = "card adcard";
    card.innerHTML = '<p class="lbl" style="margin:0 0 6px">Advertisement</p>';
    const ins = document.createElement("ins");
    ins.className = "adsbygoogle";
    ins.style.display = "block";
    ins.setAttribute("data-ad-client", c.client);
    ins.setAttribute("data-ad-slot", c.slot);
    ins.setAttribute("data-ad-format", "auto");
    ins.setAttribute("data-full-width-responsive", "true");
    ins.dataset.placement = placement;
    card.appendChild(ins);
    root.appendChild(card);
    try{ (window.adsbygoogle = window.adsbygoogle || []).push({}); }
    catch(err){ card.remove(); }
  },
};
