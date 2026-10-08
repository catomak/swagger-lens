const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { targets, targetConfig, verifyBinary } = require('./targets.cjs');
const { readVsix } = require('./vsix.cjs');
const { readRelease } = require('./release-notes.cjs');

async function releaseAssets(directory, manifest, inspect = readVsix) {
  const expected = targets.map(target => `${manifest.name}-${manifest.version}-${targetConfig(target).artifactTarget}.vsix`);
  const actual = (await fs.readdir(directory)).filter(file => file.endsWith('.vsix'));
  assert.deepEqual(actual.sort(), [...expected].sort(), 'Release must contain exactly the six expected VSIX packages');
  const packages = [], checksums = [];
  for (const [index, name] of expected.entries()) {
    const file = path.join(directory, name), files = await inspect(file);
    const pkg = JSON.parse(files.get('extension/package.json').data);
    for (const key of ['name', 'publisher', 'version']) assert.equal(pkg[key], manifest[key], `Wrong ${key} in ${name}`);
    const xml = files.get('extension.vsixmanifest').data.toString().match(/<Identity\b[^>]*>/)?.[0] || '';
    assert.equal(xml.match(/TargetPlatform="([^"]+)"/)?.[1], targets[index], `Wrong VS Code target in ${name}`);
    assert.equal(xml.match(/\bVersion="([^"]+)"/)?.[1], manifest.version, `Wrong VSIX version in ${name}`);
    const config = targetConfig(targets[index]), binary = files.get(`extension/bin/${config.binary}`);
    assert.ok(binary, `Missing native engine in ${name}`);
    verifyBinary(binary.data, targets[index]);
    if (config.platform !== 'win32') assert.ok(binary.mode & 0o111, `Engine is not executable in ${name}`);
    const checksum = crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
    checksums.push(`${checksum}  ${name}`); packages.push(file);
  }
  return { packages, checksums: checksums.join('\n') + '\n' };
}

async function publishAssets(assets, publish = require('@vscode/vsce').publishVSIX) {
  await publish(assets.packages, { azureCredential: true, skipDuplicate: true });
}

async function main() {
  const [command, tag, directory, ...rest] = process.argv.slice(2);
  assert.ok(['prepare', 'verify', 'publish'].includes(command) && directory && !rest.length, 'Usage: node scripts/release-assets.cjs <prepare|verify|publish> <tag> <directory>');
  const { manifest } = await readRelease(tag);
  const assets = await releaseAssets(directory, manifest);
  const sumFile = path.join(directory, 'SHA256SUMS');
  if (command === 'prepare') await fs.writeFile(sumFile, assets.checksums);
  else assert.equal(await fs.readFile(sumFile, 'utf8'), assets.checksums, 'Published release checksums do not match its packages');
  if (command === 'publish') await publishAssets(assets);
  console.log(`${command}: ${assets.packages.length} packages for ${manifest.publisher}.${manifest.name} ${manifest.version}`);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { releaseAssets, publishAssets };
