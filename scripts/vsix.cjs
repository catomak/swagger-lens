const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const yauzl = require('yauzl');
const { targetConfig, verifyBinary } = require('./targets.cjs');

function readVsix(file) {
  return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true }, (error, zip) => {
    if (error) return reject(error);
    const files = new Map();
    zip.on('error', reject);
    zip.on('end', () => resolve(files));
    zip.on('entry', entry => {
      if (entry.fileName.endsWith('/')) return zip.readEntry();
      if (entry.fileName.split('/').some(part => part === '..') || path.posix.isAbsolute(entry.fileName)) { zip.close(); return reject(new Error('Unsafe VSIX entry')); }
      zip.openReadStream(entry, (error, stream) => {
        if (error) { zip.close(); return reject(error); }
        const chunks = [];
        stream.on('error', reject);
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => {
          files.set(entry.fileName, { data: Buffer.concat(chunks), mode: entry.externalFileAttributes >>> 16 });
          zip.readEntry();
        });
      });
    });
    zip.readEntry();
  }));
}

async function verifyVsix(file, target, stage) {
  const files = await readVsix(file), config = targetConfig(target);
  const get = name => { assert.ok(files.has(name), `Missing ${name}`); return files.get(name); };
  const manifest = get('extension.vsixmanifest').data.toString();
  const packaged = JSON.parse(get('extension/package.json').data);
  const expected = JSON.parse(await fs.readFile(path.join(stage, 'package.json')));
  assert.equal(packaged.name, expected.name);
  assert.equal(packaged.displayName, 'Swagger Lens');
  assert.equal(packaged.publisher, expected.publisher);
  assert.equal(packaged.version, expected.version);
  assert.ok(manifest.includes(`TargetPlatform="${target}"`));
  assert.ok(manifest.includes(`Version="${expected.version}"`));
  for (const [name, entry] of files) {
    if (!name.startsWith('extension/')) continue;
    const relative = name.slice('extension/'.length);
    assert.ok(relative === 'package.json' || ['readme.md', 'changelog.md', 'LICENSE.txt', 'NOTICE'].includes(relative) || /^(dist|bin|assets|THIRD-PARTY)\//.test(relative), `Unexpected packaged file: ${relative}`);
    assert.ok(!/AGENTS\.md|icon-concepts|node_modules|\.map$/.test(relative));
    const source = { 'readme.md': 'README.md', 'changelog.md': 'CHANGELOG.md', 'LICENSE.txt': 'LICENSE' }[relative] || relative;
    assert.deepEqual(entry.data, await fs.readFile(path.join(stage, source)), `Stale packaged file: ${relative}`);
  }
  for (const name of await fs.readdir(path.join(stage, 'dist'))) get(`extension/dist/${name}`);
  assert.equal(packaged.license, 'Apache-2.0');
  get('extension/LICENSE.txt');
  get('extension/NOTICE');
  get('extension/THIRD-PARTY/README.md');
  assert.equal(packaged.icon, 'assets/icon.png');
  const icon = get('extension/assets/icon.png').data;
  assert.ok(icon.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  assert.ok(icon.readUInt32BE(16) >= 128 && icon.readUInt32BE(16) === icon.readUInt32BE(20));
  const binaries = [...files.keys()].filter(name => name.startsWith('extension/bin/'));
  assert.deepEqual(binaries, [`extension/bin/${config.binary}`]);
  const binary = get(binaries[0]);
  verifyBinary(binary.data, target);
  if (config.platform !== 'win32') assert.ok(binary.mode & 0o111, 'The packaged engine must remain executable');
  return { version: packaged.version, target, files: files.size, binary: config.binary, icon: packaged.icon };
}
module.exports = { readVsix, verifyVsix };
