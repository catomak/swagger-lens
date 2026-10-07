const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { compareTwoFiles, compareFile } = require('../src/engine.cjs');
const binary = require('./binary.cjs');
const clone = value => structuredClone(value);

function fixture() {
  const schemas = {};
  for (let i = 1; i < 5; i++) schemas[`Level${i}`] = { type: 'object', properties: { [`level${i + 1}`]: { $ref: `#/components/schemas/Level${i + 1}` } } };
  schemas.Level5 = { type: 'object', properties: { status: { type: 'string', enum: ['draft', 'active'] }, oldField: { type: 'string' } } };
  const response = { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Level1' } } } };
  return { openapi: '3.0.3', info: { title: 'Test API', version: '1.0.0' }, paths: { '/applications': { get: { responses: { 200: response } } }, '/applications/{id}': { get: { parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: response } } }, '/unrelated': { get: { responses: { 200: { description: 'unchanged' } } } } }, components: { schemas } };
}
function leaf(spec, route = '/applications') {
  let schema = spec.paths[route].get.responses['200'].content['application/json'].schema;
  for (let i = 2; i <= 5; i++) schema = schema.properties[`level${i}`];
  return schema;
}
async function pair(t, base, revision) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'api-diff-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const oldFile = path.join(root, 'old.json'), newFile = path.join(root, 'new.json');
  await fs.writeFile(oldFile, JSON.stringify(base)); await fs.writeFile(newFile, JSON.stringify(revision));
  return compareTwoFiles(oldFile, newFile, binary);
}

test('one deeply referenced enum change highlights both methods and preserves the nested models', async t => {
  const oldSpec = fixture(), newSpec = clone(oldSpec);
  newSpec.components.schemas.Level5.properties.status.enum.push('closed');
  const result = await pair(t, oldSpec, newSpec);
  assert.deepEqual(result.operations.map(op => op.path).sort(), ['/applications', '/applications/{id}']);
  for (const op of result.operations) {
    assert.equal(result.spec.paths[op.path].get['x-diff-status'], 'updated');
    assert.deepEqual(leaf(result.spec, op.path).properties.status['x-diff-details'], [{ key: 'enum', before: ['draft', 'active'], after: ['draft', 'active', 'closed'] }]);
    assert.ok(op.changes.some(change => change.id === 'response-property-enum-value-added'));
  }
  assert.equal(result.spec.paths['/unrelated'].get['x-diff-status'], undefined);
  assert.deepEqual(oldSpec, fixture(), 'input specs must remain unmodified');
});

test('generated change descriptions are English while contract descriptions and examples retain their language', async t => {
  const before = fixture();
  const contractText = '\u041F\u0440\u0438\u043C\u0435\u0440';
  before.info.description = contractText;
  before.components.schemas.Level5.properties.oldField.description = contractText;
  before.components.schemas.Level5.properties.oldField.example = contractText;
  const after = clone(before);
  after.components.schemas.Level5.properties.status.enum.push('closed');
  after.paths['/new'] = { post: { responses: { 204: { description: 'Accepted' } } } };
  const result = await pair(t, before, after);
  const descriptions = result.changelog.map(change => [change.text, change.comment].filter(Boolean).join(' ')).join('\n');
  assert.match(descriptions, /added the new `closed` enum value/);
  assert.match(descriptions, /endpoint added/);
  assert.doesNotMatch(descriptions, /[\u0400-\u04ff]/);
  assert.equal(result.spec.info.description, contractText);
  assert.equal(leaf(result.spec).properties.oldField.description, contractText);
  assert.equal(leaf(result.spec).properties.oldField.example, contractText);
  assert.ok(result.operations.find(op => op.path === '/new').changes.some(change => change.text === 'endpoint added'));
});

test('removed and added fields remain visible with their respective diff status', async t => {
  const oldSpec = fixture(), newSpec = clone(oldSpec);
  delete newSpec.components.schemas.Level5.properties.oldField;
  newSpec.components.schemas.Level5.properties.newField = { type: 'integer' };
  const result = await pair(t, oldSpec, newSpec);
  assert.equal(leaf(result.spec).properties.oldField['x-diff-status'], 'deleted');
  assert.equal(leaf(result.spec).properties.newField['x-diff-status'], 'added');
});

test('removed methods and response codes are restored only in the review document', async t => {
  const oldSpec = fixture(), newSpec = clone(oldSpec);
  delete newSpec.paths['/applications/{id}'];
  newSpec.paths['/applications'].get.responses['201'] = newSpec.paths['/applications'].get.responses['200'];
  delete newSpec.paths['/applications'].get.responses['200'];
  newSpec.paths['/new'] = { post: { responses: { 204: { description: 'Created' } } } };
  const result = await pair(t, oldSpec, newSpec);
  assert.equal(result.spec.paths['/applications/{id}'].get['x-diff-status'], 'deleted');
  assert.equal(result.spec.paths['/new'].post['x-diff-status'], 'added');
  assert.equal(result.spec.paths['/applications'].get.responses['200']['x-diff-status'], 'deleted');
  assert.equal(result.spec.paths['/applications'].get.responses['201']['x-diff-status'], 'added');
});

test('making a nested request property required highlights that property', async t => {
  const oldSpec = fixture();
  oldSpec.paths['/applications'].post = { requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Level5' } } } }, responses: { 204: { description: 'OK' } } };
  const newSpec = clone(oldSpec); newSpec.components.schemas.Level5.required = ['status'];
  const result = await pair(t, oldSpec, newSpec);
  const property = result.spec.paths['/applications'].post.requestBody.content['application/json'].schema.properties.status;
  assert.ok(property['x-diff-details'].some(detail => detail.key === 'required' && detail.before === false && detail.after === true));
});

test('unchanged specs do not create fake changed methods', async t => {
  const spec = fixture(), result = await pair(t, spec, clone(spec));
  assert.equal(result.operations.length, 0);
  assert.equal(result.changelog.length, 0);
});

test('Git baseline resolves split-file references from the same revision, not the working tree', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'api-diff-git-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const git = args => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
  git(['init', '-q']);
  const spec = fixture();
  const schemas = spec.components.schemas; spec.components = { schemas: { Level1: { $ref: './models.json#/Level1' } } };
  for (const schema of Object.values(schemas)) for (const property of Object.values(schema.properties || {})) if (property.$ref) property.$ref = property.$ref.replace('#/components/schemas/', '#/');
  await fs.writeFile(path.join(root, 'openapi.json'), JSON.stringify(spec));
  await fs.writeFile(path.join(root, 'models.json'), JSON.stringify(schemas));
  git(['add', '.']); git(['-c', 'user.name=API Diff Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Test fixture baseline']);
  schemas.Level5.properties.status.enum.push('closed');
  await fs.writeFile(path.join(root, 'models.json'), JSON.stringify(schemas));
  const result = await compareFile(path.join(root, 'openapi.json'), 'HEAD', binary);
  assert.equal(result.operations.length, 2);
  assert.deepEqual(leaf(result.spec).properties.status['x-diff-original'].enum, ['draft', 'active']);
  assert.deepEqual(leaf(result.spec).properties.status.enum, ['draft', 'active', 'closed']);
});

test('recursive schemas can be compared and serialized without an infinite loop', async t => {
  const oldSpec = fixture();
  oldSpec.components.schemas.Level5.properties.child = { $ref: '#/components/schemas/Level5' };
  const newSpec = clone(oldSpec); newSpec.components.schemas.Level5.properties.status.type = 'integer';
  delete newSpec.components.schemas.Level5.properties.status.enum;
  const result = await pair(t, oldSpec, newSpec);
  assert.equal(result.operations.length, 2);
  assert.doesNotThrow(() => JSON.stringify(result));
});

async function repository(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'api-diff-new-file-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const git = args => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' }).toString();
  git(['init', '-q']);
  await fs.writeFile(path.join(root, 'README.md'), 'Fixture repository\n');
  git(['add', 'README.md']);
  const commit = () => git(['-c', 'user.name=API Diff Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Test fixture baseline']);
  commit();
  return { root, git, commit };
}

test('a staged new contract absent from HEAD shows all methods as added without changing Git', async t => {
  const { root, git, commit } = await repository(t);
  const relativePath = 'Core [Storage]/core storage api.json';
  const file = path.join(root, relativePath);
  await fs.mkdir(path.dirname(file));
  await fs.writeFile(file, JSON.stringify(fixture()));
  git(['add', '--', relativePath]);
  const before = git(['status', '--porcelain']);
  const result = await compareFile(file, 'HEAD', binary);
  assert.equal(result.baseMissing, true);
  assert.equal(result.baseRef, 'HEAD');
  assert.equal(result.operations.length, 3);
  assert.ok(result.operations.every(op => op.status === 'added'));
  assert.equal(result.spec.paths['/applications'].get['x-diff-status'], 'added');
  assert.equal(git(['status', '--porcelain']), before);
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), fixture());
  commit();
  const committed = await compareFile(file, 'HEAD', binary);
  assert.equal(committed.baseMissing, false);
  assert.equal(committed.operations.length, 0, 'After committing, the same literal path has a real baseline');
});

test('an untracked new YAML contract resolves its local references and shows added methods', async t => {
  const { root } = await repository(t);
  const file = path.join(root, 'openapi.yaml');
  const spec = fixture();
  await fs.writeFile(path.join(root, 'models.json'), JSON.stringify({ Level5: spec.components.schemas.Level5 }));
  spec.components.schemas.Level5 = { $ref: './models.json#/Level5' };
  await fs.writeFile(file, require('yaml').stringify(spec));
  const result = await compareFile(file, 'HEAD', binary);
  assert.equal(result.baseMissing, true);
  assert.equal(result.operations.length, 3);
  assert.ok(result.operations.every(op => op.status === 'added'));
  assert.deepEqual(leaf(result.spec).properties.status.enum, ['draft', 'active']);
});

test('an invalid revision and a missing committed dependency remain errors, not new contracts', async t => {
  const { root, git, commit } = await repository(t);
  const file = path.join(root, 'openapi.json');
  const spec = fixture();
  await fs.writeFile(path.join(root, 'models.json'), JSON.stringify({ Level5: spec.components.schemas.Level5 }));
  spec.components.schemas.Level5 = { $ref: './models.json#/Level5' };
  await fs.writeFile(file, JSON.stringify(spec));
  await assert.rejects(compareFile(file, 'missing-baseline', binary), /missing-baseline/);
  git(['add', 'openapi.json']);
  commit();
  await assert.rejects(compareFile(file, 'HEAD', binary), /models\.json/);
});
