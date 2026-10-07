const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const YAML = require('yaml');
const { compareTwoFiles, compareFile, loadWorking } = require('../src/engine.cjs');
const binary = require('./binary.cjs');

function fixture(version = '3.1.2') {
  const response = { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Envelope' } } } };
  return {
    openapi: version, info: { title: 'OpenAPI 3.1 fixture', version: '1.0.0' },
    paths: {
      '/records': { get: { responses: { 200: response } } },
      '/records/{id}': { get: { parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: response } } },
      '/unchanged': { get: { responses: { 204: { description: 'OK' } } } }
    },
    components: { schemas: {
      Envelope: { type: 'object', properties: { payload: { $ref: '#/components/schemas/Payload' } } },
      Payload: { type: 'object', properties: {
        state: { type: ['string', 'null'], const: 'draft' },
        amount: { type: 'number', exclusiveMinimum: 0 },
        free: true, forbidden: false
      } }
    } }
  };
}

const payload = result => result.spec.paths['/records'].get.responses[200].content['application/json'].schema.properties.payload;
const change = (schema, key) => schema['x-diff-details'].find(detail => detail.key === key);
async function directory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'api-diff-31-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
async function pair(t, before, after) {
  const root = await directory(t), oldFile = path.join(root, 'old.json'), newFile = path.join(root, 'new.json');
  await fs.writeFile(oldFile, JSON.stringify(before)); await fs.writeFile(newFile, JSON.stringify(after));
  return compareTwoFiles(oldFile, newFile, binary);
}

for (const version of ['3.1.0', '3.1.1', '3.1.2']) test(`${version}: nullable types, const and numeric exclusive bounds affect both referenced endpoints`, async t => {
  const before = fixture(version), after = structuredClone(before);
  after.components.schemas.Payload.properties.state = { type: 'string', const: 'active' };
  after.components.schemas.Payload.properties.amount.exclusiveMinimum = 10;
  const result = await pair(t, before, after);
  assert.deepEqual(result.operations.map(op => op.path).sort(), ['/records', '/records/{id}']);
  assert.deepEqual(change(payload(result).properties.state, 'type'), { key: 'type', before: ['string', 'null'], after: 'string' });
  assert.deepEqual(change(payload(result).properties.state, 'const'), { key: 'const', before: 'draft', after: 'active' });
  assert.deepEqual(change(payload(result).properties.amount, 'exclusiveMinimum'), { key: 'exclusiveMinimum', before: 0, after: 10 });
  assert.equal(result.spec.paths['/unchanged'].get['x-diff-status'], undefined);
  assert.deepEqual(before, fixture(version));
});

test('JSON Schema conditional branches, tuple items and pattern schemas receive nested diff details', async t => {
  const before = fixture();
  before.components.schemas.Payload.if = { properties: { state: { const: 'draft' } } };
  before.components.schemas.Payload.then = { properties: { amount: { type: 'number', minimum: 1 } } };
  before.components.schemas.Payload.patternProperties = { '^extra': { type: 'integer', minimum: 0 } };
  before.components.schemas.Payload.properties.tuple = { type: 'array', prefixItems: [{ type: 'integer', minimum: 0 }], items: false };
  const after = structuredClone(before);
  after.components.schemas.Payload.if.properties.state.const = 'active';
  after.components.schemas.Payload.then.properties.amount.minimum = 5;
  after.components.schemas.Payload.patternProperties['^extra'].minimum = 2;
  after.components.schemas.Payload.properties.tuple.prefixItems[0].minimum = 3;
  const result = await pair(t, before, after), schema = payload(result);
  assert.equal(result.operations.length, 2);
  assert.equal(change(schema.if.properties.state, 'const').after, 'active');
  assert.equal(change(schema.then.properties.amount, 'minimum').after, 5);
  assert.equal(change(schema.patternProperties['^extra'], 'minimum').after, 2);
  assert.equal(change(schema.properties.tuple.prefixItems[0], 'minimum').after, 3);
  assert.equal(schema.properties.tuple.items, false);
});

test('boolean properties can change, be added or deleted, and become required without losing false', async t => {
  const before = fixture(), after = structuredClone(before);
  after.components.schemas.Payload.properties.free = false;
  delete after.components.schemas.Payload.properties.forbidden;
  after.components.schemas.Payload.properties.newForbidden = false;
  after.components.schemas.Payload.required = ['free'];
  const result = await pair(t, before, after), properties = payload(result).properties;
  assert.equal(result.operations.length, 2);
  assert.deepEqual(properties.free.not, {});
  assert.deepEqual(change(properties.free, 'schema'), { key: 'schema', before: true, after: false });
  assert.deepEqual(change(properties.free, 'required'), { key: 'required', before: false, after: true });
  assert.equal(properties.forbidden['x-diff-status'], 'deleted');
  assert.deepEqual(properties.forbidden.not, {});
  assert.equal(properties.newForbidden['x-diff-status'], 'added');
  assert.deepEqual(properties.newForbidden.not, {});
});

test('a false media schema changing to true is annotated instead of being skipped', async t => {
  const before = fixture(); before.paths['/records'].get.responses[200].content['application/json'].schema = false;
  const after = structuredClone(before); after.paths['/records'].get.responses[200].content['application/json'].schema = true;
  const result = await pair(t, before, after);
  assert.deepEqual(result.operations.map(op => op.path).sort(), ['/records', '/records/{id}']);
  const schema = result.spec.paths['/records'].get.responses[200].content['application/json'].schema;
  assert.deepEqual(change(schema, 'schema'), { key: 'schema', before: false, after: true });
  assert.equal(Object.hasOwn(schema, 'not'), false);
});

test('static schema references with sibling constraints preserve both sets of constraints', async t => {
  const before = fixture();
  before.components.schemas.Bound = { type: 'number', minimum: 10 };
  before.components.schemas.Payload.properties.amount = { $ref: '#/components/schemas/Bound', minimum: 2 };
  const after = structuredClone(before); after.components.schemas.Payload.properties.amount.minimum = 3;
  const result = await pair(t, before, after), amount = payload(result).properties.amount;
  assert.equal(result.operations.length, 2);
  assert.equal(amount.minimum, 3);
  assert.equal(amount.allOf[0].minimum, 10, 'A sibling must not override its reference target');
  assert.deepEqual(change(amount, 'minimum'), { key: 'minimum', before: 2, after: 3 });
});

test('3.1 YAML and external schema references use committed versions and preserve external ref siblings', async t => {
  const root = await directory(t), file = path.join(root, 'openapi.yaml');
  const git = args => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
  git(['init', '-q']);
  const spec = fixture();
  spec.components.schemas.Payload.properties.amount = { $ref: './models.json#/Bounded', maximum: 100 };
  const model = { Base: { type: 'number', minimum: 10 }, Bounded: { $ref: '#/Base', minimum: 2 } };
  await fs.writeFile(file, YAML.stringify(spec));
  await fs.writeFile(path.join(root, 'models.json'), JSON.stringify(model));
  git(['add', '.']); git(['-c', 'user.name=API Diff Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', '3.1 baseline']);
  model.Bounded.minimum = 3;
  await fs.writeFile(path.join(root, 'models.json'), JSON.stringify(model));
  const result = await compareFile(file, 'HEAD', binary), amount = payload(result).properties.amount;
  assert.equal(result.operations.length, 2);
  assert.equal(result.baseMissing, false);
  assert.equal(amount.maximum, 100);
  assert.deepEqual(change(amount.allOf[0], 'minimum'), { key: 'minimum', before: 2, after: 3 });
  assert.equal(amount.allOf[0].allOf[0].minimum, 10);
});

test('webhook-only contracts show changed, added and removed webhook operations', async t => {
  const before = fixture();
  before.webhooks = { created: { post: { requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Payload' } } } }, responses: { 204: { description: 'OK' } } } }, removed: { post: { responses: { 204: { description: 'OK' } } } } };
  delete before.paths;
  const after = structuredClone(before);
  after.components.schemas.Payload.properties.state.const = 'active';
  delete after.webhooks.removed;
  after.webhooks.added = { post: { responses: { 204: { description: 'OK' } } } };
  const result = await pair(t, before, after);
  assert.deepEqual(result.operations.map(op => [op.scope, op.path, op.status]).sort(), [['webhooks', 'added', 'added'], ['webhooks', 'created', 'updated'], ['webhooks', 'removed', 'deleted']]);
  assert.deepEqual(result.spec.paths, {});
  assert.ok(result.operations.find(op => op.path === 'created').changes.some(c => c.id === 'request-property-const-changed'));
  assert.equal(result.spec.webhooks.removed.post['x-diff-status'], 'deleted');
});

test('a webhook name equal to an endpoint path remains a separate operation', async t => {
  const before = fixture();
  before.webhooks = { '/records': { get: { responses: { 200: { description: 'Before' } } } } };
  const after = structuredClone(before); after.webhooks['/records'].get.responses[200].description = 'After';
  const result = await pair(t, before, after);
  assert.equal(result.operations.length, 1);
  assert.equal(result.operations[0].scope, 'webhooks');
  assert.equal(result.spec.paths['/records'].get['x-diff-status'], undefined);
  assert.equal(result.spec.webhooks['/records'].get['x-diff-status'], 'updated');
});

test('3.1 components-only documents load, and unsupported dynamic references produce a visible warning', async t => {
  const before = fixture(); delete before.paths;
  before.components.schemas.Dynamic = { $dynamicAnchor: 'node', type: 'object', properties: { child: { $dynamicRef: '#node' } } };
  before.components.pathItems = { Shared: { get: { responses: { 204: { description: 'OK' } } } } };
  const result = await pair(t, before, structuredClone(before));
  assert.equal(result.operations.length, 0);
  assert.ok(result.warnings.some(w => w.includes('$dynamicRef')));
  assert.ok(result.warnings.some(w => w.includes('components.pathItems')));
});

test('3.2 remains explicitly unsupported, and example payloads are not rewritten as schema references', async t => {
  const root = await directory(t), file = path.join(root, 'api.json');
  const spec = fixture(); spec.components.schemas.Payload.examples = [{ $ref: '#/example-data', type: 'customer payload' }];
  await fs.writeFile(file, JSON.stringify(spec));
  const loaded = await loadWorking(file);
  assert.deepEqual(loaded.expanded.components.schemas.Payload.examples, spec.components.schemas.Payload.examples);
  spec.openapi = '3.2.0'; await fs.writeFile(file, JSON.stringify(spec));
  await assert.rejects(loadWorking(file), /supports OpenAPI 3\.0\.x and 3\.1\.x/);
});
