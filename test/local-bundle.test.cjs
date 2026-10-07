const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { execFileSync } = require('node:child_process');
const { $RefParser: RefParser } = require('@apidevtools/json-schema-ref-parser');
const YAML = require('yaml');
const Client = require('swagger-client');
const { bundleLocal } = require('../src/local-bundle.cjs');
const { loadWorking, loadSnapshot, previewFile, compareFile } = require('../src/engine.cjs');
const { InMemoryResolverPlugin } = require('../src/resolver.cjs');
const binary = require('./binary.cjs');

const api = (reference, version = '3.1.2') => ({
  openapi: version, info: { title: 'Fragment test', version: '1' },
  servers: [{ url: 'https://example.test' }],
  paths: Object.fromEntries(['/items', '/items/{id}'].map(route => [route, { get: {
    ...(route.includes('{id}') ? { parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }] } : {}),
    responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: reference } } } } }
  } }]))
});
const response = spec => spec.paths['/items'].get.responses[200].content['application/json'].schema;
async function folder(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swagger-fragments-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
async function resolve(bundle) {
  const system = { fn: { resolve: Client.resolve, resolveSubtree: Client.resolveSubtree } };
  InMemoryResolverPlugin().afterLoad(system);
  const result = await system.fn.resolve({ spec: bundle, baseDoc: 'vscode-webview://fixture/index.html', requestInterceptor: () => { throw new Error('Unexpected network request'); } });
  assert.deepEqual(result.errors, []);
  return result.spec;
}

for (const drive of ['C', 'c']) {
  test(`Windows drive aliases preserve ${drive}: dependency paths and prune unrelated references`, async () => {
    const root = `file:///${drive}:/work/api.json`, models = `file:///${drive}:/work/Schemas.json`;
    const current = api('file:///c:/work/Schemas.json#/Wanted');
    current.components = { schemas: {
      Local: { type: 'string' },
      Alias: { $ref: 'file:///C:/work/Schemas.json#/Wanted' },
      RootAlias: { $ref: `file:///${drive === 'C' ? 'c' : 'C'}:/work/api.json#/components/schemas/Local` }
    } };
    const reads = [];
    const loaded = await bundleLocal(root, current, url => {
      reads.push(url);
      assert.equal(url, models);
      return JSON.stringify({ Wanted: { type: 'object', properties: { name: { type: 'string' } } }, Unused: { $ref: './missing.json' } });
    }, true);
    assert.deepEqual(reads, [models]);
    assert.deepEqual(loaded.dependencies, [root, models]);
    assert.doesNotMatch(JSON.stringify(loaded.bundle), /Unused|missing\.json/);
    const expanded = await RefParser.dereference(structuredClone(loaded.bundle), { resolve: { file: false, http: false } });
    assert.equal(response(expanded).properties.name.type, 'string');
    assert.equal(expanded.components.schemas.Alias.properties.name.type, 'string');
    assert.equal(expanded.components.schemas.RootAlias.type, 'string');
  });
}

for (const [format, version] of [['json', '3.0.3'], ['yaml', '3.1.2']]) {
  test(`${format.toUpperCase()} neighboring Swagger over 5,000 lines loads only reachable fragments, once per file`, async t => {
    const root = await folder(t), file = path.join(root, 'service-a', `api.${format}`);
    const neighbor = path.join(root, 'service-b', `api.${format}`), shared = path.join(root, 'common', `status.${format}`);
    const serialize = value => format === 'json' ? JSON.stringify(value, null, 2) : YAML.stringify(value);
    const current = api(`../service-b/api.${format}#/components/schemas/Wanted`, version);
    const wanted = { type: 'object', description: 'Only this object is imported', properties: {
      name: { type: 'string', description: 'Display name', example: 'Asha' },
      status: { $ref: `../common/status.${format}#/Status` },
      active: { type: 'boolean' }
    }, example: { name: 'Asha', status: 'active', active: true } };
    const schemas = { Wanted: wanted, UnusedDependency: { $ref: '../unused/missing.json#/Never' } };
    for (let index = 0; index < 1000; index++) schemas[`Unused${index}`] = { type: 'object', properties: { unused: { type: 'string', description: 'Unrelated schema' } } };
    const large = serialize({ ...api('#/components/schemas/Unused0', version), components: { schemas } });
    assert.ok(large.split('\n').length > 5000);
    for (const destination of [file, neighbor, shared]) await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(file, serialize(current));
    await fs.writeFile(neighbor, large);
    await fs.writeFile(shared, serialize({ Status: { type: 'string', enum: ['draft', 'active'], example: 'active' } }));
    const reads = [];
    const loaded = await bundleLocal(pathToFileURL(file).href, current, url => {
      reads.push(fileURLToPath(url));
      return fs.readFile(fileURLToPath(url));
    }, version.startsWith('3.1.'));
    assert.deepEqual(reads.sort(), [neighbor, shared].sort());
    assert.deepEqual(loaded.dependencies.map(fileURLToPath).sort(), [file, neighbor, shared].sort());
    assert.doesNotMatch(JSON.stringify(loaded.bundle), /Unused|missing\.json/);
    const rendered = await resolve(loaded.bundle), model = response(rendered);
    assert.deepEqual(Object.keys(model.properties), ['name', 'status', 'active']);
    assert.equal(model.description, wanted.description);
    assert.deepEqual(model.example, wanted.example);
    assert.equal(model.properties.name.example, 'Asha');
    assert.deepEqual(model.properties.status.enum, ['draft', 'active']);
    assert.deepEqual(rendered.servers, current.servers);
    const preview = await previewFile(file);
    assert.deepEqual(preview.dependencies.sort(), [file, neighbor, shared].sort());
    assert.doesNotMatch(JSON.stringify(preview.spec), /Unused/);
  });
}

test('multiple overlapping pointers, escaped names, array elements and false schemas share one physical file', async t => {
  const root = await folder(t), file = path.join(root, 'api #1 %20 ~.json'), models = path.join(root, 'models #1 %20 ~.json');
  const relative = './models%20%231%20%2520%20~.json';
  const current = api(`${relative}#/schemas/A~1B~0C`);
  current.components = { schemas: {
    Parent: { $ref: `${relative}#/schemas/A~1B~0C` },
    Child: { $ref: `${relative}#/schemas/A~1B~0C/properties/name` },
    ArrayChild: { $ref: `${relative}#/list/1` },
    Nothing: { $ref: `${relative}#/Nothing` }
  } };
  await fs.writeFile(file, JSON.stringify(current));
  await fs.writeFile(models, JSON.stringify({
    schemas: { 'A/B~C': { type: 'object', properties: { name: { $ref: '#/Name' } } } },
    Name: { type: 'string', description: 'Shared internal target' },
    list: [{ $ref: './missing.json' }, { type: 'integer', minimum: 3 }], Nothing: false,
    unused: { $ref: './missing.json' }
  }));
  const loaded = await loadWorking(file);
  assert.deepEqual(loaded.dependencies.sort(), [file, models].sort());
  assert.equal(loaded.expanded.components.schemas.Parent.properties.name.description, 'Shared internal target');
  assert.equal(loaded.expanded.components.schemas.Child.type, 'string');
  assert.equal(loaded.expanded.components.schemas.ArrayChild.minimum, 3);
  assert.equal(loaded.expanded.components.schemas.Nothing, false);
  assert.doesNotMatch(JSON.stringify(loaded.bundle), /missing\.json/);
});

test('cross-file recursive references remain serializable and share internal references', async t => {
  const root = await folder(t), file = path.join(root, 'api.json');
  await fs.writeFile(file, JSON.stringify(api('./a.json#/A')));
  await fs.writeFile(path.join(root, 'a.json'), JSON.stringify({ A: { type: 'object', properties: { b: { $ref: './b.json#/B' } } }, unused: { $ref: './missing.json' } }));
  await fs.writeFile(path.join(root, 'b.json'), JSON.stringify({ B: { type: 'object', properties: { a: { $ref: './a.json#/A' } } } }));
  const loaded = await loadWorking(file);
  assert.equal(loaded.dependencies.length, 3);
  const serialized = JSON.stringify(loaded.bundle);
  assert.doesNotMatch(serialized, /a\.json|b\.json|missing\.json/);
  assert.match(serialized, /\$ref/);
  assert.doesNotThrow(() => JSON.stringify(loaded.expanded));
});

test('Preview skips dereferencing for both working files and comparison snapshots; Diff loads still expand', async t => {
  const root = await folder(t), file = path.join(root, 'api.json'), current = api('#/components/schemas/Item');
  current.components = { schemas: { Item: { type: 'string', enum: ['active'] } } };
  await fs.writeFile(file, JSON.stringify(current));
  const original = RefParser.dereference;
  let calls = 0;
  RefParser.dereference = (...args) => { calls++; return original.apply(RefParser, args); };
  t.after(() => { RefParser.dereference = original; });
  await previewFile(file);
  const working = await loadWorking(file, { expand: false });
  const snapshot = await loadSnapshot(file, JSON.stringify(current), () => { throw new Error('No external files'); }, { expand: false });
  assert.equal(working.expanded, undefined);
  assert.equal(snapshot.expanded, undefined);
  assert.equal(calls, 0);
  const diffWorking = await loadWorking(file), diffSnapshot = await loadSnapshot(file, JSON.stringify(current), () => {});
  assert.equal(calls, 2);
  assert.deepEqual(response(diffWorking.expanded).enum, ['active']);
  assert.deepEqual(response(diffSnapshot.expanded).enum, ['active']);
});

test('snapshot fragment dependencies use only the snapshot reader and ignore unused missing dependencies', async t => {
  const root = await folder(t), file = path.join(root, 'service', 'api.json'), models = path.join(root, 'models #1.json');
  const current = api('../models%20%231.json#/Wanted');
  await fs.writeFile(models, JSON.stringify({ Wanted: { type: 'string', enum: ['WORKING_TREE'] } }));
  const reads = [];
  const loaded = await loadSnapshot(file, JSON.stringify(current), async requested => {
    reads.push(requested);
    assert.equal(requested, models);
    return JSON.stringify({ Wanted: { type: 'string', enum: ['SNAPSHOT'] }, Unused: { $ref: './missing.json' } });
  }, { expand: false });
  assert.deepEqual(reads, [models]);
  assert.deepEqual(response(loaded.bundle).enum, ['SNAPSHOT']);
  assert.equal(loaded.expanded, undefined);
});

test('equivalent URL spellings of one snapshot file reuse its parsed document', async t => {
  const root = await folder(t), file = path.join(root, 'service', 'api.json'), models = path.join(root, 'models~.json');
  const current = api('../models%7e.json#/Wanted');
  current.components = { schemas: { Other: { $ref: '../models~.json#/Other' } } };
  const reads = [];
  const loaded = await loadSnapshot(file, JSON.stringify(current), requested => {
    reads.push(requested);
    return JSON.stringify({ Wanted: { type: 'string' }, Other: { type: 'integer' } });
  });
  assert.deepEqual(reads, [models]);
  assert.equal(response(loaded.expanded).type, 'string');
  assert.equal(loaded.expanded.components.schemas.Other.type, 'integer');
});

test('Git Diff keeps each side of a selected fragment in its own revision and highlights both operations', async t => {
  const root = await folder(t), file = path.join(root, 'api.json'), models = path.join(root, 'models.json');
  const git = args => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
  git(['init', '-q']);
  await fs.writeFile(file, JSON.stringify(api('./models.json#/Wanted')));
  const document = { Wanted: { type: 'object', properties: { state: { type: 'string', enum: ['draft', 'active'] } } }, Unused: { $ref: './missing.json' } };
  await fs.writeFile(models, JSON.stringify(document));
  git(['add', '.']);
  git(['-c', 'user.name=API Diff Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Fixture baseline']);
  document.Wanted.properties.state.enum.push('closed');
  await fs.writeFile(models, JSON.stringify(document));
  const result = await compareFile(file, 'HEAD', binary);
  assert.equal(result.operations.length, 2);
  assert.deepEqual(response(result.spec).properties.state['x-diff-details'], [{ key: 'enum', before: ['draft', 'active'], after: ['draft', 'active', 'closed'] }]);
  assert.doesNotMatch(JSON.stringify(result.spec), /Unused/);
});

test('schema identifiers use full resolution and named anchors retain the existing error behavior', async t => {
  const root = await folder(t), file = path.join(root, 'api.json');
  await fs.writeFile(file, JSON.stringify(api('./models.json#/$defs/Wanted')));
  await fs.writeFile(path.join(root, 'models.json'), JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema', $id: './models.json',
    $defs: { Wanted: { $anchor: 'target', type: 'string', description: 'Named target' }, Unused: { $ref: './extra.json' } }
  }));
  await fs.writeFile(path.join(root, 'extra.json'), JSON.stringify({ type: 'boolean' }));
  const loaded = await loadWorking(file);
  assert.equal(response(loaded.expanded).description, 'Named target');
  assert.equal(loaded.dependencies.length, 3);
  await fs.writeFile(file, JSON.stringify(api('./models.json#target')));
  await assert.rejects(loadWorking(file), error => error.code === 'EINVALIDPOINTER');
});

test('required missing files and pointers remain errors while literal example references remain untouched', async t => {
  const root = await folder(t), file = path.join(root, 'api.json');
  const current = api('./models.json#/Wanted');
  await fs.writeFile(file, JSON.stringify(current));
  await assert.rejects(loadWorking(file), /models\.json/);
  await fs.writeFile(path.join(root, 'models.json'), JSON.stringify({ Wanted: { type: 'object', examples: [{ $ref: './missing.json', $id: 'user value' }], properties: { name: { type: 'string' } } } }));
  assert.deepEqual(response((await loadWorking(file)).expanded).examples, [{ $ref: './missing.json', $id: 'user value' }]);
  current.paths['/items'].get.responses[200].content['application/json'].schema.$ref = './models.json#/Absent';
  await fs.writeFile(file, JSON.stringify(current));
  await assert.rejects(loadWorking(file), /Absent/);
});
