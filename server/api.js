// REST API, mounted at /api/v1
import { Router } from 'express';
import { MACH } from '../shared/plant.js';
import {
  pubStatus, pubKpis, pubEnergy, pubMachine, pubMachineTags, pubTimeline, pubAgv, pubWarehouse, pubBuffers, pubPeople,
  pubEvents, pubHistory, pubMachineHistory, pubState,
} from '../shared/engine.js';

export function apiRouter({world, command, services, cfg}) {
  const api = Router();
  api.use((req, res, next) => {
    res.set({'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET,POST,PUT,OPTIONS', 'Access-Control-Allow-Headers':'Content-Type', 'Cache-Control':'no-store'});
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  const machine = (req, res) => {
    const i = MACH.findIndex(m => m.id === req.params.id.toUpperCase());
    if (i < 0) { res.status(404).json({error:`unknown machine '${req.params.id}'`, known:MACH.map(m => m.id)}); return -1; }
    return i;
  };
  const reply = (res, r) => res.status(r.ok ? 200 : 400).json(r.ok ? {ok:true, status:pubStatus(world)} : {ok:false, error:r.error});

  api.get('/', (req, res) => res.json({
    name:'Kestrel digital twin API', version:'1.0.0', docs:'/docs/',
    endpoints:['GET /status', 'GET /state', 'GET /kpis', 'GET /energy', 'GET /machines', 'GET /machines/{id}', 'GET /machines/{id}/tags', 'GET /machines/{id}/timeline', 'GET /machines/{id}/history',
      'GET /agvs', 'GET /agvs/{id}', 'GET /material', 'GET /people', 'GET /warehouse', 'GET /warehouse/inventory', 'GET /warehouse/trucks', 'GET /history', 'GET /events', 'GET /connectivity', 'GET /stream',
      'POST /control/{start|pause|resume|stop|reset}', 'PUT or POST /control/speed', 'POST /machines/{id}/fault', 'POST /warehouse/trucks/{inbound|outbound}'],
  }));

  api.get('/status', (req, res) => res.json(pubStatus(world)));
  api.get('/state', (req, res) => res.json(pubState(world)));
  api.get('/kpis', (req, res) => res.json(pubKpis(world)));
  api.get('/energy', (req, res) => res.json(pubEnergy(world)));
  api.get('/connectivity', (req, res) => res.json(services));

  api.get('/machines', (req, res) => res.json(MACH.map((_, i) => pubMachine(world, i))));
  api.get('/machines/:id', (req, res) => { const i = machine(req, res); if (i >= 0) res.json(pubMachine(world, i)); });
  api.get('/machines/:id/tags', (req, res) => { const i = machine(req, res); if (i >= 0) res.json({id:MACH[i].id, time:pubStatus(world).simTime, tags:pubMachineTags(world, i), definitions:MACH[i].tags.map(t => ({key:t.k, name:t.name, unit:t.unit, kind:t.perPart ? 'per-part measurement' : t.wear ? 'wear counter' : 'continuous'}))}); });
  api.get('/machines/:id/timeline', (req, res) => {
    const i = machine(req, res); if (i < 0) return;
    const win = Math.min(7200, Math.max(60, Number(req.query.windowS) || 1800));
    res.json({id:MACH[i].id, windowS:win, segments:pubTimeline(world, i, win)});
  });
  api.get('/machines/:id/history', (req, res) => { const i = machine(req, res); if (i >= 0) res.json({id:MACH[i].id, sampleIntervalS:10, samples:pubMachineHistory(world, i)}); });
  api.post('/machines/:id/fault', (req, res) => { const i = machine(req, res); if (i >= 0) reply(res, command({action:'fault', machine:MACH[i].id}, 'rest')); });

  api.get('/agvs', (req, res) => res.json(world.S.agv.map((_, k) => pubAgv(world, k))));
  api.get('/agvs/:id', (req, res) => {
    const k = world.S.agv.findIndex(a => `AGV-${a.id}` === req.params.id.toUpperCase() || String(a.id) === req.params.id);
    if (k < 0) return res.status(404).json({error:`unknown AGV '${req.params.id}'`, known:world.S.agv.map(a => `AGV-${a.id}`)});
    res.json(pubAgv(world, k));
  });
  api.get('/material', (req, res) => res.json(pubBuffers(world)));
  api.get('/people', (req, res) => res.json(pubPeople(world)));

  api.get('/warehouse', (req, res) => res.json(pubWarehouse(world)));
  api.get('/warehouse/inventory', (req, res) => { const w = pubWarehouse(world); res.json({inventory:w.inventory, slots:w.slots, stands:w.stands}); });
  api.get('/warehouse/trucks', (req, res) => res.json(pubWarehouse(world).trucks));
  api.post('/warehouse/trucks/:direction', (req, res) => reply(res, command({action:'truck', direction:req.params.direction}, 'rest')));

  api.get('/history', (req, res) => {
    let rows = pubHistory(world); const since = Number(req.query.sinceS);
    if (Number.isFinite(since)) rows = rows.filter(r => r.t > since);
    res.json({sampleIntervalS:20, samples:rows});
  });
  api.get('/events', (req, res) => res.json(pubEvents(world, Math.min(200, Math.max(1, Number(req.query.limit) || 50)), Number(req.query.sinceId) || 0)));

  for (const action of ['start', 'pause', 'resume', 'stop', 'reset']) api.post(`/control/${action}`, (req, res) => reply(res, command({action}, 'rest')));
  api.put('/control/speed', (req, res) => reply(res, command({action:'speed', speed:req.body && req.body.speed}, 'rest')));
  api.post('/control/speed', (req, res) => reply(res, command({action:'speed', speed:req.body && req.body.speed}, 'rest')));

  // Server-Sent Events: status and KPIs once a second (real time)
  api.get('/stream', (req, res) => {
    res.set({'Content-Type':'text/event-stream', Connection:'keep-alive'}); res.flushHeaders();
    const tick = () => { res.write(`event: status\ndata: ${JSON.stringify(pubStatus(world))}\n\n`); res.write(`event: kpis\ndata: ${JSON.stringify(pubKpis(world))}\n\n`); };
    tick(); const timer = setInterval(tick, 1000);
    req.on('close', () => clearInterval(timer));
  });

  api.use((req, res) => res.status(404).json({error:'not found', see:'/api/v1'}));
  return api;
}
