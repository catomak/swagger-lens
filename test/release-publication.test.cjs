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

test('Marketplace publication uses only verified packages and allows retrying existing platform versions', async () => {
  const assets = { packages: ['one.vsix', 'two.vsix'] }, calls = [];
  const publish = async (...args) => calls.push(args);
  await assert.rejects(publishAssets(assets, '', publish), /VSCE_PAT repository secret/);
  assert.deepEqual(calls, []);
  await publishAssets(assets, 'test-only-credential', publish);
  assert.deepEqual(calls, [[assets.packages, { pat: 'test-only-credential', skipDuplicate: true }]]);
});

test('CI publishes only version-tag runs after the complete build matrix and GitHub release', async () => {
  const workflow = YAML.parse(await fs.readFile('.github/workflows/build.yml', 'utf8'));
  assert.deepEqual(workflow.jobs.release.strategy.matrix.include.map(item => item.target).sort(), [...targets].sort());
  assert.equal(workflow.jobs['github-release'].needs, 'release');
  assert.equal(workflow.jobs.marketplace.needs, 'github-release');
  for (const job of [workflow.jobs['github-release'], workflow.jobs.marketplace]) assert.equal(job.if, "github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')");
  assert.equal(workflow.jobs['github-release'].permissions.contents, 'write');
  assert.equal(workflow.jobs.marketplace.permissions.contents, 'read');
  const publish = workflow.jobs.marketplace.steps.at(-1);
  assert.equal(publish.env.VSCE_PAT, '${{ secrets.VSCE_PAT }}');
  assert.match(publish.run, /release-assets.cjs publish/);
});
