const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { host } = require('./mock-vscode.cjs');
const { githubFixture } = require('./github-review-fixture.cjs');
const { fileUri } = require('../src/editor-context.cjs');
const engine = require('../src/engine.cjs');
const binary = require('./binary.cjs');
const root = path.resolve('test/fixtures');
const leaf = data => data.spec.paths['/items'].get.responses['200'].content['application/json'].schema.properties.status;
function setup(options) {
  const app = host(2, new Map(), { 'swaggerLens.oasdiffPath': binary }, { engine: { ...engine, findGitRoot: async () => null } });
  const fixture = githubFixture(app.vscode, root, options);
  app.vscode.extensions = { getExtension: id => id === 'vscode.git' ? { activate: async () => {}, exports: { getAPI: () => ({ getRepository: () => fixture.repository }) } } : undefined };
  app.vscode.workspace.fs.readFile = async uri => fixture.readFile(uri);
  return { app, fixture };
}

for (const local of [true, false]) test(`GitHub PR comparison resolves unchanged refs from each ${local ? 'local' : 'remote'} commit`, async () => {
  const { app, fixture } = setup({ local });
  await app.openSource(fixture.right, fixture.left);
  const state = app.api.getPreview(fixture.right);
  assert.equal(state.error, null); assert.equal(state.mode, 'diff');
  assert.equal(state.data.baseRef, 'GitHub 11111111');
  assert.equal(state.data.diffAvailable, true); assert.equal(state.data.canSelectBase, false);
  assert.deepEqual(leaf(state.data)['x-diff-original'].enum, ['before']);
  assert.deepEqual(leaf(state.data).enum, ['after']);
  assert.equal(fixture.gitReads.length, 4);
  assert.equal(fixture.reads.filter(read => read.scheme === 'githubcommit').length, local ? 0 : 4);
  assert.ok(!fixture.reads.some(read => read.path.endsWith('missing.json')));
  for (const commit of [fixture.baseCommit, fixture.headCommit]) assert.deepEqual(fixture.gitReads.filter(read => read.commit === commit).map(read => path.relative(root, read.file).split(path.sep).join('/')).sort(), ['shared/models.yaml', 'shared/status.json']);
});

test('GitHub PR Preview shows its head snapshot and switching back retains the left version', async () => {
  const { app, fixture } = setup();
  await app.openSource(fixture.right, fixture.left);
  await app.api.setMode(fixture.right, 'preview');
  assert.deepEqual(app.api.getPreview(fixture.right).data.spec.components.schemas.Envelope.properties.status.enum, ['after']);
  assert.doesNotMatch(JSON.stringify(app.api.getPreview(fixture.right).data.spec), /x-diff-/);
  await app.api.setMode(fixture.right, 'diff');
  assert.deepEqual(leaf(app.api.getPreview(fixture.right).data)['x-diff-original'].enum, ['before']);
});

test('GitHub review and outdated .git URI suffixes use query paths and the recorded commit', async () => {
  const { app, fixture } = setup();
  const uri = fixture.reviewUri(fixture.basePath, fixture.baseCommit, '.git');
  await app.openSource(uri);
  const state = app.api.getPreview(uri);
  assert.equal(state.error, null); assert.equal(state.mode, 'preview');
  assert.equal(fileUri(app.vscode, uri).fsPath, path.join(root, fixture.basePath));
  assert.deepEqual(state.data.spec.components.schemas.Envelope.properties.status.enum, ['before']);
});

for (const [change, status] of [['added', 0], ['deleted', 2]]) test(`GitHub ${change} PR files preserve the empty side`, async () => {
  const { app, fixture } = setup();
  const left = fixture.prUri(true, status), right = fixture.prUri(false, status);
  await app.openSource(right, left);
  const state = app.api.getPreview(right);
  assert.equal(state.error, null);
  assert.equal(state.data.baseMissing, status === 0); assert.equal(state.data.revisionMissing, status === 2);
  assert.equal(state.data.spec.paths['/items'].get['x-diff-status'], change);
});

test('closing GitHub source tabs follows auto closure and preserves a duplicate editor', async () => {
  const { app, fixture } = setup();
  const panel = await app.openSource(fixture.right, fixture.left), first = app.vscode.window.tabGroups.all[0].tabs[0];
  const second = app.addTab(fixture.right, { tabs: [], viewColumn: 3 }, fixture.left);
  app.closeTab(first); await app.flush(); assert.equal(panel.disposed, false);
  app.closeTab(second); await app.flush(); assert.equal(panel.disposed, true);
});

for (const remoteUrl of ['https://github.com/catomak/swagger-lens.git', 'ssh://git@github.example.com:2222/catomak/swagger-lens.git']) test(`GitHub references resolve repository metadata from ${remoteUrl}`, async () => {
  const { app, fixture } = setup({ remoteUrl });
  await app.openSource(fixture.right);
  assert.equal(app.api.getPreview(fixture.right).error, null);
  assert.ok(fixture.reads.some(read => read.scheme === 'githubcommit' && read.owner === 'catomak' && read.repo === 'swagger-lens'));
});

test('missing GitHub schema references surface an error rather than reading working files', async () => {
  const { app, fixture } = setup();
  fixture.documents.delete(`${fixture.headCommit}:/shared/status.json`);
  await app.openSource(fixture.right);
  assert.match(app.api.getPreview(fixture.right).error, /Missing GitHub file/);
});

test('GitHub URI mapping rejects inconsistent repository paths and enables JSON/YAML preview menus', () => {
  const { app, fixture } = setup();
  assert.throws(() => fileUri(app.vscode, fixture.right.with({ query: JSON.stringify({ fileName: '../outside.json' }) })), /Invalid GitHub/);
  const entry = require('../package.json').contributes.menus['editor/title'][0];
  const patterns = [...entry.when.matchAll(/=~ \/([^/]+)\//g)].map(match => new RegExp(match[1]));
  assert.ok(patterns[0].test('pr')); assert.ok(patterns[0].test('review'));
  assert.ok(patterns[2].test('api.yaml.git')); assert.ok(patterns[2].test('api.json.git'));
});
