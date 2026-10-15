// Discrete-time simulation of the brake disc line and its warehouse.
// Pure JavaScript with no I/O: the server owns one instance and every protocol reads from it.
import {
  PLANT, SHIFT_START, IDEAL_CT, TARGET_RATE, SPACING, CONV_V, PALLET_QTY, RAW_PALLET_QTY, TOTE_RAW, TOTE_WIP, BUFFER_CAP,
  MACH, REASONS, CONV, SRC, SNK, STG, STAGE_NAME, TBL, RING_L, ST, STOP_NAME, ringPos, fwd, AGV_V, AGV_GAP, AGV_HANDLING,
  OP1, TECH_HOME, WALK_V, servicePt, WH, SLOTS, STATE_CODE, STATE_LABEL,
} from './plant.js';

const SPEED_MIN = 0.1, SPEED_MAX = 120;
const HIST_EVERY = 20, MACH_HIST_EVERY = 10;

function rng32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const gauss = S => (S.rng() + S.rng() + S.rng() - 1.5) * 2;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const r = (v, d = 1) => { const f = 10 ** d; return Math.round(v * f) / f; };
const pad = n => String(n).padStart(2, '0');
export function fmtClock(t) { t = Math.floor(SHIFT_START + t) % 86400; return `${pad(Math.floor(t / 3600))}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}`; }
export function fmtDur(t) { t = Math.max(0, Math.round(t)); return `${Math.floor(t / 60)}:${pad(t % 60)}`; }

/* ============================================================ creation */
export function createWorld() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const world = { S:null, paused:false, speed:10, runNo:0, epoch:d.getTime() + SHIFT_START * 1000, startedAt:Date.now() };
  world.S = createSim(world.runNo++);
  ev(world.S, 'info', 'line', 'Shift started, line running');
  return world;
}

export function createSim(runNo = 0) {
  const S = {
    t:0, mode:'running', rng:rng32(20261006 + 977 * runNo), nid:1, eid:1,
    buf:{ain:[], aout:[], bin:[]}, pallet:[], conv:CONV.map(() => []),
    mach:MACH.map(d => ({part:null, prog:0, ctAct:0, done:false, down:false, techHere:false, repairLeft:0, downAt:0, reason:'',
      state:'IDLE', since:0, ts:{RUN:0, IDLE:0, BLOCKED:0, DOWN:0, OFF:0}, count:0, scrap:0, kwh:0, kw:0, stops:0, lastCt:0, segs:[], tags:{}, hist:[]})),
    agv:[0, 1].map(k => ({id:k + 1, s:k ? 60 : 20, state:'idle', task:null, load:[], kind:null, timer:0, battery:k ? 78 : 92, dist:0, trips:0, moving:false, pushed:false, lowBat:false, busyT:0})),
    tasks:[], pend:{raw:false, wip:false, fg:false},
    tech:{x:TECH_HOME.x, z:TECH_HOME.z, yaw:0, state:'home', job:null, path:[], queue:[], repairs:0, busyT:0},
    op1:{x:OP1.mach.x, z:OP1.mach.z, yaw:Math.PI, state:'idle', carry:null, loads:0},
    good:0, scrap:0, palletsDone:0, kw:0, kwh:0, auxKwh:0, agvKwh:0, whKwh:0, peakKw:0, airPressure:6.4,
    plannedT:0, outT:[], hist:[], kwAcc:0, accT:0, nextSample:HIST_EVERY, nextMachSample:MACH_HIST_EVERY, log:[],
  };
  const mk = stage => ({id:S.nid++, stage, bad:null, checked:false});
  // the shift starts with the work in progress left by the previous one
  for (let i = 0; i < 8; i++) S.buf.ain.push(mk(0));
  S.buf.aout.push(mk(2));
  for (let i = 0; i < 2; i++) S.buf.bin.push(mk(2));
  [[1, 1], [1, 2], [1, 2], [1, 2], [1, 3], [1, 4], [0, 4]].forEach(([n, stage], c) => { for (let k = 0; k < n; k++) S.conv[c].push({part:mk(stage), pos:CONV[c].len - k * SPACING}); });
  for (let i = 0; i < 3; i++) S.pallet.push(mk(4));
  MACH.forEach((d, i) => { for (const tg of d.tags) S.mach[i].tags[tg.k] = tg.perPart ? tg.mean : tg.wear ? 55 + S.rng() * 40 : tg.idle; });

  // warehouse
  const W = S.wh = {
    slots:SLOTS.map(() => ({pallet:null, res:false})), pid:1,
    rawStand:[null, null], rawRes:[false, false], fgStand:[null, null],
    fork:{x:WH.home.x, z:WH.home.z, yaw:WH.home.yaw, state:'idle', task:null, path:[], load:null, lift:0.15, timer:0, busyT:0, moves:0, dist:0},
    inbound:{state:'none', pos:0, eta:0, pallets:[], no:0, dockedAt:0},
    outbound:{state:'none', pos:0, eta:0, loaded:[], need:WH.shipQty, no:0, dockedAt:0},
    stats:{receivedPallets:0, receivedDiscs:0, shippedPallets:0, shippedDiscs:0, trucksIn:0, trucksOut:0, d2sSum:0, d2sN:0, stockoutT:0, putaways:0, replenishments:0},
  };
  const pal = (type, qty, t = 0) => ({id:`${type === 'raw' ? 'RP' : 'FP'}-${String(W.pid++).padStart(4, '0')}`, type, qty, t});
  S.newPallet = pal;
  let n = 0; SLOTS.forEach((s, i) => { if (s.zone === 'raw' && n < 9 && s.level < 2) { W.slots[i].pallet = pal('raw', RAW_PALLET_QTY); n++; } });
  n = 0; SLOTS.forEach((s, i) => { if (s.zone === 'fg' && n < 4 && s.level === 0) { W.slots[i].pallet = pal('fg', PALLET_QTY); n++; } });
  W.rawStand = [pal('raw', RAW_PALLET_QTY), pal('raw', RAW_PALLET_QTY)];
  return S;
}

export function ev(S, kind, src, msg) {
  S.log.unshift({id:S.eid++, t:S.t, kind, src, msg});
  if (S.log.length > 200) S.log.pop();
}

/* ============================================================ line */
function startPart(S, i, p) {
  const d = MACH[i], m = S.mach[i];
  m.part = p; m.prog = 0; m.done = false; m.ctAct = d.ct * (1 + S.rng() * 0.12);
  if (p.bad == null && S.rng() < d.defect) p.bad = i;
}
function scrapPart(S, p, at) {
  S.scrap++; S.mach[p.bad].scrap++;
  ev(S, 'quality', MACH[at].id, `Disc ${p.id} scrapped at ${MACH[at].id} ${MACH[at].name.toLowerCase()}, defect from ${MACH[p.bad].id}`);
}
function cycleDone(S, i, p) {
  const d = MACH[i], m = S.mach[i];
  m.count++; m.lastCt = m.ctAct;
  for (const tg of d.tags) {
    if (tg.perPart) m.tags[tg.k] = Math.max(0, tg.mean + gauss(S) * tg.sd + (p.bad != null && (i === 5 || i === 2 || p.bad === i) ? 3.4 * tg.sd : 0));
    else if (tg.wear) { m.tags[tg.k] -= tg.drop * (0.7 + S.rng() * 0.6); if (m.tags[tg.k] <= 3) { m.tags[tg.k] = 100; ev(S, 'info', d.id, `${d.id} ${d.name}: tool changed automatically`); } }
  }
}
// try to move the finished part out of station i; false means blocked
function finish(S, i) {
  const m = S.mach[i], p = m.part;
  if (i === 6) {
    if (S.pallet.length >= PALLET_QTY) return false;
    p.stage = STG[i]; S.pallet.push(p); S.good++; S.outT.push(S.t);
    if (S.pallet.length === PALLET_QTY) S.palletsDone++;
    return true;
  }
  if (i === 2 && p.bad != null && !p.checked) { p.checked = true; if (S.rng() < 0.55) { scrapPart(S, p, i); return true; } }
  if (i === 5 && p.bad != null) { scrapPart(S, p, i); return true; }
  const c = S.conv[SNK[i]];
  if (c.length && c[c.length - 1].pos < SPACING) return false;
  p.stage = STG[i]; c.push({part:p, pos:0}); return true;
}
export function fault(S, i, manual) {
  const d = MACH[i], m = S.mach[i];
  if (m.down) return false;
  m.down = true; m.techHere = false; m.stops++; m.downAt = S.t;
  m.repairLeft = d.mttr * (0.6 + S.rng() * 0.8);
  const rs = REASONS[d.type]; m.reason = manual ? 'fault triggered manually' : rs[Math.floor(S.rng() * rs.length)];
  S.tech.queue.push(i);
  ev(S, 'alarm', d.id, `${d.id} ${d.name} down: ${m.reason}`);
  return true;
}

function stepMachine(S, i, dt, run, live) {
  const d = MACH[i], m = S.mach[i];
  let st = null;
  if (m.down) {
    st = 'DOWN';
    if (m.techHere) {
      m.repairLeft -= dt;
      if (m.repairLeft <= 0) { m.down = false; m.techHere = false; S.tech.repairs++; ev(S, 'info', d.id, `${d.id} ${d.name} repaired after ${fmtDur(S.t - m.downAt)}`); }
    }
  } else if (live) {
    if (m.part && !m.done) {
      m.prog += dt; st = 'RUN';
      if (S.rng() < dt / d.mtbf) { fault(S, i); st = 'DOWN'; }
      else if (m.prog >= m.ctAct) m.done = true;
    }
    if (!m.down && m.part && m.done) {
      const p = m.part;
      if (finish(S, i)) { cycleDone(S, i, p); m.part = null; m.done = false; }
      else st = st || 'BLOCKED';
    }
    if (!m.down && !m.part && run && SRC[i] != null) {
      const c = S.conv[SRC[i]];
      if (c.length && c[0].pos >= CONV[SRC[i]].len - 1e-3) { startPart(S, i, c.shift().part); st = st || 'RUN'; }
    }
    if (!st) st = run ? 'IDLE' : 'OFF';
  } else st = 'OFF';

  m.kw = st === 'RUN' ? d.kwRun * (0.72 + 0.4 * Math.sin(Math.PI * Math.min(1, m.prog / (m.ctAct || 1))))
       : st === 'IDLE' || st === 'BLOCKED' ? d.kwIdle : st === 'DOWN' ? d.kwIdle * 0.6 : d.kwIdle * 0.25;
  m.kwh += m.kw * dt / 3600; m.ts[st] += dt;
  if (m.state !== st || !m.segs.length) { m.segs.push({s:st, t:S.t - dt}); if (m.segs.length > 600) m.segs.shift(); m.since = S.t - dt; }
  m.state = st;
  for (const tg of d.tags) {
    if (tg.perPart || tg.wear) continue;
    const target = st === 'RUN' ? tg.run : st === 'IDLE' || st === 'BLOCKED' ? tg.idle : st === 'DOWN' ? (tg.idle + tg.off) / 2 : tg.off;
    m.tags[tg.k] += (target - m.tags[tg.k]) * (1 - Math.exp(-dt / tg.tau));
  }
}

function walk(o, target, dt) {
  const dx = target.x - o.x, dz = target.z - o.z, dist = Math.hypot(dx, dz), stepLen = WALK_V * dt;
  if (dist <= stepLen) { o.x = target.x; o.z = target.z; return true; }
  o.x += dx / dist * stepLen; o.z += dz / dist * stepLen; o.yaw = Math.atan2(dx, dz); return false;
}
function stepOperator(S, dt, run) {
  const o = S.op1, m = S.mach[0];
  if (o.state === 'idle') { if (run && S.buf.ain.length) o.state = 'toTable'; }
  else if (o.state === 'toTable') {
    if (walk(o, OP1.table, dt)) { o.yaw = Math.PI; if (S.buf.ain.length) { o.carry = S.buf.ain.pop(); o.state = 'toMach'; } else if (!run) o.state = 'back'; }
  } else if (o.state === 'toMach') { if (walk(o, OP1.mach, dt)) { o.yaw = Math.PI; o.state = 'hold'; } }
  else if (o.state === 'back') { if (walk(o, OP1.mach, dt)) { o.yaw = Math.PI; o.state = 'idle'; } }
  else if (o.state === 'hold') {
    if (run && !m.down && !m.part) { startPart(S, 0, o.carry); o.carry = null; o.loads++; o.state = 'idle'; }
  }
}
const techRoute = (from, to) => [{x:from.x, z:1}, {x:to.x, z:1}, {x:to.x, z:to.z}];
function stepTech(S, dt) {
  const T = S.tech;
  if (T.state !== 'home') T.busyT += dt;
  if ((T.state === 'home' || T.state === 'return') && T.queue.length) { T.job = T.queue.shift(); T.path = techRoute(T, servicePt(T.job)); T.state = 'walk'; }
  if (T.state === 'walk' || T.state === 'return') {
    if (!T.path.length || walk(T, T.path[0], dt)) T.path.shift();
    if (!T.path.length) {
      if (T.state === 'walk') { T.state = 'repair'; S.mach[T.job].techHere = true; T.yaw = MACH[T.job].z < 0 ? Math.PI : 0; }
      else { T.state = 'home'; T.yaw = 0; }
    }
  } else if (T.state === 'repair' && !S.mach[T.job].down) {
    T.job = null;
    if (T.queue.length) { T.job = T.queue.shift(); T.path = techRoute(T, servicePt(T.job)); T.state = 'walk'; }
    else { T.path = techRoute(T, TECH_HOME); T.state = 'return'; }
  }
}

/* ---------------- AGVs ---------------- */
const standQty = S => S.wh.rawStand.reduce((n, p) => n + (p ? p.qty : 0), 0);
function agvAdvance(S, a, dt, target) {
  let stepLen = AGV_V * dt, arrive = false;
  if (target != null) { const rem = fwd(a.s, target); if (rem <= stepLen) { stepLen = rem; arrive = true; } }
  for (const o of S.agv) {
    if (o === a) continue;
    const gap = fwd(a.s, o.s);
    if (gap < AGV_GAP + 1.5 && o.state === 'idle') o.pushed = true;
    if (gap < AGV_GAP + stepLen) { stepLen = Math.max(0, gap - AGV_GAP); arrive = false; }
  }
  a.s = arrive ? target : (a.s + stepLen) % RING_L;
  a.dist += stepLen; a.battery = Math.max(0, a.battery - 0.08 * stepLen); a.moving = stepLen > 1e-6;
  return arrive;
}
function stepAgv(S, a, dt) {
  a.moving = false;
  if (a.state !== 'idle') a.busyT += dt;
  switch (a.state) {
    case 'idle':
      if (a.pushed) agvAdvance(S, a, dt, null);
      else { a.battery = Math.min(100, a.battery + 0.12 * dt); if (a.lowBat && a.battery > 50) a.lowBat = false; }
      break;
    case 'toPick': if (agvAdvance(S, a, dt, a.task.pick)) { a.state = 'loading'; a.timer = AGV_HANDLING; } break;
    case 'toDrop': if (agvAdvance(S, a, dt, a.task.drop)) { a.state = 'unloading'; a.timer = AGV_HANDLING; } break;
    case 'loading':
      a.timer -= dt;
      if (a.timer <= 0) {
        const ty = a.task.type;
        if (ty === 'raw') {
          if (standQty(S) < TOTE_RAW) break;                         // wait for the forklift to replenish the stand
          let need = TOTE_RAW; const W = S.wh;
          for (let k = 0; k < W.rawStand.length && need > 0; k++) { const p = W.rawStand[k]; if (!p) continue; const take = Math.min(p.qty, need); p.qty -= take; need -= take; if (p.qty === 0) W.rawStand[k] = null; }
          a.load = []; for (let k = 0; k < TOTE_RAW; k++) a.load.push({id:S.nid++, stage:0, bad:null, checked:false}); a.kind = 'tote';
        } else if (ty === 'wip') { a.load = S.buf.aout.splice(0, TOTE_WIP); a.kind = 'tote'; }
        else { a.load = S.pallet; S.pallet = []; a.kind = 'pallet'; }
        a.state = 'toDrop';
      }
      break;
    case 'unloading':
      a.timer -= dt;
      if (a.timer <= 0) {
        const ty = a.task.type;
        if (ty === 'raw') S.buf.ain.push(...a.load);
        else if (ty === 'wip') S.buf.bin.push(...a.load);
        else {
          const k = S.wh.fgStand.findIndex(p => !p); if (k < 0) break;   // wait for the forklift to clear the stand
          const p = S.newPallet('fg', a.load.length, S.t); S.wh.fgStand[k] = p;
          ev(S, 'logistics', `AGV-${a.id}`, `Pallet ${p.id} handed to the warehouse by AGV ${a.id}`);
        }
        S.pend[ty] = false; a.load = []; a.kind = null; a.task = null; a.trips++; a.state = 'idle';
        if (a.battery < 20) a.lowBat = true;
      }
      break;
  }
  a.pushed = false;
}
function dispatch(S) {
  const P = S.pend;
  if (!P.raw && S.buf.ain.length <= 4 && standQty(S) >= TOTE_RAW) { P.raw = true; S.tasks.push({type:'raw', pick:ST.RAWP, drop:ST.AIN}); }
  if (!P.wip && S.buf.aout.length >= TOTE_WIP && S.buf.bin.length <= 8) { P.wip = true; S.tasks.push({type:'wip', pick:ST.AOUT, drop:ST.BIN}); }
  if (!P.fg && S.pallet.length >= PALLET_QTY && S.wh.fgStand.some(p => !p)) { P.fg = true; S.tasks.push({type:'fg', pick:ST.PAL, drop:ST.FGD}); }
  for (let k = 0; k < S.tasks.length; k++) {
    const t = S.tasks[k]; let best = null, bd = 1e9;
    for (const a of S.agv) { if (a.state !== 'idle' || a.lowBat) continue; const d = fwd(a.s, t.pick); if (d < bd) { bd = d; best = a; } }
    if (!best) break;
    best.task = t; best.state = 'toPick'; S.tasks.splice(k, 1); k--;
  }
}

/* ============================================================ warehouse */
const HALF = Math.PI / 2;
export function locPoint(loc) {
  switch (loc.kind) {
    case 'slot': return {x:WH.faceX, z:SLOTS[loc.i].z, yaw:-HALF, lift:SLOTS[loc.i].y + 0.05};
    case 'rawStand': return {x:WH.standFaceX, z:WH.rawStandZ[loc.i], yaw:HALF, lift:0.4};
    case 'fgStand': return {x:WH.standFaceX, z:WH.fgStandZ[loc.i], yaw:HALF, lift:0.4};
    case 'inbound': return {x:WH.dockX, z:WH.inboundZ, yaw:-HALF, lift:0.15};
    default: return {x:WH.dockX, z:WH.outboundZ, yaw:-HALF, lift:0.15};
  }
}
export function locName(loc) {
  return loc.kind === 'slot' ? `rack slot ${SLOTS[loc.i].id}` : loc.kind === 'rawStand' ? 'raw casting stand' : loc.kind === 'fgStand' ? 'finished goods stand'
    : loc.kind === 'inbound' ? 'inbound truck' : 'outbound truck';
}
const aisleOf = p => p.x > -31 ? WH.aisle1 : WH.aisle2;
function forkRoute(from, to) {
  const a = aisleOf(from), b = aisleOf(to), pts = [{x:a, z:from.z}];
  if (a !== b) pts.push({x:a, z:0}, {x:b, z:0});
  pts.push({x:b, z:to.z}, {x:to.x, z:to.z});
  return pts;
}
function forkDrive(f, target, dt) {
  const dx = target.x - f.x, dz = target.z - f.z, dist = Math.hypot(dx, dz);
  if (dist < 1e-3) return true;
  const diff = wrap(Math.atan2(dx, dz) - f.yaw);
  if (Math.abs(diff) > 0.02) f.yaw += Math.sign(diff) * Math.min(Math.abs(diff), WH.forkTurn * dt);
  if (Math.abs(diff) > 0.45) return false;                               // turn on the spot before driving off
  const stepLen = Math.min(dist, WH.forkV * dt);
  f.x += dx / dist * stepLen; f.z += dz / dist * stepLen; f.dist += stepLen;
  return stepLen >= dist - 1e-6;
}
function forkTake(S, loc) {
  const W = S.wh;
  if (loc.kind === 'slot') { const p = W.slots[loc.i].pallet; W.slots[loc.i].pallet = null; return p; }
  if (loc.kind === 'rawStand') { const p = W.rawStand[loc.i]; W.rawStand[loc.i] = null; return p; }
  if (loc.kind === 'fgStand') { const p = W.fgStand[loc.i]; W.fgStand[loc.i] = null; return p; }
  if (loc.kind === 'inbound') return W.inbound.pallets.pop();
  return null;
}
function forkPut(S, loc, p, task) {
  const W = S.wh;
  if (loc.kind === 'slot') {
    W.slots[loc.i].pallet = p; W.slots[loc.i].res = false;
    if (task.kind === 'unload') { W.stats.d2sSum += S.t - p.t; W.stats.d2sN++; }
    if (task.kind === 'putaway') W.stats.putaways++;
  } else if (loc.kind === 'rawStand') { W.rawStand[loc.i] = p; W.rawRes[loc.i] = false; W.stats.replenishments++; }
  else if (loc.kind === 'outbound') W.outbound.loaded.push(p);
}
function nextForkTask(S) {
  const W = S.wh;
  const freeSlot = zone => { let best = -1; SLOTS.forEach((s, i) => { if (s.zone !== zone || W.slots[i].pallet || W.slots[i].res) return; if (best < 0 || s.level < SLOTS[best].level || (s.level === SLOTS[best].level && s.bay < SLOTS[best].bay)) best = i; }); return best; };
  const oldest = zone => { let best = -1; SLOTS.forEach((s, i) => { const p = W.slots[i].pallet; if (s.zone !== zone || !p) return; if (best < 0 || p.t < W.slots[best].pallet.t || (p.t === W.slots[best].pallet.t && s.level < SLOTS[best].level)) best = i; }); return best; };
  // 1. keep the line supplied
  const free = W.rawStand.findIndex((p, k) => !p && !W.rawRes[k]);
  if (free >= 0 && standQty(S) <= TOTE_RAW && !W.rawRes.some(Boolean)) {
    const src = oldest('raw');
    if (src >= 0) { W.rawRes[free] = true; return {kind:'replenish', from:{kind:'slot', i:src}, to:{kind:'rawStand', i:free}}; }
    if (W.inbound.state === 'docked' && W.inbound.pallets.length) { W.rawRes[free] = true; return {kind:'replenish', from:{kind:'inbound'}, to:{kind:'rawStand', i:free}}; }
  }
  // 2. clear finished pallets from the handover stand
  const fg = W.fgStand.findIndex(p => p);
  if (fg >= 0) {
    if (W.outbound.state === 'docked' && W.outbound.loaded.length < W.outbound.need) return {kind:'load', from:{kind:'fgStand', i:fg}, to:{kind:'outbound'}};
    const dst = freeSlot('fg'); if (dst >= 0) { W.slots[dst].res = true; return {kind:'putaway', from:{kind:'fgStand', i:fg}, to:{kind:'slot', i:dst}}; }
  }
  // 3. unload the inbound truck
  if (W.inbound.state === 'docked' && W.inbound.pallets.length) {
    const dst = freeSlot('raw'); if (dst >= 0) { W.slots[dst].res = true; return {kind:'unload', from:{kind:'inbound'}, to:{kind:'slot', i:dst}}; }
  }
  // 4. load the outbound truck
  if (W.outbound.state === 'docked' && W.outbound.loaded.length < W.outbound.need) {
    const src = oldest('fg'); if (src >= 0) return {kind:'load', from:{kind:'slot', i:src}, to:{kind:'outbound'}};
  }
  return null;
}
function stepFork(S, dt) {
  const f = S.wh.fork;
  if (f.state === 'idle' || f.state === 'toHome') {
    const task = nextForkTask(S);
    if (task) { f.task = task; f.path = forkRoute(f, locPoint(task.from)); f.state = 'toPick'; }
    else if (f.state === 'idle' && Math.hypot(f.x - WH.home.x, f.z - WH.home.z) > 0.1) { f.path = forkRoute(f, WH.home); f.state = 'toHome'; }
  }
  if (f.state !== 'idle' && f.state !== 'toHome') f.busyT += dt;
  let liftTarget = 0.15;
  if (f.state === 'toPick' || f.state === 'toDrop' || f.state === 'toHome') {
    if (!f.path.length || forkDrive(f, f.path[0], dt)) f.path.shift();
    if (!f.path.length) {
      if (f.state === 'toHome') { const d = wrap(WH.home.yaw - f.yaw); if (Math.abs(d) < 0.03) f.state = 'idle'; else f.yaw += Math.sign(d) * Math.min(Math.abs(d), WH.forkTurn * dt); }
      else { f.state = f.state === 'toPick' ? 'picking' : 'dropping'; f.timer = WH.forkHandling; }
    }
  } else if (f.state === 'picking' || f.state === 'dropping') {
    const pt = locPoint(f.state === 'picking' ? f.task.from : f.task.to), d = wrap(pt.yaw - f.yaw);
    liftTarget = pt.lift;
    if (Math.abs(d) > 0.03) f.yaw += Math.sign(d) * Math.min(Math.abs(d), WH.forkTurn * dt);
    else if (Math.abs(f.lift - pt.lift) < 0.03) {
      f.timer -= dt;
      if (f.timer <= 0) {
        if (f.state === 'picking') { f.load = forkTake(S, f.task.from); f.path = forkRoute(f, locPoint(f.task.to)); f.state = 'toDrop'; }
        else { forkPut(S, f.task.to, f.load, f.task); f.load = null; f.task = null; f.moves++; f.state = 'idle'; }
      }
    }
  }
  f.lift += Math.sign(liftTarget - f.lift) * Math.min(Math.abs(liftTarget - f.lift), 0.6 * dt);
}
export const whCounts = S => {
  const W = S.wh; let rawRack = 0, fgRack = 0, rawDiscs = 0, fgDiscs = 0;
  W.slots.forEach((s, i) => { if (!s.pallet) return; if (SLOTS[i].zone === 'raw') { rawRack++; rawDiscs += s.pallet.qty; } else { fgRack++; fgDiscs += s.pallet.qty; } });
  const standPallets = W.rawStand.filter(Boolean).length; rawDiscs += standQty(S);
  const fgStand = W.fgStand.filter(Boolean); fgStand.forEach(p => { fgDiscs += p.qty; });
  return {rawRack, fgRack, rawPallets:rawRack + standPallets, rawDiscs, fgPallets:fgRack + fgStand.length, fgDiscs, occupied:rawRack + fgRack};
};
export function callTruck(S, which) {
  const T = S.wh[which]; if (!T || T.state !== 'none') return false;
  T.state = 'due'; T.eta = S.t + 20; return true;
}
function stepTrucks(S, dt) {
  const W = S.wh, c = whCounts(S), f = W.fork;
  const I = W.inbound, O = W.outbound;
  if (I.state === 'none' && c.rawPallets <= WH.reorderPoint) { I.state = 'due'; I.eta = S.t + 420 + S.rng() * 360; ev(S, 'logistics', 'warehouse', `Raw stock at ${c.rawPallets} pallets, replenishment truck ordered`); }
  if (O.state === 'none' && c.fgRack >= WH.shipTrigger) { O.state = 'due'; O.eta = S.t + 300 + S.rng() * 300; ev(S, 'logistics', 'warehouse', `${c.fgRack} finished pallets in stock, collection booked`); }
  for (const T of [I, O]) {
    const inb = T === I;
    if (T.state === 'due' && S.t >= T.eta) {
      T.state = 'arriving'; T.pos = 0; T.no++;
      if (inb) T.pallets = Array.from({length:WH.truckQty}, () => S.newPallet('raw', RAW_PALLET_QTY));
    } else if (T.state === 'arriving') {
      T.pos = Math.min(1, T.pos + dt / WH.truckTravel);
      if (T.pos >= 1) {
        T.state = 'docked'; T.dockedAt = S.t;
        if (inb) { T.pallets.forEach(p => { p.t = S.t; }); ev(S, 'logistics', 'warehouse', `Inbound truck ${T.no} docked with ${T.pallets.length} pallets of raw castings`); }
        else ev(S, 'logistics', 'warehouse', `Outbound truck ${T.no} docked, loading ${T.need} pallets`);
      }
    } else if (T.state === 'docked') {
      const busyHere = f.task && (f.task.from.kind === (inb ? 'inbound' : 'x') || f.task.to.kind === (inb ? 'x' : 'outbound'));
      if (inb ? (!T.pallets.length && !busyHere) : (T.loaded.length >= T.need && !busyHere)) {
        T.state = 'departing';
        if (inb) { W.stats.trucksIn++; W.stats.receivedPallets += WH.truckQty; W.stats.receivedDiscs += WH.truckQty * RAW_PALLET_QTY; ev(S, 'logistics', 'warehouse', `Inbound truck ${T.no} unloaded in ${fmtDur(S.t - T.dockedAt)}`); }
        else { const q = T.loaded.reduce((n, p) => n + p.qty, 0); W.stats.trucksOut++; W.stats.shippedPallets += T.loaded.length; W.stats.shippedDiscs += q; ev(S, 'logistics', 'warehouse', `Outbound truck ${T.no} left with ${T.loaded.length} pallets, ${q} discs`); }
      }
    } else if (T.state === 'departing') {
      T.pos = Math.max(0, T.pos - dt / WH.truckTravel);
      if (T.pos <= 0) { T.state = 'none'; if (!inb) T.loaded = []; }
    }
  }
  if (S.mode === 'running' && S.buf.ain.length <= 4 && standQty(S) < TOTE_RAW && !S.pend.raw) W.stats.stockoutT += dt;
}

/* ============================================================ main step */
export function step(S, dt) {
  S.t += dt;
  const run = S.mode === 'running', live = S.mode !== 'stopped';
  if (live) {
    for (let c = 0; c < CONV.length; c++) {
      const items = S.conv[c], len = CONV[c].len;
      for (let k = 0; k < items.length; k++) {
        const max = k === 0 ? len : items[k - 1].pos - SPACING;
        items[k].pos = Math.max(items[k].pos, Math.min(items[k].pos + CONV_V * dt, max));
      }
    }
    let c = S.conv[2];
    if (c.length && c[0].pos >= CONV[2].len - 1e-3 && S.buf.aout.length < BUFFER_CAP) S.buf.aout.push(c.shift().part);
    c = S.conv[3];
    if (S.buf.bin.length && (!c.length || c[c.length - 1].pos >= SPACING)) c.push({part:S.buf.bin.shift(), pos:0});
  }
  for (let i = 0; i < MACH.length; i++) stepMachine(S, i, dt, run, live);
  stepOperator(S, dt, run);
  stepTech(S, dt);
  if (run) dispatch(S);
  for (const a of S.agv) stepAgv(S, a, dt);
  stepFork(S, dt);
  stepTrucks(S, dt);

  if (S.mode === 'stopping' && S.mach.every(m => m.down || !m.part || m.done) && S.agv.every(a => a.state === 'idle' || ((a.state === 'loading' || a.state === 'unloading') && a.timer <= 0))
      && (S.op1.state === 'idle' || S.op1.state === 'hold')) { S.mode = 'stopped'; ev(S, 'info', 'line', 'Line stopped, stations on standby'); }

  // energy and line accounting
  let kw = 0; for (const m of S.mach) kw += m.kw;
  const aux = live ? 14 : 5; let agvKw = 0;
  for (const a of S.agv) if (a.state === 'idle' && !a.moving && a.battery < 100) agvKw += 0.9;
  const f = S.wh.fork, whKw = 3.5 + (f.state === 'idle' ? 1.2 : 0);          // warehouse lighting, dock doors, forklift charger
  kw += aux + agvKw + whKw;
  S.kw = kw; S.kwh += kw * dt / 3600; S.auxKwh += aux * dt / 3600; S.agvKwh += agvKw * dt / 3600; S.whKwh += whKw * dt / 3600;
  if (kw > S.peakKw) S.peakKw = kw;
  S.airPressure += ((live ? 6.4 : 6.9) - S.airPressure) * (1 - Math.exp(-dt / 30));
  if (live) S.plannedT += dt;
  S.kwAcc += kw * dt; S.accT += dt;
  if (S.t >= S.nextSample) {
    const k = lineKpi(S), c = whCounts(S);
    S.hist.push({t:r(S.t, 1), rate:rateNow(S), kw:r(S.kwAcc / S.accT, 1), oee:r(k.oee * 100, 1), a:r(k.A * 100, 1), p:r(k.P * 100, 1), q:r(k.Q * 100, 1), good:S.good, scrap:S.scrap, raw:c.rawDiscs, fg:c.fgPallets});
    if (S.hist.length > 360) S.hist.shift();
    S.kwAcc = 0; S.accT = 0; S.nextSample += HIST_EVERY;
  }
  if (S.t >= S.nextMachSample) {
    S.mach.forEach((m, i) => { const row = {t:r(S.t, 1), state:m.state, kw:r(m.kw, 1)}; for (const tg of MACH[i].tags) row[tg.k] = readTag(m, tg); m.hist.push(row); if (m.hist.length > 360) m.hist.shift(); });
    S.nextMachSample += MACH_HIST_EVERY;
  }
}

// advance a world by a slice of real time, honouring pause and the speed multiplier
export function advance(world, realDt) {
  if (world.paused) return;
  let left = realDt * world.speed;
  while (left > 1e-9) { const dt = Math.min(0.25, left); step(world.S, dt); left -= dt; }
}

/* ============================================================ commands */
export function applyCommand(world, cmd) {
  const S = world.S, a = cmd && cmd.action;
  switch (a) {
    case 'start':
      world.paused = false;
      if (S.mode !== 'running') { ev(S, 'info', 'line', S.t === 0 ? 'Shift started, line running' : 'Line started'); S.mode = 'running'; }
      return {ok:true};
    case 'pause': world.paused = true; return {ok:true};
    case 'resume': world.paused = false; return {ok:true};
    case 'stop':
      world.paused = false;
      if (S.mode === 'running') { S.mode = 'stopping'; ev(S, 'info', 'line', 'Stop requested, stations finishing their cycle'); }
      return {ok:true};
    case 'reset': world.S = createSim(world.runNo++); world.S.mode = 'stopped'; world.paused = false; return {ok:true};
    case 'speed': {
      const v = Number(cmd.speed);
      if (!Number.isFinite(v) || v < SPEED_MIN || v > SPEED_MAX) return {ok:false, error:`speed must be a number between ${SPEED_MIN} and ${SPEED_MAX}`};
      world.speed = v; return {ok:true};
    }
    case 'fault': {
      const i = MACH.findIndex(m => m.id === String(cmd.machine || '').toUpperCase());
      if (i < 0) return {ok:false, error:'unknown machine id'};
      return fault(S, i, true) ? {ok:true} : {ok:false, error:'machine is already down'};
    }
    case 'truck':
      if (cmd.direction !== 'inbound' && cmd.direction !== 'outbound') return {ok:false, error:'direction must be inbound or outbound'};
      return callTruck(S, cmd.direction) ? {ok:true} : {ok:false, error:`an ${cmd.direction} truck is already scheduled or at the dock`};
    default: return {ok:false, error:'unknown action'};
  }
}

/* ============================================================ KPIs */
export function rateNow(S) {
  while (S.outT.length && S.outT[0] < S.t - 300) S.outT.shift();
  return S.outT.length * 12;
}
export function machKpi(S, i) {
  const m = S.mach[i], ts = m.ts, total = ts.RUN + ts.IDLE + ts.BLOCKED + ts.DOWN + ts.OFF;
  const planned = total - ts.OFF, up = planned - ts.DOWN;
  const A = planned > 0 ? up / planned : 1;
  const P = up > 0 ? Math.min(1, MACH[i].ct * m.count / up) : 0;
  const Q = m.count ? (m.count - m.scrap) / m.count : 1;
  return {A, P, Q, oee:A * P * Q, planned};
}
export function lineKpi(S) {
  let A = 0; for (let i = 0; i < MACH.length; i++) A += machKpi(S, i).A; A /= MACH.length;
  const Q = S.good + S.scrap ? S.good / (S.good + S.scrap) : 1;
  const raw = S.plannedT > 0 ? S.good * IDEAL_CT / S.plannedT : 0;
  const P = A * Q > 0 ? Math.min(1, raw / (A * Q)) : 0;
  return {A, P, Q, oee:A * P * Q};
}
export function wipCount(S) {
  let n = S.buf.aout.length + S.buf.bin.length + S.pallet.length + (S.op1.carry ? 1 : 0);
  for (const c of S.conv) n += c.length;
  for (const m of S.mach) if (m.part) n++;
  for (const a of S.agv) if (a.task && a.task.type !== 'raw') n += a.load.length;
  return n;
}
function readTag(m, tg) {
  const v = m.tags[tg.k] + (tg.noise ? (Math.random() - 0.5) * 2 * tg.noise * (Math.abs(m.tags[tg.k]) > Math.abs(tg.run || 0) * 0.02 || !tg.run ? 1 : 0) : 0);
  return r(v, tg.dec);
}

/* ============================================================ public data model (REST, MQTT, OPC UA) */
export const simTime = (world, t = world.S.t) => ({seconds:r(t, 2), clock:fmtClock(t), iso:new Date(world.epoch + t * 1000).toISOString()});
const pct = v => r(v * 100, 2);
const oeeOut = k => ({oee:pct(k.oee), availability:pct(k.A), performance:pct(k.P), quality:pct(k.Q)});

export function pubStatus(world) {
  const S = world.S;
  return {plant:PLANT, mode:world.paused ? 'paused' : S.mode, lineMode:S.mode, paused:world.paused, speed:world.speed, simTime:simTime(world), wallTime:new Date().toISOString(), uptimeS:Math.round((Date.now() - world.startedAt) / 1000)};
}
export function pubKpis(world) {
  const S = world.S, k = lineKpi(S), planned = TARGET_RATE * S.plannedT / 3600;
  return {
    simTime:simTime(world), plannedProductionTimeS:r(S.plannedT, 1),
    oee:oeeOut(k),
    production:{good:S.good, scrap:S.scrap, firstPassYield:pct(k.Q), throughputPerHour:rateNow(S), targetPerHour:TARGET_RATE, planned:Math.round(planned), planAttainment:planned > 0.5 ? r(S.good / planned * 100, 1) : null, wip:wipCount(S), palletsCompleted:S.palletsDone},
    energy:pubEnergy(world),
  };
}
export function pubEnergy(world) {
  const S = world.S;
  const by = MACH.map((d, i) => ({id:d.id, name:d.name, powerKw:r(S.mach[i].kw, 2), energyKwh:r(S.mach[i].kwh, 3)}));
  by.push({id:'AUX', name:'Lighting and compressed air', powerKw:S.mode === 'stopped' ? 5 : 14, energyKwh:r(S.auxKwh, 3)}, {id:'AGV', name:'AGV charging', powerKw:null, energyKwh:r(S.agvKwh, 3)}, {id:'WH', name:'Warehouse', powerKw:null, energyKwh:r(S.whKwh, 3)});
  return {powerKw:r(S.kw, 2), energyKwh:r(S.kwh, 3), peakKw:r(S.peakKw, 2), kwhPerGoodPart:S.good ? r(S.kwh / S.good, 3) : null, compressedAirBar:r(S.airPressure + (Math.random() - 0.5) * 0.06, 2), byConsumer:by};
}
export function pubMachine(world, i, full = true) {
  const S = world.S, d = MACH[i], m = S.mach[i], k = machKpi(S, i);
  const out = {
    id:d.id, name:d.name, operation:d.op, description:d.desc, type:d.type, crewed:d.crew,
    state:m.state, stateCode:STATE_CODE[m.state], stateLabel:STATE_LABEL[m.state], stateSinceS:r(S.t - m.since, 1),
    fault:m.down ? {reason:m.reason, sinceS:r(S.t - m.downAt, 1), technicianOnSite:m.techHere, estimatedRepairS:m.techHere ? r(Math.max(0, m.repairLeft), 1) : null} : null,
    cycle:{progress:m.part ? r(Math.min(1, m.prog / m.ctAct) * 100, 1) : 0, idealS:d.ct, lastS:r(m.lastCt, 2), partId:m.part ? m.part.id : null},
    counters:{parts:m.count, scrap:m.scrap, stops:m.stops},
    oee:oeeOut(k),
    timeS:{run:r(m.ts.RUN, 1), idle:r(m.ts.IDLE, 1), blocked:r(m.ts.BLOCKED, 1), down:r(m.ts.DOWN, 1), off:r(m.ts.OFF, 1)},
    energy:{powerKw:r(m.kw, 2), energyKwh:r(m.kwh, 3), kwhPerPart:m.count ? r(m.kwh / m.count, 3) : null},
    maintenance:{mtbfS:m.stops ? r(m.ts.RUN / m.stops, 0) : null, mttrS:m.stops ? r(m.ts.DOWN / m.stops, 0) : null, downtimeS:r(m.ts.DOWN, 1)},
  };
  if (full) { out.tags = {}; for (const tg of d.tags) out.tags[tg.k] = {name:tg.name, unit:tg.unit, value:readTag(m, tg)}; }
  return out;
}
export function pubMachineTags(world, i) { const m = world.S.mach[i], o = {}; for (const tg of MACH[i].tags) o[tg.k] = readTag(m, tg); return o; }
export function pubTimeline(world, i, sinceS = 1800) {
  const S = world.S, m = S.mach[i], t0 = S.t - sinceS, out = [];
  m.segs.forEach((a, k) => { const end = k + 1 < m.segs.length ? m.segs[k + 1].t : S.t; if (end >= t0) out.push({state:a.s, from:simTime(world, Math.max(a.t, 0)).iso, fromS:r(a.t, 1), durationS:r(end - a.t, 1)}); });
  return out;
}
const AGV_TASK = {raw:'Raw castings to the lathe', wip:'Machined discs to finishing', fg:'Finished pallet to the warehouse'};
export function pubAgv(world, k) {
  const S = world.S, a = S.agv[k], p = ringPos(a.s);
  return {id:`AGV-${a.id}`, state:a.state, charging:a.state === 'idle' && !a.moving && a.battery < 100, lowBattery:a.lowBat, batteryPct:r(a.battery, 1),
    task:a.task ? {type:a.task.type, description:AGV_TASK[a.task.type], pickUp:STOP_NAME[a.task.pick], dropOff:STOP_NAME[a.task.drop]} : null,
    position:{loopM:r(a.s, 2), x:r(p.x, 2), z:r(p.z, 2)}, load:{kind:a.kind, quantity:a.load.length}, trips:a.trips, distanceM:r(a.dist, 1), utilisation:S.t > 0 ? pct(a.busyT / S.t) : 0};
}
const palOut = (S, p) => p ? {id:p.id, type:p.type, quantity:p.qty, ageS:r(S.t - p.t, 0)} : null;
export function pubWarehouse(world) {
  const S = world.S, W = S.wh, c = whCounts(S), f = W.fork, use = rateNow(S) || TARGET_RATE;
  const truck = (T, inb) => ({state:T.state, number:T.no, etaS:T.state === 'due' ? r(Math.max(0, T.eta - S.t), 0) : null, dockedForS:T.state === 'docked' ? r(S.t - T.dockedAt, 0) : null,
    ...(inb ? {palletsOnBoard:T.state === 'none' || T.state === 'due' ? 0 : T.pallets.length, capacity:WH.truckQty} : {palletsLoaded:T.loaded.length, capacity:T.need})});
  return {
    inventory:{rawPallets:c.rawPallets, rawDiscs:c.rawDiscs, rawCoverHours:r(c.rawDiscs / use, 2), finishedPallets:c.fgPallets, finishedDiscs:c.fgDiscs, rackSlots:SLOTS.length, rackOccupied:c.occupied, rackOccupancy:pct(c.occupied / SLOTS.length), reorderPointPallets:WH.reorderPoint},
    slots:SLOTS.map((s, i) => ({id:s.id, zone:s.zone === 'raw' ? 'raw' : 'finished', bay:s.bay + 1, level:s.level + 1, pallet:palOut(S, W.slots[i].pallet)})),
    stands:{raw:W.rawStand.map(p => palOut(S, p)), finished:W.fgStand.map(p => palOut(S, p))},
    forklift:{id:'FLT-1', state:f.state, task:f.task ? {kind:f.task.kind, from:locName(f.task.from), to:locName(f.task.to)} : null, position:{x:r(f.x, 2), z:r(f.z, 2)}, forkHeightM:r(f.lift, 2), load:palOut(S, f.load), moves:f.moves, distanceM:r(f.dist, 1), utilisation:S.t > 0 ? pct(f.busyT / S.t) : 0},
    trucks:{inbound:truck(W.inbound, true), outbound:truck(W.outbound, false)},
    stats:{...W.stats, stockoutT:undefined, d2sSum:undefined, d2sN:undefined, stockoutS:r(W.stats.stockoutT, 1), dockToStockAvgS:W.stats.d2sN ? r(W.stats.d2sSum / W.stats.d2sN, 0) : null},
  };
}
export function pubBuffers(world) {
  const S = world.S;
  return [
    ...Object.entries(TBL).map(([k, t]) => ({id:t.id, name:t.name, kind:'buffer', quantity:S.buf[k].length, capacity:BUFFER_CAP, parts:S.buf[k].map(p => ({id:p.id, stage:STAGE_NAME[p.stage]}))})),
    {id:'PAL-1', name:'Palletiser pallet', kind:'pallet', quantity:S.pallet.length, capacity:PALLET_QTY, parts:S.pallet.map(p => ({id:p.id, stage:STAGE_NAME[p.stage]}))},
    ...CONV.map((c, i) => ({id:c.id, name:`Conveyor ${c.from} to ${c.to}`, kind:'conveyor', lengthM:r(c.len, 2), speedMps:S.mode === 'stopped' ? 0 : CONV_V, quantity:S.conv[i].length, capacity:Math.floor(c.len / SPACING) + 1,
      parts:S.conv[i].map(it => ({id:it.part.id, stage:STAGE_NAME[it.part.stage], positionM:r(it.pos, 2)}))})),
  ];
}
export function pubPeople(world) {
  const S = world.S, o = S.op1, T = S.tech, f = S.wh.fork;
  const opAct = {idle:'Watching the cycle', toTable:'Walking to the casting buffer', toMach:'Carrying a casting to the lathe', hold:'Waiting to load the lathe', back:'Returning to the lathe'};
  return [
    {id:'OP-M1', role:'Machine operator', station:'M1', activity:opAct[o.state], position:{x:r(o.x, 2), z:r(o.z, 2)}, partsLoaded:o.loads},
    {id:'OP-M3', role:'Machine operator', station:'M3', activity:S.mach[2].state === 'RUN' ? 'Running the balancer' : 'Standing by', position:{x:3.65, z:-3.5}},
    {id:'OP-M6', role:'Quality inspector', station:'M6', activity:S.mach[5].state === 'RUN' ? 'Supervising inspection' : 'Standing by', position:{x:-7.9, z:6.45}},
    {id:'TECH-1', role:'Maintenance technician', station:'Line 2', activity:T.state === 'repair' ? `Repairing ${MACH[T.job].id}` : T.state === 'walk' ? `Walking to ${MACH[T.job].id}` : T.state === 'return' ? 'Returning to the workshop' : 'On standby', position:{x:r(T.x, 2), z:r(T.z, 2)}, repairsCompleted:T.repairs, openCalls:T.queue.length + (T.job != null ? 1 : 0), utilisation:S.t > 0 ? pct(T.busyT / S.t) : 0},
    {id:'FLT-1', role:'Forklift driver', station:'Warehouse', activity:f.task ? `${f.task.kind}: ${locName(f.task.from)} to ${locName(f.task.to)}` : 'Parked', position:{x:r(f.x, 2), z:r(f.z, 2)}},
  ];
}
export function pubEvents(world, limit = 50, sinceId = 0) {
  return world.S.log.filter(e => e.id > sinceId).slice(0, limit).map(e => ({id:e.id, time:simTime(world, e.t), severity:e.kind, source:e.src, message:e.msg}));
}
export function pubHistory(world) { return world.S.hist.map(h => ({time:simTime(world, h.t).iso, t:h.t, oee:h.oee, availability:h.a, performance:h.p, quality:h.q, throughputPerHour:h.rate, powerKw:h.kw, good:h.good, scrap:h.scrap, rawDiscs:h.raw, finishedPallets:h.fg})); }
export function pubMachineHistory(world, i) { return world.S.mach[i].hist.map(h => ({time:simTime(world, h.t).iso, ...h})); }
export function pubState(world) {
  return {status:pubStatus(world), kpis:pubKpis(world), machines:MACH.map((_, i) => pubMachine(world, i)), agvs:world.S.agv.map((_, k) => pubAgv(world, k)), material:pubBuffers(world), people:pubPeople(world), warehouse:pubWarehouse(world)};
}

/* ============================================================ viewer messages (WebSocket) */
// compact frame for rendering, sent many times a second
export function viewFrame(world) {
  const S = world.S, W = S.wh, f = W.fork;
  return {
    k:'f', t:S.t, mode:S.mode, paused:world.paused, speed:world.speed,
    buf:{ain:S.buf.ain.map(p => p.stage), aout:S.buf.aout.map(p => p.stage), bin:S.buf.bin.map(p => p.stage)},
    conv:S.conv.map(c => c.map(it => [r(it.pos, 3), it.part.stage])),
    pallet:S.pallet.length,
    mach:S.mach.map(m => ({s:m.state, p:m.part ? m.part.stage : -1, f:m.part ? (m.done ? 1 : r(Math.min(1, m.prog / m.ctAct), 3)) : 0})),
    agv:S.agv.map(a => ({s:r(a.s, 3), st:a.state, mv:a.moving, low:a.lowBat, kind:a.kind, load:a.load.map(p => p.stage), bat:Math.round(a.battery)})),
    tech:{x:r(S.tech.x, 3), z:r(S.tech.z, 3), yaw:r(S.tech.yaw, 3), st:S.tech.state},
    op1:{x:r(S.op1.x, 3), z:r(S.op1.z, 3), yaw:r(S.op1.yaw, 3), st:S.op1.state, c:S.op1.carry ? S.op1.carry.stage : -1},
    wh:{slots:W.slots.map(s => s.pallet ? s.pallet.qty : 0), raw:W.rawStand.map(p => p ? p.qty : 0), fg:W.fgStand.map(p => p ? p.qty : 0),
      fork:{x:r(f.x, 3), z:r(f.z, 3), yaw:r(f.yaw, 3), lift:r(f.lift, 3), st:f.state, load:f.load ? [f.load.type, f.load.qty] : null},
      inb:{st:W.inbound.state, pos:r(W.inbound.pos, 3), n:W.inbound.pallets.length}, out:{st:W.outbound.state, pos:r(W.outbound.pos, 3), n:W.outbound.loaded.length}},
  };
}
// dashboard data, sent a couple of times a second
export function viewStats(world) {
  const S = world.S;
  return {
    k:'s', status:pubStatus(world), kpis:pubKpis(world),
    machines:MACH.map((_, i) => ({...pubMachine(world, i), segs:S.mach[i].segs.filter((a, k, arr) => (k + 1 < arr.length ? arr[k + 1].t : S.t) >= S.t - 1800).map(a => [a.s, r(a.t, 1)])})),
    agvs:S.agv.map((_, k) => pubAgv(world, k)), material:pubBuffers(world), people:pubPeople(world), warehouse:pubWarehouse(world),
    hist:S.hist, events:pubEvents(world, 80),
  };
}
