const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Client = require('swagger-client');
const { loadWorking } = require('../src/engine.cjs');
const { InMemoryResolverPlugin } = require('../src/resolver.cjs');

for (const file of ['openapi31/json/new.json', 'openapi31/yaml/new/openapi.yaml']) {
  test(`Swagger UI resolves ${file} in a VS Code webview without fetching a document`, async t => {
    const original = global.document;
    global.document = { baseURI: 'vscode-webview://fixture/index.html?id=one&parentId=two' };
    t.after(() => { if (original === undefined) delete global.document; else global.document = original; });
    const { bundle } = await loadWorking(path.resolve('test/fixtures', file));
    const reports = [];
    const system = { fn: { resolve: Client.resolve, resolveSubtree: Client.resolveSubtree } };
    InMemoryResolverPlugin(result => reports.push(result)).afterLoad(system);
    const requestInterceptor = () => { throw new Error('Internal references must not make network requests'); };
    const result = await system.fn.resolve({ spec: bundle, baseDoc: document.baseURI, requestInterceptor });
    assert.deepEqual(result.errors, []);
    const schema = result.spec.paths['/records'].get.responses['200'].content['application/json'].schema;
    const record = schema.properties.payload.properties.meta.properties.details.properties.record;
    assert.deepEqual(record.properties.status.enum, ['draft', 'active', 'closed']);
    assert.equal(record.properties.free, false);
    assert.equal(record.properties.label.minLength, 2);
    assert.equal(record.properties.label.maxLength, 8);
    const subtree = await system.fn.resolveSubtree(bundle, ['components', 'schemas', 'Envelope'], { baseDoc: document.baseURI, requestInterceptor });
    assert.deepEqual(subtree.errors, []);
    assert.equal(subtree.spec.properties.payload.properties.meta.properties.details.properties.record.properties.kind.const, 'published');
    assert.deepEqual(reports.map(result => result.errors), [[], []]);
    assert.deepEqual(result.spec.servers, bundle.servers);
  });
}

test('HTTP document identity and request configuration are preserved', async () => {
  let actual;
  const system = { fn: { resolve: options => { actual = options; return { errors: [] }; }, resolveSubtree: () => ({ errors: [] }) } };
  InMemoryResolverPlugin().afterLoad(system);
  const options = { baseDoc: 'https://example.test/api.json', requestInterceptor: () => {} };
  await system.fn.resolve(options);
  assert.equal(actual, options);
});
