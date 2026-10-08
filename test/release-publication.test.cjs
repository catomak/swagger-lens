const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const YAML = require('yaml');
const { releaseNotes } = require('../scripts/release-notes.cjs');
const { releaseAssets, publishAssets } = require('../scripts/release-assets.cjs');
const { targets, targetConfig } = require('../scripts/targets.cjs');
const manifest = { name: 'swagger-lens', publisher: 'Catomak', version: '0.4.0' };
const lock = { version: manifest.version, packages: { '': { version: manifest.version } } };
const changelog = '# Changelog\n\n## Unreleased\n\n- Future change.\n\n## 0.4.0 — 2026-10-08\n\n### Added\n\n- Release behavior.\n\n## 0.3.8 — 2026-10-07\n\n- Older behavior.\n';

test('release notes extract only the matching version, including Windows line endings', () => {
  const expected = '### Added\n\n- Release behavior.\n';
  assert.equal(releaseNotes(manifest, lock, changelog, 'v0.4.0'), expected);
  assert.equal(releaseNotes(manifest, lock, changelog.replaceAll('\n', '\r\n'), 'v0.4.0'), expected);
});

test('release metadata rejects mismatched tags/lockfiles, missing or duplicate notes, and invalid dates', () => {
  assert.throws(() => releaseNotes(manifest, lock, changelog, 'v0.4.1'), /tag must match/);
  assert.throws(() => releaseNotes(manifest, { ...lock, version: '0.3.8' }, changelog, 'v0.4.0'), /Lockfile version/);
  assert.throws(() => releaseNotes(manifest, lock, changelog.replace('0.4.0 —', '0.4.1 —'), 'v0.4.0'), /exactly one/);
  assert.throws(() => releaseNotes(manifest, lock, changelog + '\n## 0.4.0 — 2026-10-08\n- Duplicate.\n', 'v0.4.0'), /exactly one/);
  assert.throws(() => releaseNotes(manifest, lock, changelog.replace('2026-10-08', '2026-02-30'), 'v0.4.0'), /Invalid release date/);
  assert.throws(() => releaseNotes(manifest, lock, changelog.replace('- Release behavior.', ''), 'v0.4.0'), /completed changes/);
});

function binary(target) {
  const data = Buffer.alloc(128);
  if (target.startsWith('darwin-')) {
    data.writeUInt32LE(0xfeedfacf, 0); data.writeUInt32LE(target.endsWith('arm64') ? 0x0100000c : 0x01000007, 4);
  } else if (target.startsWith('win32-')) {
    data.write('MZ'); data.writeUInt32LE(64, 0x3c); data.writeUInt32LE(0x00004550, 64); data.writeUInt16LE(target.endsWith('arm64') ? 0xaa64 : 0x8664, 68);
  } else {
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(data); data.writeUInt16LE(target.endsWith('arm64') ? 183 : 62, 18);
  }
  return data;
}

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lens-release-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const archives = new Map();
  for (const target of targets) {
    const file = path.join(directory, `${manifest.name}-${manifest.version}-${targetConfig(target).artifactTarget}.vsix`);
    await fs.writeFile(file, target);
    archives.set(file, new Map([
      ['extension/package.json', { data: Buffer.from(JSON.stringify(manifest)) }],
      ['extension.vsixmanifest', { data: Buffer.from(`<PackageManifest Version="2.0.0"><Metadata><Identity Version="0.4.0" TargetPlatform="${target}" /></Metadata></PackageManifest>`) }],
      [`extension/bin/${targetConfig(target).binary}`, { data: binary(target), mode: 0o755 }]
    ]));
  }
  return { directory, archives, inspect: async file => archives.get(file) };
}

test('release assets require all six correct platform packages and bind checksums to their contents', async t => {
  const data = await fixture(t);
  const assets = await releaseAssets(data.directory, manifest, data.inspect);
  assert.equal(assets.packages.length, 6); assert.equal(assets.checksums.trim().split('\n').length, 6);
  const first = assets.packages[0];
  await fs.appendFile(first, 'changed');
  assert.notEqual((await releaseAssets(data.directory, manifest, data.inspect)).checksums, assets.checksums);
  await fs.unlink(first);
  await assert.rejects(releaseAssets(data.directory, manifest, data.inspect), /exactly the six/);
});

test('publication rejects a wrong extension version or target before any upload', async t => {
  const data = await fixture(t), first = [...data.archives.values()][0];
  first.get('extension/package.json').data = Buffer.from(JSON.stringify({ ...manifest, version: '0.3.8' }));
  await assert.rejects(releaseAssets(data.directory, manifest, data.inspect), /Wrong version/);
  first.get('extension/package.json').data = Buffer.from(JSON.stringify(manifest));
  first.get('extension.vsixmanifest').data = Buffer.from('<Identity Version="0.4.0" TargetPlatform="web"/>');
  await assert.rejects(releaseAssets(data.directory, manifest, data.inspect), /Wrong VS Code target/);
});

test('Marketplace publication uses verified packages and Entra credentials without PAT fallback', async () => {
  const assets = { packages: ['one.vsix', 'two.vsix'] }, calls = [];
  await publishAssets(assets, async (...args) => calls.push(args));
  assert.deepEqual(calls, [[assets.packages, { azureCredential: true, skipDuplicate: true }]]);
  let attempts = 0;
  await assert.rejects(publishAssets(assets, async () => { attempts++; throw new Error('Entra authorization failed'); }), /Entra authorization failed/);
  assert.equal(attempts, 1);
});

test('CI publishes after complete tag builds or explicitly retries an existing release without rebuilding', async () => {
  const workflow = YAML.parse(await fs.readFile('.github/workflows/build.yml', 'utf8'));
  assert.deepEqual(workflow.jobs.release.strategy.matrix.include.map(item => item.target).sort(), [...targets].sort());
  assert.equal(workflow.jobs['github-release'].needs, 'release');
  assert.equal(workflow.jobs['github-release'].if, "github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')");
  assert.equal(workflow.jobs.marketplace.needs, 'github-release');
  assert.equal(workflow.jobs['github-release'].permissions.contents, 'write');
  assert.deepEqual(workflow.jobs.marketplace.permissions, { contents: 'read', 'id-token': 'write' });
  assert.equal(workflow.jobs.marketplace.environment, 'marketplace');
  assert.equal(workflow.on.workflow_dispatch.inputs.publish_marketplace.default, false);
  const gate = new Function('github', 'inputs', 'result', 'cancelled', 'always', 'startsWith', `return ${workflow.jobs.marketplace.if.replaceAll('needs.github-release.result', 'result')}`);
  for (const [event, ref, manual, result, canceled, expected] of [
    ['push', 'refs/tags/v0.4.0', false, 'success', false, true],
    ['push', 'refs/tags/v0.4.0', false, 'failure', false, false],
    ['push', 'refs/heads/master', false, 'skipped', false, false],
    ['pull_request', 'refs/pull/1/merge', false, 'skipped', false, false],
    ['workflow_dispatch', 'refs/heads/master', false, 'skipped', false, false],
    ['workflow_dispatch', 'refs/heads/master', true, 'skipped', false, true],
    ['workflow_dispatch', 'refs/heads/master', true, 'skipped', true, false]
  ]) assert.equal(gate({ event_name: event, ref }, { publish_marketplace: manual }, result, () => canceled, () => true, (a, b) => a.startsWith(b)), expected);
  const login = workflow.jobs.marketplace.steps.find(step => step.uses === 'azure/login@v3');
  assert.equal(login.with['client-id'], '${{ secrets.AZURE_CLIENT_ID }}');
  assert.equal(login.with['tenant-id'], '${{ secrets.AZURE_TENANT_ID }}');
  assert.equal(login.with['allow-no-subscriptions'], true);
  assert.ok(!JSON.stringify(workflow).includes('VSCE_PAT'));
  assert.match(workflow.jobs.marketplace.steps.at(-1).run, /release-assets.cjs publish/);
});
