// OPC UA server (node-opcua). Exposes the twin as a browsable address space with live variables and control methods.
import os from 'node:os';
import { OPCUAServer, Variant, DataType, StatusCodes } from 'node-opcua';
import { MACH } from '../shared/plant.js';
import { pubState } from '../shared/engine.js';

export async function startOpcUa({world, cfg, command, service}) {
  const server = new OPCUAServer({
    port:cfg.opcuaPort, resourcePath:'/UA/Kestrel', ...(cfg.host === '0.0.0.0' ? {} : {host:cfg.host}), hostname:cfg.host === '0.0.0.0' ? os.hostname() : cfg.host,
    buildInfo:{productName:'Kestrel Digital Twin', buildNumber:'1.0.0', buildDate:new Date()},
    serverInfo:{applicationName:{text:'Kestrel Digital Twin', locale:'en'}, applicationUri:'urn:kestrel:digital-twin', productUri:'urn:kestrel:digital-twin'},
    serverCertificateManager:undefined, allowAnonymous:true,
  });
  await server.initialize();
  const as = server.engine.addressSpace, ns = as.getOwnNamespace();

  // one snapshot shared by all variables, refreshed at most five times a second
  let cache = null, cacheAt = 0, cacheRun = null;
  const snap = () => { const now = Date.now(); if (!cache || now - cacheAt > 200 || cacheRun !== world.S) { cache = pubState(world); cacheAt = now; cacheRun = world.S; } return cache; };

  const folder = (parent, name, id, organized) => ns.addObject({[organized ? 'organizedBy' : 'componentOf']:parent, browseName:name, nodeId:`s=${id}`});
  const variable = (parent, name, id, type, get, description, set) => ns.addVariable({
    componentOf:parent, browseName:name, nodeId:`s=${id}`, dataType:type, description, minimumSamplingInterval:250,
    accessLevel:set ? 'CurrentRead | CurrentWrite' : 'CurrentRead', userAccessLevel:set ? 'CurrentRead | CurrentWrite' : 'CurrentRead',
    value:{
      get:() => { let v = get(snap()); if (v == null) v = type === 'String' ? '' : 0; if (type === 'Int32' || type === 'UInt32') v = Math.round(v); return new Variant({dataType:DataType[type], value:v}); },
      ...(set ? {set:variant => (set(variant.value) ? StatusCodes.Good : StatusCodes.BadOutOfRange)} : {}),
    },
  });
  const method = (parent, name, id, description, run, inputArguments = []) => {
    const m = ns.addMethod(parent, {browseName:name, nodeId:`s=${id}`, description, inputArguments,
      outputArguments:[{name:'Accepted', description:{text:'true when the command was accepted'}, dataType:DataType.Boolean}, {name:'Message', description:{text:'reason when the command was rejected'}, dataType:DataType.String}]});
    m.bindMethod((args, context, cb) => {
      const res = run(args);
      cb(null, {statusCode:StatusCodes.Good, outputArguments:[{dataType:DataType.Boolean, value:!!res.ok}, {dataType:DataType.String, value:res.error || ''}]});
    });
  };

  const rootF = folder(as.rootFolder.objects, 'KestrelBrakeWorks', 'Kestrel', true);
  const line = folder(rootF, 'Line2', 'Line2');
  variable(line, 'Mode', 'Line2.Mode', 'String', s => s.status.mode, 'running, paused, stopping or stopped');
  variable(line, 'Paused', 'Line2.Paused', 'Boolean', s => s.status.paused, 'true while the simulation clock is frozen');
  variable(line, 'Speed', 'Line2.Speed', 'Double', s => s.status.speed, 'Simulation speed multiplier, writable (0.1 to 120)', v => command({action:'speed', speed:v}, 'opcua').ok);
  variable(line, 'SimTime', 'Line2.SimTime', 'DateTime', s => new Date(s.status.simTime.iso), 'Simulated date and time');
  variable(line, 'SimSeconds', 'Line2.SimSeconds', 'Double', s => s.status.simTime.seconds, 'Simulated seconds since the start of the shift');
  for (const a of ['Start', 'Pause', 'Resume', 'Stop', 'Reset']) method(line, a, `Line2.${a}`, `${a} the line`, () => command({action:a.toLowerCase()}, 'opcua'));
  method(line, 'SetSpeed', 'Line2.SetSpeed', 'Set the simulation speed multiplier', args => command({action:'speed', speed:args[0].value}, 'opcua'),
    [{name:'Speed', description:{text:'multiplier between 0.1 and 120'}, dataType:DataType.Double}]);

  const kpi = folder(line, 'KPI', 'Line2.KPI');
  variable(kpi, 'OEE', 'Line2.KPI.OEE', 'Double', s => s.kpis.oee.oee, 'Overall equipment effectiveness, %');
  variable(kpi, 'Availability', 'Line2.KPI.Availability', 'Double', s => s.kpis.oee.availability, '%');
  variable(kpi, 'Performance', 'Line2.KPI.Performance', 'Double', s => s.kpis.oee.performance, '%');
  variable(kpi, 'Quality', 'Line2.KPI.Quality', 'Double', s => s.kpis.oee.quality, '%');
  variable(kpi, 'GoodCount', 'Line2.KPI.GoodCount', 'UInt32', s => s.kpis.production.good, 'Good discs palletised this shift');
  variable(kpi, 'ScrapCount', 'Line2.KPI.ScrapCount', 'UInt32', s => s.kpis.production.scrap, 'Discs scrapped this shift');
  variable(kpi, 'ThroughputPerHour', 'Line2.KPI.ThroughputPerHour', 'Double', s => s.kpis.production.throughputPerHour, 'Good discs per hour, 5 minute rolling window');
  variable(kpi, 'PlanAttainment', 'Line2.KPI.PlanAttainment', 'Double', s => s.kpis.production.planAttainment, 'Good discs against plan, %');
  variable(kpi, 'WIP', 'Line2.KPI.WIP', 'UInt32', s => s.kpis.production.wip, 'Discs in process on the line');

  const en = folder(line, 'Energy', 'Line2.Energy');
  variable(en, 'PowerKw', 'Line2.Energy.PowerKw', 'Double', s => s.kpis.energy.powerKw, 'Total electrical load, kW');
  variable(en, 'EnergyKwh', 'Line2.Energy.EnergyKwh', 'Double', s => s.kpis.energy.energyKwh, 'Energy consumed this shift, kWh');
  variable(en, 'PeakKw', 'Line2.Energy.PeakKw', 'Double', s => s.kpis.energy.peakKw, 'Peak load this shift, kW');
  variable(en, 'KwhPerGoodPart', 'Line2.Energy.KwhPerGoodPart', 'Double', s => s.kpis.energy.kwhPerGoodPart, 'kWh per good disc');
  variable(en, 'CompressedAirBar', 'Line2.Energy.CompressedAirBar', 'Double', s => s.kpis.energy.compressedAirBar, 'Compressed air header pressure, bar');

  const machines = folder(line, 'Machines', 'Line2.Machines');
  MACH.forEach((d, i) => {
    const id = `Line2.Machines.${d.id}`, f = folder(machines, d.id, id), m = s => s.machines[i];
    variable(f, 'Name', `${id}.Name`, 'String', () => d.name, 'Station name');
    variable(f, 'State', `${id}.State`, 'String', s => m(s).state, 'RUN, IDLE, BLOCKED, DOWN or OFF');
    variable(f, 'StateCode', `${id}.StateCode`, 'Int32', s => m(s).stateCode, '0 off, 1 idle, 2 run, 3 blocked, 4 down');
    variable(f, 'FaultReason', `${id}.FaultReason`, 'String', s => (m(s).fault ? m(s).fault.reason : ''), 'Empty when the station is healthy');
    variable(f, 'CycleProgress', `${id}.CycleProgress`, 'Double', s => m(s).cycle.progress, 'Progress of the current cycle, %');
    variable(f, 'LastCycleTime', `${id}.LastCycleTime`, 'Double', s => m(s).cycle.lastS, 'Last cycle time, s');
    variable(f, 'PartCount', `${id}.PartCount`, 'UInt32', s => m(s).counters.parts, 'Parts processed this shift');
    variable(f, 'ScrapCount', `${id}.ScrapCount`, 'UInt32', s => m(s).counters.scrap, 'Scrap attributed to this station');
    variable(f, 'StopCount', `${id}.StopCount`, 'UInt32', s => m(s).counters.stops, 'Unplanned stops this shift');
    variable(f, 'OEE', `${id}.OEE`, 'Double', s => m(s).oee.oee, '%');
    variable(f, 'Availability', `${id}.Availability`, 'Double', s => m(s).oee.availability, '%');
    variable(f, 'Performance', `${id}.Performance`, 'Double', s => m(s).oee.performance, '%');
    variable(f, 'Quality', `${id}.Quality`, 'Double', s => m(s).oee.quality, '%');
    variable(f, 'PowerKw', `${id}.PowerKw`, 'Double', s => m(s).energy.powerKw, 'Electrical load, kW');
    variable(f, 'EnergyKwh', `${id}.EnergyKwh`, 'Double', s => m(s).energy.energyKwh, 'Energy consumed this shift, kWh');
    const tags = folder(f, 'Tags', `${id}.Tags`);
    for (const tg of d.tags) { const nm = tg.k[0].toUpperCase() + tg.k.slice(1); variable(tags, nm, `${id}.Tags.${nm}`, 'Double', s => m(s).tags[tg.k].value, `${tg.name}, ${tg.unit}`); }
    method(f, 'TriggerFault', `${id}.TriggerFault`, 'Force an unplanned stop on this station', () => command({action:'fault', machine:d.id}, 'opcua'));
  });

  const agvs = folder(line, 'AGVs', 'Line2.AGVs');
  world.S.agv.forEach((_, k) => {
    const id = `Line2.AGVs.AGV${k + 1}`, f = folder(agvs, `AGV${k + 1}`, id), a = s => s.agvs[k];
    variable(f, 'State', `${id}.State`, 'String', s => a(s).state, 'idle, toPick, loading, toDrop or unloading');
    variable(f, 'BatteryPct', `${id}.BatteryPct`, 'Double', s => a(s).batteryPct, 'Battery charge, %');
    variable(f, 'PositionX', `${id}.PositionX`, 'Double', s => a(s).position.x, 'Plant X coordinate, m');
    variable(f, 'PositionZ', `${id}.PositionZ`, 'Double', s => a(s).position.z, 'Plant Z coordinate, m');
    variable(f, 'LoadQuantity', `${id}.LoadQuantity`, 'UInt32', s => a(s).load.quantity, 'Discs on board');
    variable(f, 'Trips', `${id}.Trips`, 'UInt32', s => a(s).trips, 'Transport jobs completed');
  });

  const wh = folder(line, 'Warehouse', 'Line2.Warehouse'), w = s => s.warehouse;
  variable(wh, 'RawPallets', 'Line2.Warehouse.RawPallets', 'UInt32', s => w(s).inventory.rawPallets, 'Pallets of raw castings in stock');
  variable(wh, 'RawDiscs', 'Line2.Warehouse.RawDiscs', 'UInt32', s => w(s).inventory.rawDiscs, 'Raw castings in stock');
  variable(wh, 'RawCoverHours', 'Line2.Warehouse.RawCoverHours', 'Double', s => w(s).inventory.rawCoverHours, 'Hours of production covered by raw stock');
  variable(wh, 'FinishedPallets', 'Line2.Warehouse.FinishedPallets', 'UInt32', s => w(s).inventory.finishedPallets, 'Pallets of finished discs in stock');
  variable(wh, 'FinishedDiscs', 'Line2.Warehouse.FinishedDiscs', 'UInt32', s => w(s).inventory.finishedDiscs, 'Finished discs in stock');
  variable(wh, 'RackOccupancy', 'Line2.Warehouse.RackOccupancy', 'Double', s => w(s).inventory.rackOccupancy, 'Occupied rack slots, %');
  variable(wh, 'ShippedDiscs', 'Line2.Warehouse.ShippedDiscs', 'UInt32', s => w(s).stats.shippedDiscs, 'Discs shipped this shift');
  variable(wh, 'ForkliftState', 'Line2.Warehouse.ForkliftState', 'String', s => w(s).forklift.state, 'idle, toPick, picking, toDrop, dropping or toHome');
  variable(wh, 'ForkliftX', 'Line2.Warehouse.ForkliftX', 'Double', s => w(s).forklift.position.x, 'Plant X coordinate, m');
  variable(wh, 'ForkliftZ', 'Line2.Warehouse.ForkliftZ', 'Double', s => w(s).forklift.position.z, 'Plant Z coordinate, m');
  variable(wh, 'InboundTruckState', 'Line2.Warehouse.InboundTruckState', 'String', s => w(s).trucks.inbound.state, 'none, due, arriving, docked or departing');
  variable(wh, 'OutboundTruckState', 'Line2.Warehouse.OutboundTruckState', 'String', s => w(s).trucks.outbound.state, 'none, due, arriving, docked or departing');
  method(wh, 'CallInboundTruck', 'Line2.Warehouse.CallInboundTruck', 'Order a truck of raw castings now', () => command({action:'truck', direction:'inbound'}, 'opcua'));
  method(wh, 'CallOutboundTruck', 'Line2.Warehouse.CallOutboundTruck', 'Book a collection of finished pallets now', () => command({action:'truck', direction:'outbound'}, 'opcua'));

  server.on('create_session', () => { service.sessions = server.currentSessionCount; });
  server.on('session_closed', () => { service.sessions = Math.max(0, server.currentSessionCount); });
  await server.start();
  service.namespaceUri = ns.namespaceUri; service.namespaceIndex = ns.index;
  return server;
}
