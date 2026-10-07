const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyBinary, targetConfig } = require('../scripts/targets.cjs');
const { nativeTarget, bundledBinary } = require('../src/platform.cjs');

test('PE executable machine types reject the wrong Windows architecture and OS', () => {
  for (const [arch, machine] of [['x64', 0x8664], ['arm64', 0xaa64]]) {
    const binary = Buffer.alloc(128);
    binary.write('MZ'); binary.writeUInt32LE(64, 0x3c);
    binary.writeUInt32LE(0x00004550, 64); binary.writeUInt16LE(machine, 68);
    verifyBinary(binary, `win32-${arch}`);
    assert.throws(() => verifyBinary(binary, `win32-${arch === 'x64' ? 'arm64' : 'x64'}`), /does not match/);
    assert.throws(() => verifyBinary(binary, `linux-${arch}`), /does not match/);
  }
});

test('ELF machine types reject cross-architecture Linux packages', () => {
  for (const [arch, machine] of [['x64', 62], ['arm64', 183]]) {
    const binary = Buffer.alloc(64);
    binary.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]); binary.writeUInt16LE(machine, 18);
    verifyBinary(binary, `linux-${arch}`);
    assert.throws(() => verifyBinary(binary, `linux-${arch === 'x64' ? 'arm64' : 'x64'}`), /does not match/);
    binary[5] = 2;
    assert.throws(() => verifyBinary(binary, `linux-${arch}`), /does not match/);
  }
});

test('Mach-O packages need the requested CPU, including universal binaries', () => {
  const binary = Buffer.alloc(64);
  binary.writeUInt32BE(0xcafebabe); binary.writeUInt32BE(2, 4);
  binary.writeUInt32BE(0x01000007, 8); binary.writeUInt32BE(0x0100000c, 28);
  verifyBinary(binary, 'darwin-x64'); verifyBinary(binary, 'darwin-arm64');
  binary.writeUInt32BE(1, 4);
  verifyBinary(binary, 'darwin-x64');
  assert.throws(() => verifyBinary(binary, 'darwin-arm64'), /does not match/);
});

test('unsupported targets fail explicitly and Windows uses an executable suffix', () => {
  assert.throws(() => nativeTarget('win32', 'ia32'), /Unsupported release target/);
  assert.throws(() => targetConfig('linux-arm'), /Unsupported release target/);
  assert.ok(bundledBinary('extension', 'win32').endsWith('oasdiff.exe'));
  assert.ok(bundledBinary('extension', 'darwin').endsWith('oasdiff'));
});
