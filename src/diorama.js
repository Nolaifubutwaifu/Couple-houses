/* NEST :: the diorama. Art bible sections 4, 5, 8 and 11.
   This file replaces the flat renderer entirely. Everything about how a home
   looks and moves lives here, so the Unity build can be judged against it. */
"use strict";

/* Section 5 layer 3. Rooms tile out across the lot, 0.5 unit tiles. */
const ROOMS = [
  { id:"living",  name:"Living Room", ox:-5.1, oz:-4.1, w:10, h:8,  price:0,    accent:"coral"    },
  { id:"kitchen", name:"Kitchen",     ox: 0.1, oz:-4.1, w:10, h:8,  price:500,  accent:"deepTeal" },
  { id:"bedroom", name:"Bedroom",     ox:-5.1, oz: 0.1, w:10, h:8,  price:900,  accent:"plum"     },
  { id:"garden",  name:"Garden",      ox: 0.1, oz: 0.1, w:12, h:10, price:1400, accent:"marigold" },
];
const ROOM_BY_ID = {};
ROOMS.forEach(r => { ROOM_BY_ID[r.id] = r; });

const LOT = { cx:0.5, cz:0.5, radius:4.4 };   // recomputed from the rooms actually built
const TERRAIN_TOP = 0.18;
const FLOOR_Y = 0.26;      // props sit here, clear of the terrain plateau
const WALL_H = 1.2;              // section 5: walls at half height
const PLINTH_H = 0.6;

/* ---- easing. Section 11: linear is banned. ---- */
const springOut = (p, c) => { c = c === undefined ? 0.9 : c; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };
const easeOutSine = p => Math.sin((p * Math.PI) / 2);
const easeInOutSine = p => -(Math.cos(Math.PI * p) - 1) / 2;
const lerp = (a, b, t) => a + (b - a) * t;

function softDisc(colour){
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d");
  const grd = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, colour + "cc");
  grd.addColorStop(0.55, colour + "66");
  grd.addColorStop(1, colour + "00");
  x.fillStyle = grd; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const BASE_COLOUR = { ceramic:"oat", sand:"warmSand", clay:"softClay", cream:"cream" };
const TERRAIN_COLOUR = { grass:"sage", sand:"warmSand", stone:"mist", snow:"cream" };

const Diorama = {
  ready:false, mode:"home", held:null, heldRot:0,
  yaw:0, yawTarget:0, yawFrom:0, yawT:1,
  zoomStop:1, zoomK:1.16, zoomFrom:1.16, zoomTo:1.16, zoomT:1,
  spin:0, dragging:false, calm:false, orbit:0,
  baseMaterial:null, terrainType:null, pulse:null, frameShift:0,
  fly:null, haze:null, ceremonyKey:1,
  frames:0, fps:60, _lastFpsAt:0,

  /* Section 4 named three stops. Yaw and zoom are both continuous now, so
     these are the multipliers of the lot radius the stops sit at, and the
     outer two double as the clamps a pinch cannot pass. */
  ZOOM_K:[1.62, 1.16, 0.58],
  ZOOM_NAMES:["wide", "home", "close"],
  get ZOOMS(){ return this.ZOOM_K.map(k => k * LOT.radius); },           // Dome, Home, Detail (section 4)

  init(container){
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 120);
    this.target = new THREE.Vector3(LOT.cx, 1.6, LOT.cz);

    /* Section 8. Warm key upper front left at 45, cool sky fill, faint rim.
       Nothing casts a realtime shadow. */
    this.key = new THREE.DirectionalLight(0xfff1dc, 0.72);
    this.key.position.set(-6, 9, 6);
    this.fill = new THREE.HemisphereLight(0xdde9ee, 0xd8c6ad, 0.34);
    this.rim = new THREE.DirectionalLight(0xcfe0e8, 0.2);
    this.rim.position.set(5, 4, -8);
    this.scene.add(this.key, this.fill, this.rim);

    this.lot = new THREE.Group();
    this.scene.add(this.lot);
    this.plinth = new THREE.Group();
    this.terrain = new THREE.Group();
    this.home = new THREE.Group();
    this.weather = new THREE.Group();
    this.lot.add(this.plinth, this.terrain, this.home, this.weather);

    this.domeGroup = new THREE.Group();
    this.lot.add(this.domeGroup);
    this.buildPlinth();
    this.buildDome();
    this.buildHighlight();

    this.pickPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -FLOOR_Y);
    this.ray = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.bindInput();

    this.clock = new THREE.Clock();
    this.resize();
    addEventListener("resize", () => this.resize());
    this.ready = true;
    this.loop();
  },

  /* ---- layer 1: the base ---- */
  buildPlinth(){
    this.plinth.clear();
    const r = LOT.radius;
    const prof = [];
    prof.push({ x:0, y:-PLINTH_H });
    for(let i = 0; i <= 6; i++){ const a = (i / 6) * Math.PI * 0.5; prof.push({ x:r - 0.18 + Math.sin(a) * 0.18, y:-PLINTH_H + 0.18 - Math.cos(a) * 0.18 }); }
    prof.push({ x:r, y:-0.18 });
    for(let i = 0; i <= 6; i++){ const a = (i / 6) * Math.PI * 0.5; prof.push({ x:r - 0.18 + Math.cos(a) * 0.18, y:-0.18 + Math.sin(a) * 0.18 }); }
    prof.push({ x:0, y:0 });
    const base = new THREE.Mesh(lathe(prof, 48), mat(BASE_COLOUR[this.baseMaterial] || "oat"));
    this.plinth.position.set(LOT.cx, 0, LOT.cz);
    this.plinth.add(base);

    this.nameCanvas = document.createElement("canvas");
    this.nameCanvas.width = 2048; this.nameCanvas.height = 128;
    this.nameTex = new THREE.CanvasTexture(this.nameCanvas);
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(r + 0.008, r + 0.008, 0.34, 64, 1, true),
      new THREE.MeshBasicMaterial({ map:this.nameTex, transparent:true, side:THREE.DoubleSide })
    );
    band.position.y = -0.2;
    this.plinth.add(band);
    this.setPlinthText("", "");
  },
  setPlinthText(names, streakMark){
    const c = this.nameCanvas, x = c.getContext("2d");
    x.clearRect(0, 0, c.width, c.height);
    x.font = "600 62px Quicksand, system-ui, sans-serif";
    x.fillStyle = PALETTE.cocoa;
    x.textAlign = "center"; x.textBaseline = "middle";
    // four repeats so the text reads from every yaw stop
    for(let i = 0; i < 4; i++){
      const cx = c.width * (i + 0.5) / 4;
      x.fillText(names, cx, 56);
      if(streakMark){
        x.font = "700 40px Quicksand, system-ui, sans-serif";
        x.fillStyle = PALETTE.coral;
        x.fillText(streakMark, cx, 102);
        x.font = "600 62px Quicksand, system-ui, sans-serif";
        x.fillStyle = PALETTE.cocoa;
      }
    }
    this.nameTex.needsUpdate = true;
  },

  /* ---- layer 4: the dome ---- */
  buildDome(){
    this.domeGroup.clear();
    this.domeGroup.position.set(LOT.cx, 0, LOT.cz);
    const R = LOT.radius + 0.45;
    const uni = { tint:{ value:new THREE.Color("#eaf2f5") }, opa:{ value:0.2 } };
    const shader = side => new THREE.ShaderMaterial({
      uniforms:uni, transparent:true, depthWrite:false, side,
      vertexShader:`varying vec3 vN; varying vec3 vV;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv; }`,
      fragmentShader:`uniform vec3 tint; uniform float opa; varying vec3 vN; varying vec3 vV;
        void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.6);
        gl_FragColor = vec4(tint + f * 0.18, clamp(opa * (0.05 + f * 2.4), 0.0, 0.6)); }`,
    });
    this.domeUniforms = uni;
    const geo = new THREE.SphereGeometry(R, 48, 32, 0, Math.PI * 2, 0, Math.PI * 0.54);
    const inner = new THREE.Mesh(geo, shader(THREE.BackSide));
    const outer = new THREE.Mesh(geo, shader(THREE.FrontSide));
    inner.renderOrder = 90; outer.renderOrder = 100;
    this.domeGroup.add(inner, outer);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(R * 0.999, 0.035, 8, 64), mat("oat"));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.02;
    this.domeGroup.add(rim);
  },

  /* ---- layer 2: terrain, plus the weather that sits in the dome ---- */
  applyState(stateId, season){
    const s = SEASON_STATES[stateId] || SEASON_STATES.new;
    this.stateId = stateId;
    this.season = season;
    this.key.color = new THREE.Color(s.key);
    this.key.intensity = s.keyI * 0.72;
    this.fill.intensity = s.fillI * 0.85;
    this.fill.color = new THREE.Color(s.fill);
    this.domeUniforms.tint.value = new THREE.Color(s.sky[0]);
    this.domeUniforms.opa.value = stateId === "resting" ? 0.32 : 0.2;
    const sky = `linear-gradient(180deg, ${s.sky[0]} 0%, ${s.sky[1]} 100%)`;
    if(this.container) this.container.style.background = sky;
    document.body.style.background = sky;

    this.terrain.clear();
    this.terrain.position.set(LOT.cx, 0, LOT.cz);
    const r = LOT.radius - 0.42;
    const prof = [{ x:0, y:TERRAIN_TOP }];
    for(let i = 0; i <= 8; i++){ const t = i / 8; prof.push({ x:r * t, y:TERRAIN_TOP - Math.pow(t, 4) * 0.1 }); }
    for(let i = 0; i <= 5; i++){ const a = (i / 5) * Math.PI * 0.5; prof.push({ x:r + Math.sin(a) * 0.16, y:TERRAIN_TOP - 0.1 - (1 - Math.cos(a)) * 0.16 }); }
    prof.push({ x:r + 0.16, y:-0.02 });
    // lathe winds from the profile's first point outward, so this has to run
    // in the same direction as the plinth or the whole disc faces away
    const ground = new THREE.Mesh(lathe(prof.reverse(), 48), mat(TERRAIN_COLOUR[this.terrainType] || season.ground));
    this.terrain.add(ground);

    // growth: flecks of season colour thicken as the streak state climbs
    const n = Math.round(s.growth * 130);
    const fleck = new THREE.Group();
    for(let i = 0; i < n; i++){
      const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * (r - 0.3);
      const px = Math.cos(a) * rr, pz = Math.sin(a) * rr;
      if(this.insideAnyRoom(px + LOT.cx, pz + LOT.cz)) continue;
      const h = 0.06 + Math.random() * 0.12 * s.growth;
      const m = box(0.05, h, 0.05, i % 5 === 0 ? season.tint : "sage", px, TERRAIN_TOP - 0.01, pz, { sway:0.13 });
      fleck.add(m);
    }
    this.terrain.add(fleck);

    this.weather.clear();
    if(s.motes > 0){
      const pos = new Float32Array(s.motes * 3);
      for(let i = 0; i < s.motes; i++){
        const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * LOT.radius * 0.9;
        pos[i * 3] = Math.cos(a) * rr; pos[i * 3 + 1] = Math.random() * 4.5; pos[i * 3 + 2] = Math.sin(a) * rr;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      this.motes = new THREE.Points(g, new THREE.PointsMaterial({
        size:0.11, map:softDisc(season.fleck), color:season.fleck, transparent:true,
        opacity:stateId === "resting" ? 0.5 : 0.85, depthWrite:false,
      }));
      this.weather.add(this.motes);
    } else this.motes = null;

    if(s.shafts){
      const R = LOT.radius;
      for(let i = 0; i < 3; i++){
        const shaft = new THREE.Mesh(
          new THREE.ConeGeometry(R * (0.17 + i * 0.05), R * 0.86, 10, 1, true),
          new THREE.MeshBasicMaterial({ color:new THREE.Color(s.key), transparent:true, opacity:0.055,
            depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide })
        );
        shaft.position.set(R * (-0.42 + i * 0.36), R * 0.44, R * (-0.2 + i * 0.22));
        shaft.rotation.z = 0.2;
        shaft.renderOrder = 20;
        this.weather.add(shaft);
      }
    }
    if(stateId === "resting"){
      const haze = new THREE.Mesh(
        new THREE.SphereGeometry(LOT.radius, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.5),
        new THREE.MeshBasicMaterial({ color:0xdfe7ea, transparent:true, opacity:0.16, depthWrite:false, side:THREE.BackSide })
      );
      this.weather.add(haze);
    }
  },

  insideAnyRoom(wx, wz){
    return ROOMS.some(r => this.unlocked && this.unlocked[r.id] &&
      wx > r.ox - 0.3 && wx < r.ox + r.w * TILE + 0.3 && wz > r.oz - 0.3 && wz < r.oz + r.h * TILE + 0.3);
  },

  /* ---- layer 3: the home the player built ---- */
  measureLot(){
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    ROOMS.forEach(r => {
      if(!this.unlocked[r.id]) return;
      minX = Math.min(minX, r.ox); maxX = Math.max(maxX, r.ox + r.w * TILE);
      minZ = Math.min(minZ, r.oz); maxZ = Math.max(maxZ, r.oz + r.h * TILE);
    });
    if(minX > maxX){ minX = -1; maxX = 1; minZ = -1; maxZ = 1; }
    LOT.cx = (minX + maxX) / 2; LOT.cz = (minZ + maxZ) / 2;
    LOT.radius = Math.max(3.2, Math.hypot(maxX - LOT.cx, maxZ - LOT.cz) + 0.55);
    this.lot.position.set(0, 0, 0);
    this.target.set(LOT.cx, LOT.radius * 0.2, LOT.cz);
  },
  setLot(house, couple, streakLabel){
    this.unlocked = {};
    ROOMS.forEach(r => { this.unlocked[r.id] = house.rooms[r.id] && house.rooms[r.id].unlocked; });
    const before = LOT.radius;
    this.measureLot();
    if(Math.abs(before - LOT.radius) > 0.001){ this.buildPlinth(); this.buildDome(); }
    this.home.clear();
    this.props = {};
    this.walls = [];

    ROOMS.forEach(r => {
      if(!this.unlocked[r.id]) return;
      const W = r.w * TILE, H = r.h * TILE, cx = r.ox + W / 2, cz = r.oz + H / 2;
      const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.1, H), mat(r.id === "garden" ? "sage" : "softClay"));
      floor.position.set(cx, FLOOR_Y - 0.05, cz);
      this.home.add(floor);
      if(r.id !== "garden"){
        const inner = new THREE.Mesh(new THREE.BoxGeometry(W - 0.16, 0.02, H - 0.16), mat("oat"));
        inner.position.set(cx, FLOOR_Y + 0.006, cz);
        this.home.add(inner);
        [[0, -1, W], [0, 1, W], [-1, 0, H], [1, 0, H]].forEach(([nx, nz, len]) => {
          const wall = new THREE.Mesh(
            bevelBox(nx ? 0.12 : len, WALL_H, nz ? 0.12 : len, 0.02),
            new THREE.MeshToonMaterial({ color:PALETTE.oat, gradientMap:toonRamp(), transparent:true })
          );
          wall.position.set(cx + nx * W / 2, FLOOR_Y + WALL_H / 2, cz + nz * H / 2);
          wall.userData.normal = new THREE.Vector2(nx, nz);
          wall.userData.opacity = 1;
          this.home.add(wall);
          this.walls.push(wall);
          [[0.06, "softClay", 0.15], [WALL_H - 0.05, "cream", 0.1]].forEach(([y, col, t]) => {
            const trim = new THREE.Mesh(
              bevelBox(nx ? 0.16 : len, t, nz ? 0.16 : len, 0.02),
              new THREE.MeshToonMaterial({ color:PALETTE[col], gradientMap:toonRamp(), transparent:true }));
            trim.position.set(cx + nx * W / 2, FLOOR_Y + y, cz + nz * H / 2);
            trim.userData.normal = wall.userData.normal;
            trim.userData.opacity = 1;
            this.home.add(trim);
            this.walls.push(trim);
          });
        });
      }
    });

    (house.placed || []).forEach(p => this.addProp(p, true));
    if(couple) this.setPlinthText(`${couple.partnerA}  ·  ${couple.partnerB}`, streakLabel || "");
    this.resize();
  },

  footprint(item, rot){ return rot % 2 === 0 ? { w:item.w, h:item.h } : { w:item.h, h:item.w }; },
  tileToWorld(roomId, tx, ty, fw, fh){
    const r = ROOM_BY_ID[roomId];
    return { x:r.ox + (tx + fw / 2) * TILE, z:r.oz + (ty + fh / 2) * TILE };
  },
  addProp(p, instant){
    const item = ITEM_BY_ID[p.itemId];
    if(!item) return;
    const f = this.footprint(item, p.rot);
    const at = this.tileToWorld(p.room, p.x, p.y, f.w, f.h);
    const g = buildProp(p.itemId);
    g.position.set(at.x, FLOOR_Y, at.z);
    g.rotation.y = p.rot * Math.PI / 2;
    g.userData.instanceId = p.instanceId;
    g.userData.placed = p;
    g.userData.sways = [];
    g.traverse(o => { if(o.userData && o.userData.sway) g.userData.sways.push({ o, amp:o.userData.sway, base:o.rotation.z, phase:Math.random() * 9 }); });

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(f.w, 1) * TILE * 1.9, Math.max(f.h, 1) * TILE * 1.9),
      new THREE.MeshBasicMaterial({ map:softDisc("#8a6e58"), transparent:true, opacity:0.32, depthWrite:false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(at.x, FLOOR_Y + 0.012, at.z);
    this.home.add(shadow);
    g.userData.shadow = shadow;

    this.home.add(g);
    this.props[p.instanceId] = g;
    if(!instant) g.userData.anim = { t:0, dur:0.34, from:0.3 };   // section 11 placement
    return g;
  },
  removeProp(instanceId){
    const g = this.props[instanceId];
    if(!g) return;
    if(g.userData.shadow) this.home.remove(g.userData.shadow);
    this.home.remove(g);
    delete this.props[instanceId];
  },

  /* ---- placement highlight ---- */
  buildHighlight(){
    this.hl = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color:PALETTE.coral, transparent:true, opacity:0.4, depthWrite:false })
    );
    this.hl.rotation.x = -Math.PI / 2;
    this.hl.visible = false;
    this.scene.add(this.hl);
  },
  setHeld(itemId, rot){
    this.held = itemId; this.heldRot = rot || 0;
    if(this.ghost){ this.lot.remove(this.ghost); this.ghost = null; }
    if(itemId){
      this.ghost = buildProp(itemId);
      this.ghost.traverse(o => { if(o.material){ o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.55; } });
      this.ghost.visible = false;
      this.lot.add(this.ghost);
    }
    this.hl.visible = false;
  },
  hoverAt(wx, wz){
    if(!this.held) return null;
    const item = ITEM_BY_ID[this.held];
    const f = this.footprint(item, this.heldRot);
    for(const r of ROOMS){
      if(!this.unlocked[r.id]) continue;
      if(item.room !== "any" && item.room !== r.id) continue;
      const tx = Math.round((wx - r.ox) / TILE - f.w / 2);
      const ty = Math.round((wz - r.oz) / TILE - f.h / 2);
      if(tx < 0 || ty < 0 || tx + f.w > r.w || ty + f.h > r.h) continue;
      return { room:r.id, x:tx, y:ty, f };
    }
    return null;
  },
  showGhost(spot, ok){
    if(!this.ghost) return;
    if(!spot){ this.ghost.visible = false; this.hl.visible = false; return; }
    const at = this.tileToWorld(spot.room, spot.x, spot.y, spot.f.w, spot.f.h);
    this.ghost.visible = true;
    this.ghost.position.set(at.x, FLOOR_Y + 0.04, at.z);
    this.ghost.rotation.y = this.heldRot * Math.PI / 2;
    this.hl.visible = true;
    this.hl.scale.set(spot.f.w * TILE, spot.f.h * TILE, 1);
    this.hl.position.set(at.x, FLOOR_Y + 0.02, at.z);
    this.hl.material.color = new THREE.Color(ok ? PALETTE.sage : PALETTE.coral);
  },

  /* ---- camera, section 4 ---- */
  frameCamera(){ this.applyCamera(); },
  applyCamera(){
    const tilt = 32 * Math.PI / 180;
    const R = 40;
    const y = this.yaw;
    this.camera.position.set(
      this.target.x + Math.sin(y) * Math.cos(tilt) * R,
      this.target.y + Math.sin(tilt) * R,
      this.target.z + Math.cos(y) * Math.cos(tilt) * R
    );
    this.camera.lookAt(this.target);
    this.camera.up.set(0, 1, 0);
  },
  /* The arrows still exist alongside the drag, and they are worth more now
     than before: from any resting angle they take you to the next composed
     quarter turn, which is the fastest way back to a framed shot. */
  rotate(dir){
    this.spin = 0;
    const q = Math.PI / 2, u = this.yaw / q, eps = 0.02;
    let t = dir > 0 ? Math.ceil(u - eps) : Math.floor(u + eps);
    if(Math.abs(t - u) < eps) t += dir;
    this.yawFrom = this.yaw;
    this.yawTarget = t * q;
    this.yawT = 0;
  },
  setZoomK(k){
    this.zoomT = 1;
    this.zoomK = Math.max(this.ZOOM_K[2], Math.min(this.ZOOM_K[0], k));
    this.applyView();
  },
  setZoom(stop){
    this.zoomStop = Math.max(0, Math.min(2, stop));
    this.zoomFrom = this.zoomK;
    this.zoomTo = this.ZOOM_K[this.zoomStop];
    this.zoomT = 0;
  },
  /* a pinch leaves you between stops, so the button picks up from the
     nearest one rather than from whatever was last pressed */
  cycleZoom(){
    let near = 0, best = 1e9;
    this.ZOOM_K.forEach((k, i) => { const d = Math.abs(k - this.zoomK); if(d < best){ best = d; near = i; } });
    this.setZoom((near + 1) % 3);
    return this.ZOOM_NAMES[this.zoomStop];
  },
  /* Section 4 of the onboarding spec moves the camera between intro beats.
     One tween covers both the zoom and what it is aimed at. */
  flyTo(opts){
    this.zoomT = 1;
    const to = opts.target || this.target.clone();
    this.fly = {
      t:0, ms:(opts.ms || 1800) / 1000, done:opts.done,
      fromK:this.zoomK, toK:opts.zoomK === undefined ? this.zoomK : opts.zoomK,
      from:this.target.clone(), to:new THREE.Vector3(to.x, to.y, to.z),
    };
  },
  roomCentre(id){
    const r = ROOM_BY_ID[id] || ROOMS[0];
    return new THREE.Vector3(r.ox + r.w * TILE / 2, 1.0, r.oz + r.h * TILE / 2);
  },
  lotCentre(){ return new THREE.Vector3(LOT.cx, LOT.radius * 0.2, LOT.cz); },

  /* Section 7 of the onboarding spec, the ceremony. Five beats, about six
     seconds, and it either plays in full or it does not play at all. */
  playCeremony(itemId, onStep){
    const step = n => { if(onStep) onStep(n); };
    if(!this.haze){
      this.haze = new THREE.Mesh(
        new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.5),
        new THREE.MeshBasicMaterial({ color:0xe8eef0, transparent:true, opacity:0, depthWrite:false, side:THREE.BackSide })
      );
      this.lot.add(this.haze);
    }
    this.haze.scale.setScalar(LOT.radius);
    this.haze.position.set(LOT.cx, 0, LOT.cz);
    this.haze.material.opacity = 0.92;
    this.haze.visible = true;
    const key0 = 0.16;
    this.key.intensity = key0;
    this.fill.intensity = 0.2;
    step(1);
    const t0 = performance.now();
    const run = () => {
      const t = (performance.now() - t0) / 1000;
      // 2: fog clears from the centre outward, 1.4s
      const fog = Math.min(1, t / 1.4);
      this.haze.material.opacity = 0.92 * (1 - easeInOutSine(fog));
      // 3: key light rises to full warmth over 1.2s, starting as the fog goes
      const lit = Math.max(0, Math.min(1, (t - 0.9) / 1.2));
      this.key.intensity = lerp(key0, 0.95, easeOutSine(lit));
      this.fill.intensity = lerp(0.2, 0.34, easeOutSine(lit));
      if(t > 1.4 && !this._ceremonyStep2){ this._ceremonyStep2 = 1; step(2); }
      if(t > 2.6 && !this._ceremonyStep3){ this._ceremonyStep3 = 1; step(3); }
      // 4: one object drops in with the standard placement spring
      if(t > 3.2 && !this._ceremonyStep4){
        this._ceremonyStep4 = 1;
        step(4);
      }
      if(t > 4.6 && !this._ceremonyStep5){ this._ceremonyStep5 = 1; step(5); }
      if(t < 6){ requestAnimationFrame(run); }
      else{
        this.haze.visible = false;
        this._ceremonyStep2 = this._ceremonyStep3 = this._ceremonyStep4 = this._ceremonyStep5 = 0;
        step(6);
      }
    };
    requestAnimationFrame(run);
  },

  setBase(material, terrain){
    this.baseMaterial = material || null;
    this.terrainType = terrain || null;
    if(this.ready){ this.buildPlinth(); this.applyState(this.stateId || "resting", this.season || seasonNow()); }
  },
  /* the first placement is taught with one pulsing target and no text wall */
  pulseTarget(spot){
    if(!this.pulse){
      this.pulse = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ color:PALETTE.butter, transparent:true, opacity:0.7, depthWrite:false })
      );
      this.pulse.rotation.x = -Math.PI / 2;
      this.scene.add(this.pulse);
    }
    if(!spot){ this.pulse.visible = false; this.pulseSpot = null; return; }
    const r = ROOM_BY_ID[spot.room];
    this.pulseSpot = spot;
    this.pulse.visible = true;
    this.pulse.scale.set(TILE * 2.2, TILE * 2.2, 1);
    this.pulse.position.set(r.ox + (spot.x + 1) * TILE, FLOOR_Y + 0.03, r.oz + (spot.y + 1) * TILE);
  },

  applyView(){
    if(!this.container) return;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if(!w || !h) return;
    const view = this.zoomK * LOT.radius;
    const aspect = w / h;
    // the dome is as wide as it is tall, so the frustum has to be driven by
    // whichever screen dimension is smaller, or a tall screen crops the sides
    const halfW = aspect >= 1 ? view * aspect : view;
    const halfH = aspect >= 1 ? view : view / aspect;
    // onboarding runs the dome full height with a sheet over the lower half,
    // so the frame slides down in world space to lift the dome up on screen
    const shift = this.frameShift * halfH;
    this.camera.left = -halfW; this.camera.right = halfW;
    this.camera.top = halfH - shift; this.camera.bottom = -halfH - shift;
    this.camera.updateProjectionMatrix();
    this.applyCamera();
  },
  resize(){
    if(!this.container) return;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if(!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.applyView();
  },

  /* ---- input. Drag the dome to turn it, pinch or scroll to zoom, tap to
     place and pick up. A drag never becomes a tap. ---- */
  bindInput(){
    const el = this.renderer.domElement;
    el.style.touchAction = "none";      // the dome eats the gesture, the page does not scroll
    this.calm = matchMedia("(prefers-reduced-motion: reduce)").matches;

    const pts = new Map();
    let start = null, pinch = null;

    el.addEventListener("pointerdown", e => {
      try{ el.setPointerCapture(e.pointerId); }catch(err){ /* capture is a nicety */ }
      pts.set(e.pointerId, { x:e.clientX, y:e.clientY });
      if(pts.size === 1){
        this.spin = 0;
        this.yawT = 1;                  // a hand on the dome stops any tween
        this.dragging = false;
        start = { x:e.clientX, y:e.clientY, yaw:this.yaw, t:performance.now(), moved:0 };
      }else if(pts.size === 2){
        const [a, b] = [...pts.values()];
        pinch = { d:Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), k:this.zoomK };
        this.dragging = false;
        start = null;
        this.showGhost(null);
      }
    });

    el.addEventListener("pointermove", e => {
      if(pts.has(e.pointerId)) pts.set(e.pointerId, { x:e.clientX, y:e.clientY });

      if(pinch && pts.size >= 2){
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if(d > 4) this.setZoomK(pinch.k * (pinch.d / d));
        return;
      }

      if(start){
        const dx = e.clientX - start.x;
        start.moved = Math.max(start.moved, Math.hypot(dx, e.clientY - start.y));
        if(!this.dragging && Math.abs(dx) > 6) this.dragging = true;
        if(this.dragging){
          const k = (Math.PI * 2.3) / Math.max(1, el.clientWidth);   // a full swipe is a bit over half a turn
          const now = performance.now(), prev = this.yaw;
          this.yaw = start.yaw - dx * k;
          const dt = Math.max(8, now - start.t);
          const v = ((this.yaw - prev) / dt) * 1000;
          this.spin = this.spin * 0.6 + v * 0.4;                     // smoothed, so a jitter cannot fling it
          start.t = now;
          this.yawTarget = this.yaw;
          this.applyCamera();
          this.showGhost(null);
          return;
        }
      }
      if(this.held && !this.dragging){
        const spot = this.hoverAt(...this.worldAt(e));
        this.showGhost(spot, spot && this.canPlace(spot));
      }
    });

    const release = e => {
      if(!pts.has(e.pointerId) && pts.size) return;
      pts.delete(e.pointerId);
      if(pts.size < 2) pinch = null;
      if(pts.size > 0) return;                    // still a finger on the dome
      const dragged = this.dragging, moved = start ? start.moved : 999;
      start = null;
      this.dragging = false;
      if(dragged){
        this.spin = this.calm ? 0 : Math.max(-5, Math.min(5, this.spin));
        return;                                    // a drag is never a tap
      }
      this.spin = 0;
      if(moved <= 12) this.tap(e);
    };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);

    el.addEventListener("wheel", e => {
      e.preventDefault();
      this.setZoomK(this.zoomK * (1 + e.deltaY * 0.0012));
    }, { passive:false });
  },
  worldAt(e){
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    this.ray.ray.intersectPlane(this.pickPlane, hit);
    return hit ? [hit.x, hit.z] : [1e9, 1e9];
  },
  tap(e){
    if(this.held){
      const spot = this.hoverAt(...this.worldAt(e));
      if(spot && this.canPlace(spot) && this.onPlace) this.onPlace(spot);
      return;
    }
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.pointer, this.camera);
    const hits = this.ray.intersectObjects(Object.values(this.props || {}), true);
    if(hits.length){
      let o = hits[0].object;
      while(o && !o.userData.instanceId) o = o.parent;
      if(o && this.onPick) this.onPick(o.userData.placed);
    }
  },
  canPlace(spot){
    const occupied = Object.values(this.props).map(g => g.userData.placed);
    return !occupied.some(p => {
      if(p.room !== spot.room) return false;
      const f = this.footprint(ITEM_BY_ID[p.itemId], p.rot);
      return spot.x < p.x + f.w && spot.x + spot.f.w > p.x && spot.y < p.y + f.h && spot.y + spot.f.h > p.y;
    });
  },

  /* ---- the loop. Section 11: at least three ambient motions on screen. ---- */
  loop(){
    requestAnimationFrame(() => this.loop());
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;

    if(this.yawT < 1){
      this.yawT = Math.min(1, this.yawT + dt / 0.45);
      this.yaw = lerp(this.yawFrom, this.yawTarget, springOut(this.yawT, 0.6));
      this.applyCamera();
    }else if(!this.dragging && this.orbit){
      this.yaw += this.orbit * dt;
      this.yawTarget = this.yaw;
      this.applyCamera();
    }else if(!this.dragging && this.spin !== 0){
      // a flick keeps going and dies away, the one place a decay curve beats an ease
      this.yaw += this.spin * dt;
      this.spin *= Math.pow(0.05, dt);
      if(Math.abs(this.spin) < 0.06) this.spin = 0;
      this.yawTarget = this.yaw;
      this.applyCamera();
    }
    if(this.fly){
      const f = this.fly;
      f.t = Math.min(1, f.t + dt / f.ms);
      const e = easeOutSine(f.t);
      this.zoomK = lerp(f.fromK, f.toK, e);
      this.target.set(lerp(f.from.x, f.to.x, e), lerp(f.from.y, f.to.y, e), lerp(f.from.z, f.to.z, e));
      this.applyView();
      if(f.t >= 1){ this.fly = null; if(f.done) f.done(); }
    }
    if(this.zoomT < 1){
      this.zoomT = Math.min(1, this.zoomT + dt / 0.4);
      this.zoomK = lerp(this.zoomFrom, this.zoomTo, easeOutSine(this.zoomT));
      this.applyView();
    }
    const camXZ = new THREE.Vector2(Math.sin(this.yaw), Math.cos(this.yaw));
    (this.walls || []).forEach(w => {
      const facing = w.userData.normal.dot(camXZ);
      const want = facing > 0.25 ? 0.06 : 1;
      w.userData.opacity = lerp(w.userData.opacity, want, 1 - Math.pow(0.001, dt));
      w.material.opacity = w.userData.opacity;
      w.visible = w.userData.opacity > 0.08;
    });

    Object.values(this.props || {}).forEach(g => {
      const a = g.userData.anim;
      if(a){
        a.t += dt;
        const p = Math.min(1, a.t / a.dur);
        const e = springOut(p);
        g.position.y = FLOOR_Y + a.from * (1 - e);
        g.scale.y = CHUNK * lerp(0.9, 1, e);
        if(p >= 1){ g.userData.anim = null; g.position.y = FLOOR_Y; g.scale.y = CHUNK; }
      }
      if(g.userData.selected) g.position.y = FLOOR_Y + Math.sin(t * (Math.PI * 2 / 1.4)) * 0.02 + 0.02;
      g.userData.sways.forEach(s => { s.o.rotation.z = s.base + Math.sin(t * 1.1 + s.phase) * s.amp; });
    });
    this.terrain.children.forEach(c => {
      if(c.type !== "Group") return;
      c.children.forEach((f, i) => { if(f.userData.sway) f.rotation.z = Math.sin(t * 0.9 + i) * f.userData.sway; });
    });
    if(this.motes){
      const p = this.motes.geometry.attributes.position;
      for(let i = 0; i < p.count; i++){
        p.setY(i, p.getY(i) + dt * 0.16);
        if(p.getY(i) > 5) p.setY(i, 0);
        p.setX(i, p.getX(i) + Math.sin(t * 0.4 + i) * dt * 0.05);
      }
      p.needsUpdate = true;
    }
    this.weather.children.forEach(c => { if(c.geometry && c.geometry.type === "ConeGeometry") c.rotation.y = t * 0.05; });
    if(this.ghost && this.ghost.visible) this.ghost.position.y = FLOOR_Y + 0.04 + Math.sin(t * 4) * 0.03;
    if(this.pulse && this.pulse.visible){
      const b = 0.5 + Math.sin(t * 3.2) * 0.5;
      this.pulse.material.opacity = 0.32 + b * 0.45;
      const sc = TILE * (2.0 + b * 0.5);
      this.pulse.scale.set(sc, sc, 1);
    }

    this.renderer.render(this.scene, this.camera);
    this.frames++;
    if(t - this._lastFpsAt > 1){ this.fps = Math.round(this.frames / (t - this._lastFpsAt)); this.frames = 0; this._lastFpsAt = t; }
  },

  triangles(){
    let n = 0;
    this.scene.traverse(o => { if(o.geometry && o.visible) n += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3; });
    return Math.round(n);
  },
};

/* ---- offscreen renders: shop icons, showcase thumbnails and the
   section 16 silhouette checks. Every icon in the interface is a picture
   of a thing you can actually place. ---- */
const Offscreen = {
  cache:{},
  renderer:null,
  get r(){
    if(!this.renderer){
      this.renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true, preserveDrawingBuffer:true });
      this.renderer.setPixelRatio(1);
      this.renderer.outputEncoding = THREE.sRGBEncoding;
    }
    return this.renderer;
  },
  scene(objects, silhouette){
    const scene = new THREE.Scene();
    if(!silhouette){
      const key = new THREE.DirectionalLight(0xfff1dc, 0.78); key.position.set(-6, 9, 6);
      const fill = new THREE.HemisphereLight(0xdde9ee, 0xd8c6ad, 0.36);
      const rim = new THREE.DirectionalLight(0xcfe0e8, 0.2); rim.position.set(5, 4, -8);
      scene.add(key, fill, rim);
    }
    objects.forEach(o => {
      if(silhouette) o.traverse(m => { if(m.material) m.material = new THREE.MeshBasicMaterial({ color:0x000000 }); });
      scene.add(o);
    });
    return scene;
  },
  render(objects, size, opts){
    opts = opts || {};
    const r = this.r;
    const W = size.w || size, H = size.h || size;
    r.setSize(W, H, false);
    const scene = this.scene(objects, opts.silhouette);
    const bb = new THREE.Box3();
    objects.forEach(o => bb.expandByObject(o));
    const c = bb.getCenter(new THREE.Vector3());
    const v = opts.view || Math.max(bb.getSize(new THREE.Vector3()).length() * 0.56, 0.3);
    const a = W / H;
    const cam = new THREE.OrthographicCamera(-v * Math.max(1, a), v * Math.max(1, a),
                                             v / Math.min(1, a), -v / Math.min(1, a), 0.01, 300);
    const tilt = 32 * Math.PI / 180, yaw = opts.yaw || 0;
    cam.position.set(c.x + Math.sin(yaw) * Math.cos(tilt) * 80, c.y + Math.sin(tilt) * 80, c.z + Math.cos(yaw) * Math.cos(tilt) * 80);
    cam.lookAt(c);
    r.render(scene, cam);
    return r.domElement;
  },
  dataURL(objects, size, opts){ return this.render(objects, size, opts).toDataURL("image/png"); },
  icon(itemId, size){
    size = size || 128;
    const k = itemId + "@" + size;
    if(!this.cache[k]) this.cache[k] = this.dataURL([buildProp(itemId)], size);
    return this.cache[k];
  },
  /* alpha mask of a prop at one yaw, used by the section 16 checks */
  mask(itemId, size, yaw, view){
    const gl = this.render([buildProp(itemId)], size, { silhouette:true, yaw, view });
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const x = c.getContext("2d");
    x.drawImage(gl, 0, 0);
    const d = x.getImageData(0, 0, size, size).data;
    const bits = [];
    let filled = 0;
    for(let i = 0; i < size * size; i++){ const on = d[i * 4 + 3] > 128; if(on) filled++; bits.push(on ? 1 : 0); }
    return { filled:filled / (size * size), bits, size };
  },
  /* a whole lot rendered as a collectible thumbnail for the street */
  lotThumb(placed, size, seasonGround){
    const used = {};
    (placed || []).forEach(p => { used[p.room] = true; });
    if(!Object.keys(used).length) used.living = true;
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    ROOMS.forEach(r => {
      if(!used[r.id]) return;
      minX = Math.min(minX, r.ox); maxX = Math.max(maxX, r.ox + r.w * TILE);
      minZ = Math.min(minZ, r.oz); maxZ = Math.max(maxZ, r.oz + r.h * TILE);
    });
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const R = Math.hypot(maxX - cx, maxZ - cz) + 0.55;

    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(R, R + 0.06, 0.42, 44), mat("oat"));
    base.position.set(cx, -0.24, cz);
    const ground = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.42, R - 0.42, 0.16, 44), mat(seasonGround || "sage"));
    ground.position.set(cx, 0.05, cz);
    g.add(base, ground);
    ROOMS.forEach(r => {
      if(!used[r.id]) return;
      const floor = new THREE.Mesh(
        new THREE.BoxGeometry(r.w * TILE, 0.08, r.h * TILE),
        mat(r.id === "garden" ? "sage" : "softClay"));
      floor.position.set(r.ox + r.w * TILE / 2, 0.16, r.oz + r.h * TILE / 2);
      g.add(floor);
    });
    (placed || []).forEach(p => {
      const item = ITEM_BY_ID[p.itemId];
      if(!item) return;
      const f = p.rot % 2 === 0 ? { w:item.w, h:item.h } : { w:item.h, h:item.w };
      const r = ROOM_BY_ID[p.room] || ROOMS[0];
      const prop = buildProp(p.itemId);
      prop.position.set(r.ox + (p.x + f.w / 2) * TILE, 0.2, r.oz + (p.y + f.h / 2) * TILE);
      prop.rotation.y = p.rot * Math.PI / 2;
      g.add(prop);
    });
    return this.dataURL([g], size || { w:420, h:210 }, { view:R * 1.04 });
  },
};
