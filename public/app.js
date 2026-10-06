// Viewer application: connects to the twin, drives the 3D scene, and renders dashboards and detail dialogs.
import { MACH, CONV, TBL, WH, STATE_LABEL, TARGET_RATE, ringPos, PALLET_POS, PEOPLE } from '/shared/plant.js';
import { fmtClock, fmtDur, createWorld, advance, applyCommand, viewFrame, viewStats, pubMachineHistory } from '/shared/engine.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c]));
let scene = null;
try { scene = (await import('/scene.js')).createScene($('gl'), $('stage'), {onPick:e => e && openEntity(e), onHover:showTip}); }
catch (e) { console.error(e); $('fail').hidden = false; $('fail').textContent = 'The 3D view could not start. Check that the server is running and reload the page.'; }

/* ============================================================ connection */
// Two modes: connected to the twin server over WebSocket, or, when no server answers (a static
// deployment), the same engine running in this page.
let F = null, D = null, ws = null, online = false, local = null, everOnline = false;
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => { online = everOnline = true; };
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.k === 'f') F = m; else if (m.k === 's') { D = m; onStats(); } };
  ws.onclose = () => { if (local) return; if (!everOnline) return startLocal(); online = false; setStatus(); setTimeout(connect, 1500); };
}
function localStats() { D = {...viewStats(local), services:null}; onStats(); }
function startLocal() { local = createWorld(); online = true; F = viewFrame(local); localStats(); setInterval(localStats, 500); }
const send = cmd => { if (local) { applyCommand(local, cmd); F = viewFrame(local); localStats(); } else if (ws && ws.readyState === 1) ws.send(JSON.stringify(cmd)); };

/* ============================================================ small render helpers */
const COL = {ink:'#16232D', ink2:'#4C5C68', muted:'#83919C', line:'#D6DCE1', blue:'#1D5F9A', RUN:'#2B9A5A', IDLE:'#9BA8B3', BLOCKED:'#E08E12', DOWN:'#D2452F', OFF:'#CCD3D9'};
const n1 = (v, d = 1) => (v == null ? '-' : Number(v).toFixed(d));
const dur = s => (s == null ? '-' : fmtDur(s));
const hms = t => { t = Math.floor(t); return `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const tile = (l, v, u = '', sub = '') => `<div class="tile"><dt>${l}</dt><dd>${v}${u ? `<small>${u}</small>` : ''}</dd>${sub ? `<p>${sub}</p>` : ''}</div>`;
const tiles = a => `<dl class="tiles">${a.join('')}</dl>`;
const meter = (l, v) => `<div class="meter"><span>${l}</span><div class="trk"><i style="width:${Math.max(0, Math.min(100, v)).toFixed(1)}%"></i></div><span style="text-align:right">${v.toFixed(1)}%</span></div>`;
const bars = (rows, fmt, cls = '') => { const max = Math.max(1e-9, ...rows.map(r => r.max ?? r.v)); return `<div class="bars ${cls}">${rows.map(r => `<div class="r"><span>${esc(r.label)}</span><div class="trk"><i style="width:${(Math.max(0, r.v) / (r.max ?? max) * 100).toFixed(1)}%"></i></div><span class="v">${fmt(r)}</span></div>`).join('')}</div>`; };
const kv = pairs => `<dl class="kv">${pairs.map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join('')}</dl>`;
const pill = (state, label) => `<span class="st ${state}"><i class="dot"></i>${esc(label ?? STATE_LABEL[state])}</span>`;
const h3 = (t, small = '') => `<h3>${t}${small ? `<small>${small}</small>` : ''}</h3>`;
const LEGEND = `<div class="legend">${['RUN', 'IDLE', 'BLOCKED', 'DOWN', 'OFF'].map(s => `<span><i class="dot ${s}"></i>${STATE_LABEL[s]}</span>`).join('')}</div>`;
const evList = (evs, empty = 'Nothing logged yet.') => evs.length ? `<ul class="log">${evs.map(e => `<li><time>${e.time.clock}</time><span class="src">${esc(e.source)}</span><span class="${e.severity}-t">${esc(e.message)}</span></li>`).join('')}</ul>` : `<p class="empty">${empty}</p>`;

/* ============================================================ charts */
function prep(cv) {
  const r = cv.getBoundingClientRect(), d = devicePixelRatio || 1, w = Math.round(r.width * d), h = Math.round(r.height * d);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const c = cv.getContext('2d'); c.setTransform(d, 0, 0, d, 0, 0); c.clearRect(0, 0, r.width, r.height); return [c, r.width, r.height];
}
const nice = v => { const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; };
function lineChart(cv, pts, o) {
  const [c, w, h] = prep(cv); if (w < 10) return;
  const now = D ? D.status.simTime.seconds : 0, pL = 34, pR = 8, pT = 8, pB = 17, tMax = Math.max(now, 600), tMin = Math.max(0, tMax - (o.win || 3600));
  pts = pts.filter(p => p.t >= tMin && p[o.key] != null);
  const vals = pts.map(p => p[o.key]);
  let y0 = 0, y1 = o.yMax || nice(Math.max(o.ref || 0, 1e-6, ...vals, o.line2 ? o.line2(tMax) : 0) * 1.12);
  if (o.zero === false && vals.length) { const lo = Math.min(...vals), hi = Math.max(...vals), padv = Math.max((hi - lo) * 0.25, Math.abs(hi) * 0.02, 0.5); y0 = lo >= 0 ? Math.max(0, lo - padv) : lo - padv; y1 = hi + padv; }
  const X = t => pL + (t - tMin) / (tMax - tMin) * (w - pL - pR), Y = v => h - pB - (Math.max(y0, Math.min(v, y1)) - y0) / (y1 - y0) * (h - pT - pB);
  const fmtY = v => (Math.abs(y1 - y0) < 5 ? v.toFixed(1) : String(Math.round(v)));
  c.font = '11px Barlow, Arial, sans-serif'; c.lineWidth = 1; c.textBaseline = 'middle';
  for (let i = 0; i <= 2; i++) { const v = y0 + (y1 - y0) * i / 2, y = Math.round(Y(v)) + 0.5; c.strokeStyle = i ? '#E9EDF0' : COL.line; c.beginPath(); c.moveTo(pL, y); c.lineTo(w - pR, y); c.stroke(); c.fillStyle = COL.muted; c.textAlign = 'right'; c.fillText(fmtY(v), pL - 6, y); }
  c.textBaseline = 'alphabetic'; c.fillStyle = COL.muted; c.textAlign = 'left'; c.fillText(fmtClock(tMin).slice(0, 5), pL, h - 3); c.textAlign = 'right'; c.fillText(fmtClock(tMax).slice(0, 5), w - pR, h - 3);
  if (o.ref) { const y = Math.round(Y(o.ref)) + 0.5; c.setLineDash([4, 4]); c.strokeStyle = COL.ink2; c.beginPath(); c.moveTo(pL, y); c.lineTo(w - pR, y); c.stroke(); c.setLineDash([]); c.fillStyle = COL.ink2; c.textAlign = 'right'; c.fillText(o.refLabel, w - pR - 2, (vals.length && vals[vals.length - 1] > o.ref) ? y + 13 : y - 5); }
  if (o.line2) { c.setLineDash([4, 4]); c.strokeStyle = COL.ink2; c.beginPath(); c.moveTo(X(tMin), Y(o.line2(tMin))); c.lineTo(X(tMax), Y(o.line2(tMax))); c.stroke(); c.setLineDash([]); c.fillStyle = COL.ink2; c.textAlign = 'right'; c.fillText(o.line2Label, w - pR - 2, Y(o.line2(tMax)) + 14); }
  if (!pts.length) { c.fillStyle = COL.muted; c.textAlign = 'center'; c.fillText('Collecting data', (pL + w - pR) / 2, h / 2); return; }
  c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(X(p.t), Y(p[o.key])) : c.moveTo(X(p.t), Y(p[o.key]))));
  c.strokeStyle = COL.blue; c.lineWidth = 2; c.lineJoin = 'round'; c.stroke();
  if (o.zero !== false) { c.lineTo(X(pts[pts.length - 1].t), Y(0)); c.lineTo(X(pts[0].t), Y(0)); c.closePath(); c.fillStyle = 'rgba(29,95,154,.10)'; c.fill(); }
  if (cv._hx != null) {
    let best = pts[0]; for (const p of pts) if (Math.abs(X(p.t) - cv._hx) < Math.abs(X(best.t) - cv._hx)) best = p;
    const x = X(best.t), y = Y(best[o.key]);
    c.strokeStyle = COL.muted; c.lineWidth = 1; c.beginPath(); c.moveTo(Math.round(x) + 0.5, pT); c.lineTo(Math.round(x) + 0.5, h - pB); c.stroke();
    c.beginPath(); c.arc(x, y, 4.5, 0, 7); c.fillStyle = '#fff'; c.fill(); c.beginPath(); c.arc(x, y, 3, 0, 7); c.fillStyle = COL.blue; c.fill();
    const txt = `${best[o.key].toFixed(o.dec ?? 0)} ${o.unit || ''}`.trim();
    c.font = '600 12px Barlow, Arial, sans-serif'; const tw = Math.max(c.measureText(txt).width, 46) + 14, bx = Math.max(pL, Math.min(w - pR - tw, x - tw / 2)), by = y > 52 ? y - 46 : y + 10;
    c.fillStyle = COL.ink; c.beginPath(); c.roundRect(bx, by, tw, 34, 5); c.fill();
    c.fillStyle = '#fff'; c.textAlign = 'left'; c.fillText(txt, bx + 7, by + 14); c.font = '11px Barlow, Arial, sans-serif'; c.fillStyle = '#B9C5CE'; c.fillText(fmtClock(best.t), bx + 7, by + 27);
  }
}
function timeline(cv, segs) {
  const [c, w, h] = prep(cv); if (w < 10 || !D) return;
  const now = D.status.simTime.seconds, span = 1800, t0 = now - span, X = t => (t - t0) / span * w;
  c.fillStyle = '#EEF1F3'; c.fillRect(0, 0, w, h);
  segs.forEach((a, k) => { const end = k + 1 < segs.length ? segs[k + 1][1] : now; if (end < t0) return; const x0 = Math.max(0, X(a[1])); c.fillStyle = COL[a[0]]; c.fillRect(x0, 0, Math.max(0.6, X(end) - x0), h); });
}
// per-station sample history comes from the REST API, refreshed while a dialog needs it
const histCache = {};
function machHist(id) {
  if (local) return pubMachineHistory(local, MACH.findIndex(m => m.id === id));
  const e = histCache[id] || (histCache[id] = {rows:[], at:0, busy:false});
  if (Date.now() - e.at > 2500 && !e.busy) { e.busy = true; fetch(`/api/v1/machines/${id}/history`).then(r => r.json()).then(j => { e.rows = j.samples; e.at = Date.now(); e.busy = false; }).catch(() => { e.busy = false; e.at = Date.now(); }); }
  return e.rows;
}

/* ============================================================ modal engine */
let cur = null;
function openModal(def) {
  closeModal(true);
  cur = {def, els:[]}; $('mBody').innerHTML = ''; $('modal').classList.toggle('wide', !!def.wide); $('back').hidden = false;
  if (scene) scene.select(def.ent || null);
  [...$('rail').querySelectorAll('button')].forEach(b => b.setAttribute('aria-pressed', b.dataset.open === def.key));
  renderModal(); $('mClose').focus();
}
function closeModal(keep) { if (!cur) return; cur = null; $('back').hidden = true; if (scene && !keep) scene.select(null); [...$('rail').querySelectorAll('button')].forEach(b => b.setAttribute('aria-pressed', 'false')); }
function renderModal() {
  if (!cur || !D) return;
  const def = cur.def, body = $('mBody');
  $('mTitle').textContent = def.title; $('mSub').textContent = typeof def.sub === 'function' ? def.sub() : def.sub || '';
  const blocks = def.blocks();
  blocks.forEach((b, i) => {
    let el = cur.els[i];
    if (!el) {
      el = document.createElement('div'); el.className = 'blk ' + (b.cls || ''); body.appendChild(el); cur.els[i] = el; el._html = null;
      if (b.chart) { el.innerHTML = `<div class="cap"></div><canvas style="height:${b.h || 130}px"></canvas>`; const cv = el.lastChild; cv.addEventListener('mousemove', e => { cv._hx = e.offsetX; if (cv._draw) cv._draw(); }); cv.addEventListener('mouseleave', () => { cv._hx = null; if (cv._draw) cv._draw(); }); }
      if (b.build) b.build(el);
    }
    if (b.chart) { const cap = `<span>${b.cap || ''}</span><b>${b.val || ''}</b>`; if (el._html !== cap) { el.firstChild.innerHTML = cap; el._html = cap; } const cv = el.lastChild; cv._draw = () => b.chart(cv); cv._draw(); }
    else if (b.update) b.update(el);
    else if (el._html !== b.html) { el.innerHTML = b.html; el._html = b.html; }
  });
  while (cur.els.length > blocks.length) cur.els.pop().remove();
}
$('mClose').onclick = () => closeModal();
$('back').addEventListener('mousedown', e => { if (e.target === $('back')) closeModal(); });
$('mBody').addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const [act, a, b] = t.dataset.act.split(':');
  if (act === 'open') openEntity({type:a, id:/^\d+$/.test(b) ? +b : b});
  else if (act === 'dash') openDash(a);
  else if (act === 'fault') send({action:'fault', machine:a});
  else if (act === 'truck') send({action:'truck', direction:a});
  else if (act === 'focus') { closeModal(true); scene && scene.focusOn(+a, +b); }
  else if (act === 'copy') { navigator.clipboard && navigator.clipboard.writeText(t.dataset.text); t.textContent = 'Copied'; setTimeout(() => { t.textContent = 'Copy'; }, 1200); }
  else if (act === 'evf') { evFilter = a; renderModal(); }
});

/* ============================================================ dashboards */
const hist = () => D.hist;
const machRows = (cols) => `<table><thead><tr>${cols.map(c => `<th class="${c.num ? 'num' : ''}">${c.h}</th>`).join('')}</tr></thead><tbody>${D.machines.map((m, i) => `<tr class="go" data-act="open:machine:${i}">${cols.map(c => `<td class="${c.num ? 'num' : ''}">${c.f(m, i)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
let evFilter = 'all';
const DASH = {
  overview:{title:'Plant overview', sub:() => `${D.status.plant.product}. Shift time ${hms(D.status.simTime.seconds)}`, wide:true, blocks() {
    const k = D.kpis, o = k.oee, p = k.production, w = D.warehouse.inventory, gap = o.oee - 85;
    return [
      {cls:'c5', html:h3('Overall equipment effectiveness') + `<div class="big">${o.oee.toFixed(1)}<small>%</small></div><p class="note" style="margin:4px 0 10px">${k.plannedProductionTimeS < 60 ? 'Benchmark 85%' : `${Math.abs(gap).toFixed(1)} points ${gap >= 0 ? 'above' : 'below'} the 85% benchmark`}</p>${meter('Availability', o.availability)}${meter('Performance', o.performance)}${meter('Quality', o.quality)}`},
      {cls:'c7', chart:cv => lineChart(cv, hist(), {key:'oee', yMax:100, ref:85, refLabel:'benchmark 85%', unit:'%', dec:1}), h:214, cap:'Line OEE over the last hour, %'},
      {html:tiles([tile('Good discs', p.good, '', `${p.planned} planned`), tile('Throughput', p.throughputPerHour, '/h', `plan ${p.targetPerHour}/h`), tile('Scrap', p.scrap, '', `yield ${p.firstPassYield.toFixed(1)}%`), tile('Electrical load', Math.round(k.energy.powerKw), 'kW', `${n1(k.energy.kwhPerGoodPart, 2)} kWh per disc`), tile('Raw castings', w.rawDiscs, '', `${n1(w.rawCoverHours)} h of cover`), tile('Finished stock', w.finishedPallets, 'pallets', `${w.finishedDiscs} discs`)])},
      {cls:'c7', html:h3('Stations') + machRows([{h:'Station', f:m => `<b>${m.id}</b> ${esc(m.name)}`}, {h:'State', f:m => pill(m.state)}, {h:'OEE', num:1, f:m => m.oee.oee.toFixed(1) + '%'}, {h:'Parts', num:1, f:m => m.counters.parts}, {h:'kW', num:1, f:m => m.energy.powerKw.toFixed(1)}])},
      {cls:'c5', html:h3('Latest events') + evList(D.events.slice(0, 9))},
    ];
  }},
  production:{title:'Production', sub:'Output, flow and work in progress', wide:true, blocks() {
    const p = D.kpis.production;
    return [
      {html:tiles([tile('Good discs', p.good), tile('Planned so far', p.planned), tile('Plan attainment', p.planAttainment == null ? '-' : p.planAttainment.toFixed(0), '%'), tile('Throughput', p.throughputPerHour, '/h'), tile('Work in progress', p.wip), tile('Pallets completed', p.palletsCompleted), tile('Scrap', p.scrap)])},
      {cls:'c6', chart:cv => lineChart(cv, hist(), {key:'rate', ref:TARGET_RATE, refLabel:`plan ${TARGET_RATE}/h`, unit:'discs/h'}), h:170, cap:'Throughput, discs per hour (5 minute rolling window)', val:`${p.throughputPerHour}/h`},
      {cls:'c6', chart:cv => lineChart(cv, hist(), {key:'good', unit:'discs', line2:t => TARGET_RATE * t / 3600, line2Label:'plan'}), h:170, cap:'Good discs against plan', val:`${p.good} of ${p.planned}`},
      {cls:'c6', html:h3('Parts processed by station') + bars(D.machines.map(m => ({label:`${m.id} ${m.name}`, v:m.counters.parts})), r => r.v)},
      {cls:'c6', html:h3('Where the work in progress is', 'parts / capacity') + bars(D.material.map(b => ({label:b.kind === 'conveyor' ? b.name.replace('Conveyor ', '') : b.name, v:b.quantity, max:b.capacity, cap:b.capacity})), r => `${r.v} / ${r.cap}`)},
    ];
  }},
  quality:{title:'Quality', sub:'Yield, scrap and in-process measurements', wide:true, blocks() {
    const p = D.kpis.production, total = p.good + p.scrap, q = [['M3', 'imbalance', 'Residual imbalance, g·cm', 0], ['M5', 'coatThickness', 'Coating thickness, µm', 1], ['M6', 'runout', 'Lateral runout, µm', 0], ['M6', 'thicknessVar', 'Disc thickness variation, µm', 1]];
    return [
      {html:tiles([tile('First-pass yield', p.firstPassYield.toFixed(1), '%'), tile('Scrap', p.scrap, 'discs'), tile('Scrap rate', total ? Math.round(p.scrap / total * 1e6).toLocaleString('en') : 0, 'ppm'), tile('Inspected', D.machines[5].counters.parts, 'discs')])},
      {cls:'c5', html:h3('Scrap by originating station') + (p.scrap ? bars(D.machines.filter(m => m.counters.scrap).map(m => ({label:`${m.id} ${m.name}`, v:m.counters.scrap})).sort((a, b) => b.v - a.v), r => `${r.v} disc${r.v > 1 ? 's' : ''}`, 'red') : '<p class="empty">No scrap so far this shift.</p>') + '<p class="note">Defects are caught at the balancer (M3) or the inspection cell (M6) and charged to the station that caused them.</p>'},
      {cls:'c7', html:h3('Quality events') + evList(D.events.filter(e => e.severity === 'quality').slice(0, 8), 'No discs have been scrapped.')},
      ...q.map(([id, key, cap, dec]) => ({cls:'c6', chart:cv => lineChart(cv, machHist(id), {key, zero:false, unit:cap.split(', ')[1], dec}), h:120, cap:`${id}: ${cap}`, val:n1(D.machines.find(m => m.id === id).tags[key].value, dec)})),
    ];
  }},
  energy:{title:'Energy', sub:'Electrical load and consumption', wide:true, blocks() {
    const e = D.kpis.energy;
    return [
      {html:tiles([tile('Load now', Math.round(e.powerKw), 'kW'), tile('Consumed', e.energyKwh.toFixed(1), 'kWh'), tile('Per good disc', n1(e.kwhPerGoodPart, 2), 'kWh'), tile('Peak load', Math.round(e.peakKw), 'kW'), tile('Compressed air', e.compressedAirBar.toFixed(1), 'bar')])},
      {chart:cv => lineChart(cv, hist(), {key:'kw', unit:'kW'}), h:170, cap:'Electrical load, kW (20 s averages)', val:`${Math.round(e.powerKw)} kW`},
      {cls:'c6', html:h3('Energy by consumer', 'kWh') + bars([...e.byConsumer].sort((a, b) => b.energyKwh - a.energyKwh).map(c => ({label:c.id.length <= 2 ? `${c.id} ${c.name}` : c.name, v:c.energyKwh})), r => r.v.toFixed(1))},
      {cls:'c6', html:h3('Station load now', 'kW') + bars(D.machines.map(m => ({label:`${m.id} ${m.name}`, v:m.energy.powerKw})), r => r.v.toFixed(1)) + '<p class="note">Station load follows the machining cycle. Idle, blocked and switched-off stations draw standby power.</p>'},
    ];
  }},
  maintenance:{title:'Maintenance', sub:'Faults, downtime and reliability', wide:true, blocks() {
    const ms = D.machines, down = ms.filter(m => m.fault), tech = D.people.find(p => p.id === 'TECH-1'), dt = ms.reduce((n, m) => n + m.timeS.down, 0);
    return [
      {html:tiles([tile('Open faults', down.length), tile('Stops this shift', ms.reduce((n, m) => n + m.counters.stops, 0)), tile('Total downtime', dur(dt), 'min'), tile('Mean availability', (ms.reduce((n, m) => n + m.oee.availability, 0) / ms.length).toFixed(1), '%'), tile('Repairs completed', tech.repairsCompleted)])},
      {cls:'c5', html:h3('Open faults') + (down.length ? down.map(m => `<div class="row" style="margin-bottom:8px"><button class="btn danger" data-act="open:machine:${ms.indexOf(m)}">${m.id} ${esc(m.name)}</button><span>${esc(m.fault.reason)}, ${m.fault.technicianOnSite ? `repair in progress, about ${dur(m.fault.estimatedRepairS)} left` : 'waiting for the technician'}</span></div>`).join('') : '<p class="empty">All stations are healthy.</p>') + `<h3 style="margin-top:14px">Technician</h3>` + kv([['Activity', esc(tech.activity)], ['Open calls', tech.openCalls], ['Utilisation', tech.utilisation.toFixed(1) + '%']])},
      {cls:'c7', html:h3('Downtime by station') + (dt > 0 ? bars(ms.filter(m => m.counters.stops).map(m => ({label:`${m.id} ${m.name}`, v:m.timeS.down, n:m.counters.stops})).sort((a, b) => b.v - a.v), r => `${(r.v / 60).toFixed(1)} min, ${r.n} stop${r.n > 1 ? 's' : ''}`, 'red') : '<p class="empty">No stops yet this shift.</p>')},
      {html:h3('Reliability') + machRows([{h:'Station', f:m => `<b>${m.id}</b> ${esc(m.name)}`}, {h:'State', f:m => pill(m.state)}, {h:'Availability', num:1, f:m => m.oee.availability.toFixed(1) + '%'}, {h:'Stops', num:1, f:m => m.counters.stops}, {h:'Downtime', num:1, f:m => dur(m.timeS.down)}, {h:'Mean time between failures', num:1, f:m => dur(m.maintenance.mtbfS)}, {h:'Mean time to repair', num:1, f:m => dur(m.maintenance.mttrS)}])},
    ];
  }},
  stations:{title:'Stations', sub:'State, 30 minute history and key figures for every station', wide:true, blocks() {
    return [{build(el) {
      el.innerHTML = `<table><thead><tr><th>Station</th><th>State</th><th style="width:38%"><span style="float:left">30 min ago</span><span style="float:right">now</span></th><th class="num">OEE</th><th class="num">Avail.</th><th class="num">Perf.</th><th class="num">Quality</th><th class="num">Parts</th><th class="num">Scrap</th><th class="num">kW</th><th>Crew</th></tr></thead><tbody>${MACH.map((d, i) => `<tr class="go" data-act="open:machine:${i}"><td><b>${d.id}</b> ${d.name}</td><td></td><td><canvas class="tl"></canvas></td><td class="num"></td><td class="num"></td><td class="num"></td><td class="num"></td><td class="num"></td><td class="num"></td><td class="num"></td><td>${d.crew ? 'Operator' : 'Unattended'}</td></tr>`).join('')}</tbody></table>${LEGEND}`;
    }, update(el) {
      [...el.querySelectorAll('tbody tr')].forEach((tr, i) => { const m = D.machines[i], t = tr.children, set = (k, v) => { if (t[k].innerHTML !== v) t[k].innerHTML = v; };
        set(1, pill(m.state)); timeline(t[2].firstChild, m.segs); set(3, m.oee.oee.toFixed(1) + '%'); set(4, m.oee.availability.toFixed(1) + '%'); set(5, m.oee.performance.toFixed(1) + '%'); set(6, m.oee.quality.toFixed(1) + '%'); set(7, String(m.counters.parts)); set(8, String(m.counters.scrap)); set(9, m.energy.powerKw.toFixed(1)); });
    }}];
  }},
  logistics:{title:'Internal logistics', sub:'AGV fleet, buffers and conveyors', wide:true, blocks() {
    const AST = {idle:'Idle, charging', toPick:'Driving to pick-up', loading:'Loading', toDrop:'Delivering', unloading:'Unloading'};
    return [
      ...D.agvs.map((a, k) => ({cls:'c6', html:`<div class="statebar" style="margin-bottom:8px"><h3 style="margin:0">${a.id}</h3><span class="why">${a.lowBattery ? 'Charging, battery low' : AST[a.state]}${a.task ? ': ' + esc(a.task.description.toLowerCase()) : ''}</span><span class="sp"><button class="btn" data-act="open:agv:${k}">Details</button></span></div>` + bars([{label:'Battery', v:a.batteryPct, max:100}, {label:'Utilisation', v:a.utilisation, max:100}], r => r.v.toFixed(0) + '%') + kv([['Jobs completed', a.trips], ['Distance', (a.distanceM / 1000).toFixed(2) + ' km'], ['Load', a.load.quantity ? `${a.load.quantity} discs` : 'Empty']])})),
      {cls:'c6', html:h3('Buffers and pallet', 'parts / capacity') + bars(D.material.filter(b => b.kind !== 'conveyor').map(b => ({label:`${b.id} ${b.name}`, v:b.quantity, max:b.capacity, cap:b.capacity})), r => `${r.v} / ${r.cap}`)},
      {cls:'c6', html:h3('Conveyors', 'parts / capacity') + bars(D.material.filter(b => b.kind === 'conveyor').map(b => ({label:b.name.replace('Conveyor ', `${b.id} `), v:b.quantity, max:b.capacity, cap:b.capacity})), r => `${r.v} / ${r.cap}`)},
      {html:h3('People on the floor') + `<table><thead><tr><th>Role</th><th>Area</th><th>Doing now</th></tr></thead><tbody>${D.people.map(p => `<tr class="go" data-act="open:person:${p.id}"><td><b>${p.id}</b> ${esc(p.role)}</td><td>${esc(p.station)}</td><td>${esc(p.activity)}</td></tr>`).join('')}</tbody></table>`},
    ];
  }},
  warehouse:{title:'Warehouse', sub:'Stock, racking, forklift and docks', wide:true, blocks() {
    const w = D.warehouse, v = w.inventory, s = w.stats;
    return [
      {html:tiles([tile('Raw castings', v.rawDiscs, '', `${v.rawPallets} pallets, reorder at ${v.reorderPointPallets}`), tile('Raw cover', n1(v.rawCoverHours), 'h'), tile('Finished stock', v.finishedDiscs, '', `${v.finishedPallets} pallets`), tile('Rack occupancy', v.rackOccupancy.toFixed(0), '%', `${v.rackOccupied} of ${v.rackSlots} slots`), tile('Shipped', s.shippedDiscs, 'discs', `${s.trucksOut} trucks`), tile('Received', s.receivedDiscs, 'castings', `${s.trucksIn} trucks`), tile('Dock to stock', dur(s.dockToStockAvgS), 'min'), tile('Line stock-out', dur(s.stockoutS), 'min')])},
      {cls:'c6', html:h3('Raw material rack', 'castings per pallet') + rackMap('raw')},
      {cls:'c6', html:h3('Finished goods rack', 'discs per pallet') + rackMap('finished')},
      {cls:'c6', chart:cv => lineChart(cv, hist(), {key:'raw', unit:'castings'}), h:120, cap:'Raw castings in stock', val:String(v.rawDiscs)},
      {cls:'c6', chart:cv => lineChart(cv, hist(), {key:'fg', unit:'pallets'}), h:120, cap:'Finished pallets in stock', val:String(v.finishedPallets)},
      {cls:'c6', html:h3('Docks') + truckRow('inbound') + truckRow('outbound')},
      {cls:'c6', html:`<div class="statebar" style="margin-bottom:8px"><h3 style="margin:0">Forklift FLT-1</h3><span class="why">${esc(forkText(w.forklift))}</span><span class="sp"><button class="btn" data-act="open:forklift:0">Details</button></span></div>` + kv([['Pallet moves', w.forklift.moves], ['Utilisation', w.forklift.utilisation.toFixed(1) + '%'], ['Line replenishments', s.replenishments], ['Put-aways', s.putaways]])},
    ];
  }},
  events:{title:'Event log', sub:'Alarms, quality and logistics events, newest first', blocks() {
    const kinds = [['all', 'All'], ['alarm', 'Alarms'], ['quality', 'Quality'], ['logistics', 'Logistics'], ['info', 'Information']];
    const evs = D.events.filter(e => evFilter === 'all' || e.severity === evFilter);
    return [{html:`<div class="filter">${kinds.map(([k, l]) => `<button data-act="evf:${k}" aria-pressed="${evFilter === k}">${l}</button>`).join('')}</div>` + evList(evs, 'No events of this kind yet.')}];
  }},
  connectivity:{title:'Connectivity', sub:'Every figure in this twin is served over these interfaces', wide:true, blocks() {
    if (!D.services) return [{html:'<p style="margin:0 0 8px"><b>This is the browser-only build.</b> The simulation runs in this page, so there is no server to connect to and each visitor has their own plant.</p><p style="margin:0 0 12px;color:var(--ink2)">Running the app with Node (<code>npm start</code>) adds the REST API, the MQTT broker and the OPC UA server described in the documentation.</p><a class="btn primary" style="display:inline-flex;align-items:center;text-decoration:none" href="/docs/" target="_blank" rel="noopener">Open the documentation</a>'}];
    const sv = D.services, base = sv.mqtt.baseTopic, row = (s, extra = '') => `<div class="svc"><b>${s.name}</b><span class="${s.status === 'running' ? 'ok' : s.status === 'error' ? 'bad' : 'off'}">${s.status === 'running' ? 'Running' : s.status === 'error' ? 'Not running' : s.status === 'disabled' ? 'Disabled' : 'Starting'}</span><span><code>${esc(s.url)}</code>${s.error ? `<br><span class="note">${esc(s.error)}</span>` : extra ? `<br><span class="note">${extra}</span>` : ''}</span><button class="btn" data-act="copy" data-text="${esc(s.url)}">Copy</button></div>`;
    return [
      {html:row(sv.http, 'JSON over HTTP, plus Server-Sent Events at /api/v1/stream') + row(sv.websocket, 'Live frames and commands for viewers') + row(sv.mqtt, `Topics under ${base}/#, ${sv.mqtt.clients} client${sv.mqtt.clients === 1 ? '' : 's'} connected. Also available over WebSocket at ${esc(sv.mqtt.wsUrl)}`) + row(sv.opcua, `Anonymous access, namespace index ${sv.opcua.namespaceIndex ?? 1}, ${sv.opcua.sessions} session${sv.opcua.sessions === 1 ? '' : 's'}`) + row(sv.docs, 'Guides and reference for every interface')},
      {cls:'c4', html:h3('REST') + `<pre>curl ${esc(sv.http.url)}/kpis\ncurl ${esc(sv.http.url)}/machines/M1\ncurl -X PUT ${esc(sv.http.url)}/control/speed \\\n  -H 'Content-Type: application/json' \\\n  -d '{"speed":30}'</pre>`},
      {cls:'c4', html:h3('MQTT') + `<pre>mosquitto_sub -h ${esc(sv.mqtt.url.split('//')[1].split(':')[0])} -p ${esc(sv.mqtt.url.split(':').pop())} \\\n  -t '${base}/#' -v\n\n# stop the line\nmosquitto_pub -t '${base}/cmd/control' \\\n  -m '{"action":"stop"}'</pre>`},
      {cls:'c4', html:h3('OPC UA') + `<pre>Endpoint  ${esc(sv.opcua.url)}\nNode      ns=1;s=Line2.KPI.OEE\nNode      ns=1;s=Line2.Machines.M1.State\nMethod    ns=1;s=Line2.SetSpeed</pre>`},
      {html:`<div class="row"><a class="btn primary" style="display:inline-flex;align-items:center;text-decoration:none" href="/docs/" target="_blank" rel="noopener">Open the documentation</a><span class="note" style="margin:0">Data is generated in simulated time, so the speed multiplier also scales how fast telemetry is published.</span></div>`},
    ];
  }},
};
function rackMap(zone) {
  const slots = D.warehouse.slots.filter(s => s.zone === zone), cell = (b, l) => { const s = slots.find(x => x.bay === b && x.level === l); return s.pallet ? `<div class="slot ${zone === 'raw' ? 'raw' : 'fg'}" title="${s.id}: ${s.pallet.id}, in stock for ${dur(s.pallet.ageS)} min"><b>${s.pallet.quantity}</b><span>${s.pallet.id}</span></div>` : `<div class="slot" title="${s.id}: empty"></div>`; };
  let h = '<div class="rackmap"><span></span>' + [1, 2, 3, 4, 5, 6].map(b => `<span class="h">Bay ${b}</span>`).join('');
  for (let l = 3; l >= 1; l--) h += `<span class="lv">Level ${l}</span>` + [1, 2, 3, 4, 5, 6].map(b => cell(b, l)).join('');
  return h + '</div>';
}
const TRUCK_TXT = {none:'No truck scheduled', due:'On its way', arriving:'Reversing onto the dock', docked:'At the dock', departing:'Leaving'};
function truckRow(dir) {
  const t = D.warehouse.trucks[dir], inb = dir === 'inbound';
  const info = t.state === 'due' ? `arrives in ${dur(t.etaS)} min` : t.state === 'docked' ? (inb ? `${t.palletsOnBoard} pallets still on board` : `${t.palletsLoaded} of ${t.capacity} pallets loaded`) : '';
  return `<div class="row" style="justify-content:space-between;padding:7px 0;border-top:1px solid var(--hair)"><span><b>Dock ${inb ? '1, receiving' : '2, shipping'}</b><br><span style="color:var(--ink2)">${TRUCK_TXT[t.state]}${info ? ', ' + info : ''}</span></span><span class="row"><button class="btn" data-act="open:truck:${dir}">Details</button><button class="btn" data-act="truck:${dir}" ${t.state !== 'none' ? 'disabled' : ''}>${inb ? 'Order castings now' : 'Book a collection now'}</button></span></div>`;
}
const FORK_ST = {idle:'Parked at the charger', toPick:'Driving to pick up', picking:'Picking up a pallet', toDrop:'Carrying a pallet', dropping:'Setting down a pallet', toHome:'Returning to the charger'};
const forkText = f => FORK_ST[f.state] + (f.task ? `: ${f.task.from} to ${f.task.to}` : '');
function openDash(key) { const d = DASH[key]; if (d) openModal({...d, key}); }

/* ============================================================ detail dialogs */
function machineModal(i) {
  const d = MACH[i];
  return {key:`machine${i}`, ent:{type:'machine', id:i}, wide:true, title:`${d.id} ${d.name}`, sub:`${d.op}. ${d.desc}. ${d.crew ? 'Run by an operator.' : 'Runs unattended.'}`, blocks() {
    const m = D.machines[i], hrows = machHist(d.id);
    const why = m.fault ? `${m.fault.reason}, ${m.fault.technicianOnSite ? `repair in progress, about ${dur(m.fault.estimatedRepairS)} left` : 'waiting for the technician'}` : m.state === 'BLOCKED' ? 'The outfeed is full' : m.state === 'IDLE' ? 'No part available at the infeed' : m.state === 'RUN' ? `Cycle ${m.cycle.progress.toFixed(0)}% complete` : 'The line is stopped';
    return [
      {html:`<div class="statebar">${pill(m.state)}<span class="why">${esc(why)}</span><span class="sp"><button class="btn" data-act="focus:${d.x}:${d.z}">Show on the floor</button><button class="btn danger" data-act="fault:${d.id}" ${m.fault ? 'disabled' : ''}>Trigger a fault</button></span></div>`},
      {cls:'c4', html:h3('Effectiveness') + `<div class="big" style="font-size:46px">${m.oee.oee.toFixed(1)}<small>%</small></div>${meter('Availability', m.oee.availability)}${meter('Performance', m.oee.performance)}${meter('Quality', m.oee.quality)}`},
      {cls:'c8', html:h3('Counters and cycle') + kv([['Parts made', m.counters.parts], ['Scrap caused', m.counters.scrap], ['Last cycle', m.cycle.lastS ? m.cycle.lastS.toFixed(1) + ' s' : '-'], ['Ideal cycle', m.cycle.idealS + ' s'], ['Power now', m.energy.powerKw.toFixed(1) + ' kW'], ['Energy used', m.energy.energyKwh.toFixed(1) + ' kWh'], ['Energy per part', m.energy.kwhPerPart == null ? '-' : m.energy.kwhPerPart.toFixed(2) + ' kWh'], ['Stops', m.counters.stops], ['Downtime', dur(m.timeS.down) + ' min'], ['Mean time to repair', dur(m.maintenance.mttrS)], ['Time between failures', dur(m.maintenance.mtbfS)], ['Running time', dur(m.timeS.run) + ' min']])},
      {build(el) { el.innerHTML = `${h3('State over the last 30 minutes')}<canvas class="tl" style="height:18px"></canvas>${LEGEND}`; }, update(el) { timeline(el.querySelector('canvas'), D.machines[i].segs); }},
      {cls:'c4', chart:cv => lineChart(cv, hrows, {key:'kw', unit:'kW', dec:1}), h:96, cap:'Electrical load, kW', val:m.energy.powerKw.toFixed(1)},
      ...d.tags.map(tg => ({cls:'c4', chart:cv => lineChart(cv, hrows, {key:tg.k, zero:false, unit:tg.unit, dec:tg.dec}), h:96, cap:`${tg.name}, ${tg.unit}`, val:n1(m.tags[tg.k].value, tg.dec)})),
    ];
  }};
}
function materialModal(id, ent, extra = '') {
  return {key:`mat${id}`, ent, title:() => '', blocks() {
    const b = D.material.find(x => x.id === id), by = {}; b.parts.forEach(p => { by[p.stage] = (by[p.stage] || 0) + 1; });
    return [
      {html:kv([['Parts', `${b.quantity} of ${b.capacity}`], ['Fill level', Math.round(b.quantity / b.capacity * 100) + '%'], ...(b.kind === 'conveyor' ? [['Length', b.lengthM + ' m'], ['Belt speed', b.speedMps + ' m/s']] : []), ...Object.entries(by).map(([k, v]) => [k, v])]) + (extra ? `<p class="note">${extra}</p>` : '')},
      {html:h3('Parts here now') + (b.parts.length ? `<table><thead><tr><th>Part</th><th>Stage</th>${b.kind === 'conveyor' ? '<th class="num">Position</th>' : ''}</tr></thead><tbody>${b.parts.map(p => `<tr><td>Disc ${p.id}</td><td>${p.stage}</td>${b.kind === 'conveyor' ? `<td class="num">${p.positionM.toFixed(2)} m</td>` : ''}</tr>`).join('')}</tbody></table>` : '<p class="empty">Empty.</p>')},
    ];
  }};
}
function standModal(type) {
  const raw = type === 'rawStand';
  return {key:type, ent:{type, id:0}, title:raw ? 'Raw casting handover stand' : 'Finished goods handover stand', sub:raw ? 'The forklift sets raw pallets here. AGVs take six castings at a time to the lathe.' : 'AGVs set finished pallets here. The forklift puts them away or loads them straight onto a truck.', blocks() {
    const st = D.warehouse.stands[raw ? 'raw' : 'finished'];
    return [{html:`<table><thead><tr><th>Position</th><th>Pallet</th><th class="num">${raw ? 'Castings' : 'Discs'}</th><th class="num">Waiting</th></tr></thead><tbody>${st.map((p, k) => `<tr><td>${k + 1}</td><td>${p ? p.id : 'Empty'}</td><td class="num">${p ? p.quantity : '-'}</td><td class="num">${p ? dur(p.ageS) : '-'}</td></tr>`).join('')}</tbody></table>`}, {html:`<button class="btn" data-act="dash:warehouse">Open the warehouse dashboard</button>`, cls:'plain'}];
  }};
}
const ENT = {
  machine:id => machineModal(id),
  conveyor:id => { const c = CONV[id]; return {...materialModal(c.id, {type:'conveyor', id}), title:`${c.id} conveyor`, sub:`Roller conveyor from ${c.from} to ${c.to}. Parts queue here when the next station is busy.`}; },
  buffer:id => { const t = TBL[id]; return {...materialModal(t.id, {type:'buffer', id}), title:`${t.id} ${t.name.toLowerCase()}`, sub:id === 'ain' ? 'Raw castings delivered by AGV, loaded into the lathe by hand.' : id === 'aout' ? 'Machined discs waiting for an AGV to take them to finishing.' : 'Machined discs delivered by AGV, fed to the washer automatically.'}; },
  palletStation:() => ({...materialModal('PAL-1', {type:'palletStation', id:0}), title:'Palletiser pallet', sub:'The robot stacks eight coated discs here. A full pallet is collected by AGV.'}),
  agv:k => ({key:`agv${k}`, ent:{type:'agv', id:k}, title:`AGV ${k + 1}`, sub:'Automated guided vehicle on the one-way loop around the line', blocks() {
    const a = D.agvs[k], ST = {idle:'Idle, charging from the floor', toPick:'Driving to the pick-up', loading:'Loading', toDrop:'Delivering', unloading:'Unloading'};
    return [{html:`<div class="statebar"><span class="st"><i class="dot ${a.state === 'idle' ? 'IDLE' : 'RUN'}"></i>${a.lowBattery ? 'Charging, battery low' : ST[a.state]}</span></div>`},
      {html:bars([{label:'Battery', v:a.batteryPct, max:100}, {label:'Utilisation', v:a.utilisation, max:100}], r => r.v.toFixed(0) + '%')},
      {html:kv([['Job', a.task ? esc(a.task.description) : 'None'], ['From', a.task ? esc(a.task.pickUp) : '-'], ['To', a.task ? esc(a.task.dropOff) : '-'], ['Load', a.load.quantity ? `${a.load.quantity} discs on a ${a.load.kind}` : 'Empty'], ['Jobs completed', a.trips], ['Distance driven', (a.distanceM / 1000).toFixed(2) + ' km'], ['Loop position', a.position.loopM.toFixed(1) + ' m'], ['Plant position', `x ${a.position.x.toFixed(1)}, z ${a.position.z.toFixed(1)}`]])}];
  }}),
  person:id => { const d = PEOPLE.find(p => p.id === id); return {key:`person${id}`, ent:{type:'person', id}, title:`${d.role} ${d.id}`, sub:d.duty, blocks() {
    const p = D.people.find(x => x.id === id);
    return [{html:kv([['Area', esc(p.station)], ['Doing now', esc(p.activity)], ['Position', `x ${p.position.x.toFixed(1)}, z ${p.position.z.toFixed(1)}`], ...(p.partsLoaded != null ? [['Castings loaded', p.partsLoaded]] : []), ...(p.repairsCompleted != null ? [['Repairs completed', p.repairsCompleted], ['Open calls', p.openCalls], ['Utilisation', p.utilisation.toFixed(1) + '%']] : [])])}];
  }}; },
  rack:zone => ({key:`rack${zone}`, ent:{type:'rack', id:zone}, wide:true, title:zone === 'raw' ? 'Raw material rack' : 'Finished goods rack', sub:zone === 'raw' ? 'Selective pallet racking, 6 bays by 3 levels. Oldest pallets go to the line first.' : 'Selective pallet racking, 6 bays by 3 levels. Oldest pallets ship first.', blocks() {
    const z = zone === 'raw' ? 'raw' : 'finished', slots = D.warehouse.slots.filter(s => s.zone === z), full = slots.filter(s => s.pallet);
    return [{html:tiles([tile('Pallets', full.length, '', `of ${slots.length} slots`), tile(z === 'raw' ? 'Castings' : 'Discs', full.reduce((n, s) => n + s.pallet.quantity, 0)), tile('Oldest pallet', full.length ? dur(Math.max(...full.map(s => s.pallet.ageS))) : '-', 'min')])},
      {html:rackMap(z)},
      {html:h3('Pallets') + (full.length ? `<table><thead><tr><th>Slot</th><th>Pallet</th><th class="num">Quantity</th><th class="num">In stock for</th></tr></thead><tbody>${full.sort((a, b) => b.pallet.ageS - a.pallet.ageS).map(s => `<tr><td>${s.id}</td><td>${s.pallet.id}</td><td class="num">${s.pallet.quantity}</td><td class="num">${dur(s.pallet.ageS)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">The rack is empty.</p>')}];
  }}),
  rawStand:() => standModal('rawStand'), fgStand:() => standModal('fgStand'),
  forklift:() => ({key:'forklift', ent:{type:'forklift', id:0}, title:'Forklift FLT-1', sub:'Counterbalance truck serving the racks, the line handover stands and both docks', blocks() {
    const f = D.warehouse.forklift;
    return [{html:`<div class="statebar"><span class="st"><i class="dot ${f.state === 'idle' ? 'IDLE' : 'RUN'}"></i>${FORK_ST[f.state]}</span></div>`},
      {html:kv([['Job', f.task ? {replenish:'Replenish the line', putaway:'Put away finished goods', unload:'Unload the inbound truck', load:'Load the outbound truck'}[f.task.kind] : 'None'], ['From', f.task ? esc(f.task.from) : '-'], ['To', f.task ? esc(f.task.to) : '-'], ['On the forks', f.load ? `${f.load.id}, ${f.load.quantity} discs` : 'Nothing'], ['Fork height', f.forkHeightM.toFixed(2) + ' m'], ['Pallet moves', f.moves], ['Distance driven', (f.distanceM / 1000).toFixed(2) + ' km'], ['Utilisation', f.utilisation.toFixed(1) + '%']])},
      {html:'<p class="note" style="margin:0">Job priority: keep the line supplied, clear finished pallets from the handover stand, unload inbound trucks, load outbound trucks.</p>', cls:'plain'}];
  }}),
  truck:dir => ({key:`truck${dir}`, ent:{type:'truck', id:dir}, title:dir === 'inbound' ? 'Dock 1, receiving' : 'Dock 2, shipping', sub:dir === 'inbound' ? `A truck with ${WH.truckQty} pallets of raw castings is ordered when stock falls to ${WH.reorderPoint} pallets.` : `A collection of ${WH.shipQty} pallets is booked when ${WH.shipTrigger} finished pallets are in the rack.`, blocks() {
    const t = D.warehouse.trucks[dir], s = D.warehouse.stats, inb = dir === 'inbound';
    return [{html:`<div class="statebar"><span class="st"><i class="dot ${t.state === 'docked' ? 'RUN' : t.state === 'none' ? 'OFF' : 'BLOCKED'}"></i>${TRUCK_TXT[t.state]}</span><span class="sp"><button class="btn" data-act="truck:${dir}" ${t.state !== 'none' ? 'disabled' : ''}>${inb ? 'Order castings now' : 'Book a collection now'}</button></span></div>`},
      {html:kv([['Truck number', t.number || '-'], ['Arrives in', t.etaS == null ? '-' : dur(t.etaS) + ' min'], ['At the dock for', t.dockedForS == null ? '-' : dur(t.dockedForS) + ' min'], inb ? ['Pallets on board', `${t.palletsOnBoard} of ${t.capacity}`] : ['Pallets loaded', `${t.palletsLoaded} of ${t.capacity}`], inb ? ['Trucks received', s.trucksIn] : ['Trucks shipped', s.trucksOut], inb ? ['Castings received', s.receivedDiscs] : ['Discs shipped', s.shippedDiscs]])}];
  }}),
};
const REDIRECT = {utilities:'energy', office:'overview', andon:'overview', workshop:'maintenance', scrap:'quality'};
function openEntity(e) {
  if (REDIRECT[e.type]) return openDash(REDIRECT[e.type]);
  const make = ENT[e.type]; if (!make) return;
  const def = make(e.id); if (typeof def.title === 'function') def.title = '';
  openModal(def);
}

/* ============================================================ HUD */
const ICON = {
  overview:'M4 17a8 8 0 1 1 16 0M12 17l4-6', production:'M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8', quality:'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12l3 3 5-6',
  energy:'M13 3L5 14h6l-1 7 8-11h-6z', maintenance:'M15 6a4 4 0 0 0 4.5 5.3L10 21l-3-3 9.7-9.5A4 4 0 0 0 15 6z', stations:'M4 6h16M4 12h16M4 18h16',
  logistics:'M3 15h18v-4H3zM7.5 18.5h.01M16.5 18.5h.01M6 11V7h9v4', warehouse:'M3 10l9-6 9 6v10H3zM8 20v-6h8v6M8 17h8', events:'M6 16v-5a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
  connectivity:'M5 12a7 7 0 0 1 14 0M8.5 12a3.5 3.5 0 0 1 7 0M12 12v7M9 19h6', docs:'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11',
};
const RAIL = [['overview', 'Overview'], ['production', 'Production'], ['quality', 'Quality'], ['energy', 'Energy'], ['maintenance', 'Maintenance'], ['stations', 'Stations'], ['logistics', 'Logistics'], ['warehouse', 'Warehouse'], ['events', 'Events'], null, ['connectivity', 'Connectivity']];
$('rail').innerHTML = RAIL.map(r => r ? `<button data-open="${r[0]}" aria-pressed="false"><svg viewBox="0 0 24 24"><path d="${ICON[r[0]]}"/></svg>${r[1]}${r[0] === 'maintenance' ? '<span class="n" id="nFault" hidden></span>' : ''}</button>` : '<hr>').join('')
  + `<a href="/docs/" target="_blank" rel="noopener"><svg viewBox="0 0 24 24"><path d="${ICON.docs}"/></svg>Documentation</a>`;
$('rail').addEventListener('click', e => { const b = e.target.closest('button[data-open]'); if (b) openDash(b.dataset.open); });

const STRIP = [['overview', 'Line OEE'], ['production', 'Throughput'], ['production', 'Good discs'], ['quality', 'Scrap'], ['energy', 'Electrical load'], ['warehouse', 'Raw castings'], ['warehouse', 'Finished stock'], ['maintenance', 'Open faults']];
$('strip').innerHTML = STRIP.map(([k, l]) => `<button class="kp" data-open="${k}"><small>${l}</small><b>-</b></button>`).join('');
$('strip').addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b) openDash(b.dataset.open); });
const stripEls = [...$('strip').children];

const chipEls = MACH.map((d, i) => { const b = document.createElement('button'); b.className = 'chip'; b.innerHTML = `<i class="dot"></i>${d.id}`; b.title = `${d.id} ${d.name}`; b.onclick = () => openEntity({type:'machine', id:i}); $('chips').appendChild(b); return b; });
const agvChips = [0, 1].map(k => { const b = document.createElement('div'); b.className = 'chip sub'; b.innerHTML = `AGV ${k + 1} <span></span>`; $('chips').appendChild(b); return b; });
const forkChip = (() => { const b = document.createElement('div'); b.className = 'chip sub'; b.textContent = 'FLT-1'; $('chips').appendChild(b); return b; })();
function placeChips() {
  if (!scene) return;
  const at = (el, x, y, z) => { const p = scene.project(x, y, z); el.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px) translate(-50%,-100%)`; };
  MACH.forEach((d, i) => at(chipEls[i], d.x, d.h + 1.5, d.z));
  agvChips.forEach((el, k) => { const p = scene.agvPos(k); at(el, p.x, 1.6, p.z); });
  const fp = scene.forkPos(); at(forkChip, fp.x, 3.0, fp.z);
}
function showTip(e, x, y) {
  const t = $('tip'); if (!e) { t.hidden = true; return; }
  t.hidden = false; t.innerHTML = `${esc(e.name)}<small>Click for details</small>`; t.style.left = Math.min(innerWidth - 220, x + 14) + 'px'; t.style.top = (y + 16) + 'px';
}

function setStatus() {
  const st = $('status'), mode = !online ? 'offline' : D ? D.status.mode : 'stopped';
  st.dataset.m = mode;
  st.lastElementChild.textContent = !online ? 'Reconnecting' : !D ? 'Connecting' : mode === 'paused' ? 'Paused' : mode === 'running' ? 'Running' : mode === 'stopping' ? 'Stopping' : D.status.simTime.seconds === 0 ? 'Ready to start' : 'Stopped';
  const lm = D ? D.status.lineMode : 'stopped', paused = D ? D.status.paused : false;
  $('bStart').disabled = !online || (!paused && lm === 'running'); $('bPause').disabled = !online || paused || lm === 'stopped'; $('bStop').disabled = !online || lm !== 'running'; $('bReset').disabled = !online;
}
const spToPos = s => Math.round(1000 * Math.log(s / 0.1) / Math.log(1200)), posToSp = p => 0.1 * Math.pow(1200, p / 1000);
const spRound = s => (s < 1 ? Math.round(s * 20) / 20 : s < 10 ? Math.round(s * 2) / 2 : Math.round(s));
let spTouched = 0;
function setSpeed(v) { v = Math.max(0.1, Math.min(120, v)); spTouched = Date.now(); $('spNum').value = v; $('spRange').value = spToPos(v); send({action:'speed', speed:v}); markPresets(v); }
const markPresets = v => [...$('spPresets').children].forEach(b => b.setAttribute('aria-pressed', +b.dataset.s === v));
$('spRange').addEventListener('input', e => setSpeed(spRound(posToSp(+e.target.value))));
$('spNum').addEventListener('change', e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setSpeed(v); });
$('spPresets').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setSpeed(+b.dataset.s); });
for (const b of document.querySelectorAll('.controls button')) b.onclick = () => { const paused = D && D.status.paused; send({action:b.dataset.cmd === 'start' && paused && D.status.lineMode === 'running' ? 'resume' : b.dataset.cmd}); if (b.dataset.cmd === 'reset') for (const k in histCache) delete histCache[k]; };
$('views').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || !scene) return; scene.setView(b.dataset.v); [...$('views').children].forEach(x => x.setAttribute('aria-pressed', x === b)); });
$('bLabels').onclick = e => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', on); $('chips').classList.toggle('nolabels', !on); };
addEventListener('keydown', e => {
  if (e.key === 'Escape') return closeModal();
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if (e.code === 'Space' && e.target.tagName !== 'BUTTON' && D) { e.preventDefault(); send({action:D.status.paused ? 'resume' : 'pause'}); }
});

function onStats() {
  setStatus();
  const k = D.kpis, p = k.production, w = D.warehouse.inventory, faults = D.machines.filter(m => m.fault);
  $('clock').textContent = D.status.simTime.clock; $('elapsed').textContent = `${hms(D.status.simTime.seconds)} into the shift`;
  if (Date.now() - spTouched > 1200 && document.activeElement !== $('spNum')) { $('spNum').value = D.status.speed; $('spRange').value = spToPos(D.status.speed); markPresets(D.status.speed); }
  const vals = [`${k.oee.oee.toFixed(1)}<em>%</em>`, `${p.throughputPerHour}<em>/h</em>`, `${p.good}<em>of ${p.planned}</em>`, `${p.scrap}<em>${p.firstPassYield.toFixed(1)}% yield</em>`, `${Math.round(k.energy.powerKw)}<em>kW</em>`, `${w.rawDiscs}<em>${n1(w.rawCoverHours)} h cover</em>`, `${w.finishedPallets}<em>pallets</em>`, `${faults.length}`];
  stripEls.forEach((el, i) => { if (el.lastChild.innerHTML !== vals[i]) el.lastChild.innerHTML = vals[i]; });
  stripEls[7].classList.toggle('alert', faults.length > 0);
  const nf = $('nFault'); nf.hidden = !faults.length; nf.textContent = faults.length;
  const ah = faults.map(m => `<button class="alarm" data-i="${D.machines.indexOf(m)}"><i></i><b>${m.id} ${esc(m.name)} is down</b><span>${esc(m.fault.reason)}, ${m.fault.technicianOnSite ? 'repair in progress' : 'technician called'}</span></button>`).join('');
  if ($('alarms')._h !== ah) { $('alarms').innerHTML = ah; $('alarms')._h = ah; }
  D.machines.forEach((m, i) => { const c = 'chip ' + m.state; if (chipEls[i].className !== c) chipEls[i].className = c; });
  D.agvs.forEach((a, i) => { agvChips[i].lastChild.textContent = `${a.batteryPct.toFixed(0)}%`; });
  if (scene) scene.setStats(D);
  renderModal();
}
$('alarms').addEventListener('click', e => { const b = e.target.closest('.alarm'); if (b) openEntity({type:'machine', id:+b.dataset.i}); });

/* ============================================================ render loop */
let last = performance.now();
function frame(now) {
  const rdt = Math.min(0.1, (now - last) / 1000); last = now;
  if (local) { advance(local, rdt); F = viewFrame(local); }
  if (scene && F) { scene.update(F, rdt); placeChips(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
setStatus();
// start last: everything above must be initialised before the first data arrives
if (document.querySelector('meta[name=twin-mode][content=local]') || new URLSearchParams(location.search).has('local')) startLocal(); else connect();
window.__twin = { openDash, openEntity, get stats() { return D; }, get frame() { return F; } };
void ringPos; void PALLET_POS;
