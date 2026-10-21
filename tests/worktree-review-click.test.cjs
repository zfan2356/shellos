const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const vm = require('node:vm');
const { test } = require('node:test');

const script = path.resolve(__dirname, '../scripts/patch-tode-worktree-review-click.sh');
const anchor = 'this.delegate?.willOpenElement(c.browserEvent),await this.editorService.openEditor({resource:l.resource,options:{preserveFocus:c.editorOptions.preserveFocus,pinned:c.editorOptions.pinned,source:1}},c.sideBySide?Kn:cr)';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-entry-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const out = path.join(root, '4.132.0/lib/vscode/out');
  const entry = path.join(out, 'vs/code/browser/workbench/workbench.js');
  const internal = path.join(out, 'vs/workbench/workbench.web.main.internal.js');
  for (const file of [entry, internal]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `async function click(c,l){${anchor}}`);
  }
  fs.writeFileSync(entry.replace(/\.js$/, '.html'), '<script type="module" src="{{WORKBENCH_WEB_BASE_URL}}/out/vs/code/browser/workbench/workbench.js"></script>');
  const run = (...args) => cp.spawnSync('bash', [script, ...args], {
    encoding: 'utf8', env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`,
      SHELLOS_FULL_REINSTALL: '1', TODE_CODE_SERVER_ROOT: root, TODE_WORKBENCH_BUNDLE: '' },
  });
  return { entry, internal, run };
}

test('patches the served browser entry as well as the internal bundle', t => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  for (const file of [f.entry, f.internal]) {
    assert.match(fs.readFileSync(file, 'utf8'), /Explorer atomic diff v3/);
  }
  const once = fs.readFileSync(f.entry, 'utf8');
  const html = f.entry.replace(/\.js$/, '.html');
  assert.match(fs.readFileSync(html, 'utf8'), /workbench\.js\?shellos-review=3/);
  assert.equal(f.run().status, 0);
  assert.equal(fs.readFileSync(f.entry, 'utf8'), once);
  assert.equal(f.run('--check').status, 0);
  const versioned = fs.readFileSync(html, 'utf8');
  fs.writeFileSync(html, versioned.replace('?shellos-review=3', ''));
  assert.notEqual(f.run('--check').status, 0);
  assert.equal(f.run().status, 0);
  assert.equal(fs.readFileSync(html, 'utf8'), versioned);
  fs.writeFileSync(f.entry, `async function click(c,l){${anchor}}`);
  assert.notEqual(f.run('--check').status, 0);
});

test('opens one diff directly with revived remote URI objects', async t => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  class URI {
    constructor(value) { Object.assign(this, value); }
    static revive(value) { return new URI(value); }
  }
  const remote = new URI({ scheme: 'vscode-remote', path: '/repo/b.py' });
  const response = { original: { scheme: 'worktree-review', path: '/b.py' },
    modified: { scheme: 'vscode-remote', path: '/repo/b.py' }, label: 'b.py diff' };
  const opened = [];
  let resolve;
  const command = new Promise(r => { resolve = r; });
  const context = { Kn: 2, cr: 1 };
  vm.runInNewContext(fs.readFileSync(f.entry, 'utf8'), context);
  const owner = {
    commandService: { executeCommand: async (name, resource) => {
      assert.equal(name, 'worktreeReview.resolveExplorerOpen');
      assert.equal(resource, remote);
      return command;
    } },
    editorService: { openEditor: async (...args) => { opened.push(args); } },
  };
  const operation = context.click.call(owner, { editorOptions: { preserveFocus: true, pinned: false } }, { resource: remote });
  await Promise.resolve();
  assert.equal(opened.length, 0);
  resolve(response);
  await operation;
  assert.equal(opened.length, 1);
  const [input, group] = opened[0];
  assert.ok(input.original.resource instanceof URI);
  assert.ok(input.modified.resource instanceof URI);
  assert.equal(input.modified.resource.path, remote.path);
  assert.equal(input.resource, undefined);
  assert.equal(group, 1);
});

test('unchanged files still open once as a normal source editor', async t => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  const context = { Kn: 2, cr: 1 };
  vm.runInNewContext(fs.readFileSync(f.entry, 'utf8'), context);
  const resource = { path: '/repo/unchanged.py' };
  const opened = [];
  await context.click.call({
    commandService: { executeCommand: async () => undefined },
    editorService: { openEditor: async (...args) => opened.push(args) },
  }, { editorOptions: {}, sideBySide: true }, { resource });
  assert.equal(opened.length, 1);
  assert.equal(opened[0][0].resource, resource);
  assert.equal(opened[0][1], 2);
});
