// Builds edge/kestrel-twin-flow.json: a Flow Creator (Node-RED) flow that runs the Kestrel simulation and publishes it
// to the Industrial Edge Databus as SIMATIC v1 JSON. The simulation code is bundled from shared/, so the flow and the
// viewer always run the same model. Run: node edge/build-flow.mjs [connector]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const connector = process.argv[2] || 'kestreltwin1';

// ES module -> CommonJS-style factory, enough for the three files in shared/
function toFactory(file) {
  let src = readFileSync(path.join(root, 'shared', file), 'utf8');
  const names = [];
  src = src.replace(/import\s*\{([\s\S]*?)\}\s*from\s*'\.\/([\w.]+)';/g, (m, list, mod) => `const {${list}} = require('./${mod}');`);
  src = src.replace(/^export function (\w+)/gm, (m, n) => { names.push(n); return `function ${n}`; });
  src = src.replace(/^export const (\w+)/gm, (m, n) => { names.push(n); return `const ${n}`; });
  src = src.replace(/^export \{([^}]*)\};?$/gm, (m, list) => { names.push(...list.split(',').map(x => x.trim()).filter(Boolean)); return ''; });
  if (/^\s*(import|export)\s/m.test(src)) throw new Error(`unsupported module syntax left in ${file}`);
  return `"./${file}": function (module, exports, require) {\n${src}\nmodule.exports = { ${[...new Set(names)].join(', ')} };\n}`;
}
const bundle = `const KT = node.__kestrel || (node.__kestrel = (() => {
  const factories = {
${['plant.js', 'engine.js', 'databus.js'].map(toFactory).join(',\n')}
  };
  const loaded = {};
  const load = name => { if (!loaded[name]) { const module = {exports:{}}; loaded[name] = module; factories[name](module, module.exports, load); } return loaded[name].exports; };
  return {plant:load('./plant.js'), engine:load('./engine.js'), databus:load('./databus.js')};
})());`;

const func = `// ---- settings: change the connector name here and in the "Writes" MQTT-in node ----
const CONNECTOR = '${connector}';   // ie/d/j/simatic/v1/<CONNECTOR>/dp/r/<CONNECTION>/<chunk>
const CONNECTION = 'factory';
const START_SPEED = 1;              // 1 = real time; up to 120
const MAX_CATCHUP_S = 30;           // longer runtime gaps are skipped, not simulated
// ----------------------------------------------------------------------------------
${bundle}
const DB = KT.databus, EN = KT.engine, T = DB.topics(CONNECTOR, CONNECTION), now = Date.now();
let world = flow.get('kestrelWorld'), fresh = false;
if (!world || world.modelVersion !== DB.DATABUS.modelVersion) {
  world = EN.createWorld(); world.speed = START_SPEED; world.lastMs = now; world.seq = 0; world.gapS = 0; world.lastHistMs = 0;
  world.modelVersion = DB.DATABUS.modelVersion; fresh = true;
}
const seq = () => (world.seq = world.seq >= 4294967295 ? 1 : world.seq + 1);
const dt = (now - world.lastMs) / 1000; world.lastMs = now;
if (dt > MAX_CATCHUP_S) world.gapS += dt; else if (dt > 0) EN.advance(world, dt);
const out = [], meta = () => ({topic:T.meta, payload:DB.metadata(CONNECTOR, CONNECTION), qos:1, retain:true});
try {
  if (msg.topic === 'kt/metadata') out.push(meta());
  else if (msg.topic === 'kt/frame') out.push(...DB.readMessages(world, DB.FAST_CHUNKS, seq(), CONNECTOR, CONNECTION, {frameJson:JSON.stringify(EN.viewFrame(world))}));
  else if (msg.topic === 'kt/tick') {
    if (fresh) out.push(meta());
    const chunks = [...DB.SLOW_CHUNKS];
    if (now - world.lastHistMs >= 20000) { chunks.push(...DB.HISTORY_CHUNKS); world.lastHistMs = now; }
    out.push(...DB.readMessages(world, chunks, seq(), CONNECTOR, CONNECTION));
  } else if (msg.topic === 'kt/control') {
    const r = EN.applyCommand(world, msg.payload || {});
    node.warn(\`\${JSON.stringify(msg.payload)}: \${r.ok ? 'accepted' : r.error}\`);
  } else if (typeof msg.topic === 'string' && msg.topic.startsWith(T.write + '/')) {
    const chunk = msg.topic.slice(T.write.length + 1), payload = typeof msg.payload === 'string' ? JSON.parse(msg.payload) : msg.payload;
    const results = DB.handleWrite(world, chunk, payload), echo = DB.echoMessage(world, chunk, seq(), CONNECTOR, CONNECTION);
    if (echo) out.push(echo);
    if (results.length) node.status({fill:'yellow', shape:'dot', text:results.join('; ').slice(0, 60)});
  }
} catch (e) { node.error(e.message, msg); }
flow.set('kestrelWorld', world);
if (msg.topic === 'kt/tick') {
  const a = world.S.anom.active;
  node.status(a ? {fill:'red', shape:'dot', text:\`Anomaly \${a.type} on \${a.station}\`} : {fill:'green', shape:'dot', text:\`\${world.paused ? 'paused' : world.S.mode}, speed \${world.speed}x, \${EN.fmtClock(world.S.t)}\`});
}
return [out.map(m => ({topic:m.topic, payload:m.payload, qos:m.qos || 0, retain:!!m.retain}))];`;

const id = (n => () => (++n).toString(16).padStart(16, 'a'))(0x1000);
const tab = id(), fn = id(), out = id(), broker = id(), wr = id();
const T = {write:`ie/d/j/simatic/v1/${connector}/dp/w/factory`};
const inject = (name, topic, repeat, payload, payloadType, x, y) => ({id:id(), type:'inject', z:tab, name, props:[{p:'payload'}, {p:'topic', vt:'str'}], repeat, crontab:'', once:!!repeat, onceDelay:repeat ? 1 : 0.1, topic, payload, payloadType, x, y, wires:[[fn]]});
const flow = [
  {id:tab, type:'tab', label:'Kestrel Brake Works twin', disabled:false, info:'Runs the Kestrel Brake Works digital twin simulation and publishes it to the Industrial Edge Databus as SIMATIC v1 JSON. See /docs/#/industrial-edge in the twin app.'},
  {id:id(), type:'comment', z:tab, name:'Read me: Databus credentials, connector name and topics', info:`1. Open the "IE Databus" broker node and enter the user name and password of a Databus user that may publish and subscribe to ie/#.\n2. The connector name is "${connector}". To change it, edit CONNECTOR in the function node and the topic of the "Writes" MQTT-in node.\n3. Data: ie/d/j/simatic/v1/${connector}/dp/r/factory/<chunk>. Metadata: ie/m/j/simatic/v1/${connector}/dp (retained).\n4. Writes: ie/d/j/simatic/v1/${connector}/dp/w/factory/Control_0 (commands) and AI_0 (AI Inference Server results). Both are echoed on the read topic.\n5. The simulation state is kept in flow context "kestrelWorld". Delete it to start a new shift.`, x:250, y:40, wires:[]},
  inject('Publish metadata', 'kt/metadata', '60', '', 'date', 150, 100),
  inject('Frame, 4 per second', 'kt/frame', '0.25', '', 'date', 160, 140),
  inject('Snapshot, every second', 'kt/tick', '1', '', 'date', 160, 180),
  {id:fn, type:'function', z:tab, name:'Kestrel twin: simulation and SIMATIC publisher', func, outputs:1, timeout:0, noerr:0, initialize:'', finalize:'', libs:[], x:520, y:200, wires:[[out]]},
  {id:out, type:'mqtt out', z:tab, name:'IE Databus (topic set by the function)', topic:'', qos:'', retain:'', respTopic:'', contentType:'', userProps:'', correl:'', expiry:'', broker, x:880, y:200, wires:[]},
  {id:wr, type:'mqtt in', z:tab, name:'Writes: Control_0 and AI_0', topic:`${T.write}/#`, qos:'1', datatype:'json', broker, nl:false, rap:true, rh:0, inputs:0, x:150, y:260, wires:[[fn]]},
  inject('Start', 'kt/control', '', '{"action":"start"}', 'json', 110, 320),
  inject('Stop', 'kt/control', '', '{"action":"stop"}', 'json', 110, 360),
  inject('Reset', 'kt/control', '', '{"action":"reset"}', 'json', 110, 400),
  inject('Speed 1x', 'kt/control', '', '{"action":"speed","speed":1}', 'json', 120, 440),
  inject('Speed 10x', 'kt/control', '', '{"action":"speed","speed":10}', 'json', 120, 480),
  inject('Inject a random anomaly', 'kt/control', '', '{"action":"anomaly","type":"random"}', 'json', 160, 520),
  inject('Clear the anomaly', 'kt/control', '', '{"action":"clearAnomaly"}', 'json', 140, 560),
  inject('Order raw castings', 'kt/control', '', '{"action":"truck","direction":"inbound"}', 'json', 150, 600),
  {id:broker, type:'mqtt-broker', name:'IE Databus', broker:'ie-databus', port:'1883', clientid:`${connector}-sim`, autoConnect:true, usetls:false, protocolVersion:'4', keepalive:'60', cleansession:true, autoUnsubscribe:true,
   birthTopic:'', birthQos:'0', birthPayload:'', birthMsg:{}, closeTopic:'', closeQos:'0', closePayload:'', closeMsg:{}, willTopic:'', willQos:'0', willPayload:'', willMsg:{}, userProps:'', sessionExpiry:''},
];
// self-check: run the bundle and compare its exports with the real ES modules
{
  const node = {}, KT = new Function('node', `${bundle}\nreturn KT;`)(node);
  for (const [key, file] of [['plant', 'plant.js'], ['engine', 'engine.js'], ['databus', 'databus.js']]) {
    const real = await import(path.join(root, 'shared', file));
    const missing = Object.keys(real).filter(n => !(n in KT[key]) || (KT[key][n] === undefined) !== (real[n] === undefined));
    if (missing.length) throw new Error(`bundle of ${file} is missing exports: ${missing.join(', ')}`);
  }
}
const file = path.join(root, 'edge', 'kestrel-twin-flow.json');
writeFileSync(file, JSON.stringify(flow, null, 2));
// tag catalogue for configuring other Industrial Edge apps (Data Service, AI Inference Server, dashboards)
{
  const { CHUNKS } = await import(path.join(root, 'shared', 'databus.js'));
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = ['id,name,dataType,unit,access,role,dataPoint,description'];
  for (const c of CHUNKS) for (const t of c.tags) rows.push([t.id, t.name, t.dataType, t.unit, t.access || 'r', t.role, c.name, t.description].map(q).join(','));
  writeFileSync(path.join(root, 'edge', 'tag-catalog.csv'), rows.join('\n') + '\n');
}
console.log(`Wrote ${path.relative(root, file)}: ${flow.length} nodes, function ${(func.length / 1024).toFixed(0)} kB, connector "${connector}"`);
