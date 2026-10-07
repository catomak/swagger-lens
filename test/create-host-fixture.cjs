const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const YAML = require('yaml');

async function main() {
  const destination = path.resolve(process.argv[2]);
  const root = path.join(destination, 'repository'), standalone = path.join(destination, 'standalone');
  await fs.mkdir(root, { recursive: true }); await fs.mkdir(standalone, { recursive: true });
  const git = args => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
  const commit = () => git(['-c', 'user.name=Swagger Preview Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Fixture revision']);
  const response = { description: 'OK', content: { 'application/json': { schema: { $ref: './models.yaml#/Item' } } } };
  const base = { openapi: '3.1.2', info: { title: 'Mode Test API', version: '1' }, paths: { '/items': { get: { responses: { 200: response } } }, '/unchanged': { get: { responses: { 200: { description: 'OK' } } } }, '/deleted': { get: { responses: { 200: { description: 'Legacy' } } } } } };
  const file = path.join(root, 'api.json'), unstaged = path.join(root, 'unstaged-api.yaml'), model = path.join(root, 'models.yaml');
  const openapi31 = path.join(root, 'openapi31.json');
  const models = value => YAML.stringify({ Item: { type: 'object', properties: { status: { type: 'string', enum: [value] } } } });
  git(['init', '-q']);
  await fs.copyFile(path.resolve('test/fixtures/openapi31/json/old.json'), openapi31);
  await fs.writeFile(file, JSON.stringify(base)); await fs.writeFile(unstaged, YAML.stringify(base)); await fs.writeFile(model, models('v1'));
  git(['add', '.']); commit();
  await fs.writeFile(model, models('v2')); git(['add', '.']); commit();
  const staged = structuredClone(base);
  staged.paths['/staged-only'] = { post: { responses: { 204: { description: 'Staged' } } } };
  await fs.writeFile(file, JSON.stringify(staged)); await fs.writeFile(model, models('v4'));
  const added = path.join(root, 'added.yaml'); await fs.writeFile(added, YAML.stringify(base));
  git(['add', '.']);
  const working = structuredClone(base);
  delete working.paths['/deleted'];
  working.paths['/working-only'] = { post: { responses: { 204: { description: 'Working' } } } };
  await fs.writeFile(file, JSON.stringify(working)); await fs.writeFile(model, models('v5'));
  await fs.copyFile(path.resolve('test/fixtures/openapi31/json/new.json'), openapi31);
  const yaml31 = path.join(standalone, 'openapi31');
  await fs.cp(path.resolve('test/fixtures/openapi31/yaml/new'), yaml31, { recursive: true });
  const outside = path.join(standalone, 'api.yaml'), outsideModel = path.join(standalone, 'models.yaml');
  await fs.writeFile(outside, YAML.stringify(base)); await fs.writeFile(outsideModel, models('outside'));
  const fragment = path.join(standalone, 'service-a', 'api.yaml'), neighbor = path.join(standalone, 'service-b', 'api.json');
  await fs.mkdir(path.dirname(fragment)); await fs.mkdir(path.dirname(neighbor));
  const small = structuredClone(base);
  small.components = { schemas: { Envelope: { $ref: '../service-b/api.json#/components/schemas/Wanted' } } };
  small.paths['/items'].get.responses[200].content['application/json'].schema.$ref = '#/components/schemas/Envelope';
  const schemas = {
    Wanted: { type: 'object', description: 'Imported small object', properties: { name: { type: 'string', example: 'Asha' }, active: { type: 'boolean' }, count: { type: 'integer' } }, example: { name: 'Asha', active: true, count: 3 } },
    UnusedDependency: { $ref: '../unused/missing.json' }
  };
  for (let index = 0; index < 1000; index++) schemas[`Unused${index}`] = { type: 'object', properties: { unrelated: { type: 'string', description: 'Unrelated schema' } } };
  await fs.writeFile(fragment, YAML.stringify(small));
  await fs.writeFile(neighbor, JSON.stringify({ ...base, components: { schemas } }, null, 2));
  const fixture = { root, file, model, unstaged, added, outside, outsideModel, openapi31, yaml31: path.join(yaml31, 'openapi.yaml'), fragment, neighbor };
  await fs.writeFile(path.join(destination, 'fixture.json'), JSON.stringify(fixture, null, 2));
  console.log(JSON.stringify(fixture));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
