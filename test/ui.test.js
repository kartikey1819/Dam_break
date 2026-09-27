'use strict';
/* Headless UI smoke test using an already-installed Chrome/Edge via the DevTools protocol (no npm deps).
 *   node test/ui.test.js                      → offline mode (file://)
 *   node test/ui.test.js http://localhost:8080 → against a running backend
 * Visits every page, exercises map modes, alerts, exports and routing; reports JS errors. */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const url = process.argv[2] || 'file:///' + path.join(__dirname, '..', 'public', 'index.html').replace(/\\/g, '/');
const shotDir = process.env.SHOT_DIR || null;
const CANDIDATES = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'];
const exe = CANDIDATES.find((p) => fs.existsSync(p));
if (!exe) { console.log('SKIP: no Chrome/Edge found'); process.exit(0); }
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-ui-'));
const chrome = spawn(exe, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9334', `--user-data-dir=${prof}`, '--window-size=1600,1000', 'about:blank']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let targets;
  for (let i = 0; i < 60; i++) { try { targets = await (await fetch('http://127.0.0.1:9334/json')).json(); if (targets.find((t) => t.type === 'page')) break; } catch (e) {} await sleep(250); }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = {}, errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; }
    if (d.method === 'Runtime.exceptionThrown') errors.push('EXC: ' + String(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).slice(0, 500));
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push('CONSOLE: ' + d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 400));
  };
  const send = (method, params) => new Promise((r) => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? 'ERR ' + (r.result.exceptionDetails.exception?.description || '').slice(0, 300) : r.result?.result?.value; };
  const shot = async (name) => { if (!shotDir) return; const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(shotDir, name + '.png'), Buffer.from(r.result.data, 'base64')); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await sleep(6000);
  console.log('scenario:', await ev('FS.state.scn && FS.state.scn.name'), '| backend:', await ev('FS.state.backend.online'));
  await ev(`document.querySelector('[data-go=dashboard]').click()`);
  for (const p of ['dashboard', 'builder', 'simulation', 'models', 'impact', 'nrt', 'evac', 'priority', 'whatif', 'export', 'data', 'arch', 'settings']) {
    await ev(`FS.app.go('${p}')`); await sleep(p === 'whatif' || p === 'builder' ? 2500 : 1200);
    console.log(p.padEnd(11), 'text:', await ev(`document.querySelector('#view').innerText.length`));
    await shot(p);
  }
  await ev(`FS.app.go('dashboard')`); await sleep(800);
  for (const m of ['arrival', 'duration', 'risk', 'infra', 'evac', 'depth']) { await ev(`document.querySelector('.mode-bar [data-m=${m}]').click()`); await sleep(200); }
  await ev(`document.querySelector('[data-play]').click()`); await sleep(1500); await ev(`document.querySelector('[data-play]').click()`);
  console.log('timeline:', await ev(`document.querySelector('.tnow').textContent`));
  const vid = await ev(`(FS.state.ana.delft3d.villages.find(v=>v.affected)||{}).id`);
  if (vid) {
    await ev(`FS.views.alertModal('${vid}')`); await sleep(200);
    for (const k of ['wa', 'brief', 'sms']) await ev(`document.querySelector('#ak [data-v=${k}]').click()`);
    await ev(`document.querySelector('#al [data-v=hi]').click()`);
    console.log('alert HI:', String(await ev(`document.querySelector('#aout').innerText.slice(0,120)`)).replace(/\n/g, ' '));
    await ev(`FS.app.closeModal()`);
  }
  console.log('kml bytes:', await ev(`FS.geoexport.kml(FS.state.scn, FS.state.scn.models.delft3d, FS.state.ana.delft3d, 't').length`));
  console.log('shp zip bytes:', await ev(`FS.geoexport.shapefileZip(FS.state.scn, FS.state.scn.models.delft3d, 't').length`));
  console.log('png len:', await ev(`FS.exporter.mapSnapshot(FS.state.scn, FS.state.scn.models.delft3d, FS.state.ana.delft3d, 360, 't').then(u=>u.length)`));
  console.log('report len:', await ev(`FS.exporter.report({st:FS.state,scn:FS.state.scn,M:FS.state.scn.models.sph,ana:FS.state.ana.sph,other:FS.state.scn.models.delft3d,otherAna:FS.state.ana.delft3d,img:'x',name:'t'}).length`));
  await ev(`FS.app.go('evac')`); await sleep(800);
  console.log('evac routes ok:', await ev(`(()=>{const s=document.querySelector('#es'); let ok=0,n=0; for (const o of [...s.options].slice(0,40)){ s.value=o.value; s.dispatchEvent(new Event('change')); n++; if(!document.querySelector('#eres').innerText.includes('NO SAFE ROAD')) ok++; } return ok+'/'+n;})()`));
  if (process.env.RUN_DEMO) {
    await ev(`FS.app.runDemo()`); await sleep(6500);
    console.log('demo run done:', await ev('!FS.state.running'), 'steps ok:', await ev(`document.querySelectorAll('#steps li.ok').length`));
  }
  console.log('ERRORS:', errors.length ? '\n' + errors.join('\n') : 'none');
  ws.close(); chrome.kill();
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {}
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('TEST FAIL', e); chrome.kill(); process.exit(1); });
