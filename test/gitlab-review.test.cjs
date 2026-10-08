const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { host } = require('./mock-vscode.cjs');
const { reviewFixture } = require('./gitlab-review-fixture.cjs');
const engine = require('../src/engine.cjs');
const { fileUri, snapshotDependencyUri } = require('../src/editor-context.cjs');
const binary = require('./binary.cjs');
const root = path.resolve('test/fixtures');
const leaf = data => data.spec.paths['/items'].get.responses['200'].content['application/json'].schema.properties.status;
const previewLeaf = data => data.spec.components.schemas.Envelope.properties.status;

function appForReview(options = {}) {
  const app = host(2, new Map(), { 'swaggerLens.oasdiffPath': binary }, { engine: { ...engine, findGitRoot: async () => null, ...options } });
  const fixture = reviewFixture(app.vscode, root);
  app.vscode.workspace.fs.readFile = async uri => {
    assert.equal(uri.scheme, 'gl-review', 'MR content must not come from working files');
    return fixture.readFile(uri);
  };
  return { app, fixture };
}

test('GitLab MR comparison uses each commit and its referenced schemas without local Git', async () => {
  const { app, fixture } = appForReview();
  await app.openSource(fixture.right, fixture.left);
  const state = app.api.getPreview(fixture.right);
  assert.equal(state.error, null);
  assert.equal(state.mode, 'diff');
  assert.equal(state.data.diffAvailable, true);
  assert.equal(state.data.canSelectBase, false);
  assert.equal(state.data.comparisonSource, 'editor');
  assert.equal(state.data.baseRef, 'GitLab 11111111');
  assert.deepEqual(leaf(state.data)['x-diff-original'].enum, ['before']);
  assert.deepEqual(leaf(state.data).enum, ['after']);
  for (const commit of [fixture.baseCommit, fixture.headCommit]) {
    assert.deepEqual(fixture.reads.filter(read => read.commit === commit).map(read => read.path).sort(), [
      commit === fixture.baseCommit ? fixture.left.path : fixture.right.path, '/shared/models.yaml', '/shared/status.json'
    ].sort());
  }
  assert.ok(fixture.reads.every(read => read.repositoryRoot === root && read.projectId === 17 && read.mrId === 42 && read.exists === '1'));
  await app.api.setBase(fixture.right, 'HEAD');
  assert.equal(app.api.getPreview(fixture.right).data.comparisonSource, 'editor');
});

test('switching GitLab Diffs to Preview shows the right snapshot and preserves the original comparison', async () => {
  const { app, fixture } = appForReview();
  await app.openSource(fixture.right, fixture.left);
  fixture.reads.length = 0;
  await app.api.setMode(fixture.right, 'preview');
  assert.deepEqual(previewLeaf(app.api.getPreview(fixture.right).data).enum, ['after']);
  assert.ok(fixture.reads.every(read => read.commit === fixture.headCommit));
  assert.doesNotMatch(JSON.stringify(app.api.getPreview(fixture.right).data.spec), /x-diff-/);
  await app.api.setMode(fixture.right, 'diff');
  assert.deepEqual(leaf(app.api.getPreview(fixture.right).data)['x-diff-original'].enum, ['before']);
});

test('a standalone GitLab review editor defaults to Preview with commit-specific YAML dependencies', async () => {
  const { app, fixture } = appForReview();
  await app.openSource(fixture.left);
  const state = app.api.getPreview(fixture.left);
  assert.equal(state.error, null);
  assert.equal(state.mode, 'preview');
  assert.equal(state.data.diffAvailable, false);
  assert.deepEqual(previewLeaf(state.data).enum, ['before']);
});

for (const change of ['added', 'deleted']) test(`GitLab ${change} files compare with the provider's empty side`, async () => {
  const { app, fixture } = appForReview();
  const left = change === 'added' ? fixture.uri(fixture.right.path, fixture.baseCommit, false, change) : fixture.left;
  const right = change === 'deleted' ? fixture.uri(fixture.left.path, fixture.headCommit, false, change) : fixture.right;
  await app.openSource(right, left);
  const state = app.api.getPreview(right);
  assert.equal(state.error, null);
  assert.equal(state.data.baseMissing, change === 'added');
  assert.equal(state.data.revisionMissing, change === 'deleted');
  assert.equal(state.data.operations.length, 1);
  assert.equal(state.data.spec.paths['/items'].get['x-diff-status'], change);
});

test('closing the last GitLab source tab closes its preview while a duplicate comparison keeps it open', async () => {
  const { app, fixture } = appForReview();
  const panel = await app.openSource(fixture.right, fixture.left);
  const first = app.vscode.window.tabGroups.all[0].tabs[0];
  const duplicate = app.addTab(fixture.right, { tabs: [], viewColumn: 3 }, fixture.left);
  app.closeTab(first); await app.flush();
  assert.equal(panel.disposed, false);
  app.closeTab(duplicate); await app.flush();
  assert.equal(panel.disposed, true);
});

test('GitLab URI mapping handles renamed paths with spaces and rejects paths outside the snapshot repository', () => {
  const { app, fixture } = appForReview();
  assert.equal(fileUri(app.vscode, fixture.left).fsPath, path.join(root, 'legacy/core api.yaml'));
  assert.equal(fileUri(app.vscode, fixture.right).fsPath, path.join(root, 'services/core api.json'));
  assert.throws(() => fileUri(app.vscode, fixture.right.with({ path: '/../outside.json' })), /inside its repository/);
  assert.throws(() => snapshotDependencyUri(app.vscode, fixture.right, path.join(root, '../outside.json')), /inside its repository/);
  assert.throws(() => fileUri(app.vscode, fixture.right.with({ query: '{}' })), /Invalid GitLab/);
});

test('a manually selected Git base compares against the MR snapshot rather than the working file', async () => {
  const requests = [];
  const { app, fixture } = appForReview({
    findGitRoot: async file => { assert.equal(path.dirname(file), root); return root; },
    loadRevision: async (repository, ref, relative) => {
      requests.push({ repository, ref, relative });
      return engine.loadSnapshot(path.join(root, 'legacy/core api.yaml'), fixture.readFile(fixture.left),
        file => fixture.readFile(snapshotDependencyUri(app.vscode, fixture.left, file)));
    }
  });
  await app.openSource(fixture.right, fixture.left);
  await app.api.setBase(fixture.right, 'HEAD~1');
  const state = app.api.getPreview(fixture.right);
  assert.deepEqual(requests, [{ repository: root, ref: 'HEAD~1', relative: 'services/core api.json' }]);
  assert.equal(state.data.comparisonSource, 'git');
  assert.deepEqual(leaf(state.data).enum, ['after']);
});

test('the editor preview button covers GitLab JSON and YAML review files', () => {
  const entry = require('../package.json').contributes.menus['editor/title'].find(item => item.command === 'swaggerLens.open');
  const patterns = [...entry.when.matchAll(/=~ \/([^/]+)\//g)].map(match => new RegExp(match[1]));
  for (const scheme of ['file', 'git', 'gl-review']) assert.ok(patterns[0].test(scheme));
  for (const ext of ['.json', '.yaml', '.yml']) assert.ok(patterns[1].test(ext));
  assert.equal(patterns[0].test('https'), false);
  assert.equal(patterns[1].test('.txt'), false);
});
