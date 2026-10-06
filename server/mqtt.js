// Embedded MQTT broker (aedes). The twin publishes its own data into it and listens for commands.
import net from 'node:net';
import Aedes from 'aedes';
import { MACH } from '../shared/plant.js';
import { pubStatus, pubKpis, pubMachine, pubMachineTags, pubAgv, pubWarehouse, pubEvents, machKpi, simTime } from '../shared/engine.js';

export function startMqtt({world, cfg, command, service}) {
  return new Promise((resolve, reject) => {
    const broker = new Aedes({id:'kestrel-twin'});
    const tcp = net.createServer(broker.handle);
    const base = cfg.mqttBase;
    const pub = (topic, obj, retain = false) => broker.publish({topic:`${base}/${topic}`, payload:JSON.stringify(obj), qos:0, retain}, () => {});
    const stamp = () => { const t = simTime(world); return {ts:t.iso, simS:t.seconds}; };

    broker.on('client', () => { service.clients = broker.connectedClients; });
    broker.on('clientDisconnect', () => { service.clients = broker.connectedClients; });

    // commands: only messages from real clients, never our own publications
    broker.on('publish', (packet, client) => {
      if (!client || !packet.topic.startsWith(`${base}/cmd/`) || packet.topic === `${base}/cmd/response`) return;
      const sub = packet.topic.slice(base.length + 5).split('/');
      let body = {}; const text = packet.payload.toString().trim();
      if (text) { try { body = JSON.parse(text); } catch { return pub('cmd/response', {ok:false, error:'payload is not valid JSON', topic:packet.topic}); } }
      if (typeof body !== 'object' || body === null) body = {value:body};
      let cmd = null;
      if (sub[0] === 'control') cmd = {action:body.action};
      else if (sub[0] === 'speed') cmd = {action:'speed', speed:body.speed ?? body.value};
      else if (sub[0] === 'machines' && sub[2] === 'fault') cmd = {action:'fault', machine:sub[1]};
      else if (sub[0] === 'warehouse' && sub[1] === 'truck') cmd = {action:'truck', direction:body.direction};
      const res = cmd ? command(cmd, 'mqtt') : {ok:false, error:'unknown command topic'};
      pub('cmd/response', {ok:res.ok, error:res.error, topic:packet.topic, requestId:body.requestId, client:client.id, ...stamp()});
    });

    // publication schedule: periods are in simulated seconds, so data rate follows the speed multiplier,
    // with a floor on the real-time gap so a fast simulation cannot flood subscribers
    const due = {};
    function every(key, simS, minRealMs) {
      const S = world.S, now = Date.now(), d = due[key] || (due[key] = {sim:-1e9, real:0});
      if (S.t < d.sim) d.sim = -1e9;                                    // simulation was reset
      if (S.t - d.sim < simS || now - d.real < minRealMs) return false;
      d.sim = S.t; d.real = now; return true;
    }
    let lastStatus = '', lastEventId = 0, lastStates = [], lastInv = '', lastTrucks = '', lastRun = null;
    function tick() {
      const S = world.S;
      if (lastRun !== S) { lastRun = S; lastEventId = 0; lastStates = []; }
      const st = pubStatus(world), key = `${st.mode}|${st.speed}|${st.lineMode}`;
      if (key !== lastStatus || every('status', 5, 2000)) { lastStatus = key; pub('status', st, true); }

      MACH.forEach((d, i) => {
        const m = S.mach[i], sk = `${m.state}|${m.reason}|${m.techHere}`;
        if (lastStates[i] !== sk) {
          lastStates[i] = sk; const p = pubMachine(world, i, false);
          pub(`machines/${d.id}/state`, {...stamp(), id:d.id, state:p.state, stateCode:p.stateCode, stateLabel:p.stateLabel, fault:p.fault}, true);
        }
        if (every(`tel${i}`, cfg.telemetrySimS, cfg.telemetryMinRealMs)) {
          pub(`machines/${d.id}/telemetry`, {...stamp(), id:d.id, state:m.state, powerKw:Math.round(m.kw * 100) / 100, cycleProgress:m.part ? Math.round(Math.min(1, m.prog / m.ctAct) * 1000) / 10 : 0, partCount:m.count, ...pubMachineTags(world, i)});
        }
        if (every(`mk${i}`, 5, 500)) {
          const p = pubMachine(world, i, false);
          pub(`machines/${d.id}/kpi`, {...stamp(), id:d.id, oee:p.oee, counters:p.counters, timeS:p.timeS, energy:p.energy, maintenance:p.maintenance, cycle:{idealS:p.cycle.idealS, lastS:p.cycle.lastS}}, true);
        }
      });
      if (every('kpi', 5, 500)) {
        const k = pubKpis(world);
        pub('kpi/oee', {...stamp(), ...k.oee}, true); pub('kpi/production', {...stamp(), ...k.production}, true); pub('kpi/energy', {...stamp(), ...k.energy}, true);
      }
      if (every('agv', 1, cfg.telemetryMinRealMs * 2)) S.agv.forEach((a, k) => pub(`agvs/AGV-${a.id}/telemetry`, {...stamp(), ...pubAgv(world, k)}));
      if (every('wh', 2, 400)) {
        const w = pubWarehouse(world);
        pub('warehouse/forklift', {...stamp(), ...w.forklift});
        const inv = JSON.stringify(w.inventory), tr = JSON.stringify([w.trucks.inbound.state, w.trucks.outbound.state, w.trucks.inbound.palletsOnBoard, w.trucks.outbound.palletsLoaded]);
        if (inv !== lastInv) { lastInv = inv; pub('warehouse/inventory', {...stamp(), ...w.inventory, stands:w.stands}, true); }
        if (tr !== lastTrucks) { lastTrucks = tr; pub('warehouse/trucks', {...stamp(), ...w.trucks}, true); }
      }
      const evs = pubEvents(world, 50, lastEventId);
      for (let k = evs.length - 1; k >= 0; k--) { pub('events', evs[k]); lastEventId = Math.max(lastEventId, evs[k].id); }
    }

    tcp.once('error', e => reject(new Error(e.code === 'EADDRINUSE' ? `port ${cfg.mqttPort} is already in use (set MQTT_PORT to change it)` : e.message)));
    tcp.listen(cfg.mqttPort, cfg.host, () => resolve({broker, tick}));
  });
}
