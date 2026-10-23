const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { host } = require('./mock-vscode.cjs');
const engine = require('../src/engine.cjs');
const binary = require('./binary.cjs');

async function indexFixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'swagger-index-test-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'App Aggregator'), file = path.join(directory, 'api.json');
  await fs.mkdir(directory);
  const spec = { openapi: '3.1.0', info: { title: 'Index API', version: '1' }, paths: {
    '/items': { get: { responses: { 200: { description: 'OK', content: {
      'application/json': { schema: { type: 'string' } }
    } } } } }
  } };
  await fs.writeFile(file, JSON.stringify(spec));
  const git = args => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
  git(['init', '-q']); git(['add', '.']);
  git(['-c', 'user.name=Test', '-c', 'user.email=test@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Initial API']);
  spec.paths['/items'].get.responses[200].content['application/json'].schema = { $ref: '../common-errors.json#/ErrorResponse' };
  await fs.writeFile(file, JSON.stringify(spec)); git(['add', '.']);
  const working = structuredClone(spec);
  working.paths['/items'].get.responses[200].content['application/json'].schema = { type: 'string' };
  await fs.writeFile(file, JSON.stringify(working));
  const app = host(2, new Map(), { 'swaggerLens.oasdiffPath': binary }, { engine });
  app.vscode.workspace.fs.readFile = async uri => {
    const { path: file, ref } = JSON.parse(uri.query);
    try { return git(['show', `${ref}:${path.relative(root, file).split(path.sep).join('/')}`]); }
    catch { const error = new Error(''); error.code = 'FileNotFound'; throw error; }
  };
  const index = app.uri(file).with({ scheme: 'git', query: JSON.stringify({ path: file, ref: '' }) });
  return { app, index, file, git };
}

test('an absent INDEX dependency displays its path and snapshot in Preview and Diffs', async t => {
  const { app, index } = await indexFixture(t);
  const panel = await app.openSource(index);
  for (const mode of ['preview', 'diff', 'preview']) {
    if (app.api.getPreview(index).mode !== mode) await app.api.setMode(index, mode);
    await panel.send({ type: 'ready' });
    const state = app.api.getPreview(index);
    assert.equal(state.busy, false);
    assert.equal(state.mode, mode);
    assert.match(state.error, /common-errors\.json/);
    assert.match(state.error, /INDEX/);
    assert.equal(panel.messages.filter(message => message.type === 'error').at(-1).error, state.error);
  }
});

test('a staged reference error recovers after the missing schema is staged', async t => {
  const { app, index, file, git } = await indexFixture(t);
  const panel = await app.openSource(index);
  await fs.writeFile(path.join(path.dirname(path.dirname(file)), 'common-errors.json'), JSON.stringify({
    ErrorResponse: { type: 'object', properties: { code: { type: 'string', enum: ['STAGED'] } } }
  }));
  git(['add', 'common-errors.json']);
  await panel.send({ type: 'refresh' });
  let state = app.api.getPreview(index);
  assert.equal(state.error, null);
  assert.equal(state.data.mode, 'preview');
  assert.deepEqual(state.data.spec.paths['/items'].get.responses[200].content['application/json'].schema.properties.code.enum, ['STAGED']);
  await app.api.setMode(index, 'diff');
  state = app.api.getPreview(index);
  assert.equal(state.error, null);
  assert.deepEqual(state.data.operations.map(operation => operation.path), ['/items']);
});

test('an empty provider error while reading the root document still displays a message', async () => {
  const app = host(2, new Map(), {}, { root: '/' });
  app.vscode.workspace.fs.readFile = async () => { throw new Error(''); };
  const index = app.uri('/api.json').with({ scheme: 'git', query: JSON.stringify({ path: '/api.json', ref: '' }) });
  const panel = await app.openSource(index);
  await panel.send({ type: 'ready' });
  assert.match(app.api.getPreview(index).error, /api\.json.*INDEX/);
  assert.ok(panel.messages.find(message => message.type === 'error')?.error);
});
