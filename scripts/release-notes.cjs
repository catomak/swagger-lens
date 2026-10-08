const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { parseArgs } = require('node:util');

function releaseNotes(manifest, lock, changelog, tag) {
  assert.match(manifest.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Release version must be stable SemVer');
  assert.equal(tag, `v${manifest.version}`, 'Release tag must match package.json');
  assert.equal(lock.version, manifest.version, 'Lockfile version must match package.json');
  assert.equal(lock.packages[''].version, manifest.version, 'Lockfile root version must match package.json');
  changelog = changelog.replaceAll('\r\n', '\n');
  const sections = [...changelog.matchAll(/^## (.+)\r?$/gm)];
  const matching = sections.filter(section => section[1] === manifest.version || section[1].startsWith(manifest.version + ' '));
  assert.equal(matching.length, 1, 'Changelog must contain exactly one section for the release');
  const section = matching[0], heading = section[1].match(/^(\S+) — (\d{4}-\d{2}-\d{2})$/);
  assert.ok(heading, 'Release heading must be ## <version> — YYYY-MM-DD');
  const date = new Date(heading[2] + 'T00:00:00Z');
  assert.ok(!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === heading[2], 'Invalid release date');
  const index = sections.indexOf(section), end = sections[index + 1]?.index ?? changelog.length;
  const notes = changelog.slice(section.index + section[0].length, end).trim();
  assert.match(notes, /^- \S/m, 'Release notes must contain completed changes');
  return notes + '\n';
}

async function readRelease(tag, root = path.resolve(__dirname, '..')) {
  const [manifest, lock, changelog] = await Promise.all(['package.json', 'package-lock.json', 'CHANGELOG.md'].map(file => fs.readFile(path.join(root, file), 'utf8')));
  const pkg = JSON.parse(manifest);
  return { manifest: pkg, notes: releaseNotes(pkg, JSON.parse(lock), changelog, tag) };
}

async function main() {
  const { values } = parseArgs({ options: { tag: { type: 'string' }, output: { type: 'string' } } });
  const { notes } = await readRelease(values.tag);
  if (values.output) await fs.writeFile(values.output, notes);
  else process.stdout.write(notes);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { releaseNotes, readRelease };
