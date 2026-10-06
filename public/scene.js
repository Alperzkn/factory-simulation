// 3D digital twin scene: builds the plant once, then poses it from the frames streamed by the server.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MACH, CONV, TBL, PALLET_POS, RING, RING_L, ST, STOP_NAME, ringPos, WH, SLOTS, PALLET_QTY } from '/shared/plant.js';

const C = {
  body:0xE4E8EB, navy:0x24384A, blue:0x1D5F9A, steel:0xBAC5CD, dark:0x333D46, yellow:0xF0B400, glass:0x27394A, wood:0xC49A63,
  concrete:0xCDD2D5, red:0xC8402C, orange:0xE8641B, white:0xF5F7F8, rack:0x2A5C96, beam:0xE8841B, green:0x2B9A5A, asphalt:0x4B5257,
};
const LAMP_ON = {r:0xFF4A33, a:0xFFB21E, g:0x35D07A}, LAMP_OFF = {r:0x4A1B15, a:0x4D3A10, g:0x143D27};
const STAGE_COL = [0x565E65, 0xC0C9CF, 0xD0D7DC, 0xE6EBEE, 0x86A0B8];
const VIEWS = { plant:{tx:-19, tz:1.5, zoom:1}, line:{tx:-2.5, tz:0.5, zoom:2.3}, warehouse:{tx:-34, tz:1, zoom:2.1} };
const ISO_EL = Math.atan(1 / Math.SQRT2);

export function createScene(canvas, host, cb = {}) {
  const renderer = new THREE.WebGLRenderer({canvas, antialias:true, powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xDDE2E6);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 600);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xAEB9C2, 0.75));
  const sun = new THREE.DirectionalLight(0xFFF6E8, 2.6);
  sun.position.set(-4, 60, 42); sun.target.position.set(-16, 0, 0); scene.add(sun, sun.target);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, {left:-58, right:44, top:34, bottom:-34, near:1, far:170});
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.05;

  /* ---------------- helpers ---------------- */
  const mats = new Map();
  const M = (color, r = 0.72, m = 0) => { const k = `${color}|${r}|${m}`; if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({color, roughness:r, metalness:m, envMapIntensity:0.55})); return mats.get(k); };
  const metal = c => M(c, 0.38, 0.75);
  const basic = c => new THREE.MeshBasicMaterial({color:c});
  const glassMat = new THREE.MeshStandardMaterial({color:0xBFE0F2, transparent:true, opacity:0.22, roughness:0.08, metalness:0.2, envMapIntensity:1, depthWrite:false});
  const asMat = m => (typeof m === 'number' ? M(m) : m);
  const add = (p, o, shadow = true) => { o.castShadow = shadow; o.receiveShadow = true; p.add(o); return o; };
  const box = (p, w, h, d, x, y, z, m, rad = 0) => { const o = new THREE.Mesh(rad ? new RoundedBoxGeometry(w, h, d, 3, Math.min(rad, w / 2.01, h / 2.01, d / 2.01)) : new THREE.BoxGeometry(w, h, d), asMat(m)); o.position.set(x, y, z); return add(p, o); };
  const cyl = (p, r, h, x, y, z, m, seg = 20, r2 = r) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, h, seg), asMat(m)); o.position.set(x, y, z); return add(p, o); };
  const cylX = (p, r, len, x, y, z, m, seg = 16) => { const o = cyl(p, r, len, x, y, z, m, seg); o.rotation.z = Math.PI / 2; return o; };
  const cylZ = (p, r, len, x, y, z, m, seg = 16) => { const o = cyl(p, r, len, x, y, z, m, seg); o.rotation.x = Math.PI / 2; return o; };
  const grp = (p, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); p.add(g); return g; };
  const canvasTex = (w, h, draw) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const c = cv.getContext('2d'); if (draw) draw(c, w, h); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return {cv, c, t}; };
  const FONT = '"Barlow Condensed", "Arial Narrow", Arial, sans-serif';
  const plate = (p, text, w, h, x, y, z, ry = 0, bg = '#16232D', fg = '#FFFFFF') => {
    const T = canvasTex(512, Math.round(512 * h / w), (c, cw, ch) => { c.fillStyle = bg; c.fillRect(0, 0, cw, ch); c.fillStyle = fg; c.font = `600 ${Math.round(ch * 0.62)}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, cw / 2, ch / 2 + ch * 0.04, cw - 24); });
    const o = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({map:T.t})); o.position.set(x, y, z); o.rotation.y = ry; p.add(o); return o;
  };
  const pickables = [];
  // invisible, generous click targets for small or moving things
  const hitMat = new THREE.MeshBasicMaterial({visible:false});
  const hit = (g, w, h, d, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), hitMat); o.position.set(0, h / 2, z); g.add(o); };
  const ent = (g, type, id, name) => { g.userData.ent = {type, id, name}; pickables.push(g); return g; };

  /* ---------------- floor ---------------- */
  const FX0 = -46, FZ0 = -15.4, FW = 63, FD = 30.8, PPM = 65;
  const floorT = canvasTex(Math.round(FW * PPM), Math.round(FD * PPM), (c, cw, ch) => {
    const X = x => (x - FX0) * PPM, Z = z => (z - FZ0) * PPM;
    const rect = (x0, z0, x1, z1, fill) => { c.fillStyle = fill; c.fillRect(X(Math.min(x0, x1)), Z(Math.min(z0, z1)), Math.abs(x1 - x0) * PPM, Math.abs(z1 - z0) * PPM); };
    const line = (x0, z0, x1, z1, col, wm = 0.1, dash) => { c.strokeStyle = col; c.lineWidth = wm * PPM; c.setLineDash(dash ? dash.map(v => v * PPM) : []); c.beginPath(); c.moveTo(X(x0), Z(z0)); c.lineTo(X(x1), Z(z1)); c.stroke(); c.setLineDash([]); };
    const outline = (x0, z0, x1, z1, col, wm = 0.1, dash) => { c.strokeStyle = col; c.lineWidth = wm * PPM; c.setLineDash(dash ? dash.map(v => v * PPM) : []); c.strokeRect(X(Math.min(x0, x1)), Z(Math.min(z0, z1)), Math.abs(x1 - x0) * PPM, Math.abs(z1 - z0) * PPM); c.setLineDash([]); };
    const hatch = (x0, z0, x1, z1, col, pitch = 0.45, wm = 0.14, alpha = 0.75) => {
      c.save(); c.beginPath(); c.rect(X(Math.min(x0, x1)), Z(Math.min(z0, z1)), Math.abs(x1 - x0) * PPM, Math.abs(z1 - z0) * PPM); c.clip(); c.globalAlpha = alpha; c.strokeStyle = col; c.lineWidth = wm * PPM;
      const span = (Math.abs(x1 - x0) + Math.abs(z1 - z0)) * PPM; for (let k = -span; k < span; k += pitch * PPM) { c.beginPath(); c.moveTo(X(Math.min(x0, x1)) + k, Z(Math.max(z0, z1))); c.lineTo(X(Math.min(x0, x1)) + k + span, Z(Math.max(z0, z1)) - span); c.stroke(); }
      c.restore(); outline(x0, z0, x1, z1, col, 0.1);
    };
    const text = (s, x, z, size = 0.8, col = 'rgba(70,84,95,.85)', align = 'left') => { c.font = `600 ${size * PPM}px ${FONT}`; c.fillStyle = col; c.textAlign = align; c.textBaseline = 'middle'; c.fillText(s.toUpperCase(), X(x), Z(z)); };

    // sealed concrete with casting bays and wear
    c.fillStyle = '#CDD2D5'; c.fillRect(0, 0, cw, ch);
    rect(-46, -15.4, -22, 15.4, '#D2D5D1');
    for (let k = 0; k < 26000; k++) { c.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.05)' : 'rgba(40,55,66,.045)'; c.fillRect(Math.random() * cw, Math.random() * ch, 1 + Math.random() * 3, 1 + Math.random() * 3); }
    for (let x = -40; x < 17; x += 6) line(x, -15.4, x, 15.4, 'rgba(120,132,141,.38)', 0.035);
    for (let z = -12; z < 15; z += 6) line(-46, z, 17, z, 'rgba(120,132,141,.38)', 0.035);

    // pedestrian route
    rect(-21.4, 0.3, 9, 1.7, '#B9D2C3'); line(-21.4, 0.3, 9, 0.3, '#F4F6F4', 0.08); line(-21.4, 1.7, 9, 1.7, '#F4F6F4', 0.08);
    rect(-18.5, 0.2, -16.5, 1.8, '#CDD2D5'); for (let x = -18.4; x < -16.6; x += 0.5) rect(x, 0.3, x + 0.25, 1.7, '#F4F6F4');
    for (let x = -14; x < 9; x += 5.5) { c.save(); c.translate(X(x), Z(1)); c.fillStyle = 'rgba(255,255,255,.8)'; c.beginPath(); c.arc(0, -0.34 * PPM, 0.1 * PPM, 0, 7); c.fill(); c.fillRect(-0.08 * PPM, -0.2 * PPM, 0.16 * PPM, 0.34 * PPM); c.fillRect(-0.09 * PPM, 0.14 * PPM, 0.07 * PPM, 0.3 * PPM); c.fillRect(0.02 * PPM, 0.14 * PPM, 0.07 * PPM, 0.3 * PPM); c.restore(); }

    // AGV loop
    for (const off of [-0.75, 0.75]) outline(RING.x0 - off, RING.z0 - off, RING.x1 + off, RING.z1 + off, '#E9B000', 0.11);
    outline(RING.x0, RING.z0, RING.x1, RING.z1, 'rgba(60,80,95,.5)', 0.05, [0.5, 0.5]);
    for (let s = 5; s < RING_L; s += 10) { const p = ringPos(s); c.save(); c.translate(X(p.x), Z(p.z)); c.rotate(-p.yaw); c.strokeStyle = '#E9B000'; c.lineWidth = 0.09 * PPM; c.beginPath(); c.moveTo(-0.25 * PPM, -0.3 * PPM); c.lineTo(0.2 * PPM, 0); c.lineTo(-0.25 * PPM, 0.3 * PPM); c.stroke(); c.restore(); }
    for (const s of Object.values(ST)) { const p = ringPos(s), hz = Math.abs(Math.cos(p.yaw)) > 0.5; hatch(p.x - (hz ? 1.3 : 0.68), p.z - (hz ? 0.68 : 1.3), p.x + (hz ? 1.3 : 0.68), p.z + (hz ? 0.68 : 1.3), '#E9B000', 0.4, 0.12, 0.6); }

    // station footprints and codes
    for (const d of MACH) { if (d.type === 'robot') continue; outline(d.x - d.hw - 0.45, d.z - 1.65, d.x + d.hw + 0.45, d.z + 1.55, '#E9B000', 0.08); text(d.id, d.x - d.hw - 0.3, d.z + 2.05, 0.55); }
    hatch(-16.2, 3.2, -11.0, 6.8, '#E9B000', 0.5, 0.1, 0.35); text('M7 robot cell', -16.1, 7.25, 0.5);
    for (const t of Object.values(TBL)) { outline(t.x - 1.75, t.z - 1.25, t.x + 1.75, t.z + 1.25, '#2A6FB0', 0.08); text(t.id, t.x - 1.7, t.z + 1.65, 0.5, 'rgba(42,111,176,.9)'); }
    text('Machining', -0.6, -7.7, 0.85); text('Finishing and packing', -12.6, 8.25, 0.85); text('Maintenance', 8.4, 0.95, 0.55);
    hatch(2.4, -14.9, 11.6, -12.9, '#C8402C', 0.5, 0.1, 0.4); text('Utilities, keep clear', 2.6, -12.5, 0.5, 'rgba(160,50,35,.9)');

    // warehouse
    outline(WH.aisle1 - 1.5, -14.2, WH.aisle1 + 1.5, 14.6, '#E9B000', 0.1); line(WH.aisle1, -14.2, WH.aisle1, 14.6, 'rgba(255,255,255,.75)', 0.07, [0.8, 0.8]);
    outline(WH.aisle2 - 1.6, -14.2, WH.aisle2 + 1.6, 14.2, '#E9B000', 0.1); line(WH.aisle2, -14.2, WH.aisle2, 14.2, 'rgba(255,255,255,.75)', 0.07, [0.8, 0.8]);
    rect(-42.5, -1.6, -23.2, 1.6, '#D2D5D1'); line(-42.5, -1.6, -23.2, -1.6, '#E9B000', 0.1); line(-42.5, 1.6, -23.2, 1.6, '#E9B000', 0.1);
    for (const s of SLOTS) if (s.level === 0) { outline(WH.rackX - 0.62, s.z - 0.72, WH.rackX + 0.62, s.z + 0.72, 'rgba(42,111,176,.7)', 0.05); }
    for (const z of [...WH.rawStandZ, ...WH.fgStandZ]) outline(WH.standX - 0.8, z - 0.75, WH.standX + 0.8, z + 0.75, '#2A6FB0', 0.09);
    for (const z of [WH.inboundZ, WH.outboundZ]) { hatch(-45.6, z - 1.9, -40.6, z + 1.9, '#E9B000', 0.55, 0.12, 0.5); }
    hatch(-23.6, 12.3, -21.4, 14.7, '#2B9A5A', 0.4, 0.1, 0.5);
    text('Raw material', -34.2, 13.4, 0.8); text('Finished goods', -34.6, -13.5, 0.8);
    text('Dock 1 receiving', -45.4, 10.6, 0.6); text('Dock 2 shipping', -45.4, -10.6, 0.6);
    text('Raw to line', -22.2, 10.75, 0.45, 'rgba(42,111,176,.9)'); text('Finished from line', -22.4, -6.3, 0.45, 'rgba(42,111,176,.9)');
    text('Forklift charging', -23.6, 11.85, 0.4, 'rgba(30,110,65,.9)');
    line(-22, -15.4, -22, -1.8, 'rgba(60,80,95,.55)', 0.12, [1, 0.6]); line(-22, 1.8, -22, 15.4, 'rgba(60,80,95,.55)', 0.12, [1, 0.6]);
  });
  { const o = new THREE.Mesh(new THREE.PlaneGeometry(FW, FD), new THREE.MeshStandardMaterial({map:floorT.t, roughness:0.62, metalness:0.02, envMapIntensity:0.5}));
    o.rotation.x = -Math.PI / 2; o.position.set(FX0 + FW / 2, 0, 0); o.receiveShadow = true; scene.add(o); }
  box(scene, FW + 0.6, 1.6, FD + 0.6, FX0 + FW / 2, -0.81, 0, M(0xB4BBC1, 0.9)).castShadow = false;
  { const o = new THREE.Mesh(new THREE.PlaneGeometry(40, FD + 8), M(C.asphalt, 0.95)); o.rotation.x = -Math.PI / 2; o.position.set(-66.3, -1.1, 0); o.receiveShadow = true; scene.add(o);
    for (const z of [WH.inboundZ, WH.outboundZ]) for (const dz of [-2.1, 2.1]) { const l = new THREE.Mesh(new THREE.PlaneGeometry(13, 0.14), basic(0xE8EAEC)); l.rotation.x = -Math.PI / 2; l.position.set(-53, -1.09, z + dz); scene.add(l); } }

  /* ---------------- building shell (cutaway: back and dock walls only) ---------------- */
  const wallM = M(0xE9EDF0, 0.85), plinth = M(0xAEB7BE, 0.9), ribT = canvasTex(64, 64, (c) => { c.fillStyle = '#E9EDF0'; c.fillRect(0, 0, 64, 64); c.fillStyle = '#D5DBE0'; c.fillRect(0, 0, 3, 64); });
  ribT.t.wrapS = ribT.t.wrapT = THREE.RepeatWrapping;
  const panel = (len) => { const t = ribT.t.clone(); t.needsUpdate = true; t.repeat.set(len / 0.5, 1); return new THREE.MeshStandardMaterial({map:t, roughness:0.8, envMapIntensity:0.4}); };
  const shell = grp(scene);
  box(shell, 63.6, 1.1, 0.34, -14.5, 0.55, -15.57, plinth); box(shell, 63.6, 4.2, 0.26, -14.5, 3.2, -15.57, panel(63.6)); box(shell, 63.6, 0.16, 0.4, -14.5, 5.36, -15.57, C.blue);
  for (let x = -40; x <= 14; x += 6) { box(shell, 3.4, 0.9, 0.3, x, 3.9, -15.52, new THREE.MeshStandardMaterial({color:0x9CC6DE, roughness:0.1, metalness:0.3, emissive:0x8FBFD9, emissiveIntensity:0.35})); }
  const wallSeg = (z0, z1, y0 = 0, y1 = 5.28) => { const len = z1 - z0, zc = (z0 + z1) / 2; if (y0 < 1.1) box(shell, 0.34, Math.min(1.1, y1) - y0, len, -46.17, (y0 + Math.min(1.1, y1)) / 2, zc, plinth); const a = Math.max(y0, 1.1); if (y1 > a) { const m = panel(len); const o = box(shell, 0.26, y1 - a, len, -46.17, (a + y1) / 2, zc, m); o.rotation.y = 0; } };
  wallSeg(-15.7, WH.outboundZ - 1.8); wallSeg(WH.outboundZ + 1.8, WH.inboundZ - 1.8); wallSeg(WH.inboundZ + 1.8, 15.7);
  wallSeg(WH.outboundZ - 1.8, WH.outboundZ + 1.8, 3.5); wallSeg(WH.inboundZ - 1.8, WH.inboundZ + 1.8, 3.5);
  box(shell, 0.4, 0.16, 31.4, -46.17, 5.36, 0, C.blue);
  for (let x = -46; x <= 17; x += 9) { box(shell, 0.32, 5.3, 0.32, x, 2.65, -15.3, metal(0x7D8B96)); box(shell, 0.5, 0.9, 0.5, x, 0.45, -15.25, C.yellow); }
  for (const z of [-15, -4.5, 4.5, 15]) box(shell, 0.32, 5.3, 0.32, -45.9, 2.65, z, metal(0x7D8B96));
  box(shell, 0.4, 0.3, 30.8, 17.2, 0.15, 0, plinth); box(shell, 63.4, 0.3, 0.4, -14.5, 0.15, 15.6, plinth);
  cylX(shell, 0.06, 62, -14.5, 4.25, -15.3, M(0x2A6FB0, 0.5, 0.2)); box(shell, 62, 0.08, 0.4, -14.5, 4.75, -15.2, metal(0x9AA6AF));
  for (let x = -43; x < 17; x += 6) box(shell, 0.05, 0.5, 0.05, x, 5.0, -15.2, metal(0x9AA6AF));
  // doors, signage, fire points
  box(shell, 1.1, 2.2, 0.08, -19, 1.1, -15.38, M(0x5E7385)); box(shell, 0.7, 0.24, 0.05, -19, 2.5, -15.36, basic(0x2FBF71));
  for (const x of [-34, -6, 12]) { box(shell, 0.5, 0.7, 0.04, x, 1.75, -15.38, M(C.red)); cyl(shell, 0.09, 0.5, x, 1.0, -15.25, M(C.red, 0.4, 0.3), 12); }

  // dock doors, levellers, signals
  const docks = [WH.inboundZ, WH.outboundZ].map((z, k) => {
    const g = grp(scene);
    const door = box(g, 0.1, 3.5, 3.6, -46.05, 1.75, z, M(0x8693A0, 0.6, 0.3));
    for (let i = 0; i < 6; i++) box(door, 0.02, 0.03, 3.6, 0.06, -1.5 + i * 0.6, 0, M(0x6B7882));
    box(g, 0.5, 3.9, 0.3, -46.4, 1.75, z - 1.95, C.dark); box(g, 0.5, 3.9, 0.3, -46.4, 1.75, z + 1.95, C.dark); box(g, 0.5, 0.35, 4.2, -46.4, 3.7, z, C.dark);
    box(g, 2.2, 0.04, 3.0, -44.9, 0.02, z, metal(0x8D99A3)); box(g, 0.08, 0.05, 3.0, -43.8, 0.03, z, C.yellow);
    for (const dz of [-2.2, 2.2]) cyl(g, 0.09, 1.0, -43.6, 0.5, z + dz, C.yellow, 12);
    const lamp = box(g, 0.12, 0.28, 0.28, -45.95, 2.9, z + 2.3, basic(0xD2452F)); box(g, 0.16, 0.7, 0.36, -45.99, 2.75, z + 2.3, C.dark);
    plate(g, `DOCK ${k + 1}`, 1.5, 0.45, -45.98, 4.3, z, Math.PI / 2);
    return {door, lamp};
  });

  /* ---------------- conveyors ---------------- */
  let rollerN = 0; CONV.forEach(c => { rollerN += Math.floor(c.len / 0.2); });
  const rollers = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.045, 0.68, 10).rotateX(Math.PI / 2), metal(0xA9B4BC), rollerN); rollers.castShadow = true; rollers.receiveShadow = true; scene.add(rollers);
  { let n = 0; const d = new THREE.Object3D();
    CONV.forEach((c, i) => {
      const g = ent(grp(scene), 'conveyor', i, `${c.id} conveyor`), mid = (c.x0 + c.x1) / 2, lo = Math.min(c.x0, c.x1);
      box(g, c.len, 0.16, 0.06, mid, 0.86, c.z + 0.39, C.navy); box(g, c.len, 0.16, 0.06, mid, 0.86, c.z - 0.39, C.navy);
      box(g, c.len, 0.03, 0.7, mid, 0.8, c.z, C.dark); box(g, c.len, 0.05, 0.03, mid, 1.0, c.z + 0.4, C.steel); box(g, c.len, 0.05, 0.03, mid, 1.0, c.z - 0.4, C.steel);
      const legs = Math.max(2, Math.round(c.len / 1.5));
      for (let k = 0; k < legs; k++) { const x = lo + 0.2 + k * (c.len - 0.4) / (legs - 1); for (const dz of [-0.36, 0.36]) { box(g, 0.07, 0.78, 0.07, x, 0.39, c.z + dz, C.steel); box(g, 0.16, 0.03, 0.16, x, 0.015, c.z + dz, C.dark); } box(g, 0.05, 0.05, 0.72, x, 0.3, c.z, C.steel); }
      box(g, 0.34, 0.3, 0.26, lo + 0.45, 0.6, c.z - 0.56, C.blue, 0.04); cylZ(g, 0.1, 0.22, lo + 0.45, 0.6, c.z - 0.78, C.dark);
      box(g, 0.06, 0.1, 0.06, c.x1 + (c.x1 > c.x0 ? -0.2 : 0.2), 1.06, c.z + 0.43, C.yellow); box(g, 0.06, 0.1, 0.06, c.x1 + (c.x1 > c.x0 ? -0.2 : 0.2), 1.06, c.z - 0.43, C.dark);
      const cnt = Math.floor(c.len / 0.2); for (let k = 0; k < cnt; k++) { d.position.set(lo + 0.1 + k * (c.len - 0.2) / (cnt - 1), 0.875, c.z); d.updateMatrix(); rollers.setMatrixAt(n++, d.matrix); }
    });
  }

  /* ---------------- buffer tables, pallet stand, bins ---------------- */
  for (const [key, t] of Object.entries(TBL)) {
    const g = ent(grp(scene, t.x, 0, t.z), 'buffer', key, `${t.id} ${t.name.toLowerCase()}`);
    box(g, 3, 0.06, 2, 0, 0.89, 0, metal(0xA7B3BC)); box(g, 3, 0.12, 0.05, 0, 0.92, 1.0, C.navy); box(g, 3, 0.12, 0.05, 0, 0.92, -1.0, C.navy); box(g, 0.05, 0.12, 2, -1.5, 0.92, 0, C.navy);
    for (const [dx, dz] of [[-1.4, -0.9], [1.4, -0.9], [-1.4, 0.9], [1.4, 0.9]]) { box(g, 0.08, 0.86, 0.08, dx, 0.43, dz, C.dark); box(g, 0.18, 0.03, 0.18, dx, 0.015, dz, C.dark); }
    box(g, 2.8, 0.05, 0.05, 0, 0.3, 0.9, C.dark); box(g, 2.8, 0.05, 0.05, 0, 0.3, -0.9, C.dark);
    box(g, 0.05, 1.5, 0.05, 1.45, 1.65, -0.95, C.dark); plate(g, t.id, 0.9, 0.34, 1.0, 2.25, -0.95, 0, '#1D5F9A');
  }
  const palletGeo = new THREE.BoxGeometry(1.2, 0.14, 1.2);
  { const g = ent(grp(scene, PALLET_POS.x, 0, PALLET_POS.z), 'palletStation', 0, 'Palletiser pallet position');
    box(g, 1.5, 0.08, 1.5, 0, 0.04, 0, metal(0x8D99A3)); for (const dz of [-0.6, 0.6]) box(g, 1.5, 0.06, 0.08, 0, 0.11, dz, C.yellow); }
  for (const [x, z, id] of [[4.2, -6.75, 'M3'], [-9.55, 3.3, 'M6']]) { const g = ent(grp(scene, x, 0, z), 'scrap', id, `Scrap bin at ${id}`); box(g, 0.85, 0.7, 0.85, 0, 0.4, 0, M(C.red, 0.6), 0.04); box(g, 0.75, 0.04, 0.75, 0, 0.74, 0, C.dark); for (const dx of [-0.3, 0.3]) cylZ(g, 0.06, 0.9, dx, 0.06, 0, C.dark, 10); }

  /* ---------------- machines ---------------- */
  const hmiDraw = (c, w, h, d, m) => {
    c.fillStyle = '#0E1B26'; c.fillRect(0, 0, w, h);
    const col = {RUN:'#35D07A', IDLE:'#9BA8B3', BLOCKED:'#FFB21E', DOWN:'#FF4A33', OFF:'#55616B'}[m ? m.state : 'OFF'];
    c.fillStyle = col; c.fillRect(0, 0, w, 14);
    c.fillStyle = '#fff'; c.font = `600 34px ${FONT}`; c.textBaseline = 'top'; c.textAlign = 'left'; c.fillText(d.id, 8, 20);
    c.fillStyle = col; c.font = `600 22px ${FONT}`; c.fillText(m ? m.stateLabel.toUpperCase().slice(0, 14) : 'OFFLINE', 8, 58);
    c.fillStyle = '#B9C5CE'; c.font = `500 18px ${FONT}`; c.fillText(m ? `PARTS ${m.counters.parts}` : '', 8, 86);
    if (m) { c.fillStyle = '#24384A'; c.fillRect(8, 112, w - 16, 8); c.fillStyle = col; c.fillRect(8, 112, (w - 16) * m.cycle.progress / 100, 8); }
  };
  const machVis = MACH.map((d, i) => {
    const g = ent(grp(scene, d.x, 0, d.z), 'machine', i, `${d.id} ${d.name}`), v = {g, lamps:null, win:null, extra:{}};
    const hmi = canvasTex(160, 128, (c, w, h) => hmiDraw(c, w, h, d, null)); v.hmi = hmi;
    const screen = (x, y, z, w = 0.42, h = 0.34, ry = 0) => { const o = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({map:hmi.t})); o.position.set(x, y, z); o.rotation.y = ry; g.add(o); };
    const pendant = (x, y, z = 1.2) => { box(g, 0.06, 0.06, 0.5, x, y + 0.45, z - 0.25, C.dark); box(g, 0.06, 0.5, 0.06, x, y + 0.22, z, C.dark); box(g, 0.56, 0.74, 0.12, x, y, z, C.navy, 0.03); screen(x, y + 0.14, z + 0.065); box(g, 0.4, 0.14, 0.02, x, y - 0.2, z + 0.065, M(0x56636E)); cyl(g, 0.035, 0.03, x + 0.2, y - 0.3, z + 0.07, M(C.red), 10).rotation.x = Math.PI / 2; };
    const cabinet = (x, z, w = 0.8, h = 1.9) => { box(g, w, h, 0.5, x, h / 2, z, M(0xCBD3D9, 0.6), 0.02); box(g, w - 0.1, 0.25, 0.02, x, h - 0.3, z + 0.26, C.dark); box(g, 0.04, 0.3, 0.03, x + w / 2 - 0.1, h / 2, z + 0.26, C.dark); box(g, 0.14, 0.14, 0.02, x - w / 2 + 0.16, h - 0.62, z + 0.26, M(C.yellow)); };
    const window_ = (w, h, x, y, z) => { box(g, w + 0.12, h + 0.12, 0.05, x, y, z - 0.01, C.navy, 0.02); return box(g, w, h, 0.05, x, y, z + 0.01, new THREE.MeshStandardMaterial({color:C.glass, roughness:0.1, metalness:0.4, emissive:0x8FD0F5, emissiveIntensity:0})); };
    let lx = d.hw - 0.3, lz = -0.7, ly = d.h;
    if (d.type === 'lathe') {
      box(g, 3.0, 0.28, 2.2, 0, 0.14, 0, C.navy); box(g, 3.0, 1.5, 2.16, 0, 1.03, 0, M(C.body, 0.55), 0.06); box(g, 2.9, 0.26, 2.06, 0, 1.9, 0, M(C.blue, 0.5), 0.05);
      box(g, 1.55, 1.12, 0.06, -0.45, 1.12, 1.09, M(0xD3D9DE, 0.5), 0.03); v.win = window_(1.0, 0.62, -0.45, 1.24, 1.12); box(g, 0.05, 0.5, 0.06, 0.24, 1.1, 1.15, metal(0x8D99A3));
      pendant(1.05, 1.25); cabinet(0.9, -1.36); box(g, 0.9, 0.5, 0.55, -0.7, 0.25, -1.4, M(0x7C8A95)); cylX(g, 0.05, 0.5, -0.7, 0.6, -1.4, C.dark, 8);
      const chip = box(g, 1.5, 0.22, 0.5, -2.0, 0.62, -0.45, C.dark); chip.rotation.z = -0.5; box(g, 0.85, 0.75, 0.85, -2.75, 0.375, -0.45, M(C.blue, 0.6), 0.03); box(g, 0.75, 0.05, 0.75, -2.75, 0.76, -0.45, metal(0x9AA6AF));
      cyl(g, 0.22, 0.5, 0.9, 2.28, -0.5, M(0xD3D9DE, 0.5)); cyl(g, 0.09, 0.3, 0.9, 2.65, -0.5, C.dark, 12);
      plate(g, `${d.id}  CNC LATHE`, 1.3, 0.2, -0.45, 1.9, 1.04);
    } else if (d.type === 'mill') {
      box(g, 2.4, 0.28, 2.2, 0, 0.14, 0, C.navy); box(g, 2.4, 2.0, 2.16, 0, 1.28, 0, M(C.body, 0.55), 0.06); box(g, 2.3, 0.22, 2.06, 0, 2.36, 0, M(C.blue, 0.5), 0.05);
      box(g, 0.95, 0.55, 0.95, 0, 2.72, -0.25, C.navy, 0.05); cyl(g, 0.2, 0.5, 0, 3.2, -0.25, M(0x56636E, 0.5, 0.4)); cylZ(g, 0.55, 0.3, -1.22, 1.7, -0.3, M(0xD3D9DE, 0.5), 24).rotation.set(0, 0, Math.PI / 2);
      box(g, 1.2, 1.3, 0.06, -0.4, 1.3, 1.09, M(0xD3D9DE, 0.5), 0.03); v.win = window_(0.8, 0.8, -0.4, 1.42, 1.12); box(g, 0.05, 0.5, 0.06, 0.14, 1.25, 1.15, metal(0x8D99A3));
      for (const sx of [-1, 1]) box(g, 0.04, 0.36, 0.9, sx * 1.21, 1.05, 0, C.dark);
      pendant(0.8, 1.3); cabinet(0.6, -1.36, 0.9, 2.1); box(g, 0.8, 0.5, 0.5, -0.6, 0.25, -1.4, M(0x7C8A95));
      plate(g, `${d.id}  DRILLING CENTRE`, 1.5, 0.18, -0.2, 2.36, 1.04); ly = 2.47; lx = 0.95; lz = 0.7;
    } else if (d.type === 'bal') {
      box(g, 2.2, 0.16, 1.6, 0, 0.08, 0, C.navy); box(g, 2.2, 0.76, 1.6, 0, 0.54, 0, M(C.body, 0.55), 0.04); box(g, 2.24, 0.06, 1.64, 0, 0.94, 0, metal(0x8D99A3));
      box(g, 0.5, 1.25, 0.45, 0, 1.58, -0.52, M(C.blue, 0.5), 0.04); box(g, 0.34, 0.18, 0.7, 0, 2.1, -0.2, C.navy, 0.03); cyl(g, 0.05, 0.5, 0, 1.8, 0.1, metal(0x8D99A3), 10);
      cyl(g, 0.16, 0.08, 0, 0.99, 0.1, C.dark); v.extra.spin = cyl(g, 0.13, 0.05, 0, 1.03, 0.1, metal(0xB9C4CC), 6);
      box(g, 0.22, 0.22, 0.3, 0.55, 1.1, -0.1, M(0x56636E)); cylX(g, 0.03, 0.25, 0.4, 1.12, 0.05, metal(0xB9C4CC), 8);
      const hood = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.85, 1.1, 2, 0.06), glassMat); hood.position.set(0, 1.42, 0.12); g.add(hood);
      box(g, 0.05, 0.9, 0.05, 0.95, 1.4, 0.55, C.dark); box(g, 0.58, 0.46, 0.08, 0.95, 1.7, 0.6, C.navy, 0.02); screen(0.95, 1.7, 0.645, 0.48, 0.38);
      cabinet(-0.75, -1.05, 0.6, 1.5); plate(g, `${d.id}  BALANCER`, 1.1, 0.16, 0, 0.6, 0.805); ly = 2.2; lx = 0; lz = -0.55;
    } else if (d.type === 'wash') {
      for (const [dx, dz] of [[-1.5, -0.75], [1.5, -0.75], [-1.5, 0.75], [1.5, 0.75], [0, -0.75], [0, 0.75]]) box(g, 0.1, 0.48, 0.1, dx, 0.24, dz, C.dark);
      box(g, 3.4, 0.1, 1.9, 0, 0.5, 0, C.navy); box(g, 3.4, 1.2, 1.8, 0, 1.15, 0, metal(0xC2CCD3), 0.06);
      for (const sx of [-1, 1]) box(g, 0.05, 0.36, 0.9, sx * 1.71, 1.06, 0, C.dark);
      for (const x of [-1.0, 0, 1.0]) { box(g, 0.62, 0.5, 0.04, x, 1.25, 0.91, C.navy, 0.02); box(g, 0.5, 0.38, 0.04, x, 1.25, 0.93, new THREE.MeshStandardMaterial({color:0x4F6F86, roughness:0.1, metalness:0.5})); }
      cyl(g, 0.17, 1.0, 0.9, 2.25, -0.45, metal(0xC2CCD3)); cyl(g, 0.23, 0.08, 0.9, 2.78, -0.45, C.dark);
      cylX(g, 0.06, 2.4, -0.2, 1.84, -0.6, M(0x2A6FB0, 0.5, 0.2), 10); cylX(g, 0.05, 2.0, -0.4, 1.84, 0.3, M(C.red, 0.5, 0.2), 10);
      box(g, 0.7, 0.42, 0.6, -1.0, 0.24, -1.3, M(C.blue, 0.5), 0.03); cylX(g, 0.16, 0.5, -0.3, 0.24, -1.3, M(0x56636E, 0.5, 0.4));
      box(g, 0.5, 0.7, 0.14, 1.25, 1.3, 0.98, C.navy, 0.03); screen(1.25, 1.42, 1.055);
      v.extra.steam = [0, 1, 2].map(() => { const s = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:0, depthWrite:false})); g.add(s); return s; });
      plate(g, `${d.id}  WASHER`, 0.9, 0.16, -0.9, 1.62, 0.905); ly = 1.75; lx = -1.45; lz = -0.65;
    } else if (d.type === 'oven') {
      box(g, 3.6, 0.24, 2.2, 0, 0.12, 0, C.navy); box(g, 2.5, 1.86, 2.16, -0.55, 1.17, 0, M(C.blue, 0.5), 0.06); box(g, 1.1, 2.0, 2.16, 1.25, 1.24, 0, M(C.body, 0.55), 0.06);
      for (const sx of [-1, 1]) box(g, 0.05, 0.36, 0.9, sx * 1.81, 1.06, 0, C.dark);
      v.win = box(g, 1.8, 0.2, 0.05, -0.6, 1.3, 1.09, basic(0xFF8A30)); box(g, 1.9, 0.3, 0.04, -0.6, 1.3, 1.085, C.navy, 0.02);
      for (const y of [1.6, 1.85]) box(g, 0.8, 0.14, 0.03, 1.25, y, 1.09, C.dark);
      cyl(g, 0.17, 1.3, -1.2, 2.75, -0.5, metal(0xC2CCD3)); cyl(g, 0.17, 1.3, 0.0, 2.75, -0.5, metal(0xC2CCD3)); cyl(g, 0.2, 0.7, 1.25, 2.6, -0.4, metal(0xC2CCD3)); cyl(g, 0.3, 0.08, 1.25, 2.98, -0.4, C.dark);
      box(g, 0.6, 0.6, 0.5, -1.2, 0.54, -1.3, M(0x7C8A95), 0.03); cylZ(g, 0.07, 0.3, -1.2, 0.7, -1.05, M(C.yellow, 0.5, 0.3), 10);
      box(g, 0.5, 0.7, 0.14, 1.25, 1.2, 1.12, C.navy, 0.03); screen(1.25, 1.32, 1.195);
      cabinet(0.2, -1.36, 0.9, 1.9); plate(g, `${d.id}  COATING OVEN`, 1.4, 0.18, -0.6, 1.82, 1.085); ly = 2.25; lx = 1.6; lz = 0.8;
    } else if (d.type === 'insp') {
      box(g, 2.2, 0.16, 1.5, 0, 0.08, 0, C.navy); box(g, 2.2, 0.7, 1.5, 0, 0.51, 0, M(C.body, 0.55), 0.04); box(g, 2.24, 0.08, 1.54, 0, 0.9, 0, M(0x3B434A, 0.3, 0.1));
      for (const [dx, dz] of [[-1.05, -0.7], [1.05, -0.7], [-1.05, 0.7], [1.05, 0.7]]) box(g, 0.08, 1.25, 0.08, dx, 1.56, dz, M(C.blue, 0.5));
      box(g, 2.2, 0.1, 1.5, 0, 2.2, 0, M(C.blue, 0.5), 0.03);
      for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.2, 1.3), glassMat); p.position.set(sx * 1.05, 1.55, 0); g.add(p); }
      { const p = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.2, 0.03), glassMat); p.position.set(0, 1.55, -0.7); g.add(p); }
      box(g, 0.26, 0.36, 0.26, 0, 1.96, 0, C.navy, 0.03); cyl(g, 0.07, 0.14, 0, 1.72, 0, C.dark, 12);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.045, 8, 28), basic(0xFFFFFF)); ring.rotation.x = Math.PI / 2; ring.position.set(0, 1.58, 0); g.add(ring); v.extra.ring = ring;
      for (const dx of [-0.45, 0.45]) { box(g, 0.1, 0.4, 0.1, dx, 1.14, -0.4, C.dark); cylZ(g, 0.02, 0.3, dx, 1.05, -0.25, metal(0xC2CCD3), 8); }
      box(g, 0.05, 1.0, 0.05, 1.25, 1.2, 0.6, C.dark); box(g, 0.58, 0.46, 0.08, 1.25, 1.75, 0.6, C.navy, 0.02); screen(1.25, 1.75, 0.645, 0.48, 0.38);
      plate(g, `${d.id}  INSPECTION`, 1.2, 0.16, 0, 0.55, 0.755); ly = 2.25; lx = 0.9; lz = -0.6;
    } else if (d.type === 'robot') {
      box(g, 1.0, 0.3, 1.0, 0, 0.15, 0, C.navy, 0.03); cyl(g, 0.36, 0.5, 0, 0.55, 0, M(C.yellow, 0.45), 24); v.extra.turret = cyl(g, 0.3, 0.5, 0, 1.05, 0, M(C.yellow, 0.45), 24, 0.24);
      const armM = M(C.yellow, 0.45), jointM = M(0x3B434A, 0.4, 0.3);
      const mkSeg = (w) => { const o = new THREE.Mesh(new RoundedBoxGeometry(1, w, w, 2, 0.04).translate(0.5, 0, 0), armM); o.castShadow = true; scene.add(o); return o; };
      const mkJoint = (rr) => { const o = new THREE.Mesh(new THREE.SphereGeometry(rr, 16, 12), jointM); o.castShadow = true; scene.add(o); return o; };
      const grip = grp(scene); cyl(grip, 0.04, 0.3, 0, 0.27, 0, C.dark, 10); cyl(grip, 0.21, 0.05, 0, 0.1, 0, C.dark); for (const [dx, dz] of [[0.12, 0], [-0.12, 0], [0, 0.12], [0, -0.12]]) cyl(grip, 0.04, 0.05, dx, 0.055, dz, M(C.blue), 10);
      Object.assign(v.extra, {upper:mkSeg(0.2), fore:mkSeg(0.15), jS:mkJoint(0.19), jE:mkJoint(0.15), jW:mkJoint(0.1), grip, gp:new THREE.Vector3(-11.5, 1.7, 5)});
      // cell: controller, fence, light curtain
      box(g, 0.8, 1.5, 0.55, 0.9, 0.75, -1.25, M(0xCBD3D9, 0.6), 0.02); box(g, 0.5, 0.4, 0.03, 0.9, 1.1, -0.97, C.navy); const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), new THREE.MeshBasicMaterial({map:hmi.t})); sc.position.set(0.9, 1.1, -0.95); g.add(sc);
      const meshT = canvasTex(64, 64, (c) => { c.clearRect(0, 0, 64, 64); c.strokeStyle = 'rgba(40,52,62,.9)'; c.lineWidth = 2.5; for (let k = 0; k <= 64; k += 16) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k, 64); c.moveTo(0, k); c.lineTo(64, k); c.stroke(); } });
      meshT.t.wrapS = meshT.t.wrapT = THREE.RepeatWrapping;
      const fence = (x0, x1, z) => { const len = x1 - x0, t = meshT.t.clone(); t.needsUpdate = true; t.repeat.set(len * 5, 9); const p = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.8), new THREE.MeshBasicMaterial({map:t, transparent:true, side:THREE.DoubleSide, alphaTest:0.2})); p.position.set((x0 + x1) / 2, 1.05, z); g.add(p);
        box(g, len, 0.05, 0.05, (x0 + x1) / 2, 1.95, z, C.yellow); box(g, len, 0.05, 0.05, (x0 + x1) / 2, 0.15, z, C.yellow); for (let x = x0; x <= x1 + 0.01; x += len / Math.round(len / 1.3)) box(g, 0.07, 2.0, 0.07, x, 1.0, z, C.yellow); };
      fence(-3.3, 1.5, -1.75); fence(-3.3, 0.1, 1.75);
      for (const dz of [-1.7, 1.7]) { box(g, 0.1, 1.5, 0.1, -3.45, 0.75, dz, C.yellow); box(g, 0.04, 1.2, 0.04, -3.39, 0.8, dz, basic(0xD2452F)); }
      plate(g, `${d.id}  PALLETISING ROBOT`, 1.7, 0.18, -1.2, 2.1, 1.77); ly = 2.0; lx = 1.45; lz = -1.75;
    }
    // signal tower: red, amber, green
    cyl(g, 0.03, 0.3, lx, ly + 0.15, lz, C.dark, 8);
    v.lamps = ['g', 'a', 'r'].map((k, n) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.15, 14), basic(LAMP_OFF[k])); o.position.set(lx, ly + 0.38 + n * 0.16, lz); g.add(o); return o; });
    cyl(g, 0.09, 0.03, lx, ly + 0.86, lz, C.dark, 14);
    return v;
  });
  const robotPickPt = {x:-11.5, y:0.955, z:5}, robotShoulder = new THREE.Vector3(MACH[6].x, 1.32, MACH[6].z);

  /* ---------------- utilities, office, maintenance, andon ---------------- */
  { const g = ent(grp(scene, 7, 0, -13.9), 'utilities', 0, 'Utilities: compressed air and power');
    box(g, 1.9, 1.5, 1.1, -3, 0.75, 0, M(0x3F6F9F, 0.5), 0.05); box(g, 1.5, 0.9, 0.03, -3, 0.85, 0.56, C.dark); box(g, 0.3, 0.2, 0.03, -2.3, 1.3, 0.57, basic(0x8FD0F5));
    cyl(g, 0.55, 2.0, -1.2, 1.35, 0, M(0x3F6F9F, 0.4, 0.2), 24); new THREE.Mesh(); cyl(g, 0.55, 0.01, -1.2, 2.36, 0, C.dark); for (const a of [0, 2.1, 4.2]) cyl(g, 0.05, 0.4, -1.2 + Math.cos(a) * 0.42, 0.2, Math.sin(a) * 0.42, C.dark, 8);
    cyl(g, 0.05, 1.7, -1.2, 3.25, 0, M(0x2A6FB0, 0.5, 0.2), 8); cylX(g, 0.05, 1.3, -2.0, 1.7, 0.2, M(0x2A6FB0, 0.5, 0.2), 8);
    for (let k = 0; k < 4; k++) { const x = 0.6 + k * 0.92; box(g, 0.88, 2.1, 0.55, x, 1.05, -0.5, M(0xCBD3D9, 0.6), 0.02); box(g, 0.03, 0.4, 0.03, x + 0.32, 1.1, -0.21, C.dark); box(g, 0.5, 0.18, 0.02, x, 1.75, -0.22, C.dark); for (let n = 0; n < 3; n++) box(g, 0.06, 0.06, 0.02, x - 0.15 + n * 0.15, 1.5, -0.22, basic([0x35D07A, 0x35D07A, 0xFFB21E][n])); }
    plate(g, 'MAIN SWITCHBOARD', 1.8, 0.22, 2.0, 2.35, -0.22); plate(g, 'COMPRESSED AIR', 1.6, 0.22, -2.2, 1.75, 0.56);
  }
  { const g = ent(grp(scene, 14.6, 0, -13.0), 'office', 0, 'Line supervisor office');
    box(g, 4.4, 0.08, 4.0, 0, 0.04, 0, M(0x8FA3B3, 0.8));
    for (const [dx, dz] of [[-2.15, -1.95], [2.15, -1.95], [-2.15, 1.95], [2.15, 1.95]]) box(g, 0.1, 2.7, 0.1, dx, 1.35, dz, C.navy);
    box(g, 4.4, 0.1, 0.1, 0, 2.7, 1.95, C.navy); box(g, 0.1, 0.1, 4.0, -2.15, 2.7, 0, C.navy); box(g, 4.4, 0.9, 0.06, 0, 0.45, 1.95, M(C.body)); box(g, 0.06, 0.9, 4.0, -2.15, 0.45, 0, M(C.body));
    { const p = new THREE.Mesh(new THREE.BoxGeometry(4.3, 1.75, 0.03), glassMat); p.position.set(0, 1.78, 1.95); g.add(p); const q = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.75, 3.9), glassMat); q.position.set(-2.15, 1.78, 0); g.add(q); }
    box(g, 2.6, 0.06, 0.9, 0.3, 0.78, -1.2, M(C.wood, 0.6)); for (const dx of [-0.9, 1.5]) box(g, 0.06, 0.75, 0.8, dx, 0.4, -1.2, C.dark);
    for (const dx of [-0.3, 0.6, 1.3]) { box(g, 0.7, 0.44, 0.04, dx, 1.2, -1.45, C.dark); box(g, 0.64, 0.38, 0.02, dx, 1.2, -1.42, basic(dx === 0.6 ? 0x8FD0F5 : 0x4B93C7)); box(g, 0.05, 0.2, 0.05, dx, 0.9, -1.45, C.dark); }
    box(g, 0.5, 0.08, 0.5, 0.4, 0.5, -0.4, C.navy, 0.03); box(g, 0.5, 0.6, 0.08, 0.4, 0.85, -0.15, C.navy, 0.03); cyl(g, 0.04, 0.45, 0.4, 0.25, -0.4, C.dark, 8);
    plate(g, 'LINE 2 CONTROL', 1.8, 0.24, 0, 2.95, 1.96);
  }
  { const g = ent(grp(scene, 7.1, 0, -0.35), 'workshop', 0, 'Maintenance workshop');
    box(g, 1.8, 0.06, 0.8, 0, 0.9, 0, M(C.wood, 0.6)); box(g, 1.7, 0.8, 0.7, 0, 0.45, 0, C.navy, 0.03); for (let k = 0; k < 3; k++) box(g, 0.5, 0.2, 0.02, -0.55 + k * 0.55, 0.6, 0.36, M(0x56636E));
    box(g, 1.8, 1.0, 0.05, 0, 1.45, -0.4, M(0x56636E)); for (let k = 0; k < 6; k++) box(g, 0.05, 0.3 + (k % 3) * 0.1, 0.03, -0.7 + k * 0.28, 1.5, -0.36, metal(0xC2CCD3));
    box(g, 0.4, 0.22, 0.24, -0.5, 1.04, 0, M(C.red), 0.03); box(g, 0.2, 0.16, 0.14, 0.55, 1.01, 0.1, M(C.blue));
    const t = grp(g, 1.6, 0, 0.3); box(t, 0.7, 0.6, 0.45, 0, 0.5, 0, M(C.red, 0.5), 0.03); box(t, 0.74, 0.04, 0.5, 0, 0.82, 0, C.dark); for (const [dx, dz] of [[-0.3, -0.18], [0.3, -0.18], [-0.3, 0.18], [0.3, 0.18]]) cyl(t, 0.05, 0.05, dx, 0.05, dz, C.dark, 10).rotation.x = Math.PI / 2;
  }
  const andon = canvasTex(1024, 320);
  { const g = ent(grp(scene, -8, 0, -15.2), 'andon', 0, 'Andon board');
    box(g, 5.3, 1.75, 0.16, 0, 3.55, 0, C.dark, 0.04); const o = new THREE.Mesh(new THREE.PlaneGeometry(5.1, 1.6), new THREE.MeshBasicMaterial({map:andon.t})); o.position.set(0, 3.55, 0.09); g.add(o); }
  // spare parts shelving and consumables along the back wall
  { const g = grp(scene, -30, 0, -14.6);
    for (let k = 0; k < 3; k++) { const x = k * 2.2; for (const dx of [-1.0, 1.0]) box(g, 0.06, 2.2, 0.5, x + dx, 1.1, 0, C.dark); for (let l = 0; l < 4; l++) { box(g, 2.0, 0.04, 0.5, x, 0.3 + l * 0.6, 0, metal(0x9AA6AF)); for (let n = 0; n < 4; n++) if ((k + l + n) % 4) box(g, 0.36, 0.3, 0.36, x - 0.72 + n * 0.48, 0.47 + l * 0.6, 0, M([0x2A6FB0, 0xC49A63, 0x7C8A95, 0xC8402C][(k + n + l) % 4], 0.7), 0.02); } }
  }
  for (const [x, z] of [[14.5, 12], [14.5, 10.6]]) { const g = grp(scene, x, 0, z); for (let k = 0; k < 7; k++) box(g, 1.2, 0.13, 1.0, 0, 0.07 + k * 0.145, 0, M(C.wood, 0.85)); }
  for (const [x, z, c] of [[10.6, 12.8, 0x2B9A5A], [11.5, 12.8, 0x2A6FB0], [12.4, 12.8, 0x56636E]]) { const g = grp(scene, x, 0, z); box(g, 0.7, 1.0, 0.7, 0, 0.5, 0, M(c, 0.6), 0.05); box(g, 0.74, 0.06, 0.74, 0, 1.03, 0, C.dark, 0.02); }

  /* ---------------- warehouse ---------------- */
  for (const zone of ['raw', 'fg']) {
    const sgn = zone === 'raw' ? 1 : -1, z0 = sgn * 2.4, z1 = sgn * (2.4 + WH.bays * WH.bayPitch), zc = (z0 + z1) / 2, len = Math.abs(z1 - z0);
    const g = ent(grp(scene), 'rack', zone, zone === 'raw' ? 'Raw material rack' : 'Finished goods rack');
    for (let b = 0; b <= WH.bays; b++) { const z = sgn * (2.4 + b * WH.bayPitch);
      for (const x of [WH.rackX - 0.55, WH.rackX + 0.55]) { box(g, 0.09, 4.6, 0.09, x, 2.3, z, M(C.rack, 0.5, 0.3)); box(g, 0.2, 0.02, 0.2, x, 0.01, z, C.dark); }
      for (let k = 0; k < 4; k++) { box(g, 1.1, 0.04, 0.04, WH.rackX, 0.4 + k * 1.2, z, M(C.rack, 0.5, 0.3)); const dg = box(g, 1.55, 0.035, 0.035, WH.rackX, 1.0 + k * 1.2, z, M(C.rack, 0.5, 0.3)); dg.rotation.z = (k % 2 ? 1 : -1) * 0.83; if (k === 3) dg.visible = false; } }
    for (let l = 0; l < WH.levels; l++) { const y = l * WH.levelPitch + 0.06; for (const x of [WH.rackX - 0.55, WH.rackX + 0.55]) box(g, 0.06, 0.12, len, x, y, zc, M(l ? C.beam : 0x7C8A95, 0.5, 0.2)); if (l) box(g, 1.1, 0.02, len - 0.1, WH.rackX, y + 0.055, zc, new THREE.MeshStandardMaterial({color:0x9AA6AF, roughness:0.5, metalness:0.6, transparent:true, opacity:0.45})); }
    for (const z of [z0 - sgn * 0.25, z1 + sgn * 0.25]) { box(g, 1.5, 0.45, 0.12, WH.rackX, 0.225, z, C.yellow, 0.03); }
    plate(g, zone === 'raw' ? 'R  RAW CASTINGS' : 'F  FINISHED GOODS', 2.6, 0.5, WH.rackX + 0.62, 4.3, zc, Math.PI / 2, zone === 'raw' ? '#2A5C96' : '#2B7A52');
    for (let b = 0; b < WH.bays; b++) plate(g, `${zone === 'raw' ? 'R' : 'F'}-${String(b + 1).padStart(2, '0')}`, 0.5, 0.11, WH.rackX + 0.6, WH.levelPitch + 0.06, sgn * (3.2 + b * WH.bayPitch), Math.PI / 2, '#E8841B', '#16232D');
    // static back-to-back rack of packaging and consumables
    const gb = grp(scene);
    for (let b = 0; b <= WH.bays; b++) { const z = sgn * (2.4 + b * WH.bayPitch); for (const x of [WH.rackX - 1.9, WH.rackX - 0.8]) box(gb, 0.09, 4.6, 0.09, x, 2.3, z, M(C.rack, 0.5, 0.3)); }
    for (let l = 0; l < WH.levels; l++) { const y = l * WH.levelPitch + 0.06; for (const x of [WH.rackX - 1.9, WH.rackX - 0.8]) box(gb, 0.06, 0.12, len, x, y, zc, M(l ? C.beam : 0x7C8A95, 0.5, 0.2));
      for (let b = 0; b < WH.bays; b++) { if ((b * 7 + l * 3 + (zone === 'raw' ? 0 : 2)) % 5 === 0) continue; const z = sgn * (3.2 + b * WH.bayPitch), hh = 0.6 + ((b + l) % 3) * 0.22;
        box(gb, 1.2, 0.14, 1.0, WH.rackX - 1.35, y + 0.13, z, M(C.wood, 0.85)); box(gb, 1.05, hh, 0.95, WH.rackX - 1.35, y + 0.2 + hh / 2, z, M([0xC9AE86, 0xD8CDB8, 0xB98F5E][(b + l) % 3], 0.9), 0.02); } }
  }
  for (const [zs, type, name] of [[WH.rawStandZ, 'rawStand', 'Raw casting handover stand'], [WH.fgStandZ, 'fgStand', 'Finished goods handover stand']]) {
    const g = ent(grp(scene), type, 0, name);
    for (const z of zs) { for (const dz of [-0.5, 0.5]) box(g, 1.4, 0.3, 0.1, WH.standX, 0.15, z + dz, M(C.blue, 0.5)); for (const dx of [-0.6, 0.6]) box(g, 0.08, 0.3, 1.1, WH.standX + dx, 0.15, z, M(C.blue, 0.5)); }
    const zc = (zs[0] + zs[1]) / 2, far = zs[0] > 0 ? Math.max(...zs) + 1.0 : Math.min(...zs) - 1.0;
    box(g, 0.06, 2.2, 0.06, WH.standX, 1.1, far, C.dark); plate(g, type === 'rawStand' ? 'RAW TO LINE' : 'FINISHED GOODS', 1.3, 0.3, WH.standX, 2.2, far + (zs[0] > 0 ? -0.04 : 0.04) * 0, 0, '#1D5F9A');
    void zc;
  }
  { const g = grp(scene, -22.5, 0, 13.9); box(g, 0.9, 1.3, 0.5, 0, 0.65, 0.6, M(0x2B7A52, 0.5), 0.03); box(g, 0.3, 0.16, 0.02, 0, 1.0, 0.34, basic(0x35D07A)); cylZ(g, 0.03, 0.7, -0.6, 0.5, 0.3, C.dark, 8); }
  { const g = grp(scene, -44.2, 0, 0); box(g, 0.9, 1.2, 0.6, 0, 0.6, 0, M(0x56636E)); box(g, 0.6, 0.4, 0.02, 0.2, 1.6, 0.0, C.dark); box(g, 0.05, 0.9, 0.05, 0.2, 1.3, 0, C.dark); plate(g, 'GOODS IN / OUT', 1.4, 0.26, 0.2, 2.2, 0.05, Math.PI / 2); }

  // forklift (built facing +z)
  const fork = (() => {
    const g = ent(grp(scene), 'forklift', 0, 'FLT-1 forklift');
    const bodyM = M(C.orange, 0.45);
    box(g, 1.15, 0.55, 1.5, 0, 0.55, -0.25, bodyM, 0.08); box(g, 1.15, 0.6, 0.55, 0, 0.6, -1.15, M(0x3B434A, 0.5), 0.1); box(g, 1.0, 0.1, 1.2, 0, 0.25, -0.2, C.dark);
    for (const [dx, dz, rr] of [[-0.56, 0.35, 0.3], [0.56, 0.35, 0.3], [-0.5, -1.0, 0.24], [0.5, -1.0, 0.24]]) { const w = cylX(g, rr, 0.22, dx, rr, dz, M(0x22282D, 0.9), 18); cylX(g, rr * 0.45, 0.24, dx, rr, dz, M(0xD3D9DE)); void w; }
    for (const [dx, dz] of [[-0.5, 0.35], [0.5, 0.35], [-0.5, -1.0], [0.5, -1.0]]) box(g, 0.06, 1.35, 0.06, dx, 1.5, dz, C.dark);
    box(g, 1.12, 0.05, 1.5, 0, 2.2, -0.32, C.dark); for (let k = 0; k < 4; k++) box(g, 1.0, 0.02, 0.04, 0, 2.23, -0.9 + k * 0.38, C.dark);
    box(g, 0.5, 0.12, 0.5, 0, 0.9, -0.5, M(0x22282D)); box(g, 0.5, 0.55, 0.1, 0, 1.2, -0.76, M(0x22282D)); cyl(g, 0.02, 0.5, 0, 1.1, 0.12, C.dark, 8).rotation.x = -0.5; const sw = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.02, 6, 16), M(0x22282D)); sw.position.set(0, 1.33, 0.02); sw.rotation.x = 1.1; g.add(sw);
    const lamp = cyl(g, 0.07, 0.1, 0.4, 2.3, -0.9, basic(0xFFB21E), 12);
    for (const dx of [-0.32, 0.32]) box(g, 0.09, 2.2, 0.12, dx, 1.2, 0.66, M(0x3B434A, 0.5, 0.3));
    box(g, 0.75, 0.08, 0.1, 0, 2.28, 0.66, M(0x3B434A)); box(g, 0.75, 0.08, 0.1, 0, 0.3, 0.66, M(0x3B434A));
    const inner = grp(g); for (const dx of [-0.22, 0.22]) box(inner, 0.07, 2.2, 0.09, dx, 1.2, 0.7, metal(0x9AA6AF));
    const carriage = grp(g); box(carriage, 0.95, 0.5, 0.06, 0, 0.3, 0.78, C.dark); box(carriage, 0.95, 0.06, 0.06, 0, 0.95, 0.78, C.dark); for (const dx of [-0.4, 0, 0.4]) box(carriage, 0.04, 0.7, 0.04, dx, 0.6, 0.78, C.dark);
    for (const dx of [-0.3, 0.3]) { box(carriage, 0.12, 0.05, 1.2, dx, 0.03, 1.4, metal(0x6F7B85)); box(carriage, 0.12, 0.45, 0.05, dx, 0.25, 0.82, metal(0x6F7B85)); }
    hit(g, 1.9, 2.6, 3.6, 0.3);
    return {g, lamp, inner, carriage, x:WH.home.x, z:WH.home.z, yaw:WH.home.yaw, lift:0.15, init:false};
  })();

  // trucks (trailers are open-topped so the load stays visible)
  const trucks = [[WH.inboundZ, 'inbound', 0xF2F4F5, 0x3F6F9F], [WH.outboundZ, 'outbound', 0xF2F4F5, C.red]].map(([z, id, tc, cc]) => {
    const g = ent(grp(scene, 0, 0, z), 'truck', id, id === 'inbound' ? 'Inbound truck, raw castings' : 'Outbound truck, finished discs');
    box(g, 9.2, 0.22, 2.6, -51.1, -0.11, 0, M(0x8A7A62, 0.9)); for (const dz of [-1.3, 1.3]) box(g, 9.2, 2.2, 0.08, -51.1, 1.1, dz, M(tc, 0.5)); box(g, 0.08, 2.2, 2.6, -55.66, 1.1, 0, M(tc, 0.5));
    for (const dz of [-1.3, 1.3]) box(g, 9.2, 0.3, 0.1, -51.1, 1.5, dz + Math.sign(dz) * 0.01, M(cc, 0.5));
    box(g, 9.0, 0.25, 1.0, -51.1, -0.4, 0, C.dark);
    for (const x of [-47.6, -48.9, -54.2]) for (const dz of [-1.1, 1.1]) cylZ(g, 0.5, 0.32, x, -0.6, dz, M(0x22282D, 0.9), 20);
    box(g, 2.3, 2.5, 2.5, -57.2, 0.45, 0, M(cc, 0.45), 0.18); box(g, 0.06, 0.95, 2.2, -58.34, 1.0, 0, new THREE.MeshStandardMaterial({color:0x1B2A36, roughness:0.1, metalness:0.6}));
    box(g, 2.3, 0.4, 2.5, -57.2, -0.55, 0, C.dark); for (const dz of [-1.1, 1.1]) cylZ(g, 0.5, 0.32, -57.5, -0.6, dz, M(0x22282D, 0.9), 20);
    box(g, 0.3, 0.3, 2.2, -56.0, 1.5, 0, C.dark);
    g.visible = false; return {g, z, x:0};
  });

  /* ---------------- people ---------------- */
  const person = (suit, hat, seated = false) => {
    const g = new THREE.Group(); g.scale.setScalar(1.12);
    const limb = (w, h, x, y, c) => { const pv = new THREE.Group(); pv.position.set(x, y, 0); box(pv, w, h, w + 0.02, 0, -h / 2, 0, c, 0.03); g.add(pv); return pv; };
    const legL = limb(0.16, 0.8, -0.11, 0.8, 0x2C3A46), legR = limb(0.16, 0.8, 0.11, 0.8, 0x2C3A46);
    box(legL, 0.17, 0.1, 0.26, 0, -0.76, 0.04, 0x1B2229); box(legR, 0.17, 0.1, 0.26, 0, -0.76, 0.04, 0x1B2229);
    box(g, 0.44, 0.6, 0.26, 0, 1.1, 0, suit, 0.05); box(g, 0.46, 0.07, 0.28, 0, 1.0, 0, 0xD9DEE2); box(g, 0.46, 0.07, 0.28, 0, 1.2, 0, 0xD9DEE2);
    const armL = limb(0.12, 0.55, -0.29, 1.38, suit), armR = limb(0.12, 0.55, 0.29, 1.38, suit);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), M(0xE0B38B)); head.position.y = 1.57; head.castShadow = true; g.add(head);
    cyl(g, 0.165, 0.1, 0, 1.7, 0, M(hat, 0.4), 14); cyl(g, 0.2, 0.025, 0, 1.655, 0.03, M(hat, 0.4), 14);
    if (seated) { legL.rotation.x = legR.rotation.x = -1.45; armL.rotation.x = armR.rotation.x = -1.0; }
    return {g, legL, legR, armL, armR};
  };
  const pose = (p, x, z, yaw, mode, ph) => {
    p.g.position.set(x, 0, z); p.g.rotation.y = yaw;
    const sw = mode === 'walk' || mode === 'carry' ? Math.sin(ph) * 0.6 : 0;
    p.legL.rotation.x = sw; p.legR.rotation.x = -sw;
    if (mode === 'walk') { p.armL.rotation.x = -sw * 0.7; p.armR.rotation.x = sw * 0.7; }
    else if (mode === 'carry' || mode === 'hold') { p.armL.rotation.x = p.armR.rotation.x = -1.1; }
    else if (mode === 'work') { p.armL.rotation.x = -1.0 + Math.sin(ph * 0.7) * 0.28; p.armR.rotation.x = -1.0 + Math.cos(ph * 0.9) * 0.28; }
    else { p.armL.rotation.x = p.armR.rotation.x = 0; }
  };
  const mkPerson = (id, name, suit, hat) => { const p = person(suit, hat); scene.add(p.g); ent(p.g, 'person', id, name); hit(p.g, 1.0, 2.0, 1.0); return p; };
  const ops = { op1:mkPerson('OP-M1', 'Operator, lathe', C.blue, C.yellow), op3:mkPerson('OP-M3', 'Operator, balancer', C.blue, C.yellow), op6:mkPerson('OP-M6', 'Quality inspector', 0x2B7A52, C.white), tech:mkPerson('TECH-1', 'Maintenance technician', C.orange, C.white) };
  const toolbox = box(ops.tech.g, 0.34, 0.2, 0.16, 0.36, 0.72, 0, M(C.red), 0.03);
  { const d = person(0x56636E, C.yellow, true); d.g.position.set(0, 0.18, -0.5); d.g.scale.setScalar(1.0); fork.g.add(d.g); }
  const smooth = {op1:null, tech:null};

  /* ---------------- AGVs ---------------- */
  const trayMat = {tote:M(0x3F6F9F, 0.6), pallet:M(C.wood, 0.85)};
  const agvVis = [0, 1].map(k => {
    const g = ent(grp(scene), 'agv', k, `AGV ${k + 1}`);
    box(g, 1.86, 0.12, 1.26, 0, 0.11, 0, C.dark, 0.05); box(g, 1.8, 0.3, 1.2, 0, 0.31, 0, M(C.white, 0.4), 0.08); box(g, 1.5, 0.03, 0.95, 0, 0.47, 0, M(0x56636E, 0.6));
    for (const sx of [-1, 1]) { box(g, 0.05, 0.14, 1.1, sx * 0.93, 0.18, 0, C.yellow, 0.02); cyl(g, 0.045, 0.05, sx * 0.78, 0.49, 0.48, M(C.red), 10); }
    cyl(g, 0.1, 0.1, 0.74, 0.52, 0, C.dark, 14); cyl(g, 0.07, 0.03, 0.74, 0.585, 0, basic(0x2F8FE0), 14);
    for (const [dx, dz] of [[0.55, 0.6], [-0.55, 0.6], [0.55, -0.6], [-0.55, -0.6]]) cylZ(g, 0.09, 0.06, dx, 0.09, dz, M(0x22282D, 0.9), 12);
    const light = box(g, 1.83, 0.045, 1.23, 0, 0.4, 0, basic(0x2B9A5A)); light.castShadow = false;
    const tray = box(g, 1.3, 0.1, 1.14, -0.1, 0.53, 0, trayMat.tote, 0.02);
    plate(g, `AGV ${k + 1}`, 0.5, 0.14, -0.55, 0.3, 0.605); hit(g, 2.3, 1.3, 1.7);
    return {g, light, tray, s:null, yaw:0};
  });

  /* ---------------- instanced material: discs, pallets, stretch wrap ---------------- */
  const MAXD = 1200, MAXP = 80;
  const discMat = new THREE.MeshStandardMaterial({color:0xffffff, roughness:0.42, metalness:0.55, envMapIntensity:0.7});
  const rotor = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.29, 0.29, 0.07, 22), discMat, MAXD);
  const hat = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.15, 0.13, 16).translate(0, 0.065, 0), discMat, MAXD);
  const pallets = new THREE.InstancedMesh(palletGeo, M(C.wood, 0.85), MAXP);
  const wraps = new THREE.InstancedMesh(new THREE.BoxGeometry(1.22, 0.36, 1.22), new THREE.MeshStandardMaterial({color:0xDCEBF5, transparent:true, opacity:0.3, roughness:0.15, depthWrite:false}), MAXP);
  for (const m of [rotor, hat, pallets, wraps]) { m.castShadow = m !== wraps; m.receiveShadow = true; m.frustumCulled = false; m.count = 0; scene.add(m); }
  const stageCol = STAGE_COL.map(c => new THREE.Color(c));
  const dummy = new THREE.Object3D();

  /* ---------------- selection and hover ---------------- */
  const selRing = new THREE.Mesh(new THREE.RingGeometry(0.92, 1.0, 64), new THREE.MeshBasicMaterial({color:0x1D5F9A, transparent:true, opacity:0.95, depthTest:false}));
  selRing.rotation.x = -Math.PI / 2; selRing.position.y = 0.04; selRing.visible = false; selRing.renderOrder = 5; scene.add(selRing);
  const hoverBox = new THREE.BoxHelper(new THREE.Object3D(), 0x1D5F9A); hoverBox.visible = false; hoverBox.material.depthTest = false; hoverBox.renderOrder = 6; scene.add(hoverBox);
  let hovered = null, selected = null;

  /* ---------------- camera ---------------- */
  const view = {az:Math.PI / 4, el:ISO_EL, ...VIEWS.plant}, goal = {...view};
  let vw = 1, vh = 1, fh = 40;
  function placeCam() {
    const d = 160, asp = vw / vh; fh = Math.max(47, 86 / asp) / view.zoom;
    cam.position.set(view.tx + d * Math.cos(view.el) * Math.sin(view.az), d * Math.sin(view.el), view.tz + d * Math.cos(view.el) * Math.cos(view.az));
    cam.lookAt(view.tx, 0, view.tz);
    cam.left = -fh * asp / 2; cam.right = fh * asp / 2; cam.top = fh / 2; cam.bottom = -fh / 2; cam.updateProjectionMatrix();
  }
  function resize() { vw = host.clientWidth || 1; vh = host.clientHeight || 1; renderer.setSize(vw, vh, false); placeCam(); }
  new ResizeObserver(resize).observe(host);
  const setView = name => Object.assign(goal, {az:Math.PI / 4, el:ISO_EL}, VIEWS[name] || VIEWS.plant);
  const focusOn = (x, z) => { goal.tx = x; goal.tz = z; goal.zoom = Math.max(goal.zoom, 2.1); };

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pickAt(cx, cy) {
    const r = canvas.getBoundingClientRect(); ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    const hit = ray.intersectObjects(pickables, true)[0]; if (!hit) return null;
    let o = hit.object; while (o && !o.userData.ent) o = o.parent;
    return o || null;
  }
  { let drag = null, lastHover = 0;
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('pointerdown', e => { drag = {x:e.clientX, y:e.clientY, sx:e.clientX, sy:e.clientY, pan:e.button === 2 || e.shiftKey, moved:false}; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
        if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) drag.moved = true;
        if (!drag.moved) return;
        if (drag.pan) {
          const k = fh / vh, az = view.az, up = dy * k / Math.sin(view.el);
          goal.tx = view.tx = Math.max(-62, Math.min(20, view.tx - Math.cos(az) * dx * k - Math.sin(az) * up)); goal.tz = view.tz = Math.max(-20, Math.min(20, view.tz + Math.sin(az) * dx * k - Math.cos(az) * up));
        } else { goal.az = view.az -= dx * 0.006; goal.el = view.el = Math.max(0.3, Math.min(1.4, view.el + dy * 0.004)); }
        placeCam(); return;
      }
      const now = performance.now(); if (now - lastHover < 50) return; lastHover = now;
      const o = pickAt(e.clientX, e.clientY);
      if (o !== hovered) { hovered = o; canvas.style.cursor = o ? 'pointer' : 'grab'; if (cb.onHover) cb.onHover(o ? o.userData.ent : null, e.clientX, e.clientY); }
      else if (o && cb.onHover) cb.onHover(o.userData.ent, e.clientX, e.clientY);
    });
    canvas.addEventListener('pointerleave', () => { hovered = null; if (cb.onHover) cb.onHover(null); });
    const end = e => { if (drag && !drag.moved && e.type === 'pointerup' && e.button === 0) { const o = pickAt(e.clientX, e.clientY); if (cb.onPick) cb.onPick(o ? o.userData.ent : null); } drag = null; };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', e => { e.preventDefault(); goal.zoom = view.zoom = Math.max(0.55, Math.min(7, view.zoom * Math.exp(-e.deltaY * 0.0012))); placeCam(); }, {passive:false});
  }

  /* ---------------- per-frame update ---------------- */
  const tableSlot = (t, i) => [t.x - 0.975 + (i % 4) * 0.65, 0.955 + (i >> 3) * 0.14, t.z - 0.35 + ((i >> 2) & 1) * 0.7];
  const quad = (i, sp = 0.6) => [((i & 1) - 0.5) * sp, (i >> 2) * 0.14, (((i >> 1) & 1) - 0.5) * sp];
  let animT = 0, wallT = 0, nD = 0, nP = 0, nW = 0, stats = null, lastAndon = '';
  const put = (x, y, z, stage) => { if (nD >= MAXD) return; dummy.position.set(x, y, z); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); rotor.setMatrixAt(nD, dummy.matrix); hat.setMatrixAt(nD, dummy.matrix); rotor.setColorAt(nD, stageCol[stage]); hat.setColorAt(nD, stageCol[stage]); nD++; };
  // a pallet with its load; yaw lets it ride on vehicles
  const putPallet = (x, y, z, qty, stage, yaw = 0, wrap = false) => {
    if (nP < MAXP) { dummy.position.set(x, y + 0.07, z); dummy.rotation.set(0, yaw, 0); dummy.updateMatrix(); pallets.setMatrixAt(nP++, dummy.matrix); }
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (let i = 0; i < qty; i++) { const q = quad(i, 0.58); put(x + q[0] * c + q[2] * s, y + 0.175 + q[1], z - q[0] * s + q[2] * c, stage); }
    if (wrap && qty && nW < MAXP) { dummy.position.set(x, y + 0.14 + 0.18, z); dummy.rotation.set(0, yaw, 0); dummy.updateMatrix(); wraps.setMatrixAt(nW++, dummy.matrix); }
  };
  const ease = (cur, target, rdt, rate = 16) => cur + (target - cur) * (1 - Math.exp(-rdt * rate));
  const easeAng = (cur, target, rdt, rate = 14) => cur + Math.atan2(Math.sin(target - cur), Math.cos(target - cur)) * (1 - Math.exp(-rdt * rate));
  const setSeg = (mesh, a, b) => { const dir = new THREE.Vector3().subVectors(b, a), len = dir.length(); mesh.position.copy(a); mesh.scale.x = len; mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.normalize()); };
  const tmp = new THREE.Vector3();

  function update(F, rdt) {
    wallT += rdt; if (!F.paused) animT += rdt;
    for (const k of ['az', 'el', 'tx', 'tz', 'zoom']) if (Math.abs(goal[k] - view[k]) > 1e-4) { view[k] = ease(view[k], goal[k], rdt, 7); placeCam(); }
    nD = nP = nW = 0;
    const blink = Math.sin(wallT * 9) > 0;

    // line material
    F.buf.ain.forEach((st, i) => put(...tableSlot(TBL.ain, i), st));
    F.buf.aout.forEach((st, i) => put(...tableSlot(TBL.aout, i), st));
    F.buf.bin.forEach((st, i) => put(...tableSlot(TBL.bin, i), st));
    F.conv.forEach((items, c) => { const d = CONV[c]; for (const it of items) put(d.x0 + (d.x1 - d.x0) * it[0] / d.len, 0.955, d.z, it[1]); });
    putPallet(PALLET_POS.x, 0.14, PALLET_POS.z, F.pallet, 4);

    // machines
    F.mach.forEach((m, i) => {
      const d = MACH[i], v = machVis[i], st = m.s;
      const on = st === 'RUN' ? 'g' : st === 'IDLE' ? 'a' : st === 'BLOCKED' ? (blink ? 'a' : '') : st === 'DOWN' ? (blink ? 'r' : '') : '';
      ['g', 'a', 'r'].forEach((k, n) => v.lamps[n].material.color.setHex(on === k ? LAMP_ON[k] : LAMP_OFF[k]));
      if (d.type === 'lathe' || d.type === 'mill') v.win.material.emissiveIntensity = st === 'RUN' ? 0.75 : 0.03;
      if (d.type === 'oven') v.win.material.color.setHex(st === 'RUN' ? 0xFF8A30 : st === 'OFF' || st === 'DOWN' ? 0x5B4A3C : 0xC8743A);
      if (d.type === 'insp') v.extra.ring.material.color.setHex(st === 'RUN' ? 0xFFFFFF : 0x8E9AA3);
      if (d.type === 'bal') { if (st === 'RUN') v.extra.spin.rotation.y += rdt * 14; }
      if (d.type === 'wash') v.extra.steam.forEach((s, k) => { const f = (animT * 0.45 + k / 3) % 1; s.position.set(0.9 + f * 0.3, 2.85 + f * 1.4, -0.45); s.scale.setScalar(0.6 + f * 1.4); s.material.opacity = st === 'RUN' ? (1 - f) * 0.5 : 0; });
      if (m.p >= 0 && (d.type === 'bal' || d.type === 'insp')) put(d.x, d.type === 'bal' ? 1.09 : 0.98, d.z + (d.type === 'bal' ? 0.1 : 0), m.p);
      if (d.type === 'robot') {
        const e = v.extra; let tx = robotPickPt.x, ty = 1.85, tz = robotPickPt.z;
        if (m.p >= 0) {
          const f = m.f, q = quad(Math.min(F.pallet, PALLET_QTY - 1), 0.58), sx = PALLET_POS.x + q[0], sy = 0.14 + 0.175 + q[1], sz = PALLET_POS.z + q[2];
          tx = robotPickPt.x + (sx - robotPickPt.x) * f; tz = robotPickPt.z + (sz - robotPickPt.z) * f; ty = robotPickPt.y + (sy - robotPickPt.y) * f + Math.sin(Math.PI * f) * 1.15 + 0.1;
        }
        e.gp.lerp(tmp.set(tx, ty, tz), 1 - Math.exp(-rdt * 12)); e.grip.position.copy(e.gp);
        // two-link arm: shoulder -> elbow -> wrist, elbow up
        const W = new THREE.Vector3(e.gp.x, e.gp.y + 0.42, e.gp.z), S0 = robotShoulder, L1 = 1.55, L2 = 1.5;
        const hx = W.x - S0.x, hz = W.z - S0.z, rr = Math.hypot(hx, hz), hh = W.y - S0.y, dd = Math.min(L1 + L2 - 0.02, Math.max(0.3, Math.hypot(rr, hh)));
        const a = Math.atan2(hh, rr), b = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + dd * dd - L2 * L2) / (2 * L1 * dd)))), sa = a + b, ux = rr > 1e-3 ? hx / rr : 1, uz = rr > 1e-3 ? hz / rr : 0;
        const E = new THREE.Vector3(S0.x + ux * Math.cos(sa) * L1, S0.y + Math.sin(sa) * L1, S0.z + uz * Math.cos(sa) * L1);
        setSeg(e.upper, S0, E); setSeg(e.fore, E, W); e.jS.position.copy(S0); e.jE.position.copy(E); e.jW.position.copy(W);
        e.turret.rotation.y = -Math.atan2(hz, hx);
        if (m.p >= 0) put(e.gp.x, e.gp.y - 0.02, e.gp.z, m.p);
      }
    });

    // people
    const ph = animT * 9;
    for (const k of ['op1', 'tech']) { const src = F[k]; let sm = smooth[k]; if (!sm) sm = smooth[k] = {x:src.x, z:src.z, yaw:src.yaw}; sm.x = ease(sm.x, src.x, rdt); sm.z = ease(sm.z, src.z, rdt); sm.yaw = easeAng(sm.yaw, src.yaw, rdt, 10); }
    const o = F.op1, so = smooth.op1, moving = o.st === 'toTable' || o.st === 'toMach' || o.st === 'back';
    pose(ops.op1, so.x, so.z, so.yaw, o.c >= 0 ? (moving ? 'carry' : 'hold') : moving ? 'walk' : F.mach[0].s === 'RUN' ? 'work' : 'stand', ph);
    if (o.c >= 0) put(so.x + Math.sin(so.yaw) * 0.42, 1.26, so.z + Math.cos(so.yaw) * 0.42, o.c);
    pose(ops.op3, MACH[2].x - 0.35, MACH[2].z + 1.5, Math.PI, F.mach[2].s === 'RUN' ? 'work' : 'stand', ph + 1);
    pose(ops.op6, MACH[5].x + 0.1, MACH[5].z + 1.45, Math.PI, F.mach[5].s === 'RUN' ? 'work' : 'stand', ph + 2);
    const T = F.tech, sT = smooth.tech, tw = T.st === 'walk' || T.st === 'return';
    pose(ops.tech, sT.x, sT.z, sT.yaw, tw ? 'walk' : T.st === 'repair' ? 'work' : 'stand', ph); toolbox.visible = tw;

    // AGVs
    F.agv.forEach((a, k) => {
      const v = agvVis[k];
      if (v.s == null || Math.abs(((a.s - v.s + RING_L * 1.5) % RING_L) - RING_L / 2) > 12) v.s = a.s;
      else v.s = (v.s + (((a.s - v.s + RING_L * 1.5) % RING_L) - RING_L / 2) * (1 - Math.exp(-rdt * 16)) + RING_L) % RING_L;
      const p = ringPos(v.s); v.yaw = easeAng(v.yaw, p.yaw, rdt, 9);
      v.g.position.set(p.x, 0, p.z); v.g.rotation.y = v.yaw;
      v.light.material.color.setHex(a.st === 'idle' ? (a.low ? 0xD2452F : 0x2B9A5A) : a.mv ? 0x2F8FE0 : 0xE08E12);
      v.tray.visible = !!a.kind; if (a.kind) v.tray.material = trayMat[a.kind];
      const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
      a.load.forEach((stage, i) => { const q = quad(i, 0.6), lx = q[0] - 0.1; put(p.x + lx * c + q[2] * s, 0.615 + q[1], p.z - lx * s + q[2] * c, stage); });
    });

    // warehouse
    const W = F.wh;
    W.slots.forEach((qty, i) => { if (qty) { const s = SLOTS[i]; putPallet(s.x, s.y, s.z, qty, s.zone === 'raw' ? 0 : 4, 0, s.zone !== 'raw'); } });
    W.raw.forEach((qty, k) => { if (qty) putPallet(WH.standX, 0.3, WH.rawStandZ[k], qty, 0); });
    W.fg.forEach((qty, k) => { if (qty) putPallet(WH.standX, 0.3, WH.fgStandZ[k], qty, 4, 0, true); });
    const f = W.fork;
    if (!fork.init) { fork.x = f.x; fork.z = f.z; fork.yaw = f.yaw; fork.lift = f.lift; fork.init = true; }
    fork.x = ease(fork.x, f.x, rdt); fork.z = ease(fork.z, f.z, rdt); fork.yaw = easeAng(fork.yaw, f.yaw, rdt); fork.lift = ease(fork.lift, f.lift, rdt);
    fork.g.position.set(fork.x, 0, fork.z); fork.g.rotation.y = fork.yaw; fork.carriage.position.y = fork.lift; fork.inner.position.y = Math.max(0, fork.lift - 1.2);
    fork.lamp.material.color.setHex(f.st !== 'idle' && blink ? 0xFFB21E : 0x6B4A0C);
    if (f.load) { const sx = Math.sin(fork.yaw), cz = Math.cos(fork.yaw); putPallet(fork.x + sx * 1.45, fork.lift + 0.05, fork.z + cz * 1.45, f.load[1], f.load[0] === 'raw' ? 0 : 4, fork.yaw, f.load[0] !== 'raw'); }
    [W.inb, W.out].forEach((t, k) => {
      const v = trucks[k], here = t.st === 'arriving' || t.st === 'docked' || t.st === 'departing';
      v.g.visible = here; v.x = (1 - t.pos) * -26; v.g.position.x = v.x;
      if (here) for (let i = 0; i < t.n; i++) putPallet(-47.3 - (i >> 1) * 1.55 + v.x, 0, v.z + ((i & 1) ? 0.62 : -0.62), k ? PALLET_QTY : 12, k ? 4 : 0, 0, !!k);
      const open = t.st === 'docked' ? 1 : 0, dk = docks[k]; dk.door.userData.o = ease(dk.door.userData.o || 0, open, rdt, 3);
      dk.door.scale.y = 1 - dk.door.userData.o * 0.94; dk.door.position.y = 3.5 - 1.75 * dk.door.scale.y;
      dk.lamp.material.color.setHex(t.st === 'docked' ? 0x35D07A : 0xD2452F);
    });

    for (const m of [rotor, hat]) { m.count = nD; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    pallets.count = nP; pallets.instanceMatrix.needsUpdate = true; wraps.count = nW; wraps.instanceMatrix.needsUpdate = true;

    if (hovered) { hoverBox.setFromObject(hovered); hoverBox.visible = true; } else hoverBox.visible = false;
    if (selected) { const b = new THREE.Box3().setFromObject(selected), c = b.getCenter(tmp), r = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * 0.62 + 0.35; selRing.position.set(c.x, 0.04, c.z); selRing.scale.setScalar(r); selRing.visible = true; } else selRing.visible = false;
    renderer.render(scene, cam);
  }

  // slower data: station screens and the andon board
  function setStats(s) {
    stats = s;
    s.machines.forEach((m, i) => { const h = machVis[i].hmi; hmiDraw(h.c, h.cv.width, h.cv.height, MACH[i], m); h.t.needsUpdate = true; });
    const k = s.kpis, key = `${s.status.mode}|${k.production.good}|${k.production.planned}|${Math.round(k.oee.oee)}|${k.production.scrap}|${s.status.simTime.clock.slice(0, 5)}`;
    if (key === lastAndon) return; lastAndon = key;
    const c = andon.c, w = 1024, h = 320, col = {running:'#35D07A', paused:'#FFB21E', stopping:'#FFB21E', stopped:'#9BA8B3'}[s.status.mode];
    c.fillStyle = '#0B1620'; c.fillRect(0, 0, w, h); c.fillStyle = col; c.fillRect(0, 0, w, 16);
    c.textBaseline = 'alphabetic'; c.textAlign = 'left'; c.fillStyle = '#FFFFFF'; c.font = `600 54px ${FONT}`; c.fillText('LINE 2', 28, 84);
    c.fillStyle = col; c.fillText(s.status.mode.toUpperCase(), 190, 84); c.fillStyle = '#8FA3B3'; c.textAlign = 'right'; c.fillText(s.status.simTime.clock.slice(0, 5), w - 28, 84);
    const cells = [['GOOD', k.production.good, '#FFFFFF'], ['PLAN', k.production.planned, '#8FD0F5'], ['SCRAP', k.production.scrap, '#FF7A66'], ['OEE %', k.oee.oee.toFixed(1), k.oee.oee >= 85 ? '#35D07A' : '#FFB21E']];
    cells.forEach(([lab, val, cc], n) => { const x = 28 + n * 250; c.textAlign = 'left'; c.fillStyle = '#8FA3B3'; c.font = `500 34px ${FONT}`; c.fillText(lab, x, 150); c.fillStyle = cc; c.font = `600 120px ${FONT}`; c.fillText(String(val), x, 276); });
    andon.t.needsUpdate = true;
  }

  const project = (x, y, z) => { tmp.set(x, y, z).project(cam); return {x:(tmp.x * 0.5 + 0.5) * vw, y:(-tmp.y * 0.5 + 0.5) * vh}; };
  const agvPos = k => { const v = agvVis[k]; return v.g.position; };
  const select = e => { selected = e ? pickables.find(g => g.userData.ent.type === e.type && g.userData.ent.id === e.id) || null : null; };
  resize();
  return {update, setStats, resize, setView, focusOn, project, agvPos, forkPos:() => fork.g.position, select, STOP_NAME};
}
