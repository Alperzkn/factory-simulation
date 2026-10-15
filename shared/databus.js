// SIMATIC v1 JSON on the Industrial Edge Databus: tag catalogue, metadata, read payloads and write handling.
// Used by the Flow Creator publisher (edge/build-flow.mjs bundles this file) and by the viewer server in databus mode.
//
// Topics, with <connector> = DATABUS.connector and <connection> = DATABUS.connection:
//   ie/m/j/simatic/v1/<connector>/dp                         metadata, retained
//   ie/d/j/simatic/v1/<connector>/dp/r/<connection>/<chunk>  read values, published by the flow
//   ie/d/j/simatic/v1/<connector>/dp/w/<connection>/<chunk>  writes (Control_0 from the viewer, AI_0 from AI Inference Server)
import { PLANT, MACH, CONV, TBL, SLOTS, ANOMALIES, STATE_CODE } from './plant.js';
import { pubState, viewFrame, pubEvents, pubTimeline, applyCommand } from './engine.js';

export const DATABUS = {connector:'kestreltwin1', connection:'factory', namespace:'KBW', applicationName:'Kestrel Brake Works Digital Twin', modelVersion:'2.0.0'};
export const topics = (connector = DATABUS.connector, connection = DATABUS.connection) => ({
  meta:`ie/m/j/simatic/v1/${connector}/dp`,
  read:`ie/d/j/simatic/v1/${connector}/dp/r/${connection}`,
  write:`ie/d/j/simatic/v1/${connector}/dp/w/${connection}`,
});

/* ---------------- tag catalogue ---------------- */
// Every tag reads one value from the snapshot built by snapshot(). `path` is a dotted path into it, so the
// viewer can rebuild the same objects from received values. Append new tags at the end of a group: ids are positional.
const registry = [];
function add(group, name, dataType, unit, path, description, role = 'simulated', extra = {}) {
  registry.push({id:String(1001 + registry.length), name:`${DATABUS.namespace}.${name}`, group, dataType, unit, path, description, role, ...extra});
}
const R = 'Real', S = 'String', B = 'Bool', I = 'Int', U = 'UDInt';

add('Plant', 'Info.DataOrigin', S, '', 'const:SIMULATION', 'Always simulated, never field measurements', 'provenance');
add('Plant', 'Info.ModelVersion', S, '', `const:${DATABUS.modelVersion}`, 'Simulation model version', 'configuration');
add('Plant', 'Info.Plant', S, '', `const:${PLANT.company} ${PLANT.line}`, 'Plant and line name', 'configuration');
add('Plant', 'Info.Product', S, '', 'const:' + PLANT.product, 'Product made on the line', 'configuration');
add('Plant', 'Status.Mode', S, '', 'status.mode', 'running, paused, stopping or stopped', 'state');
add('Plant', 'Status.LineMode', S, '', 'status.lineMode', 'Line mode ignoring pause: running, stopping or stopped', 'state');
add('Plant', 'Status.Paused', B, '', 'status.paused', 'Simulation clock frozen', 'state');
add('Plant', 'Status.Speed', R, 'x', 'status.speed', 'Simulation speed multiplier', 'state');
add('Plant', 'Status.SimSeconds', R, 's', 'status.simTime.seconds', 'Simulated seconds since shift start', 'diagnostic');
add('Plant', 'Status.ShiftClock', S, '', 'status.simTime.clock', 'Simulated shift clock hh:mm:ss', 'diagnostic');
add('Plant', 'Status.LastCommand', S, '', 'control.lastResult', 'Result of the last write to Control_0', 'diagnostic');
for (const [k, d] of [['oee', 'Overall equipment effectiveness'], ['availability', 'Availability'], ['performance', 'Performance'], ['quality', 'Quality']])
  add('Plant', `Oee.${cap(k)}`, R, '%', `kpis.oee.${k}`, `Line ${d.toLowerCase()}`);
for (const [k, t, u, d] of [['good', U, 'count', 'Good discs palletised'], ['scrap', U, 'count', 'Discs scrapped'], ['firstPassYield', R, '%', 'Good share of finished discs'],
  ['throughputPerHour', R, '1/h', 'Good discs per hour, 5 minute window'], ['targetPerHour', R, '1/h', 'Planned rate'], ['planned', U, 'count', 'Planned discs so far'],
  ['planAttainment', R, '%', 'Good discs against plan, 0 until there is a plan'], ['wip', U, 'count', 'Discs in process'], ['palletsCompleted', U, 'count', 'Pallets completed by the robot']])
  add('Plant', `Production.${cap(k)}`, t, u, `kpis.production.${k}`, d, k === 'planned' || k === 'targetPerHour' ? 'configuration' : 'simulated');
add('Plant', 'Production.PlannedTimeS', R, 's', 'kpis.plannedProductionTimeS', 'Planned production time');
for (const [k, u, d] of [['powerKw', 'kW', 'Total electrical load'], ['energyKwh', 'kWh', 'Energy this shift'], ['peakKw', 'kW', 'Peak load this shift'], ['kwhPerGoodPart', 'kWh', 'Energy per good disc'], ['compressedAirBar', 'bar(g)', 'Compressed air header pressure']])
  add('Plant', `Energy.${cap(k)}`, R, u, `kpis.energy.${k}`, d);
['AUX', 'AGV', 'WH'].forEach((id, n) => add('Plant', `Energy.${id}.EnergyKwh`, R, 'kWh', `kpis.energy.byConsumer.${MACH.length + n}.energyKwh`, ['Lighting and compressed air', 'AGV charging', 'Warehouse'][n]));
for (const [k, t, u, d] of [['active', B, '', 'An injected anomaly is active'], ['id', S, '', 'Anomaly event id'], ['type', S, '', `One of ${ANOMALIES.map(a => a.type).join(', ')}`],
  ['name', S, '', 'Anomaly description'], ['station', S, '', 'Affected station id, or PLANT'], ['severity', R, '', 'Severity 0 to 1'], ['level', R, '', 'Current effect strength 0 to 1, ramps in'],
  ['startUtc', S, '', 'Anomaly start'], ['endUtc', S, '', 'Scheduled anomaly end'], ['secondsRemaining', R, 's', 'Seconds until the anomaly ends'],
  ['count', U, 'count', 'Anomalies injected this shift'], ['integratedS', R, 's', 'Total anomaly time this shift'], ['manual', B, '', 'Injected on request rather than at random']])
  add('Plant', `Anomaly.${cap(k)}`, t, u, `anomaly.${k}`, `${d}. Ground truth, exclude from detector inputs`, 'ground_truth');
add('Plant', 'Events.LastId', U, '', 'events.0.id', 'Id of the newest event', 'event');
add('Plant', 'Events.LastSeverity', S, '', 'events.0.severity', 'info, alarm, quality, logistics or anomaly', 'event');
add('Plant', 'Events.LastSource', S, '', 'events.0.source', 'Station or area that raised the newest event', 'event');
add('Plant', 'Events.LastMessage', S, '', 'events.0.message', 'Text of the newest event', 'event');

MACH.forEach((d, i) => {
  const g = d.id, p = `machines.${i}`, m = (name, t, u, path, desc, role) => add(g, `Machines.${d.id}.${name}`, t, u, `${p}.${path}`, `${d.id} ${d.name}: ${desc}`, role);
  m('State', S, '', 'state', 'RUN, IDLE, BLOCKED, DOWN or OFF', 'state');
  m('StateCode', I, '', 'stateCode', '0 off, 1 idle, 2 run, 3 blocked, 4 down', 'state');
  m('StateSinceS', R, 's', 'stateSinceS', 'Seconds in the current state');
  m('Fault.Active', B, '', 'fault.active', 'Unplanned stop active', 'state');
  m('Fault.Reason', S, '', 'fault.reason', 'Fault reason, empty when healthy', 'state');
  m('Fault.TechnicianOnSite', B, '', 'fault.technicianOnSite', 'Technician is repairing', 'state');
  m('Fault.EstimatedRepairS', R, 's', 'fault.estimatedRepairS', 'Repair time left, 0 when unknown');
  m('Cycle.Progress', R, '%', 'cycle.progress', 'Progress of the current cycle');
  m('Cycle.IdealS', R, 's', 'cycle.idealS', 'Ideal cycle time', 'configuration');
  m('Cycle.LastS', R, 's', 'cycle.lastS', 'Last cycle time');
  m('Cycle.PartId', U, '', 'cycle.partId', 'Disc in process, 0 when empty');
  for (const k of ['parts', 'scrap', 'stops']) m(`Counters.${cap(k)}`, U, 'count', `counters.${k}`, `${k} this shift`);
  for (const k of ['oee', 'availability', 'performance', 'quality']) m(`Oee.${cap(k)}`, R, '%', `oee.${k}`, k);
  for (const k of ['run', 'idle', 'blocked', 'down', 'off']) m(`Time.${cap(k)}S`, R, 's', `timeS.${k}`, `time in ${k}`);
  m('Energy.PowerKw', R, 'kW', 'energy.powerKw', 'electrical load', 'power');
  m('Energy.EnergyKwh', R, 'kWh', 'energy.energyKwh', 'energy this shift');
  m('Energy.KwhPerPart', R, 'kWh', 'energy.kwhPerPart', 'energy per part');
  m('Maintenance.MtbfS', R, 's', 'maintenance.mtbfS', 'mean running time between failures');
  m('Maintenance.MttrS', R, 's', 'maintenance.mttrS', 'mean time to repair');
  for (const tg of d.tags) m(`Process.${cap(tg.k)}`, R, tg.unit, `tags.${tg.k}.value`, `${tg.name}${tg.perPart ? ', measured per part' : ''}`, 'process');
});

for (let k = 0; k < 2; k++) {
  const p = `agvs.${k}`, a = (name, t, u, path, desc, role) => add('Logistics', `AGV${k + 1}.${name}`, t, u, `${p}.${path}`, `AGV ${k + 1}: ${desc}`, role);
  a('State', S, '', 'state', 'idle, toPick, loading, toDrop or unloading', 'state');
  a('BatteryPct', R, '%', 'batteryPct', 'battery charge');
  a('Charging', B, '', 'charging', 'charging from the floor', 'state');
  a('LowBattery', B, '', 'lowBattery', 'battery low, not taking jobs', 'state');
  a('Task.Type', S, '', 'task.type', 'raw, wip or fg, empty when idle', 'state');
  a('Task.PickUp', S, '', 'task.pickUp', 'pick-up stop');
  a('Task.DropOff', S, '', 'task.dropOff', 'drop-off stop');
  a('Position.LoopM', R, 'm', 'position.loopM', 'position on the loop');
  a('Position.X', R, 'm', 'position.x', 'plant X'); a('Position.Z', R, 'm', 'position.z', 'plant Z');
  a('Load.Kind', S, '', 'load.kind', 'tote or pallet, empty when unloaded');
  a('Load.Quantity', U, 'count', 'load.quantity', 'discs on board');
  a('Trips', U, 'count', 'trips', 'jobs completed'); a('DistanceM', R, 'm', 'distanceM', 'distance driven'); a('Utilisation', R, '%', 'utilisation', 'busy share of time');
}
[...Object.values(TBL).map(t => t.id), 'PAL-1', ...CONV.map(c => c.id)].forEach((id, n) => {
  add('Logistics', `Material.${id.replace('-', '')}.Quantity`, U, 'count', `material.${n}.quantity`, `Parts in ${id}`);
  add('Logistics', `Material.${id.replace('-', '')}.Capacity`, U, 'count', `material.${n}.capacity`, `Capacity of ${id}`, 'configuration');
});
['OP-M1', 'OP-M3', 'OP-M6', 'TECH-1', 'FLT-1'].forEach((id, n) => add('Logistics', `People.${id.replace('-', '')}.Activity`, S, '', `people.${n}.activity`, `${id} current activity`, 'state'));
add('Logistics', 'People.TECH1.OpenCalls', U, 'count', 'people.3.openCalls', 'Repair calls waiting or in progress');
add('Logistics', 'People.TECH1.RepairsCompleted', U, 'count', 'people.3.repairsCompleted', 'Repairs completed this shift');

for (const [k, t, u, d] of [['rawPallets', U, 'count', 'Raw casting pallets in stock'], ['rawDiscs', U, 'count', 'Raw castings in stock'], ['rawCoverHours', R, 'h', 'Hours of production covered by raw stock'],
  ['finishedPallets', U, 'count', 'Finished pallets in stock'], ['finishedDiscs', U, 'count', 'Finished discs in stock'], ['rackOccupied', U, 'count', 'Occupied rack slots'], ['rackOccupancy', R, '%', 'Rack occupancy']])
  add('Warehouse', `Inventory.${cap(k)}`, t, u, `warehouse.inventory.${k}`, d);
for (const [k, t, u, d] of [['state', S, '', 'idle, toPick, picking, toDrop, dropping or toHome'], ['moves', U, 'count', 'Pallet moves'], ['distanceM', R, 'm', 'Distance driven'], ['utilisation', R, '%', 'Busy share of time'], ['forkHeightM', R, 'm', 'Fork height']])
  add('Warehouse', `Forklift.${cap(k)}`, t, u, `warehouse.forklift.${k}`, `Forklift FLT-1: ${d}`, k === 'state' ? 'state' : 'simulated');
add('Warehouse', 'Forklift.Task', S, '', 'warehouse.forklift.task.kind', 'replenish, putaway, unload or load, empty when idle', 'state');
for (const dir of ['inbound', 'outbound']) {
  const T = cap(dir);
  add('Warehouse', `Trucks.${T}.State`, S, '', `warehouse.trucks.${dir}.state`, 'none, due, arriving, docked or departing', 'state');
  add('Warehouse', `Trucks.${T}.Number`, U, '', `warehouse.trucks.${dir}.number`, 'Truck number this shift');
  add('Warehouse', `Trucks.${T}.EtaS`, R, 's', `warehouse.trucks.${dir}.etaS`, 'Seconds until arrival, 0 when not due');
  add('Warehouse', `Trucks.${T}.Pallets`, U, 'count', `warehouse.trucks.${dir}.${dir === 'inbound' ? 'palletsOnBoard' : 'palletsLoaded'}`, dir === 'inbound' ? 'Pallets still on the truck' : 'Pallets loaded');
}
for (const [k, d] of [['receivedDiscs', 'Castings received'], ['shippedDiscs', 'Discs shipped'], ['trucksIn', 'Inbound trucks'], ['trucksOut', 'Outbound trucks'], ['replenishments', 'Line replenishments'], ['putaways', 'Put-aways']])
  add('Warehouse', `Stats.${cap(k)}`, U, 'count', `warehouse.stats.${k}`, d);
add('Warehouse', 'Stats.DockToStockAvgS', R, 's', 'warehouse.stats.dockToStockAvgS', 'Average time from dock to rack');
add('Warehouse', 'Stats.StockoutS', R, 's', 'warehouse.stats.stockoutS', 'Time the line waited for raw castings');
SLOTS.forEach((s, n) => {
  add('Warehouse', `Slots.${s.id}.Quantity`, U, 'count', `warehouse.slots.${n}.pallet.quantity`, `Rack slot ${s.id}: discs on the pallet, 0 when empty`);
  add('Warehouse', `Slots.${s.id}.PalletId`, S, '', `warehouse.slots.${n}.pallet.id`, `Rack slot ${s.id}: pallet id`);
});
for (const [zone, key] of [['raw', 'Raw'], ['finished', 'Finished']]) for (let k = 0; k < 2; k++) {
  add('Warehouse', `Stands.${key}${k + 1}.Quantity`, U, 'count', `warehouse.stands.${zone}.${k}.quantity`, `${key} handover stand position ${k + 1}`);
  add('Warehouse', `Stands.${key}${k + 1}.PalletId`, S, '', `warehouse.stands.${zone}.${k}.id`, `${key} handover stand position ${k + 1}: pallet id`);
}

// Visualisation feed for the 3D viewer: JSON text, not meant for analytics
add('Frame', 'Twin.FrameJson', S, '', 'frameJson', 'Positions and states for the 3D viewer, JSON', 'visualisation');
add('Twin', 'Twin.EventsJson', S, '', 'eventsJson', 'Latest events, JSON', 'visualisation');
add('Twin', 'Twin.TimelineJson', S, '', 'timelineJson', 'Station state changes over the last 30 minutes, JSON', 'visualisation');
add('History', 'Twin.HistoryJson', S, '', 'historyJson', 'Line KPI samples every 20 simulated seconds, JSON', 'visualisation');

// Written by clients (the viewer, a dashboard, a flow); the publisher applies the request and echoes the value.
for (const [k, t, d] of [['Command', S, 'start, pause, resume, stop or reset'], ['Speed', R, 'Speed multiplier 0.1 to 120'], ['FaultStation', S, 'Station id to force an unplanned stop on'],
  ['TruckRequest', S, 'inbound or outbound'], ['AnomalyRequest', S, `random, clear, or one of ${ANOMALIES.map(a => a.type).join(', ')}`], ['Sequence', U, 'Increment to repeat the same request']])
  add('Control', `Control.${k}`, t, '', `control.${k}`, d, 'command', {access:'rw'});
// Written by AI Inference Server (or any detector). Integers, because AIIS writes SIMATIC v1 outputs as integers.
for (const [k, d] of [['AnomalyScore', 'Anomaly score 0 to 1000, 500 is the warning threshold'], ['Status', '0 normal, 1 warning, 2 alarm'],
  ['Station', '0 none, 1 to 7 for M1 to M7, 8 plant air system'], ['HealthIndex', 'Health index 0 to 100']])
  add('AI', `AI.${k}`, 'DInt', '', `ai.${k}`, d, 'ai_output', {access:'rw', external:true});

function cap(s) { return s[0].toUpperCase() + s.slice(1); }

// chunks of at most 100 tags per group, named <Group>_<n> like the SIMATIC S7 connectors do
export const CHUNKS = [];
for (const g of [...new Set(registry.map(t => t.group))]) {
  const tags = registry.filter(t => t.group === g);
  for (let o = 0; o < tags.length; o += 100) CHUNKS.push({name:`${g}_${o / 100}`, group:g, tags:tags.slice(o, o + 100)});
}
export const TAGS = registry;
export const tagByName = name => registry.find(t => t.name === `${DATABUS.namespace}.${name}` || t.name === name);
export const catalog = () => registry.map(({path, ...t}) => t);

/* ---------------- publisher side ---------------- */
const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
function coerce(v, type) {
  if (type === 'Bool') return !!v;
  if (type === 'String') return v == null ? '' : String(v);
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return type === 'Real' ? Math.round(n * 1e6) / 1e6 : Math.round(n);
}
// Everything the tags read, built once per publication
export function snapshot(world) {
  const st = pubState(world);
  st.events = pubEvents(world, 40);
  st.machines.forEach(m => { m.fault = m.fault ? {active:true, ...m.fault} : {active:false, reason:'', technicianOnSite:false, estimatedRepairS:0}; });
  st.agvs.forEach(a => { if (!a.task) a.task = {type:'', pickUp:'', dropOff:''}; });
  if (!st.warehouse.forklift.task) st.warehouse.forklift.task = {kind:''};
  st.control = world.control || {};
  st.ai = world.ai || {};
  st.frameJson = JSON.stringify(viewFrame(world));
  st.eventsJson = JSON.stringify(st.events);
  st.timelineJson = JSON.stringify(MACH.map((_, i) => pubTimeline(world, i, 1800).map(s => [s.state, s.fromS])));
  st.historyJson = JSON.stringify(world.S.hist);
  return st;
}
export function metadata(connector = DATABUS.connector, connection = DATABUS.connection, hashVersion = 2026101501) {
  const T = topics(connector, connection);
  return {
    applicationName:DATABUS.applicationName, hashVersion, seq:1,
    connections:[{name:connection, type:'S7Plus', dataPoints:CHUNKS.map(c => ({
      name:c.name, publishType:'bulk', topic:`${T.read}/${c.name}`,
      ...(c.tags.some(t => t.access === 'rw') ? {pubTopic:`${T.write}/${c.name}`} : {}),
      dataPointDefinitions:c.tags.map(t => ({id:t.id, name:t.name, dataType:t.dataType, accessMode:t.access || 'r', acquisitionCycleInMs:c.group === 'Frame' ? 250 : c.group === 'History' ? 20000 : 1000, acquisitionMode:'Cyclic'})),
    }))}],
  };
}
// Read payloads for the chosen chunks. AI_0 is never published here: it only exists once a detector writes it.
export function readMessages(world, chunkNames, seq, connector = DATABUS.connector, connection = DATABUS.connection, snap = snapshot(world)) {
  const T = topics(connector, connection), ts = new Date().toISOString();
  return CHUNKS.filter(c => chunkNames.includes(c.name)).map(c => ({
    topic:`${T.read}/${c.name}`,
    payload:{seq, vals:c.tags.map(t => ({id:t.id, qc:3, ts, val:coerce(t.path.startsWith('const:') ? t.path.slice(6) : getPath(snap, t.path), t.dataType)}))},
  }));
}
// publication cadence: Frame_0 four times a second, History_0 every 20 s, AI_0 never (echo only), everything else every second
export const SLOW_CHUNKS = CHUNKS.filter(c => !['Frame', 'History', 'AI'].includes(c.group)).map(c => c.name);
export const HISTORY_CHUNKS = CHUNKS.filter(c => c.group === 'History').map(c => c.name);
export const FAST_CHUNKS = CHUNKS.filter(c => c.group === 'Frame').map(c => c.name);

// Apply a write payload ({seq, vals:[{id, val}]}) received on a dp/w topic. Returns the topics to echo.
export function handleWrite(world, chunkName, payload) {
  const vals = payload && Array.isArray(payload.vals) ? payload.vals : [];
  const results = [];
  if (chunkName.startsWith('Control')) {
    world.control = world.control || {};
    for (const v of vals) {
      const tag = registry.find(t => t.id === String(v.id)); if (!tag || tag.group !== 'Control') continue;
      const key = tag.path.split('.')[1], val = v.val;
      world.control[key] = val;
      let cmd = null;
      if (key === 'Command') cmd = {action:String(val)};
      else if (key === 'Speed') cmd = {action:'speed', speed:Number(val)};
      else if (key === 'FaultStation' && val) cmd = {action:'fault', machine:String(val)};
      else if (key === 'TruckRequest' && val) cmd = {action:'truck', direction:String(val)};
      else if (key === 'AnomalyRequest' && val) cmd = String(val) === 'clear' ? {action:'clearAnomaly'} : {action:'anomaly', type:String(val)};
      if (cmd) { const r = applyCommand(world, cmd); results.push(`${key}=${val}: ${r.ok ? 'accepted' : r.error}`); }
    }
    world.control.lastResult = results.join('; ');
  } else if (chunkName.startsWith('AI')) {
    world.ai = world.ai || {};
    for (const v of vals) { const tag = registry.find(t => t.id === String(v.id)); if (tag && tag.group === 'AI') world.ai[tag.path.split('.')[1]] = Number(v.val); }
    world.ai.updatedAt = new Date().toISOString();
  }
  return results;
}
// Echo of a write chunk on its read topic, the way an S7 connector confirms a write
export function echoMessage(world, chunkName, seq, connector = DATABUS.connector, connection = DATABUS.connection) {
  const c = CHUNKS.find(x => x.name === chunkName); if (!c) return null;
  const T = topics(connector, connection), ts = new Date().toISOString(), src = c.group === 'AI' ? (world.ai || {}) : (world.control || {});
  return {topic:`${T.read}/${c.name}`, payload:{seq, vals:c.tags.map(t => ({id:t.id, qc:3, ts, val:coerce(src[t.path.split('.')[1]], t.dataType)}))}};
}

/* ---------------- subscriber side ---------------- */
// Build a write payload for Control_0 from a viewer command ({action, ...}); null when the action has no tag.
export function controlWrite(cmd, seq) {
  const vals = [], put = (name, val) => { const t = tagByName(`Control.${name}`); vals.push({id:t.id, qc:3, ts:new Date().toISOString(), val}); };
  if (['start', 'pause', 'resume', 'stop', 'reset'].includes(cmd.action)) put('Command', cmd.action);
  else if (cmd.action === 'speed') put('Speed', Number(cmd.speed));
  else if (cmd.action === 'fault') put('FaultStation', String(cmd.machine || '').toUpperCase());
  else if (cmd.action === 'truck') put('TruckRequest', cmd.direction);
  else if (cmd.action === 'anomaly') put('AnomalyRequest', cmd.type || 'random');
  else if (cmd.action === 'clearAnomaly') put('AnomalyRequest', 'clear');
  else return null;
  put('Sequence', seq);
  return {chunk:'Control_0', payload:{seq, vals}};
}
// Rebuild the snapshot objects from received values (by tag id)
export function decode(values) {
  const out = {};
  for (const t of registry) {
    if (t.path.startsWith('const:') || !(t.id in values)) continue;
    const keys = t.path.split('.'); let o = out;
    for (let k = 0; k < keys.length - 1; k++) { const key = keys[k], nextIsIndex = /^\d+$/.test(keys[k + 1]); if (o[key] == null) o[key] = nextIsIndex ? [] : {}; o = o[key]; }
    o[keys[keys.length - 1]] = values[t.id];
  }
  return out;
}
export { STATE_CODE };
