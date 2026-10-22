const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
let work;
let target;
const env = { ...process.env, SHELLOS_FULL_REINSTALL: '1', PATH: `${path.dirname(process.execPath)}:${process.env.PATH}` };
const script = path.join(repo, 'scripts/patch-terminal-browser-drag.sh');
function patch(...args) { return execFileSync('bash', [script, ...args, target], { env, stdio: 'pipe' }); }
function inputClass(source) {
  const a = source.indexOf('var PageInput = class {');
  const b = source.indexOf('var SELECTION_SNIPPET', a);
  const c = source.indexOf('function cdpModifiers(');
  const d = source.indexOf('var EDITING_KEY_INFO', c);
  const input = b < 0 ? source : source.slice(a, b) + source.slice(c, d);
  return vm.runInNewContext(input + '\nPageInput;', { console, process, electronKey: key => key });
}
async function run() {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'shellos-drag-test-'));
  target = path.join(work, 'main.js');
  fs.copyFileSync(process.env.TODE_BROWSER_BUNDLE || path.join(__dirname, 'fixtures/terminal-browser-drag.js'), target);
  const original = fs.readFileSync(target, 'utf8');
  patch();
  const source = fs.readFileSync(target, 'utf8');
  patch(); patch('--check');
  assert.equal(fs.readFileSync(target, 'utf8'), source);
  assert.equal(fs.readFileSync(target + '.drag.orig', 'utf8'), original);
  const PageInput = inputClass(source);
  const mouse = [], drags = [];
  const input = new PageInput({ focus: () => {}, scale: () => 2,
    contents: () => ({ sendInputEvent: e => mouse.push(e) }),
    cdp: async (method, params) => { drags.push({ method, ...params }); }
  });
  const mods = { ctrl: false, alt: false, shift: false, super: false };
  const pointer = (kind, x, y, more = {}) => input.pointer({ kind, x, y, button: kind === 'move' ? 'none' : 'left', mods: { ...mods, ...more } });
  const data = { items: [{ mimeType: 'text/plain', data: '/workspace/file.py' }], dragOperationsMask: 3 };
  pointer('down', 100, 100); pointer('move', 130, 100);
  assert.equal(mouse.length, 2, 'ordinary pointer events still use the native path');
  input.startDrag(data);
  pointer('move', 1000, 300, { ctrl: true });
  pointer('up', 1000, 300, { ctrl: true });
  await input.dragQueue; await Promise.resolve();
  assert.deepEqual(drags.map(e => e.type), ['dragEnter', 'dragOver', 'dragOver', 'dragOver', 'drop']);
  assert.equal(drags.at(-1).data, data);
  assert.equal(drags.at(-1).x, 500); assert.equal(drags.at(-1).y, 150);
  assert.equal(drags.at(-1).modifiers, 2);
  assert.equal(mouse.at(-1).type, 'mouseUp');
  assert.equal(input.dragData, null); assert.equal(input.pressed.size, 0);
  pointer('down', 100, 100); input.startDrag(data); input.releaseModifiers();
  await input.dragQueue;
  assert.equal(drags.at(-1).type, 'dragCancel');
  assert.equal(input.pressed.size, 0);
  pointer('down', 100, 100); input.startDrag(data); input.key({ key: 'escape', kind: 'press', mods });
  await input.dragQueue;
  assert.equal(drags.at(-1).type, 'dragCancel');
  // A quick release can reach the host before Chromium reports the drag.
  pointer('down', 100, 100); pointer('up', 1000, 300); input.startDrag(data);
  await input.dragQueue;
  assert.equal(drags.at(-1).type, 'drop'); assert.equal(drags.at(-1).x, 500);
  const drifted = original.replace('    await this.cdp("Runtime.addBinding", { name: "__pixelEmit" });', '    await upstreamChanged();');
  fs.writeFileSync(target, drifted);
  assert.throws(() => patch());
  assert.equal(fs.readFileSync(target, 'utf8'), drifted, 'upstream drift must fail without a partial write');
  console.log('Drag patch idempotency, coordinates, payload, ordering, cancellation, and quick release passed');
}
module.exports = { inputClass };
if (require.main === module) run().finally(() => fs.rmSync(work, { recursive: true, force: true })).catch(error => { console.error(error); process.exitCode = 1; });
