const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const YAML = require('yaml');
const { previewFile, loadSnapshot, compareLoaded, compareTwoFiles } = require('../src/engine.cjs');
const binary = require('./binary.cjs');
const spec = (version = '3.0.3') => ({ openapi: version, info: { title: 'Preview API', version: '1' }, paths: { '/current': { get: { responses: { 200: { description: 'OK' } } } } } });
async function folder(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swagger-preview-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('standalone YAML preview displays the complete current contract without Git or a diff engine', async t => {
  const root = await folder(t), file = path.join(root, 'standalone.yaml'), current = spec();
  current.paths['/unchanged'] = structuredClone(current.paths['/current']);
  await fs.writeFile(file, YAML.stringify(current));
  const result = await previewFile(file);
  assert.equal(result.mode, 'preview');
  assert.equal(result.diffAvailable, false);
  assert.equal(result.root, null);
  assert.deepEqual(result.spec, current);
  assert.deepEqual(result.dependencies, [file]);
});

test('preview tracks nested local dependencies outside a repository', async t => {
  const root = await folder(t), file = path.join(root, 'api.json');
  const models = path.join(root, 'models #1.yaml'), leaf = path.join(root, 'leaf.yaml');
  const current = spec('3.1.2');
  current.components = { schemas: { Root: { $ref: './models%20%231.yaml#/Root' } } };
  await fs.writeFile(file, JSON.stringify(current));
  await fs.writeFile(models, 'Root:\n  type: object\n  properties:\n    child:\n      $ref: ./leaf.yaml#/Child\n');
  await fs.writeFile(leaf, 'Child:\n  type: string\n  enum: [old, current]\n');
  const result = await previewFile(file);
  assert.deepEqual(result.dependencies.sort(), [file, models, leaf].sort());
  assert.deepEqual(result.spec.components.schemas.Root.properties.child.enum, ['old', 'current']);
});

test('a repository without HEAD still supports normal preview', async t => {
  const root = await folder(t), file = path.join(root, 'api.json');
  execFileSync('git', ['-C', root, 'init', '-q']);
  await fs.writeFile(file, JSON.stringify(spec()));
  const result = await previewFile(file);
  assert.equal(result.diffAvailable, true);
  assert.deepEqual(result.spec, spec());
});

test('turning diff off returns the real contract without restored deleted methods or properties', async t => {
  const root = await folder(t), oldFile = path.join(root, 'old.json'), newFile = path.join(root, 'new.json');
  const before = spec(), after = spec();
  before.paths['/deleted'] = structuredClone(before.paths['/current']);
  before.components = { schemas: { Item: { type: 'object', properties: { deleted: { type: 'string' }, kept: { type: 'integer' } } } } };
  after.components = { schemas: { Item: { type: 'object', properties: { kept: { type: 'integer' } } } } };
  await fs.writeFile(oldFile, JSON.stringify(before)); await fs.writeFile(newFile, JSON.stringify(after));
  const comparison = await compareTwoFiles(oldFile, newFile, binary);
  assert.equal(comparison.spec.paths['/deleted'].get['x-diff-status'], 'deleted');
  const preview = await previewFile(newFile);
  assert.deepEqual(preview.spec, after);
  assert.ok(!JSON.stringify(preview.spec).includes('x-diff-'));
});

test('OpenAPI 3.1 boolean schemas remain literal in normal preview', async t => {
  const root = await folder(t), file = path.join(root, 'api.yaml'), current = spec('3.1.1');
  current.components = { schemas: { Anything: true, Nothing: false } };
  await fs.writeFile(file, YAML.stringify(current));
  assert.deepEqual((await previewFile(file)).spec.components.schemas, { Anything: true, Nothing: false });
});

test('a comparison snapshot reads all refs through its own reader, preserving encoded paths and 3.1 ref siblings', async t => {
  const root = await folder(t), file = path.join(root, 'api.json'), model = path.join(root, 'model #1.yaml');
  await fs.writeFile(model, 'Item:\n  type: string\n  enum: [WORKING_TREE]\n');
  const current = spec('3.1.0');
  current.components = { schemas: { Item: { $ref: './model%20%231.yaml#/Item', maxLength: 9 } } };
  const reads = [];
  const result = await loadSnapshot(file, Buffer.from(JSON.stringify(current)), async requested => {
    reads.push(requested);
    assert.equal(requested, model);
    return Buffer.from('Item:\n  type: string\n  enum: [LEFT_VERSION]\n');
  });
  assert.deepEqual(reads, [model]);
  assert.ok(JSON.stringify(result.bundle).includes('LEFT_VERSION'));
  assert.ok(!JSON.stringify(result.bundle).includes('WORKING_TREE'));
  assert.equal(result.bundle.components.schemas.Item.maxLength, 9);
  await assert.rejects(loadSnapshot(file, JSON.stringify(current), async () => { throw new Error('Missing snapshot dependency'); }), /Missing snapshot dependency/);
});

test('empty sides in a VS Code comparison represent added or deleted APIs', async () => {
  const current = spec(), loaded = { bundle: current, expanded: current };
  const added = await compareLoaded(null, loaded, binary);
  assert.equal(added.baseMissing, true);
  assert.equal(added.operations[0].status, 'added');
  const deleted = await compareLoaded(loaded, null, binary);
  assert.equal(deleted.revisionMissing, true);
  assert.equal(deleted.operations[0].status, 'deleted');
});
