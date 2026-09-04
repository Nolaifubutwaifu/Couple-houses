/* NEST :: art bible section 16, as code.
   A checklist read once is a checklist nobody follows. These run over every
   prop in the catalogue and report, so a rule that cannot hold shows up now. */
"use strict";

const SILHOUETTE_VIEW = 1.5;   // metres of half frame, shared by every prop
const BUDGETS = { small:[200, 600], medium:[600, 1800], large:[1800, 4500], shell:[6000, 9000] };
const LOT_BUDGET = 100000;

function runBibleChecks(){
  const rows = [];
  const hashes = {};
  CATALOGUE.forEach(def => {
    buildProp(def.id);                                   // populates def.colours via mat()
    const tris = propTriangles(def.id);
    const budget = BUDGETS[def.cls];
    // readability is judged with the prop framed to fill 64px, section 6
    const mask = Offscreen.mask(def.id, 64, 0);
    // distinctness has to be judged at a shared world scale, otherwise every
    // prop fills the frame and a mug reads like a sofa
    // shape, not size: crop the silhouette to its own bounds before comparing,
    // which is what "identifiable as a black shape" actually means
    const bits = shapeHash(Offscreen.mask(def.id, 64, 0), 12);
    // yaw is free now, so four sample angles no longer cover what a player sees
    const yaws = [];
    for(let i = 0; i < 8; i++) yaws.push(Offscreen.mask(def.id, 48, i * Math.PI / 4).filled);

    let nearest = null, nearestD = 999;
    for(const other in hashes){
      const d = hamming(bits, hashes[other]);
      if(d < nearestD){ nearestD = d; nearest = other; }
    }
    const checks = {
      palette:   def.colours.every(c => !!PALETTE[c]),
      oneAccent: def.accentsUsed.length <= 1,
      budget:    tris <= budget[1],
      silhouette: mask.filled > 0.03 && mask.filled < 0.8,
      unique:    nearestD >= 6,
      allYaws:   yaws.every(f => f > 0.02),
    };
    const warn = tris < budget[0] ? "thin for a " + def.cls + " prop" : null;
    hashes[def.id] = bits;
    rows.push({ id:def.id, name:def.name, cls:def.cls, tris, budget, fill:mask.filled, warn,
                nearest, nearestD, accents:def.accentsUsed, checks,
                pass:Object.values(checks).every(Boolean) });
  });
  const lotTris = rows.reduce((n, r) => n + r.tris, 0);
  return { rows, lotTris, lotBudget:LOT_BUDGET, passed:rows.filter(r => r.pass).length,
           warned:rows.filter(r => r.warn).length, total:rows.length };
}

/* crop to the silhouette's bounding box, then resample to a to x to grid */
function shapeHash(mask, to){
  const n = mask.size;
  let minX = n, maxX = -1, minY = n, maxY = -1;
  for(let y = 0; y < n; y++) for(let x = 0; x < n; x++){
    if(!mask.bits[y * n + x]) continue;
    if(x < minX) minX = x; if(x > maxX) maxX = x;
    if(y < minY) minY = y; if(y > maxY) maxY = y;
  }
  if(maxX < 0) return new Array(to * to).fill(0);
  const w = maxX - minX + 1, h = maxY - minY + 1, out = [];
  for(let j = 0; j < to; j++) for(let i = 0; i < to; i++){
    let on = 0, count = 0;
    for(let dy = 0; dy < h / to; dy++) for(let dx = 0; dx < w / to; dx++){
      const sx = minX + Math.floor(i * w / to + dx), sy = minY + Math.floor(j * h / to + dy);
      on += mask.bits[sy * n + sx]; count++;
    }
    out.push(on > count / 3 ? 1 : 0);
  }
  return out;
}
function downsample(mask, to){
  const step = mask.size / to, out = [];
  for(let y = 0; y < to; y++){
    for(let x = 0; x < to; x++){
      let on = 0;
      for(let j = 0; j < step; j++) for(let i = 0; i < step; i++)
        on += mask.bits[Math.floor(y * step + j) * mask.size + Math.floor(x * step + i)];
      out.push(on > (step * step) / 4 ? 1 : 0);
    }
  }
  return out;
}

const CHECK_LABELS = {
  palette:"master palette only", oneAccent:"at most one accent", budget:"inside triangle budget",
  silhouette:"reads at 64px", unique:"distinct silhouette", allYaws:"reads at all eight yaws",
};

function hamming(a, b){
  let d = 0;
  for(let i = 0; i < a.length; i++) if(a[i] !== b[i]) d++;
  return d;
}
