const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const YAML = require('yaml');
const { compareTwoFiles, loadWorking, previewLoaded } = require('../src/engine.cjs');
const fixtures = path.resolve('test/fixtures'), binary = require('./binary.cjs');
const operationKeys = result => result.operations.map(op => `${op.scope}:${op.method}:${op.path}:${op.status}`).sort();
const record = schema => schema.properties.payload.properties.meta.properties.details.properties.record;
const detail = (schema, key) => schema['x-diff-details']?.find(item => item.key === key);

test('the permanent OpenAPI 3.0 YAML pair shows all four affected operations', async () => {
  const before = path.join(fixtures, 'yaml/old.yaml'), after = path.join(fixtures, 'yaml/new.yaml');
  const result = await compareTwoFiles(before, after, binary);
  assert.deepEqual(operationKeys(result), [
    'paths:get:/applications/{id}:updated', 'paths:get:/applications:updated',
    'paths:get:/legacy/status:deleted', 'paths:post:/applications/recheck:added'
  ].sort());
  let leaf = result.spec.paths['/applications'].get.responses['200'].content['application/json'].schema;
  for (let index = 2; index <= 5; index++) leaf = leaf.properties[`level${index}`];
  assert.deepEqual(detail(leaf.properties.status, 'enum'), { key: 'enum', before: ['draft', 'active'], after: ['draft', 'active', 'closed'] });
  assert.equal(leaf.properties.legacyCode['x-diff-status'], 'deleted');
  assert.equal(leaf.properties.reason['x-diff-status'], 'added');
  assert.equal(result.spec.paths['/health'].get['x-diff-status'], undefined);
  const loaded = await loadWorking(after);
  assert.equal(loaded.bundle.openapi, '3.0.3');
  assert.equal(loaded.expanded.paths['/legacy/status'], undefined);
});

async function versionPair(t, format, version) {
  const directory = path.join(fixtures, 'openapi31', format);
  if (version === '3.1.2') return format === 'json'
    ? [path.join(directory, 'old.json'), path.join(directory, 'new.json')]
    : ['old', 'new'].map(side => path.join(directory, side, 'openapi.yaml'));
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'api-diff-fixture-version-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  await fs.cp(directory, temp, { recursive: true });
  const files = format === 'json' ? ['old.json', 'new.json'] : ['old/openapi.yaml', 'new/openapi.yaml'];
  for (const name of files) {
    const file = path.join(temp, name), parsed = YAML.parse(await fs.readFile(file, 'utf8'));
    parsed.openapi = version;
    await fs.writeFile(file, format === 'json' ? JSON.stringify(parsed) : YAML.stringify(parsed));
  }
  return files.map(file => path.join(temp, file));
}

for (const format of ['json', 'yaml']) for (const version of ['3.1.0', '3.1.1', '3.1.2']) {
  test(`permanent ${format.toUpperCase()} fixtures support ${version} nested constraints and webhooks`, async t => {
    const [before, after] = await versionPair(t, format, version);
    const result = await compareTwoFiles(before, after, binary);
    assert.deepEqual(operationKeys(result), [
      'paths:get:/records:updated', 'paths:post:/records:updated', 'paths:get:/records/{id}:updated',
      'paths:get:/legacy/status:deleted', 'paths:post:/records/recheck:added',
      'webhooks:post:record.changed:updated'
    ].sort());
    const leaves = [
      record(result.spec.paths['/records'].get.responses['200'].content['application/json'].schema),
      record(result.spec.paths['/records/{id}'].get.responses['200'].content['application/json'].schema),
      record(result.spec.paths['/records'].post.requestBody.content['application/json'].schema),
      record(result.spec.webhooks['record.changed'].post.requestBody.content['application/json'].schema)
    ];
    for (const leaf of leaves) {
      assert.deepEqual(detail(leaf.properties.status, 'type'), { key: 'type', before: ['string', 'null'], after: 'string' });
      assert.deepEqual(detail(leaf.properties.kind, 'const'), { key: 'const', before: 'record', after: 'published' });
      assert.deepEqual(detail(leaf.properties.amount, 'exclusiveMinimum'), { key: 'exclusiveMinimum', before: 0, after: 10 });
      assert.deepEqual(detail(leaf.properties.amount, 'exclusiveMaximum'), { key: 'exclusiveMaximum', before: 1000, after: 500 });
      assert.deepEqual(detail(leaf.properties.free, 'schema'), { key: 'schema', before: true, after: false });
      assert.deepEqual(detail(leaf.properties.blocked, 'schema'), { key: 'schema', before: false, after: true });
      assert.equal(leaf.properties.legacyCode['x-diff-status'], 'deleted');
      assert.equal(leaf.properties.reason['x-diff-status'], 'added');
      assert.ok(leaf.required.includes('reason'));
      assert.equal(leaf.properties.label.allOf[0].minLength, 2);
      assert.equal(leaf.properties.label.allOf[0].pattern, '^[A-Za-z]+$');
      assert.deepEqual(detail(leaf.properties.label, 'maxLength'), { key: 'maxLength', before: 12, after: 8 });
      assert.equal(detail(leaf.properties.tuple.prefixItems[1], 'minimum').after, 1);
      assert.equal(detail(leaf.patternProperties['^x-'], 'minLength').after, 2);
      assert.equal(detail(leaf.if.properties.status, 'const').after, 'closed');
      assert.equal(detail(leaf.then.properties.amount, 'minimum').after, 20);
    }
    assert.equal(result.spec.paths['/health'].get['x-diff-status'], undefined);
    assert.deepEqual(result.warnings, []);
    const current = await loadWorking(after);
    assert.equal(current.expanded.openapi, version);
    assert.equal(record(current.expanded.components.schemas.Envelope).properties.free, false);
    assert.equal(record(current.expanded.components.schemas.Envelope).properties.blocked, true);
    assert.equal(record(current.expanded.components.schemas.Envelope).properties.tuple.items, false);
    assert.equal(current.expanded.paths['/legacy/status'], undefined);
    assert.equal(JSON.stringify(previewLoaded(current).spec).includes('x-diff-'), false);
    assert.equal(current.dependencies.length, format === 'yaml' ? 3 : 1);
  });
}

test('the single-file JSON and split YAML 3.1 fixtures describe equivalent contracts', async () => {
  for (const side of ['old', 'new']) {
    const json = await loadWorking(path.join(fixtures, 'openapi31/json', side + '.json'));
    const yaml = await loadWorking(path.join(fixtures, 'openapi31/yaml', side, 'openapi.yaml'));
    assert.deepEqual(yaml.expanded, json.expanded);
  }
});

test('comparing each permanent fixture with itself produces an empty diff', async () => {
  for (const file of ['yaml/new.yaml', 'openapi31/json/new.json', 'openapi31/yaml/new/openapi.yaml']) {
    const current = path.join(fixtures, file), result = await compareTwoFiles(current, current, binary);
    assert.deepEqual(result.operations, [], file);
    assert.deepEqual(result.changelog, [], file);
  }
});
