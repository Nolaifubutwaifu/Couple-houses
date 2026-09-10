/* NEST :: geometry. Art bible sections 6 and 7.
   One primitive builds everything, so the mandatory bevel is structural
   rather than something an artist can forget. */
"use strict";

const TILE = 0.5;          // section 6: floor tiles are 0.5 units
const SNAP = 0.25;         // props snap to the 0.25 grid
const CHUNK = 1.15;        // section 6 proportion rule
const BEVEL = 0.018;       // 0.01 to 0.02 units

/* ---- toon ramp, section 7. A light ramp, not a hard cel edge. ---- */
let RAMP = null;
function toonRamp(){
  if(RAMP) return RAMP;
  const c = document.createElement("canvas");
  c.width = 4; c.height = 1;
  const x = c.getContext("2d");
  ["#786c63", "#a2968b", "#c9beb2", "#ece4d9"].forEach((v, i) => { x.fillStyle = v; x.fillRect(i, 0, 1, 1); });
  RAMP = new THREE.CanvasTexture(c);
  RAMP.minFilter = RAMP.magFilter = THREE.NearestFilter;
  return RAMP;
}

/* ---- materials. Matte clay only. Metallic does not exist. ---- */
const _mats = {};
let _watch = null;            // collects colour names while a prop is building
function mat(name){
  if(!PALETTE[name]) throw new Error("colour outside the master palette: " + name);
  if(_watch) _watch.add(name);
  if(!_mats[name]) _mats[name] = new THREE.MeshToonMaterial({ color:PALETTE[name], gradientMap:toonRamp() });
  return _mats[name];
}
function fabricMat(name){
  // section 7: base clay plus a subtle fuzz rim
  const key = name + "|fuzz";
  if(_watch) _watch.add(name);
  if(!_mats[key]){
    const m = new THREE.MeshToonMaterial({ color:PALETTE[name], gradientMap:toonRamp() });
    m.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        "#include <dithering_fragment>\n  float fuzz = pow(1.0 - abs(dot(normalize(vNormal), vec3(0.0,0.0,1.0))), 3.0);\n  gl_FragColor.rgb += fuzz * 0.15;"
      );
    };
    _mats[key] = m;
  }
  return _mats[key];
}

/* ---- the one primitive. Every visible edge is bevelled. ---- */
const _geoCache = {};
function bevelBox(w, h, d, b){
  b = b === undefined ? BEVEL : b;
  b = Math.min(b, w / 2.5, h / 2.5, d / 2.5);
  const key = [w, h, d, b].map(v => v.toFixed(3)).join("_");
  void 0;
  if(_geoCache[key]) return _geoCache[key];
  const cheap = Math.min(w, h, d) < 0.085;
  const iw = w - 2 * b, ih = h - 2 * b, r = Math.min(b * 2.2, iw / 2, ih / 2);
  const s = new THREE.Shape();
  s.moveTo(-iw / 2 + r, -ih / 2);
  s.lineTo(iw / 2 - r, -ih / 2);
  s.absarc(iw / 2 - r, -ih / 2 + r, r, -Math.PI / 2, 0, false);
  s.lineTo(iw / 2, ih / 2 - r);
  s.absarc(iw / 2 - r, ih / 2 - r, r, 0, Math.PI / 2, false);
  s.lineTo(-iw / 2 + r, ih / 2);
  s.absarc(-iw / 2 + r, ih / 2 - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-iw / 2, -ih / 2 + r);
  s.absarc(-iw / 2 + r, -ih / 2 + r, r, Math.PI, Math.PI * 1.5, false);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: d - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b,
    bevelSegments: cheap ? 1 : 2, curveSegments: cheap ? 1 : 2,
  });
  geo.translate(0, 0, -(d / 2 - b));
  geo.computeVertexNormals();
  _geoCache[key] = geo;
  return geo;
}
function lathe(profile, seg){
  const key = "lathe_" + seg + "_" + profile.map(p => p.x.toFixed(2) + "," + p.y.toFixed(2)).join(";");
  if(_geoCache[key]) return _geoCache[key];
  _geoCache[key] = new THREE.LatheGeometry(profile.map(p => new THREE.Vector2(p.x, p.y)), seg || 18);
  return _geoCache[key];
}

/* ---- placement helpers. Origin at floor contact, section 15. ---- */
function box(w, h, d, colour, x, y, z, opts){
  const m = new THREE.Mesh(bevelBox(w, h, d), (opts && opts.fabric) ? fabricMat(colour) : mat(colour));
  m.position.set(x, y + h / 2, z);
  if(opts){
    if(opts.rx) m.rotation.x = opts.rx;
    if(opts.ry) m.rotation.y = opts.ry;
    if(opts.rz) m.rotation.z = opts.rz;
    if(opts.sway) m.userData.sway = opts.sway;
    if(opts.centred) m.position.y = y;
  }
  return m;
}
function cyl(rTop, rBot, h, colour, x, y, z, seg){
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg || 14), mat(colour));
  m.position.set(x, y + h / 2, z);
  return m;
}
function ball(r, colour, x, y, z, seg){
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg || 12, (seg || 12) / 2), mat(colour));
  m.position.set(x, y, z);
  return m;
}
function legs(g, w, d, h, colour, t){
  t = t || 0.09;   // legs thickened roughly 40 percent over life, section 6
  [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([sx, sz]) => {
    g.add(box(t, h, t, colour, sx * (w / 2 - t), 0, sz * (d / 2 - t)));
  });
}
function pottedPlant(g, x, z, potColour, leafColour, scale, leaves){
  const s = scale || 1, n = leaves || 5;
  g.add(cyl(0.15 * s, 0.12 * s, 0.22 * s, potColour, x, 0, z));
  for(let i = 0; i < n; i++){
    const a = (i / n) * Math.PI * 2;
    const leaf = box(0.20 * s, 0.26 * s, 0.05 * s, leafColour, x + Math.cos(a) * 0.11 * s, 0.22 * s + i * 0.055 * s, z + Math.sin(a) * 0.11 * s,
      { ry:a, rz:Math.cos(a) * 0.35, sway:0.05 });
    g.add(leaf);
  }
}
function artFrame(w, h, frameColour, panelColour){
  const g = new THREE.Group();
  g.add(box(w, h, 0.05, frameColour, 0, 0, 0));
  g.add(box(w - 0.09, h - 0.09, 0.03, panelColour, 0, 0, 0.03));
  return g;
}

/* ---- the catalogue. Ids, prices and charm carry over from the first build,
   so the economy transfers untouched. cls drives the triangle budget. ---- */
const CATALOGUE = [
  /* LIVING */
  { id:"sofa", name:"Sofa", price:410, charm:8, w:4, h:2, room:"living", cls:"large", build(g){
      g.add(box(2.0, 0.34, 0.95, "oat", 0, 0.28, 0, { fabric:true }));
      g.add(box(2.0, 0.52, 0.24, "oat", 0, 0.62, -0.36, { fabric:true }));
      [-0.88, 0.88].forEach(x => g.add(box(0.22, 0.46, 0.95, "oat", x, 0.28, 0, { fabric:true })));
      [-0.5, 0.5].forEach(x => g.add(box(0.34, 0.1, 0.3, "coral", x, 0.62, -0.2, { rx:-0.5, fabric:true })));
      legs(g, 2.0, 0.95, 0.28, "cocoa");
    } },
  { id:"tv", name:"Big TV", price:530, charm:7, w:3, h:1, room:"living", cls:"medium", build(g){
      g.add(box(1.4, 0.5, 0.36, "warmSand", 0, 0, 0));
      g.add(box(1.32, 0.78, 0.08, "ink", 0, 0.5, -0.1));
      g.add(box(1.2, 0.66, 0.03, "mist", 0, 0.56, -0.05));
      g.add(box(0.3, 0.06, 0.2, "ink", 0, 0.5, -0.1));
      g.add(box(0.9, 0.09, 0.14, "cocoa", 0, 0.36, 0.1));
      [-0.5, 0.5].forEach(x => g.add(box(0.26, 0.2, 0.22, "oat", x, 0.06, 0.06)));
      g.add(box(1.36, 0.05, 0.4, "cocoa", 0, 0.5, 0));
    } },
  { id:"armchair", name:"Armchair", price:220, charm:4, w:2, h:2, room:"living", cls:"medium", build(g){
      g.add(box(0.72, 0.3, 0.72, "blush", 0, 0.3, 0, { fabric:true }));
      g.add(box(0.72, 0.5, 0.2, "blush", 0, 0.6, -0.26, { fabric:true }));
      [-0.3, 0.3].forEach(x => g.add(box(0.14, 0.4, 0.72, "blush", x, 0.3, 0, { fabric:true })));
      legs(g, 0.72, 0.72, 0.3, "cocoa", 0.07);
    } },
  /* Day one ends with 300 coins and a living room. Without something under
     that line which is not already in the starter set, the shop is shut on the
     evening the couple is most likely to look at it.
     Round on a pedestal rather than a slab on four legs: a low rectangle on
     legs reads as the garden bench at 64px, and section 16 says so out loud. */
  { id:"cofftbl", name:"Coffee Table", price:260, charm:5, w:2, h:1, room:"living", cls:"medium", build(g){
      g.add(cyl(0.6, 0.6, 0.08, "warmSand", 0, 0.34, 0, 28));    // top
      g.add(cyl(0.56, 0.58, 0.04, "cocoa", 0, 0.3, 0, 28));      // rim under the top
      g.add(cyl(0.09, 0.12, 0.3, "cocoa", 0, 0, 0, 16));         // stem
      g.add(cyl(0.3, 0.34, 0.05, "cocoa", 0, 0, 0, 24));         // foot
      g.add(cyl(0.08, 0.07, 0.12, "marigold", -0.2, 0.42, 0.1, 12));
      g.add(box(0.26, 0.05, 0.2, "sage", 0.16, 0.42, -0.08));
      g.add(box(0.24, 0.04, 0.18, "mist", 0.16, 0.47, -0.04, { ry:0.22 }));
    } },
  { id:"books", name:"Bookshelf", price:350, charm:6, w:2, h:1, room:"living", cls:"large", build(g){
      [-0.41, 0.41].forEach(x => g.add(box(0.08, 1.42, 0.32, "cocoa", x, 0, 0)));
      [0, 0.4, 0.8, 1.2].forEach(y => g.add(box(0.9, 0.06, 0.32, "cocoa", 0, y, 0)));
      g.add(box(1.06, 0.1, 0.4, "cocoa", 0, 1.42, 0));           // cornice breaks the box
      [0.46, 0.86].forEach((y, row) => {
        for(let i = 0; i < 4; i++){
          const c = ["blush","sage","butter","mist","lilac"][(i + row) % 5];
          g.add(box(0.13, 0.3, 0.2, c, -0.27 + i * 0.18, y, 0.03));
        }
      });
      [0, 1, 2].forEach(i => g.add(box(0.14, 0.34, 0.2, ["butter","blush","sage"][i], -0.2 + i * 0.17, 1.26, 0.03, { rz:0.3 - i * 0.24 })));
    } },
  { id:"plant", name:"Fiddle Fig", price:190, charm:4, w:1, h:1, room:"living", cls:"medium", build(g){
      pottedPlant(g, 0, 0, "peach", "sage", 1.5, 7);
      g.add(cyl(0.04, 0.05, 0.55, "cocoa", 0, 0.3, 0, 8));
      g.add(box(0.24, 0.3, 0.06, "sage", 0.1, 0.72, 0.06, { rz:-0.5, sway:0.06 }));
    } },
  { id:"guitar", name:"Guitar", price:470, charm:7, w:1, h:1, room:"living", cls:"medium", build(g){
      g.add(box(0.4, 0.5, 0.13, "marigold", 0, 0.1, 0, { rz:0.12 }));
      g.add(box(0.26, 0.3, 0.13, "marigold", -0.03, 0.52, 0, { rz:0.12 }));
      g.add(box(0.09, 0.7, 0.07, "cocoa", -0.12, 0.72, 0, { rz:0.12 }));
      g.add(box(0.13, 0.16, 0.05, "ink", -0.2, 1.4, 0, { rz:0.12 }));
    } },
  { id:"console", name:"Game Corner", price:590, charm:9, w:2, h:1, room:"living", cls:"large", build(g){
      g.add(box(0.86, 0.09, 0.4, "warmSand", 0, 0.28, 0));
      g.add(box(0.86, 0.09, 0.4, "warmSand", 0, 0, 0));
      [-0.38, 0.38].forEach(x => g.add(box(0.09, 0.37, 0.36, "warmSand", x, 0, 0)));
      g.add(box(0.5, 0.07, 0.3, "ink", 0, 0.37, 0));
      g.add(box(0.1, 0.42, 0.1, "ink", 0, 0.44, -0.06));          // stem
      g.add(box(0.66, 0.42, 0.06, "ink", 0, 0.86, -0.06));        // screen on top, a T outline
      g.add(box(0.58, 0.34, 0.02, "mist", 0, 0.9, -0.02));
      g.add(box(0.22, 0.1, 0.15, "deepTeal", -0.26, 0.37, 0.06, { rz:0.2 }));
      g.add(box(0.22, 0.1, 0.15, "mist", 0.26, 0.37, 0.06, { rz:-0.2 }));
    } },
  { id:"fireplc", name:"Fireplace", price:1000, charm:14, w:3, h:2, room:"living", cls:"large", build(g){
      g.add(box(1.5, 1.15, 0.5, "softClay", 0, 0, 0));
      g.add(box(1.0, 0.62, 0.24, "ink", 0, 0.14, 0.16));
      g.add(box(1.66, 0.14, 0.62, "warmSand", 0, 1.15, 0));
      g.add(box(0.9, 1.1, 0.44, "softClay", 0, 1.29, -0.03));
      g.add(box(1.02, 0.12, 0.5, "warmSand", 0, 2.39, -0.03));
      [[-0.22, 0.2],[0.05, 0.28],[0.24, 0.18]].forEach(([x, h]) =>
        g.add(box(0.18, h, 0.12, "coral", x, 0.16, 0.2, { sway:0.09 })));
    } },

  /* KITCHEN */
  { id:"fridge", name:"Fridge", price:620, charm:7, w:2, h:2, room:"kitchen", cls:"medium", build(g){
      g.add(box(0.8, 1.14, 0.72, "cream", 0, 0, 0));
      g.add(box(0.66, 0.5, 0.62, "cream", -0.07, 1.14, 0));       // stepped freezer on top
      g.add(box(0.72, 0.1, 0.68, "mist", -0.07, 1.64, 0));
      g.add(box(0.1, 0.86, 0.09, "cocoa", 0.46, 0.16, 0.3));      // handle stands proud
      g.add(box(0.1, 0.3, 0.09, "cocoa", 0.33, 1.24, 0.28));
      g.add(box(0.78, 0.03, 0.02, "warmSand", 0, 1.12, 0.37));
    } },
  { id:"stove", name:"Stove", price:560, charm:7, w:2, h:2, room:"kitchen", cls:"medium", build(g){
      g.add(box(0.86, 0.9, 0.72, "oat", 0, 0, 0));
      g.add(box(0.86, 0.06, 0.72, "ink", 0, 0.9, 0));
      [[-0.2,-0.16],[0.2,-0.16],[-0.2,0.18],[0.2,0.18]].forEach(([x, z]) => g.add(cyl(0.11, 0.11, 0.03, "cocoa", x, 0.96, z)));
      g.add(box(0.6, 0.4, 0.03, "mist", 0, 0.34, 0.37));
      g.add(box(0.7, 0.05, 0.05, "cocoa", 0, 0.78, 0.4));
      g.add(box(0.26, 0.72, 0.22, "oat", 0, 1.16, -0.24));        // narrow flue
      g.add(box(0.92, 0.26, 0.5, "oat", 0, 1.88, -0.16, { rx:0.18 }));  // hood flares out
      g.add(box(0.8, 0.06, 0.4, "cream", 0, 1.82, -0.16));
    } },
  { id:"table", name:"Dining Table", price:740, charm:11, w:4, h:3, room:"kitchen", cls:"large", build(g){
      g.add(box(1.7, 0.1, 1.0, "cocoa", 0, 0.74, 0));
      legs(g, 1.6, 0.9, 0.74, "cocoa", 0.1);
      [[-0.55, 0.62],[0.55, -0.62]].forEach(([x, z]) => {
        g.add(box(0.4, 0.06, 0.4, "sage", x, 0.44, z));
        g.add(box(0.4, 0.46, 0.07, "sage", x, 0.5, z + (z > 0 ? 0.17 : -0.17)));
        g.add(box(0.12, 0.44, 0.12, "sage", x, 0, z));
      });
      g.add(cyl(0.11, 0.09, 0.16, "deepTeal", 0, 0.84, 0));
    } },
  { id:"coffee", name:"Coffee Bar", price:470, charm:8, w:2, h:1, room:"kitchen", cls:"medium", build(g){
      g.add(box(0.8, 0.92, 0.45, "warmSand", 0, 0, 0));
      g.add(box(0.86, 0.08, 0.5, "cream", 0, 0.92, 0));
      g.add(box(0.34, 0.44, 0.3, "deepTeal", -0.16, 1.0, 0));
      g.add(box(0.2, 0.06, 0.2, "cream", -0.16, 1.16, 0.16));
      [0.16, 0.3].forEach((x, i) => g.add(cyl(0.06, 0.05, 0.09, "blush", x + i * 0.02, 1.0, -0.08)));
    } },
  { id:"wine", name:"Wine Rack", price:660, charm:9, w:1, h:2, room:"kitchen", cls:"medium", build(g){
      [-0.24, 0.24].forEach(x => g.add(box(0.07, 1.16, 0.36, "cocoa", x, 0, 0)));
      [0, 0.56, 1.12].forEach(y => g.add(box(0.55, 0.07, 0.36, "cocoa", 0, y, 0)));
      [[-1, 0.06],[1, 0.06]].forEach(([d, y]) =>                 // crossed braces break the outline
        g.add(box(0.62, 0.05, 0.05, "cocoa", 0, 0.34, 0.17, { rz:d * 0.86 })));
      [0.14, 0.7].forEach(y => {
        for(let i = 0; i < 3; i++) g.add(cyl(0.055, 0.055, 0.3, "plum", -0.13 + i * 0.13, y, 0.02, 8));
      });
      for(let i = 0; i < 2; i++) g.add(cyl(0.05, 0.05, 0.42, "plum", -0.1 + i * 0.2, 1.19, 0.02, 8));
    } },
  { id:"bake", name:"Cake Stand", price:280, charm:5, w:1, h:1, room:"kitchen", cls:"small", build(g){
      g.add(cyl(0.06, 0.14, 0.12, "cream", 0, 0, 0));
      g.add(cyl(0.24, 0.24, 0.04, "cream", 0, 0.12, 0));
      g.add(cyl(0.17, 0.19, 0.16, "blush", 0, 0.16, 0));
      g.add(ball(0.035, "coral", 0, 0.35, 0));
    } },
  { id:"herbs", name:"Herb Shelf", price:220, charm:4, w:2, h:1, room:"kitchen", cls:"medium", build(g){
      g.add(box(0.9, 0.06, 0.24, "cocoa", 0, 0.9, 0));
      [-0.24, 0.24].forEach(x => pottedPlant(g, x, 0, "peach", "sage", 0.65, 3));
      g.children.forEach(c => { if(c.position.y < 0.9) c.position.y += 0.96; });
    } },

  /* BEDROOM */
  { id:"bed", name:"Double Bed", price:880, charm:13, w:3, h:4, room:"bedroom", cls:"large", build(g){
      g.add(box(1.45, 0.3, 1.95, "cocoa", 0, 0.16, 0));
      g.add(box(1.4, 0.24, 1.9, "cream", 0, 0.46, 0, { fabric:true }));
      g.add(box(1.4, 0.1, 1.15, "lilac", 0, 0.7, 0.34, { fabric:true }));
      [-0.34, 0.34].forEach(x => g.add(box(0.56, 0.14, 0.34, "cream", x, 0.7, -0.7, { fabric:true })));
      g.add(box(1.5, 0.85, 0.12, "cocoa", 0, 0.16, -1.0));
      [-0.68, 0.68].forEach(x => g.add(box(0.12, 1.5, 0.12, "cocoa", x, 0.16, -1.0)));
      [-0.68, 0.68].forEach(x => g.add(ball(0.08, "cocoa", x, 1.72, -1.0, 10)));
      legs(g, 1.4, 1.9, 0.16, "cocoa", 0.09);
    } },
  { id:"mirror", name:"Tall Mirror", price:370, charm:6, w:1, h:1, room:"bedroom", cls:"medium", build(g){
      // a cheval mirror: two posts, a tilted oval, an outline nothing else has
      [-0.32, 0.32].forEach(x => g.add(box(0.07, 1.32, 0.09, "cocoa", x, 0.06, 0)));
      g.add(box(0.72, 0.07, 0.3, "cocoa", 0, 0, 0));
      [-0.3, 0.3].forEach(x => g.add(box(0.3, 0.07, 0.3, "cocoa", x, 0, 0)));
      const glass = new THREE.Group();
      glass.add(cyl(0.28, 0.28, 0.06, "marigold", 0, -0.03, 0, 20));
      glass.add(cyl(0.23, 0.23, 0.03, "mist", 0, 0.02, 0.03, 20));
      glass.scale.set(1, 1, 1.9);
      glass.position.set(0, 0.78, 0);
      glass.rotation.x = Math.PI / 2 - 0.16;
      g.add(glass);
    } },
  { id:"lamp", name:"Warm Lamp", price:190, charm:4, w:1, h:1, room:"bedroom", cls:"small", build(g){
      g.add(cyl(0.14, 0.18, 0.05, "cocoa", 0, 0, 0));
      g.add(cyl(0.03, 0.03, 0.9, "cocoa", 0, 0.05, 0, 8));
      g.add(cyl(0.24, 0.17, 0.32, "butter", 0, 0.9, 0));
    } },
  { id:"wardrobe", name:"Wardrobe", price:590, charm:7, w:2, h:1, room:"bedroom", cls:"large", build(g){
      g.add(box(1.1, 1.78, 0.6, "warmSand", 0, 0.12, 0));
      [-0.27, 0.27].forEach(x => g.add(box(0.5, 1.62, 0.03, "oat", x, 0.2, 0.3)));
      [-0.27, 0.27].forEach(x => [0.45, 1.15].forEach(y => g.add(box(0.36, 0.5, 0.02, "warmSand", x, y, 0.33))));
      [-0.06, 0.06].forEach(x => g.add(ball(0.04, "cocoa", x, 1.0, 0.33, 8)));
      g.add(box(1.16, 0.12, 0.66, "softClay", 0, 0, 0));
      g.add(box(1.16, 0.1, 0.66, "softClay", 0, 1.9, 0));
      g.add(box(1.24, 0.09, 0.72, "cocoa", 0, 2.0, 0));
    } },
  { id:"clock", name:"Old Clock", price:430, charm:7, w:1, h:1, room:"bedroom", cls:"medium", build(g){
      g.add(box(0.36, 1.45, 0.28, "cocoa", 0, 0, 0));
      g.add(box(0.5, 0.1, 0.34, "cocoa", 0, 1.45, 0));
      g.add(box(0.26, 0.16, 0.24, "cocoa", 0, 1.55, 0, { rz:0.0 }));
      g.add(cyl(0.13, 0.13, 0.05, "cream", 0, 1.2, 0.14, 16));
      g.add(box(0.02, 0.09, 0.02, "ink", 0, 1.38, 0.18));
      g.add(box(0.09, 0.5, 0.03, "butter", 0, 0.5, 0.14, { sway:0.08 }));
    } },
  { id:"flowers", name:"Fresh Flowers", price:250, charm:6, w:1, h:1, room:"bedroom", cls:"small", build(g){
      g.add(cyl(0.09, 0.11, 0.24, "mist", 0, 0, 0));
      [["blush",0],["coral",1],["butter",2],["lilac",3],["blush",4]].forEach(([c, i]) => {
        const a = (i / 5) * Math.PI * 2;
        g.add(cyl(0.012, 0.012, 0.26, "sage", Math.cos(a) * 0.05, 0.24, Math.sin(a) * 0.05, 6));
        g.add(ball(0.06, c, Math.cos(a) * 0.09, 0.53, Math.sin(a) * 0.09, 8));
      });
    } },
  { id:"cat", name:"Sleepy Cat", price:820, charm:12, w:1, h:1, room:"bedroom", cls:"medium", build(g){
      g.add(cyl(0.3, 0.32, 0.12, "blush", 0, 0, 0, 16));
      g.add(box(0.34, 0.18, 0.24, "softClay", 0, 0.12, 0, { fabric:true }));
      g.add(ball(0.11, "softClay", 0.1, 0.28, 0.06, 10));
      [[-0.05, 0.06],[0.05, -0.02]].forEach(([dx, dz]) => g.add(box(0.05, 0.07, 0.02, "softClay", 0.1 + dx, 0.36, 0.06 + dz, { rz:dx * 4 })));
      g.add(box(0.26, 0.05, 0.05, "softClay", -0.16, 0.16, 0.06, { rz:0.2, sway:0.16 }));
    } },

  /* GARDEN */
  { id:"tree", name:"Old Tree", price:530, charm:9, w:3, h:3, room:"garden", cls:"medium", build(g){
      g.add(cyl(0.13, 0.2, 1.15, "cocoa", 0, 0, 0, 10));
      g.add(ball(0.52, "sage", 0, 1.45, 0, 16));
      g.add(ball(0.36, "sage", 0.35, 1.2, 0.16, 14));
      g.add(ball(0.32, "sage", -0.3, 1.32, -0.2, 14));
      g.add(ball(0.26, "sage", 0.12, 1.8, -0.18, 12));
      g.add(ball(0.22, "sage", -0.24, 1.62, 0.26, 12));
      [[-0.4, 0.72, 0.5],[0.42, 0.86, -0.4]].forEach(([x, y, z]) =>
        g.add(box(0.35, 0.07, 0.07, "cocoa", x, y, z, { rz:x > 0 ? -0.5 : 0.5 })));
      g.children.slice(1).forEach(c => { c.userData.sway = 0.03; });
    } },
  { id:"tulips", name:"Tulip Bed", price:220, charm:5, w:2, h:2, room:"garden", cls:"medium", build(g){
      g.add(box(0.8, 0.14, 0.8, "cocoa", 0, 0, 0));
      for(let i = 0; i < 5; i++){
        const a = i * 1.9, r = 0.1 + (i % 3) * 0.11;
        g.add(cyl(0.012, 0.012, 0.24, "sage", Math.cos(a) * r, 0.14, Math.sin(a) * r, 6));
        g.add(box(0.09, 0.13, 0.09, ["coral","blush","butter"][i % 3], Math.cos(a) * r, 0.38, Math.sin(a) * r, { sway:0.09 }));
      }
    } },
  { id:"bench", name:"Two Seat Bench", price:410, charm:8, w:4, h:1, room:"garden", cls:"medium", build(g){
      g.add(box(1.5, 0.09, 0.46, "cocoa", 0, 0.44, 0));
      [0, 0.16, 0.32].forEach(y => g.add(box(1.5, 0.11, 0.06, "cocoa", 0, 0.56 + y, -0.2)));
      [-0.62, 0.62].forEach(x => { g.add(box(0.1, 0.44, 0.1, "softClay", x, 0, -0.16)); g.add(box(0.1, 0.44, 0.1, "softClay", x, 0, 0.16)); });
    } },
  { id:"firepit", name:"Fire Pit", price:680, charm:11, w:2, h:2, room:"garden", cls:"medium", build(g){
      g.add(cyl(0.42, 0.46, 0.3, "softClay", 0, 0, 0, 16));
      g.add(cyl(0.34, 0.34, 0.06, "ink", 0, 0.28, 0, 16));
      [[0, 0.34],[-0.12, 0.24],[0.13, 0.26]].forEach(([x, h]) =>
        g.add(box(0.16, h, 0.13, "coral", x, 0.3, 0, { sway:0.12 })));
      g.add(box(0.1, 0.16, 0.09, "coral", 0, 0.34, 0.02, { sway:0.16 }));
    } },
  { id:"pool", name:"Plunge Pool", price:1620, charm:20, w:6, h:4, room:"garden", cls:"large", build(g){
      g.add(box(2.9, 0.34, 1.9, "cream", 0, 0, 0));
      g.add(box(2.6, 0.24, 1.6, "mist", 0, 0.06, 0));
      g.add(box(2.4, 0.03, 1.4, "deepTeal", 0, 0.3, 0, { sway:0.006 }));
      for(let i = 0; i < 6; i++) g.add(box(0.42, 0.06, 0.16, "cream", -1.25 + i * 0.5, 0.34, 0.88));
      for(let i = 0; i < 6; i++) g.add(box(0.42, 0.06, 0.16, "cream", -1.25 + i * 0.5, 0.34, -0.88));
      [0.16, 0.34].forEach(y => g.add(box(0.5, 0.05, 0.05, "cream", 1.15, y, 0.98)));
      g.add(cyl(0.3, 0.3, 0.09, "butter", 1.7, 0, 0.7, 16));
    } },
  { id:"dog", name:"Dog House", price:880, charm:12, w:2, h:2, room:"garden", cls:"medium", build(g){
      g.add(box(0.9, 0.62, 0.9, "warmSand", 0, 0, 0));
      g.add(box(0.72, 0.62, 0.1, "coral", 0, 0.62, 0, { rz:Math.PI / 4 }));
      g.add(box(0.72, 0.62, 0.1, "coral", 0, 0.62, 0, { rz:-Math.PI / 4 }));
      g.add(box(0.34, 0.42, 0.06, "cocoa", 0, 0.06, 0.45));
    } },
  { id:"fountain", name:"Fountain", price:1250, charm:17, w:3, h:3, room:"garden", cls:"large", build(g){
      g.add(cyl(0.72, 0.78, 0.34, "cream", 0, 0, 0, 20));
      g.add(cyl(0.62, 0.62, 0.08, "mist", 0, 0.3, 0, 20));
      g.add(cyl(0.14, 0.2, 0.5, "cream", 0, 0.34, 0, 14));
      g.add(cyl(0.36, 0.16, 0.09, "cream", 0, 0.84, 0, 16));
      g.add(cyl(0.05, 0.02, 0.3, "mist", 0, 0.93, 0, 10));
      g.children[g.children.length - 1].userData.sway = 0.05;
      for(let i = 0; i < 8; i++){
        const a = (i / 8) * Math.PI * 2;
        g.add(box(0.16, 0.16, 0.1, "cream", Math.cos(a) * 0.74, 0.3, Math.sin(a) * 0.74, { ry:-a }));
      }
      g.add(cyl(0.5, 0.34, 0.1, "cream", 0, 0.62, 0, 18));
      g.add(cyl(0.44, 0.44, 0.03, "mist", 0, 0.72, 0, 18));
    } },

  /* MEMENTOS. Anywhere, and where the charm actually lives. */
  { id:"photos", name:"Photo Wall", price:940, charm:22, w:2, h:1, room:"any", memento:true, cls:"medium", build(g){
      const spots = [[-0.3, 1.15, 0.34, 0.42],[0.12, 1.3, 0.28, 0.28],[0.3, 0.95, 0.34, 0.44]];
      const tints = ["blush","butter","mist"];
      spots.forEach(([x, y, w, h], i) => {
        const f = artFrame(w, h, "cocoa", tints[i]);
        f.position.set(x, y, 0);
        g.add(f);
      });
      g.add(box(0.9, 0.06, 0.22, "cocoa", 0, 0.6, 0));
      g.add(ball(0.06, "coral", 0.3, 0.69, 0, 10));
    } },
  { id:"heartst", name:"Heart Statue", price:1400, charm:30, w:2, h:2, room:"any", memento:true, cls:"medium", build(g){
      g.add(cyl(0.3, 0.34, 0.3, "cream", 0, 0, 0, 18));
      g.add(cyl(0.22, 0.3, 0.14, "cream", 0, 0.3, 0, 18));
      g.add(box(0.42, 0.42, 0.2, "coral", 0, 0.62, 0, { rz:Math.PI / 4, centred:true }));
      g.add(ball(0.21, "coral", -0.15, 0.77, 0, 16));
      g.add(ball(0.21, "coral", 0.15, 0.77, 0, 16));
      g.children.slice(1).forEach(c => { c.userData.sway = 0.02; });
    } },
  { id:"vows", name:"Framed Vows", price:1870, charm:40, w:1, h:1, room:"any", memento:true, cls:"medium", build(g){
      g.add(box(0.34, 0.2, 0.3, "warmSand", 0, 0, 0));
      const f = artFrame(0.52, 0.66, "marigold", "cream");
      f.position.set(0, 0.55, 0.02);
      f.rotation.x = -0.1;
      g.add(f);
      [0.1, 0.2, 0.3, 0.4].forEach((y, i) => g.add(box(0.3 - (i % 2) * 0.08, 0.025, 0.01, "softClay", 0, 0.36 + y * 0.55, 0.07)));
      g.add(ball(0.05, "marigold", 0.2, 0.24, 0.1, 10));
    } },

  /* ---- second wave. Every one of these was shaped to read differently as a
     black silhouette, because with a catalogue this size the failure mode is
     forty nine props that are all a box on legs. ---- */

  /* LIVING */
  { id:"piano", name:"Upright Piano", price:1680, charm:24, w:4, h:2, room:"living", cls:"large", build(g){
      g.add(box(1.5, 1.15, 0.55, "cocoa", 0, 0.14, 0));
      g.add(box(1.58, 0.09, 0.62, "cocoa", 0, 1.29, 0));
      g.add(box(1.42, 0.14, 0.34, "cream", 0, 0.66, 0.42));      // the keyboard ledge steps out
      for(let i = 0; i < 11; i++) g.add(box(0.1, 0.04, 0.26, "cream", -0.6 + i * 0.12, 0.8, 0.44));
      for(let i = 0; i < 7; i++) g.add(box(0.05, 0.05, 0.16, "ink", -0.54 + i * 0.17, 0.84, 0.4));
      [-0.62, 0.62].forEach(x => g.add(box(0.14, 0.14, 0.5, "cocoa", x, 0, 0)));
      g.add(box(0.9, 0.36, 0.04, "warmSand", 0, 1.29, -0.1, { rx:-0.16 }));
    } },
  { id:"rug", name:"Big Rug", price:460, charm:9, w:4, h:3, room:"living", cls:"medium", build(g){
      g.add(box(1.9, 0.035, 1.35, "blush", 0, 0, 0));
      g.add(box(1.55, 0.02, 1.0, "cream", 0, 0.035, 0));
      g.add(box(1.15, 0.015, 0.68, "blush", 0, 0.05, 0));
      for(let i = 0; i < 6; i++){
        g.add(box(0.07, 0.02, 0.12, "blush", -0.75 + i * 0.3, 0, 0.73));
        g.add(box(0.07, 0.02, 0.12, "blush", -0.75 + i * 0.3, 0, -0.73));
      }
    } },

  /* KITCHEN */
  { id:"island", name:"Kitchen Island", price:1440, charm:20, w:4, h:3, room:"kitchen", cls:"large", build(g){
      g.add(box(1.5, 0.86, 0.95, "warmSand", 0, 0, 0));
      g.add(box(1.72, 0.1, 1.15, "cream", 0, 0.86, 0));           // the worktop overhangs
      g.add(box(0.5, 0.03, 0.4, "deepTeal", -0.35, 0.96, 0));
      [0.3, 0.58].forEach(y => g.add(box(1.3, 0.02, 0.02, "cocoa", 0, y, 0.48)));
      [-0.3, 0.3].forEach(x => [0.36, 0.64].forEach(y => g.add(ball(0.035, "cocoa", x, y, 0.49, 8))));
      g.add(cyl(0.16, 0.13, 0.09, "cream", 0.42, 0.96, 0.04, 16));
      [[0.36, 0.02],[0.46, 0.06],[0.42, -0.05]].forEach(([x, z]) => g.add(ball(0.055, "blush", x, 1.08, z + 0.04, 10)));
      g.add(box(0.22, 0.3, 0.03, "cream", -0.72, 0.5, 0.3, { rz:0.05 }));
      [0.3, 0.58].forEach(y => g.add(box(1.3, 0.02, 0.02, "cocoa", 0, y, -0.48)));
      [-0.3, 0.3].forEach(x => [0.36, 0.64].forEach(y => g.add(ball(0.035, "cocoa", x, y, -0.49, 8))));
      [-0.45, 0.45].forEach(x => {                                 // two stools tucked under
        g.add(cyl(0.16, 0.14, 0.06, "cocoa", x, 0.6, 0.72, 14));
        g.add(cyl(0.04, 0.05, 0.6, "cocoa", x, 0, 0.72, 8));
        g.add(cyl(0.14, 0.14, 0.03, "cocoa", x, 0.2, 0.72, 10));
      });
    } },
  { id:"potrack", name:"Pot Rack", price:670, charm:11, w:3, h:1, room:"kitchen", cls:"medium", build(g){
      [-0.55, 0.55].forEach(x => g.add(box(0.05, 0.5, 0.05, "cocoa", x, 1.42, 0)));
      g.add(box(1.24, 0.07, 0.09, "cocoa", 0, 1.36, 0));           // a bar high up, nothing below it
      const pots = [[-0.42, 0.2, "sage"], [-0.12, 0.26, "cream"], [0.18, 0.18, "peach"], [0.45, 0.24, "mist"]];
      pots.forEach(([x, h, c]) => {
        g.add(box(0.03, 0.12, 0.03, "cocoa", x, 1.24, 0));
        g.add(cyl(0.13, 0.11, h, c, x, 1.24 - h, 0, 14));
      });
    } },

  /* BEDROOM */
  { id:"dresser", name:"Dresser", price:940, charm:14, w:3, h:1, room:"bedroom", cls:"large", build(g){
      g.add(box(1.15, 0.7, 0.5, "warmSand", 0, 0.16, 0));
      [0.3, 0.55].forEach(y => g.add(box(1.02, 0.02, 0.02, "cocoa", 0, y, 0.26)));
      [-0.26, 0.26].forEach(x => [0.34, 0.6].forEach(y => g.add(ball(0.035, "cocoa", x, y, 0.27, 8))));
      [-0.48, 0.48].forEach(x => { g.add(box(0.09, 0.16, 0.09, "cocoa", x, 0, -0.16, { rz:x > 0 ? -0.2 : 0.2 }));
                                   g.add(box(0.09, 0.16, 0.09, "cocoa", x, 0, 0.16, { rz:x > 0 ? -0.2 : 0.2 })); });
      g.add(box(1.2, 0.06, 0.55, "cocoa", 0, 0.86, 0));
      const oval = new THREE.Group();                              // an oval mirror makes it a T, not a box
      oval.add(cyl(0.3, 0.3, 0.05, "cocoa", 0, -0.025, 0, 20));
      oval.add(cyl(0.25, 0.25, 0.03, "mist", 0, 0.01, 0.02, 20));
      oval.scale.set(1, 1, 1.35);
      oval.position.set(0, 1.28, -0.06);
      oval.rotation.x = Math.PI / 2;
      g.add(oval);
      [-0.3, 0.3].forEach(x => g.add(box(0.05, 0.42, 0.05, "cocoa", x, 0.92, -0.06)));
    } },
  { id:"rocker", name:"Rocking Chair", price:770, charm:12, w:2, h:2, room:"bedroom", cls:"medium", build(g){
      [-0.24, 0.24].forEach(x => {                                 // curved runners give it a rocking base
        for(let i = 0; i < 5; i++){
          const t = (i / 4) - 0.5;
          g.add(box(0.16, 0.06, 0.11, "cocoa", x, Math.abs(t) * 0.16, t * 0.84, { rz:0 }));
        }
      });
      g.add(box(0.62, 0.07, 0.6, "cocoa", 0, 0.42, 0));
      g.add(box(0.62, 0.62, 0.07, "cocoa", 0, 0.49, -0.28, { rx:0.18 }));
      [-0.28, 0.28].forEach(x => { g.add(box(0.07, 0.42, 0.07, "cocoa", x, 0, -0.26));
                                   g.add(box(0.07, 0.42, 0.07, "cocoa", x, 0, 0.26)); });
      g.add(box(0.5, 0.1, 0.34, "lilac", 0, 0.49, 0.02, { fabric:true }));
    } },

  /* STUDY */
  { id:"desk", name:"Writing Desk", price:980, charm:15, w:4, h:2, room:"study", cls:"large", build(g){
      g.add(box(1.6, 0.08, 0.75, "cocoa", 0, 0.72, 0));
      g.add(box(0.62, 0.44, 0.6, "warmSand", -0.44, 0.28, 0));
      [0.36, 0.56].forEach(y => g.add(box(0.5, 0.02, 0.02, "cocoa", -0.44, y, 0.31)));
      legs(g, 1.5, 0.7, 0.72, "cocoa", 0.09);
      g.add(box(1.5, 0.2, 0.05, "cocoa", 0, 0.5, -0.34));
      g.add(box(0.34, 0.03, 0.26, "cream", 0.42, 0.8, 0.04, { rz:0.02 }));
      g.add(cyl(0.06, 0.07, 0.14, "deepTeal", 0.16, 0.8, -0.18, 12));
      [0, 1, 2].forEach(i => g.add(box(0.03, 0.16, 0.03, "blush", 0.14 + i * 0.04, 0.94, -0.18)));
      g.add(box(0.26, 0.06, 0.2, "warmSand", -0.44, 0.8, 0.2));
    } },
  { id:"deskchair", name:"Desk Chair", price:500, charm:8, w:2, h:2, room:"study", cls:"medium", build(g){
      for(let i = 0; i < 5; i++){                                  // a five star base on one column
        const a = (i / 5) * Math.PI * 2;
        g.add(box(0.32, 0.06, 0.08, "ink", Math.cos(a) * 0.17, 0.03, Math.sin(a) * 0.17, { ry:-a }));
        g.add(cyl(0.045, 0.045, 0.07, "ink", Math.cos(a) * 0.31, 0, Math.sin(a) * 0.31, 8));
      }
      g.add(cyl(0.055, 0.07, 0.34, "ink", 0, 0.06, 0, 10));
      g.add(box(0.5, 0.09, 0.48, "mist", 0, 0.4, 0, { fabric:true }));
      g.add(box(0.46, 0.52, 0.08, "mist", 0, 0.49, -0.22, { rx:0.12, fabric:true }));
    } },
  { id:"bookwall", name:"Book Wall", price:1500, charm:22, w:3, h:1, room:"study", cls:"large", build(g){
      [-0.62, 0.62].forEach(x => g.add(box(0.07, 2.1, 0.32, "cocoa", x, 0, 0)));
      [0, 0.52, 1.04, 1.56, 2.1].forEach(y => g.add(box(1.32, 0.06, 0.32, "cocoa", 0, y, 0)));
      const c = ["blush","sage","butter","mist","lilac","peach"];
      for(let row = 0; row < 3; row++) for(let i = 0; i < 5; i++){
        if((row + i) % 4 === 0) continue;
        g.add(box(0.17, 0.36, 0.2, c[(i + row * 3) % 6], -0.44 + i * 0.22, 0.06 + row * 0.52, 0.03));
      }
      g.add(box(0.06, 1.9, 0.06, "cocoa", 0.44, 0.1, 0.28, { rz:-0.14 }));   // a leaning ladder
      g.add(box(0.06, 1.9, 0.06, "cocoa", 0.74, 0.1, 0.28, { rz:-0.14 }));
      for(let i = 0; i < 3; i++) g.add(box(0.34, 0.04, 0.05, "cocoa", 0.6 - i * 0.08, 0.4 + i * 0.55, 0.28));
    } },
  { id:"globe", name:"Globe", price:550, charm:9, w:1, h:1, room:"study", cls:"medium", build(g){
      g.add(cyl(0.12, 0.18, 0.06, "cocoa", 0, 0, 0, 16));
      g.add(cyl(0.03, 0.03, 0.28, "cocoa", 0, 0.06, 0, 8));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.022, 8, 24), mat("marigold"));
      ring.position.set(0, 0.58, 0);
      ring.rotation.y = 0.4;
      g.add(ring);
      g.add(ball(0.2, "mist", 0, 0.58, 0, 16));
      [[0.06, 0.62, 0.14],[-0.08, 0.5, 0.16],[0.02, 0.68, -0.15]].forEach(([x, y, z]) =>
        g.add(box(0.12, 0.08, 0.03, "sage", x, y, z)));
    } },
  { id:"telescope", name:"Telescope", price:1180, charm:18, w:2, h:2, room:"study", cls:"medium", build(g){
      for(let i = 0; i < 3; i++){                                   // tripod plus an angled tube
        const a = (i / 3) * Math.PI * 2;
        g.add(box(0.06, 0.95, 0.06, "cocoa", Math.cos(a) * 0.19, 0, Math.sin(a) * 0.19,
          { rz:-Math.cos(a) * 0.22, rx:Math.sin(a) * 0.22 }));
      }
      g.add(cyl(0.08, 0.09, 0.12, "cocoa", 0, 0.92, 0, 12));
      for(let i = 0; i < 3; i++){                                   // tripod braces
        const a = (i / 3) * Math.PI * 2;
        g.add(box(0.2, 0.04, 0.04, "cocoa", Math.cos(a) * 0.11, 0.4, Math.sin(a) * 0.11, { ry:-a + Math.PI / 2 }));
      }
      const tube = new THREE.Group();
      tube.add(cyl(0.1, 0.13, 0.86, "deepTeal", 0, -0.43, 0, 16));
      tube.add(cyl(0.07, 0.07, 0.1, "cocoa", 0, 0.05, 0, 12));
      tube.add(cyl(0.045, 0.05, 0.28, "cocoa", 0.13, -0.2, 0, 10));   // finder scope
      tube.add(box(0.05, 0.16, 0.05, "cocoa", 0.13, -0.34, 0));
      tube.position.set(0, 1.12, 0);
      tube.rotation.x = -0.85;
      g.add(tube);
    } },

  /* PORCH */
  { id:"swingseat", name:"Porch Swing", price:1260, charm:19, w:4, h:1, room:"porch", cls:"large", build(g){
      [-0.82, 0.82].forEach(x => {                                 // a frame with a bench hung inside it
        g.add(box(0.11, 2.0, 0.11, "cocoa", x, 0, -0.2));
        g.add(box(0.11, 2.0, 0.11, "cocoa", x, 0, 0.2));
        g.add(box(0.11, 0.5, 0.5, "cocoa", x, 1.75, 0));
      });
      g.add(box(1.8, 0.12, 0.14, "cocoa", 0, 2.0, 0));
      [-0.6, 0.6].forEach(x => [-0.22, 0.22].forEach(z =>
        g.add(box(0.035, 0.98, 0.035, "cocoa", x, 0.92, z))));
      g.add(box(1.35, 0.09, 0.5, "warmSand", 0, 0.84, 0));
      g.add(box(1.35, 0.5, 0.08, "warmSand", 0, 0.93, -0.24, { rx:0.14 }));
      g.add(box(0.36, 0.14, 0.3, "coral", -0.42, 0.93, 0.02, { fabric:true }));
    } },
  { id:"lantern", name:"Hanging Lantern", price:410, charm:7, w:1, h:1, room:"porch", cls:"small", build(g){
      g.add(cyl(0.13, 0.17, 0.07, "cocoa", 0, 0, 0, 14));
      g.add(cyl(0.04, 0.05, 1.5, "cocoa", 0, 0.07, 0, 10));
      g.add(box(0.44, 0.05, 0.05, "cocoa", 0.2, 1.55, 0));          // an arm out to one side
      g.add(box(0.24, 0.3, 0.24, "butter", 0.4, 1.13, 0));
      g.add(box(0.3, 0.07, 0.3, "cocoa", 0.4, 1.43, 0));
    } },
  { id:"planter", name:"Planter Box", price:580, charm:10, w:3, h:1, room:"porch", cls:"large", build(g){
      g.add(box(1.3, 0.34, 0.4, "cocoa", 0, 0.08, 0));
      g.add(box(1.36, 0.07, 0.46, "cocoa", 0, 0.42, 0));
      [-0.42, 0, 0.42].forEach(x => pottedPlant(g, x, 0, "warmSand", "sage", 0.7, 3));
      g.children.forEach(c => { if(c.position.y < 0.4 && Math.abs(c.position.x) > 0.1) c.position.y += 0.49; });
      [-0.58, 0.58].forEach(x => g.add(box(0.1, 0.16, 0.36, "cocoa", x, 0, 0)));
    } },
  { id:"doormat", name:"Welcome Mat", price:180, charm:4, w:2, h:1, room:"porch", cls:"medium", build(g){
      g.add(box(0.72, 0.05, 0.44, "softClay", 0, 0, 0));
      [-0.13, 0.13].forEach(x =>                                    // boots, so it is not a slab
        g.add(box(0.16, 0.26, 0.3, "deepTeal", x, 0.06, 0.02)));
    } },

  /* GARDEN */
  { id:"hammock", name:"Hammock", price:1060, charm:16, w:4, h:2, room:"garden", cls:"medium", build(g){
      [-0.86, 0.86].forEach(x => {
        g.add(cyl(0.07, 0.1, 1.15, "cocoa", x, 0, 0));
        g.add(box(0.5, 0.09, 0.09, "cocoa", x + (x > 0 ? -0.2 : 0.2), 0.95, 0, { rz:x > 0 ? 0.5 : -0.5 }));
      });
      for(let i = 0; i < 11; i++){                                 // a real sag, which nothing else has
        const t = (i / 10) - 0.5;
        const y = 0.86 - Math.cos(t * Math.PI) * 0.34;
        g.add(box(0.17, 0.06, 0.52, "butter", t * 1.6, y, 0, { rz:-t * 0.9, fabric:true }));
      }
      g.add(box(0.3, 0.1, 0.26, "cream", 0.42, 0.82, 0, { fabric:true }));
    } },

  /* MEMENTO */
  { id:"ring", name:"The Ring", price:2880, charm:50, w:1, h:1, room:"any", memento:true, cls:"medium", build(g){
      g.add(cyl(0.26, 0.3, 0.1, "cocoa", 0, 0, 0, 20));
      g.add(cyl(0.24, 0.24, 0.04, "blush", 0, 0.1, 0, 18));
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.018, 8, 20), mat("marigold"));
      band.position.set(0, 0.22, 0);
      band.rotation.x = Math.PI / 2.6;
      g.add(band);
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.5),
        new THREE.MeshToonMaterial({ color:PALETTE.mist, gradientMap:toonRamp(), transparent:true, opacity:0.42 })
      );
      dome.position.set(0, 0.12, 0);
      g.add(dome);
      g.add(cyl(0.03, 0.03, 0.04, "cocoa", 0, 0.4, 0, 8));
    } },
];
function legs2(g, x, z, h){   // chair legs, thin set
  [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([sx, sz]) =>
    g.add(box(0.05, h, 0.05, "sage", x + sx * 0.16, 0, z + sz * 0.16)));
}
const ITEM_BY_ID = {};
CATALOGUE.forEach(i => { ITEM_BY_ID[i.id] = i; });

/* ---- build a prop, recording which palette colours it used ---- */
const _propCache = {};
function buildProp(id){
  if(_propCache[id]) return _propCache[id].clone();
  const def = ITEM_BY_ID[id];
  const g = new THREE.Group();
  _watch = new Set();
  def.build(g);
  def.colours = [..._watch];
  def.accentsUsed = def.colours.filter(IS_ACCENT);
  _watch = null;
  g.scale.setScalar(CHUNK);          // section 6: model true, then chunk up
  g.userData.itemId = id;
  _propCache[id] = g;
  return g.clone();
}
function propTriangles(id){
  let n = 0;
  buildProp(id).traverse(o => { if(o.geometry) n += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3; });
  return Math.round(n);
}
