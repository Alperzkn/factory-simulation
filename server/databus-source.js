// Databus source: the twin app does not simulate. It subscribes to the SIMATIC v1 topics published by the
// Flow Creator flow (edge/kestrel-twin-flow.json), rebuilds the viewer's data from them, and sends commands back
// as writes to the Control_0 data point.
import mqtt from 'mqtt';
import * as DB from '../shared/databus.js';
import { PLANT, MACH, CONV, TBL, SLOTS, WH, PEOPLE, ANOMALIES, STATE_LABEL, STOP_NAME, PALLET_QTY } from '../shared/plant.js';
import { fmtClock } from '../shared/engine.js';

const AGV_TASK = {raw:'Raw castings to the lathe', wip:'Machined discs to finishing', fg:'Finished pallet to the warehouse'};
const STOP_BY_TASK = {raw:[81.5, 95], wip:[35, 45], fg:[85, 98.5]};

export function startDatabusSource({cfg, service, onStats}) {
  const T = DB.topics(cfg.databusConnector, cfg.databusConnection);
  const values = {};                     // registry tag id -> value
  let idMap = null;                      // publisher id -> registry id, from metadata (matched by tag name)
  let frame = null, frameSeq = 0, timeline = [], history = [], events = [], lastAt = 0, messages = 0, seq = 0;
  const machHist = MACH.map(() => []), lastMachSample = MACH.map(() => -1e9);

  const client = mqtt.connect(cfg.databusUrl, {
    clientId:`kestrel-viewer-${Math.random().toString(16).slice(2, 8)}`, username:cfg.databusUser || undefined, password:cfg.databusPassword || undefined,
    reconnectPeriod:3000, connectTimeout:8000,
  });
  service.status = 'starting';
  client.on('connect', () => { service.status = 'running'; service.error = undefined; client.subscribe([T.meta, `${T.read}/#`], {qos:0}); });
  client.on('reconnect', () => { service.status = 'starting'; });
  client.on('close', () => { if (service.status === 'running') service.status = 'starting'; });
  client.on('error', e => { service.status = 'error'; service.error = e.message; });
  client.on('message', (topic, buf) => {
    let p; try { p = JSON.parse(buf.toString()); } catch { return; }
    messages++; lastAt = Date.now(); service.messages = messages; service.lastMessageAt = new Date(lastAt).toISOString();
    if (topic === T.meta) {
      idMap = {};
      for (const c of (p.connections || [])) for (const dp of (c.dataPoints || [])) for (const d of (dp.dataPointDefinitions || [])) { const t = DB.TAGS.find(x => x.name === d.name); if (t) idMap[d.id] = t.id; }
      service.metadataTags = Object.keys(idMap).length;
      return;
    }
    if (!topic.startsWith(`${T.read}/`) || !Array.isArray(p.vals)) return;
    const chunk = topic.slice(T.read.length + 1);
    for (const v of p.vals) values[idMap ? idMap[v.id] ?? v.id : v.id] = v.val;
    if (chunk.startsWith('Frame')) { const j = tagVal('Twin.FrameJson'); if (j) { try { frame = JSON.parse(j); frameSeq++; } catch { /* partial value */ } } }
    else if (chunk.startsWith('Twin')) { events = parse(tagVal('Twin.EventsJson'), events); timeline = parse(tagVal('Twin.TimelineJson'), timeline); }
    else if (chunk.startsWith('History')) history = parse(tagVal('Twin.HistoryJson'), history);
    else if (/^M\d_/.test(chunk)) sampleMachine(+chunk[1] - 1);
  });

  const tagVal = name => values[DB.tagByName(name).id];
  const parse = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };
  function sampleMachine(i) {
    const t = Number(tagVal('Status.SimSeconds')) || 0;
    if (t < lastMachSample[i]) { machHist[i].length = 0; lastMachSample[i] = -1e9; }        // shift was reset
    if (t - lastMachSample[i] < 10) return;
    lastMachSample[i] = t;
    const d = MACH[i], row = {t, time:new Date().toISOString(), state:tagVal(`Machines.${d.id}.State`), kw:tagVal(`Machines.${d.id}.Energy.PowerKw`)};
    for (const tg of d.tags) row[tg.k] = tagVal(`Machines.${d.id}.Process.${tg.k[0].toUpperCase() + tg.k.slice(1)}`);
    machHist[i].push(row); if (machHist[i].length > 360) machHist[i].shift();
  }

  // Rebuild the viewer's stats object (same shape as engine.viewStats) from the received tags
  function stats() {
    const s = DB.decode(values);
    if (!s.status || !s.kpis || !s.machines) return null;
    const secs = Number(s.status.simTime.seconds) || 0;
    const status = {plant:PLANT, mode:s.status.mode, lineMode:s.status.lineMode, paused:s.status.paused, speed:s.status.speed,
      simTime:{seconds:secs, clock:s.status.simTime.clock || fmtClock(secs), iso:new Date().toISOString()}, source:'databus'};
    const k = s.kpis; k.production.planAttainment = k.plannedProductionTimeS > 60 ? k.production.planAttainment : null;
    k.energy.byConsumer = [...MACH.map((d, i) => ({id:d.id, name:d.name, powerKw:s.machines[i].energy.powerKw, energyKwh:s.machines[i].energy.energyKwh})),
      ...['Lighting and compressed air', 'AGV charging', 'Warehouse'].map((name, n) => ({id:['AUX', 'AGV', 'WH'][n], name, powerKw:null, energyKwh:k.energy.byConsumer[MACH.length + n].energyKwh}))];
    const machines = MACH.map((d, i) => {
      const m = s.machines[i], tags = {};
      for (const tg of d.tags) tags[tg.k] = {name:tg.name, unit:tg.unit, value:m.tags[tg.k].value};
      return {...m, id:d.id, name:d.name, operation:d.op, description:d.desc, type:d.type, crewed:d.crew, stateLabel:STATE_LABEL[m.state] || m.state,
        fault:m.fault.active ? {reason:m.fault.reason, technicianOnSite:m.fault.technicianOnSite, estimatedRepairS:m.fault.estimatedRepairS} : null,
        tags, segs:timeline[i] || []};
    });
    const agvs = s.agvs.map((a, k) => ({...a, id:`AGV-${k + 1}`, task:a.task.type ? {type:a.task.type, description:AGV_TASK[a.task.type] || a.task.type, pickUp:STOP_NAME[STOP_BY_TASK[a.task.type][0]], dropOff:STOP_NAME[STOP_BY_TASK[a.task.type][1]]} : null}));
    const matDefs = [...Object.values(TBL).map(t => ({id:t.id, name:t.name, kind:'buffer'})), {id:'PAL-1', name:'Palletiser pallet', kind:'pallet'}, ...CONV.map(c => ({id:c.id, name:`Conveyor ${c.from} to ${c.to}`, kind:'conveyor', lengthM:Math.round(c.len * 100) / 100}))];
    const material = matDefs.map((m, n) => ({...m, quantity:s.material[n].quantity, capacity:s.material[n].capacity}));
    const f = frame || {};
    const pos = {'OP-M1':f.op1, 'TECH-1':f.tech, 'FLT-1':f.wh && f.wh.fork};
    const people = PEOPLE.map((p, n) => ({id:p.id, role:p.role, station:p.station, activity:s.people[n].activity, position:pos[p.id] ? {x:pos[p.id].x, z:pos[p.id].z} : {x:0, z:0},
      ...(p.id === 'TECH-1' ? {repairsCompleted:s.people[3].repairsCompleted, openCalls:s.people[3].openCalls, utilisation:0} : {})}));
    const w = s.warehouse, fk = w.forklift;
    const warehouse = {
      inventory:{...w.inventory, rackSlots:SLOTS.length, reorderPointPallets:WH.reorderPoint},
      slots:SLOTS.map((sl, n) => ({id:sl.id, zone:sl.zone === 'raw' ? 'raw' : 'finished', bay:sl.bay + 1, level:sl.level + 1,
        pallet:w.slots[n].pallet.quantity ? {id:w.slots[n].pallet.id, type:sl.zone, quantity:w.slots[n].pallet.quantity, ageS:0} : null})),
      stands:{raw:w.stands.raw.map(p => (p.quantity ? {id:p.id, type:'raw', quantity:p.quantity, ageS:0} : null)), finished:w.stands.finished.map(p => (p.quantity ? {id:p.id, type:'fg', quantity:p.quantity, ageS:0} : null))},
      forklift:{id:'FLT-1', state:fk.state, task:fk.task.kind ? {kind:fk.task.kind, from:'', to:''} : null, forkHeightM:fk.forkHeightM, moves:fk.moves, distanceM:fk.distanceM, utilisation:fk.utilisation,
        load:f.wh && f.wh.fork && f.wh.fork.load ? {id:'', type:f.wh.fork.load[0], quantity:f.wh.fork.load[1]} : null, position:f.wh ? {x:f.wh.fork.x, z:f.wh.fork.z} : {x:0, z:0}},
      trucks:{inbound:{...w.trucks.inbound, dockedForS:null, capacity:WH.truckQty}, outbound:{...w.trucks.outbound, dockedForS:null, capacity:WH.shipQty}},
      stats:w.stats,
    };
    for (const t of Object.values(warehouse.trucks)) if (t.state !== 'due') t.etaS = null;
    const def = ANOMALIES.find(a => a.type === s.anomaly.type);
    const anomaly = {...s.anomaly, name:def ? def.name : '', effect:def ? def.effect : '', nextInS:null, last:null, catalog:ANOMALIES.map(d => ({type:d.type, name:d.name, station:d.station, effect:d.effect}))};
    const ai = s.ai && Object.keys(s.ai).length ? {...s.ai} : null;
    return {k:'s', status, kpis:k, machines, agvs, material, people, warehouse, hist:history, events, anomaly, ai};
  }

  function command(cmd) {
    if (!client.connected) return {ok:false, error:'not connected to the Databus'};
    const w = DB.controlWrite(cmd, ++seq);
    if (!w) return {ok:false, error:'this action cannot be sent to the Databus'};
    client.publish(`${T.write}/${w.chunk}`, JSON.stringify(w.payload), {qos:1}, err => { if (err) service.error = err.message; });
    setTimeout(onStats, 400);
    return {ok:true, note:'sent to the Databus; the flow applies it within a second'};
  }

  return {
    mode:'databus', topics:T,
    frame:() => (frame ? {k:'f', ...frame} : null), frameSeq:() => frameSeq,
    stats, command, machineHistory:i => machHist[i],
    tags:() => DB.TAGS.filter(t => t.id in values && t.group !== 'Frame').map(t => ({id:t.id, name:t.name, dataType:t.dataType, unit:t.unit, value:values[t.id]})),
    health:() => ({connected:client.connected, messages, lastMessageAt:lastAt ? new Date(lastAt).toISOString() : null, metadataTags:service.metadataTags || 0}),
    PALLET_QTY,
  };
}
