/* NEST :: master palette, art bible section 9.
   Every colour in the product comes from this table. Nothing else is legal. */
"use strict";

const PALETTE = {
  // neutrals and grounds
  cream:    "#FBF3E7",
  oat:      "#EFE1CD",
  warmSand: "#DCC7A8",
  softClay: "#C4A78B",
  cocoa:    "#8A6E58",
  ink:      "#4A4038",
  // pastel field
  blush:    "#F5C9C6",
  peach:    "#F7C9A3",
  butter:   "#F6E3A8",
  sage:     "#BFD6B4",
  mist:     "#B9D3DC",
  lilac:    "#CFC2E0",
  // accents, at most one per prop, under 10 percent of visible surface
  coral:    "#F2735F",
  marigold: "#F2A33C",
  deepTeal: "#2F7A73",
  plum:     "#7A4A6B",
};
const ACCENTS = ["coral", "marigold", "deepTeal", "plum"];
const IS_ACCENT = name => ACCENTS.indexOf(name) >= 0;

/* Sky is two stops, never a texture. Section 5. */
const SEASON_STATES = {
  new:     { label:"New",     sky:["#EAF0F2","#FBF3E7"], key:"#FFF1DC", keyI:0.95, fill:"#DDE9EE", fillI:0.42,
             terrain:"sage",  motes:0,   shafts:0,   growth:0.35, note:"Fresh ground, clear glass." },
  steady:  { label:"Steady",  sky:["#DDEBF0","#FBF0DE"], key:"#FFE9C4", keyI:1.05, fill:"#D6E6EC", fillI:0.38,
             terrain:"sage",  motes:70,  shafts:0,   growth:0.7,  note:"Motes drifting, flowers coming in." },
  strong:  { label:"Strong",  sky:["#F3D9B0","#F7C9A3"], key:"#FFDCA6", keyI:1.12, fill:"#E4D7C6", fillI:0.34,
             terrain:"sage",  motes:170, shafts:1,   growth:1.0,  note:"Late golden light, everything in bloom." },
  resting: { label:"Resting", sky:["#DDE3E6","#EFE8DE"], key:"#F0EDE8", keyI:0.8,  fill:"#D9E0E4", fillI:0.55,
             terrain:"sage",  motes:26,  shafts:0,   growth:0.6,  note:"A quiet week. Soft light, still growing." },
};

/* Seasonal overrides rotate with the real calendar and sit on top of state. */
const SEASONS = {
  blossom: { months:[2,3,4],    tint:"blush",  ground:"sage",     fleck:"#F5C9C6", label:"Blossom" },
  clear:   { months:[5,6,7],    tint:"butter", ground:"sage",     fleck:"#F6E3A8", label:"Clear"   },
  autumn:  { months:[8,9,10],   tint:"peach",  ground:"softClay", fleck:"#F2A33C", label:"Autumn"  },
  snow:    { months:[11,0,1],   tint:"mist",   ground:"oat",      fleck:"#FFFFFF", label:"Snow"    },
};
function seasonNow(date){
  const m = (date || new Date()).getMonth();
  for(const k in SEASONS) if(SEASONS[k].months.indexOf(m) >= 0) return { id:k, ...SEASONS[k] };
  return { id:"clear", ...SEASONS.clear };
}

/* Section 10. Resting is for couples who paused. It must read calm, never punished. */
function domeState(streak, daysSinceCheckIn){
  if(daysSinceCheckIn > 2) return "resting";
  if(streak >= 10) return "strong";
  if(streak >= 3) return "steady";
  return "new";
}
