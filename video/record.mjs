// Captures a scripted tour of the viewer as numbered JPEG frames in video/public/frames/.
// The page runs the simulation itself (?local) on a virtual clock, so every frame is exactly 1/30 s apart.
// Requires the app to be served: npm start (in the project root).
import { createRequire } from 'node:module';
import { readdirSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const ext = path.join(homedir(), '.vscode/extensions');
const dir = readdirSync(ext).filter(d => d.startsWith('danielsanmedium.dscodegpt-')).sort((a, b) => a.localeCompare(b, undefined, {numeric:true})).pop();
const { chromium } = createRequire(path.join(ext, dir, 'standalone') + '/')('patchright');
const out = path.resolve('video/public/frames');
rmSync(out, {recursive:true, force:true}); mkdirSync(out, {recursive:true});
const URL = 'http://127.0.0.1:8080/?local', W = 1920, H = 1080, FPS = 30;

// virtual clock and cursor, injected into the page itself
const INJECT = `<script>(() => {
  let vt = 0, id = 1; const base = Date.now(), raf = [], timers = [];
  performance.now = () => vt; Date.now = () => base + vt;
  window.requestAnimationFrame = cb => { raf.push(cb); return id++; };
  const add = (cb, ms, rep, args) => { timers.push({cb:() => cb(...args), ms:Math.max(1, ms || 0), next:vt + (ms || 0), rep, id}); return id++; };
  window.setTimeout = (cb, ms, ...a) => add(cb, ms, false, a); window.setInterval = (cb, ms, ...a) => add(cb, ms, true, a);
  window.clearTimeout = window.clearInterval = i => { const k = timers.findIndex(t => t.id === i); if (k >= 0) timers.splice(k, 1); };
  document.addEventListener('vtick', e => {
    vt += e.detail || 1000 / ${FPS};
    for (const t of [...timers]) if (t.next <= vt) { if (t.rep) t.next += t.ms; else timers.splice(timers.indexOf(t), 1); t.cb(); }
    for (const cb of raf.splice(0)) cb(vt);
  });
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div'); c.style.cssText = 'position:fixed;left:-50px;top:0;width:26px;height:26px;margin:-3px 0 0 -4px;z-index:99999;pointer-events:none';
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 22 22"><path d="M3 2l15 8-6.5 1.8L9 18z" fill="#16232D" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    addEventListener('pointermove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
  });
})();</script>`;

const browser = await chromium.launch({headless:true, args:['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']});
const ctx = await browser.newContext({viewport:{width:W, height:H}, deviceScaleFactor:1});
const page = await ctx.newPage();
await page.route(u => u.pathname === '/', async route => { const r = await route.fetch(); route.fulfill({response:r, body:(await r.text()).replace('<head>', '<head>' + INJECT)}); });
await page.goto(URL);

let n = 0, mx = W / 2, my = H / 2; const marks = {};
const tick = ms => page.evaluate(d => document.dispatchEvent(new CustomEvent('vtick', {detail:d})), ms);
const shot = async () => { await tick(1000 / FPS); await page.screenshot({path:path.join(out, String(n++).padStart(5, '0') + '.jpg'), type:'jpeg', quality:93}); };
const hold = async sec => { for (let i = 0; i < Math.round(sec * FPS); i++) await shot(); };
const skip = async (sec, step = 100) => { for (let t = 0; t < sec * 1000; t += step) await tick(step); };
const glide = async (x, y, sec = 0.7, record = true) => { const k = Math.max(2, Math.round(sec * FPS)); for (let i = 1; i <= k; i++) { const f = i / k, e = f * f * (3 - 2 * f); await page.mouse.move(mx + (x - mx) * e, my + (y - my) * e); if (record) await shot(); } mx = x; my = y; };
const centre = async sel => { const b = await page.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
const click = async (record = true) => { await page.mouse.down(); if (record) await shot(); await page.mouse.up(); if (record) await shot(); };
const clickSel = async (sel, sec = 0.7, record = true) => { const [x, y] = await centre(sel); await glide(x, y, sec, record); if (record) await hold(0.12); await click(record); };
const mark = k => { marks[k] = n; };

// warm up off camera: start the shift, order a truck, run an hour at 120x
for (let i = 0; i < 60; i++) await tick(50);
await page.waitForSelector('.kp b em');
await clickSel('#spPresets button[data-s="120"]', 0.1, false); await skip(27);
await clickSel('#rail button[data-open=warehouse]', 0.1, false); await skip(0.6); await clickSel('button[data-act="truck:inbound"]', 0.1, false); await skip(0.3); await page.keyboard.press('Escape');
await skip(1.2); await clickSel('#spPresets button[data-s="10"]', 0.1, false); await skip(1.5);
await page.mouse.move(1100, 640); mx = 1100; my = 640; await skip(0.5);

mark('plant'); await hold(0.8); await page.mouse.down(); await glide(1010, 628, 3.6); await page.mouse.up(); await hold(1.2);
mark('line'); await clickSel('#views button[data-v=line]', 0.6); await glide(1180, 560, 0.9); await hold(2.6);
mark('machine'); { const [x, y] = await centre('.chip:nth-child(5)'); await glide(x, y + 80, 0.9); await hold(0.5); await click(); } await hold(1.0); await glide(1010, 700, 1.2); await hold(3.4);
await page.keyboard.press('Escape'); await hold(0.2);
mark('warehouse'); await clickSel('#views button[data-v=warehouse]', 0.6); await glide(1120, 620, 0.9); await hold(5.6);
mark('whdash'); await clickSel('#rail button[data-open=warehouse]', 0.7); await glide(1180, 420, 0.9); await hold(3.4);
await page.keyboard.press('Escape'); await clickSel('#views button[data-v=plant]', 0.3, false); await skip(1.5);
mark('overview'); await clickSel('#rail button[data-open=overview]', 0.7); await glide(1150, 330, 0.9); await hold(3.2);
await page.keyboard.press('Escape'); await hold(0.2);
mark('energy'); await clickSel('#rail button[data-open=energy]', 0.6); await glide(900, 500, 0.9); await hold(2.6);
await page.keyboard.press('Escape'); await hold(0.2);
mark('fault'); await clickSel('.chip:nth-child(2)', 0.8); await hold(0.8); await clickSel('button[data-act="fault:M2"]', 0.8); await hold(1.0); await page.keyboard.press('Escape'); await glide(1560, 800, 0.6); await hold(2.4);
mark('speed'); await clickSel('#spPresets button[data-s="60"]', 0.8); await glide(1560, 800, 0.8); await hold(5.2);
mark('end');
await browser.close();
writeFileSync(path.resolve('video/src/marks.json'), JSON.stringify(marks, null, 1));
console.log(marks, 'frames', n);
