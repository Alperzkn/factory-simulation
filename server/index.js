// Kestrel digital twin server: runs the simulation and serves it over HTTP, WebSocket, MQTT and OPC UA.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer, createWebSocketStream } from 'ws';
import { createWorld, advance, applyCommand, viewFrame, viewStats } from '../shared/engine.js';
import { apiRouter } from './api.js';
import { startMqtt } from './mqtt.js';
import { startOpcUa } from './opcua.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const cfg = {
  host: env.HOST || '127.0.0.1',
  httpPort: Number(env.HTTP_PORT || env.PORT || 8080),
  mqttPort: Number(env.MQTT_PORT || 1883),
  opcuaPort: Number(env.OPCUA_PORT || 4840),
  mqttBase: env.MQTT_BASE_TOPIC || 'kestrel/line2',
  mqttEnabled: env.MQTT_ENABLED !== 'false',
  opcuaEnabled: env.OPCUA_ENABLED !== 'false',
  telemetrySimS: Number(env.TELEMETRY_INTERVAL_S || 1),       // machine telemetry period, simulated seconds
  telemetryMinRealMs: Number(env.TELEMETRY_MIN_REAL_MS || 100), // never publish one topic faster than this in real time
  speed: Number(env.SIM_SPEED || 10),
  frameHz: 30,
};
const shown = cfg.host === '0.0.0.0' ? 'localhost' : cfg.host;

const world = createWorld();
if (cfg.speed >= 0.1 && cfg.speed <= 120) world.speed = cfg.speed;

// every protocol reports here, the viewer and GET /api/v1/connectivity read it
const services = {
  http:      {name:'REST API', status:'starting', url:`http://${shown}:${cfg.httpPort}/api/v1`},
  websocket: {name:'WebSocket stream', status:'starting', url:`ws://${shown}:${cfg.httpPort}/ws`},
  mqtt:      {name:'MQTT broker', status:cfg.mqttEnabled ? 'starting' : 'disabled', url:`mqtt://${shown}:${cfg.mqttPort}`, wsUrl:`ws://${shown}:${cfg.httpPort}/mqtt`, baseTopic:cfg.mqttBase, clients:0},
  opcua:     {name:'OPC UA server', status:cfg.opcuaEnabled ? 'starting' : 'disabled', url:`opc.tcp://${shown}:${cfg.opcuaPort}/UA/Kestrel`, sessions:0},
  docs:      {name:'Documentation', status:'starting', url:`http://${shown}:${cfg.httpPort}/docs/`},
};

// single entry point for commands, whatever protocol they arrive on
function command(cmd, source = 'api') {
  const res = applyCommand(world, cmd);
  if (res.ok) pushStats();
  return {...res, source};
}

/* ---------------- HTTP ---------------- */
const app = express();
app.disable('x-powered-by');
app.use(express.json({limit:'64kb'}));
app.use('/api/v1', apiRouter({world, command, services, cfg}));
app.use('/shared', express.static(path.join(root, 'shared')));
app.use('/vendor/three', express.static(path.join(root, 'node_modules/three')));
app.use('/vendor/marked', express.static(path.join(root, 'node_modules/marked')));
app.use('/vendor/fontsource', express.static(path.join(root, 'node_modules/@fontsource')));
app.use('/docs', express.static(path.join(root, 'docs')));
app.use(express.static(path.join(root, 'public')));
app.use('/api', (req, res) => res.status(404).json({error:'not found', hint:'the API lives under /api/v1, see /docs/'}));
app.use((err, req, res, next) => { res.status(err.status || 500).json({error:err.type === 'entity.parse.failed' ? 'request body is not valid JSON' : 'internal error'}); });

const server = http.createServer(app);

/* ---------------- WebSocket (viewer stream) + MQTT over WebSocket ---------------- */
const wss = new WebSocketServer({noServer:true});
const mqttWss = new WebSocketServer({noServer:true});
let mqtt = null;
server.on('upgrade', (req, socket, head) => {
  const url = req.url.split('?')[0];
  if (url === '/ws') wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  else if (url === '/mqtt' && mqtt) mqttWss.handleUpgrade(req, socket, head, ws => mqtt.broker.handle(createWebSocketStream(ws), req));
  else socket.destroy();
});
const send = (ws, obj) => { if (ws.readyState === 1 && ws.bufferedAmount < 1 << 20) ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); };
const statsMsg = () => JSON.stringify({...viewStats(world), services});
function pushStats() { if (!wss.clients.size) return; const m = statsMsg(); for (const ws of wss.clients) send(ws, m); }
wss.on('connection', ws => {
  send(ws, {k:'h', version:'1.0.0', frameHz:cfg.frameHz});
  send(ws, statsMsg());
  ws.on('message', data => {
    let msg; try { msg = JSON.parse(data); } catch { return send(ws, {k:'r', ok:false, error:'message is not valid JSON'}); }
    if (typeof msg !== 'object' || msg === null) return send(ws, {k:'r', ok:false, error:'message must be a JSON object'});
    send(ws, {k:'r', id:msg.id, ...command(msg, 'websocket')});
  });
});

/* ---------------- simulation loop ---------------- */
let last = performance.now(), statsAcc = 0;
setInterval(() => {
  const now = performance.now(), dt = Math.min(0.25, (now - last) / 1000); last = now;
  advance(world, dt);
  if (mqtt) mqtt.tick();
  if (wss.clients.size) {
    const f = JSON.stringify(viewFrame(world));
    for (const ws of wss.clients) send(ws, f);
    statsAcc += dt; if (statsAcc >= 0.5) { statsAcc = 0; pushStats(); }
  }
}, 1000 / cfg.frameHz);

/* ---------------- start-up ---------------- */
server.on('error', e => { console.error(`HTTP server failed: ${e.message}`); process.exit(1); });
server.listen(cfg.httpPort, cfg.host, async () => {
  services.http.status = services.websocket.status = services.docs.status = 'running';
  console.log(`\n  Kestrel digital twin\n  Viewer      http://${shown}:${cfg.httpPort}/\n  Docs        ${services.docs.url}\n  REST API    ${services.http.url}`);
  if (cfg.mqttEnabled) {
    try { mqtt = await startMqtt({world, cfg, command, service:services.mqtt}); services.mqtt.status = 'running'; console.log(`  MQTT        ${services.mqtt.url}  (topics under ${cfg.mqttBase}/#)`); }
    catch (e) { services.mqtt.status = 'error'; services.mqtt.error = e.message; console.log(`  MQTT        not started: ${e.message}`); }
  }
  if (cfg.opcuaEnabled) {
    try { await startOpcUa({world, cfg, command, service:services.opcua}); services.opcua.status = 'running'; console.log(`  OPC UA      ${services.opcua.url}`); }
    catch (e) { services.opcua.status = 'error'; services.opcua.error = e.message; console.log(`  OPC UA      not started: ${e.message}`); }
  }
  console.log('');
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
