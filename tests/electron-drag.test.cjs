const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { inputClass } = require('./terminal-browser-drag.test.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function worker() {
  const { app, BrowserWindow } = require('electron');
  const work = process.argv[process.argv.indexOf('--worker') + 1];
  app.setPath('userData', path.join(work, 'profile'));
  app.disableHardwareAcceleration();
  await app.whenReady();
  const w = new BrowserWindow({ show: true, width: 1000, height: 700, webPreferences: { offscreen: true, sandbox: true } });
  const wc = w.webContents;
  const html = `<div id="file" draggable="true" style="width:120px;height:100px">file.py</div>
    <div id="target" style="position:absolute;left:600px;top:0;width:300px;height:600px"></div>
    <script>window.events=[]; for(const type of ['dragstart','dragenter','dragover','drop','dragend']) document.addEventListener(type,e=>{
      events.push({type,target:e.target.id,data:e.dataTransfer.getData('text/plain')});
      if(type==='dragstart') e.dataTransfer.setData('text/plain','file.py');
      if(type==='dragover') e.preventDefault();
    });</script>`;
  await w.loadURL(process.env.SHELLOS_DRAG_TEST_URL || 'data:text/html,' + encodeURIComponent(html));
  w.setContentSize(1000, 700); w.focus(); wc.focus();
  wc.debugger.attach('1.3');
  const cdp = (method, params) => wc.debugger.sendCommand(method, params);
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
  const PageInput = inputClass(fs.readFileSync(path.join(work, 'main.js'), 'utf8'));
  const input = new PageInput({ contents: () => wc, scale: () => 1, focus: () => {}, cdp });
  wc.debugger.on('message', (_event, method, params) => {
    if (method === 'Input.dragIntercepted') input.startDrag(params.data);
  });
  await cdp('Input.setInterceptDrags', { enabled: true });
  const mods = { ctrl: false, shift: false, alt: false, super: false };
  async function pointer(kind, x, y) {
    input.pointer({ kind, x, y, button: kind === 'move' ? 'none' : 'left', mods });
    await delay(100);
    await input.dragQueue;
  }
  async function waitFor(expression) {
    for (let i = 0; i < 200; i++) {
      const result = await wc.executeJavaScript(expression);
      if (result) return result;
      await delay(100);
    }
    throw new Error('Timed out: ' + expression);
  }
  if (process.env.SHELLOS_DRAG_TEST_URL) {
    const first = await waitFor(`(()=>{const e=[...document.querySelectorAll('.monaco-list-row')].find(e=>e.textContent.includes('first.py'));if(!e)return;const r=e.getBoundingClientRect();return {x:r.x+60,y:r.y+r.height/2}})()`);
    await pointer('down', first.x, first.y); await pointer('up', first.x, first.y);
    await pointer('down', first.x, first.y); await pointer('up', first.x, first.y);
    await waitFor(`document.querySelector('.tab.active')?.textContent.includes('first.py')`);
    const row = await waitFor(`(()=>{const e=[...document.querySelectorAll('.monaco-list-row')].find(e=>e.textContent.includes('second.py'));if(!e)return;const r=e.getBoundingClientRect();return {x:r.x+60,y:r.y+r.height/2}})()`);
    await pointer('down', row.x, row.y);
    await pointer('move', row.x + 20, row.y);
    await waitFor(`!!document.querySelector('.monaco-workbench')`);
    const edge = await wc.executeJavaScript(`(()=>{const r=document.querySelector('.editor-group-container').getBoundingClientRect();return {x:r.right-20,y:r.y+r.height/2}})()`);
    await pointer('move', edge.x, edge.y);
    await waitFor(`!!document.querySelector('.editor-group-overlay-indicator')`);
    await pointer('up', edge.x, edge.y);
    await waitFor(`document.querySelectorAll('.editor-group-container').length===2`);
    const tabs = await wc.executeJavaScript(`[...document.querySelectorAll('.editor-group-container')].map(e=>e.querySelector('.tab.active')?.textContent)`);
    assert.ok(tabs[0].includes('first.py'), JSON.stringify(tabs));
    assert.ok(tabs[1].includes('second.py'), JSON.stringify(tabs));
    console.log('Actual VS Code Explorer drag created two editor groups:', JSON.stringify(tabs));
    // Move the existing left tab to the right group to cover editor-tab dragging too.
    const tab = await wc.executeJavaScript(`(()=>{const r=document.querySelector('.editor-group-container .tab.active').getBoundingClientRect();return {x:r.x+45,y:r.y+r.height/2}})()`);
    await pointer('down', tab.x, tab.y); await pointer('move', tab.x+20, tab.y);
    const destination = await wc.executeJavaScript(`(()=>{const r=[...document.querySelectorAll('.editor-group-container')].at(-1).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await pointer('move', destination.x, destination.y); await pointer('up', destination.x, destination.y);
    await waitFor(`document.querySelectorAll('.editor-group-container').length===1 && document.querySelectorAll('.tab').length===2`);
    console.log('Actual VS Code editor-tab drag moved the tab into the other group');
  } else {
    await delay(200);
    await pointer('down', 50, 50); await pointer('move', 75, 50);
    assert.ok(input.dragData, 'Chromium intercepted the native drag');
    await pointer('move', 750, 300); await pointer('up', 750, 300);
    const events = await wc.executeJavaScript('events');
    assert.equal(events.find(e => e.type === 'drop')?.data, 'file.py');
    assert.equal(events.find(e => e.type === 'drop')?.target, 'target');
    assert.ok(events.some(e => e.type === 'dragend'));
    await wc.executeJavaScript('events=[]');
    await delay(550);
    await pointer('down', 50, 50); await pointer('move', 75, 50);
    assert.ok(input.dragData); input.cancelDrag(); await input.dragQueue;
    await pointer('up', 750, 300);
    const cancelled = await wc.executeJavaScript('events');
    assert.ok(!cancelled.some(e => e.type === 'drop'));
    assert.ok(cancelled.some(e => e.type === 'dragend'));
    console.log('Electron offscreen native drag preserved payload, drop target, dragend, and cancellation');
  }
  app.quit();
}
async function run() {
  assert.ok(process.env.ELECTRON_BIN, 'set ELECTRON_BIN');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'shellos-electron-drag-'));
  try {
    fs.copyFileSync(process.env.TODE_BROWSER_BUNDLE || path.join(__dirname, 'fixtures/terminal-browser-drag.js'), path.join(work, 'main.js'));
    execFileSync('bash', [path.join(__dirname, '../scripts/patch-terminal-browser-drag.sh'), path.join(work, 'main.js')], {
      env: { ...process.env, SHELLOS_FULL_REINSTALL: '1', PATH: `${path.dirname(process.execPath)}:${process.env.PATH}` }
    });
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    await new Promise((resolve, reject) => {
      const args = process.platform === 'linux' ? ['--no-sandbox', '--ozone-platform=headless'] : [];
      const child = spawn(process.env.ELECTRON_BIN, [...args, __filename, '--worker', work], { env, stdio: 'inherit' });
      const timer = setTimeout(() => { child.kill(); reject(new Error('Electron drag test timed out')); }, 60000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Electron exited ${code}`)); });
    });
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}
(process.versions.electron ? worker() : run()).catch(error => {
  console.error(error);
  if (process.versions.electron) require('electron').app.exit(1); else process.exitCode = 1;
});
