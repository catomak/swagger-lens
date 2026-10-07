const { targets, nativeTarget, executableName } = require('../src/platform.cjs');
const version = '1.33.0';
const archives = {
  darwin_all: '2a479337c15afdcbf0b1e89c0b4d0cf0176472dbc11483358fed1f831d1e46c5',
  linux_amd64: '43a4e328e2d13ba1552d760aa68d2485c75c5621f309f6ff64ae895188345247',
  linux_arm64: '4ae3c362d6074d919aada2dea82d0ee84366591600384455d0bdc658ddf8f7ae',
  windows_amd64: '22f98c7247075f8a446e783595802d6d38637de1760df264f3d4b3309f766c5b',
  windows_arm64: 'd51bd1ea4b05ff9b314245d1e97f84c222b22ce34a930e8e305c68c32edbe951'
};
function targetConfig(target) {
  if (!targets.includes(target)) throw new Error(`Unsupported release target: ${target}`);
  const [platform, arch] = target.split('-');
  const key = platform === 'darwin' ? 'darwin_all' : `${platform === 'win32' ? 'windows' : 'linux'}_${arch === 'x64' ? 'amd64' : 'arm64'}`;
  const archive = `oasdiff_${version}_${key}.tar.gz`;
  return { target, artifactTarget: target.replace(/^darwin-/, 'macos-'), platform, arch, binary: executableName(platform), archive, sha256: archives[key], url: `https://github.com/oasdiff/oasdiff/releases/download/v${version}/${archive}` };
}

function verifyBinary(data, target) {
  targetConfig(target);
  let architectures = [];
  if (target.startsWith('darwin-')) {
    if (data.readUInt32BE(0) === 0xcafebabe) {
      for (let i = 0; i < data.readUInt32BE(4); i++) architectures.push(data.readUInt32BE(8 + i * 20));
    } else if (data.readUInt32LE(0) === 0xfeedfacf) architectures.push(data.readUInt32LE(4));
    const cpu = target.endsWith('arm64') ? 0x0100000c : 0x01000007;
    if (architectures.includes(cpu)) return;
  } else if (target.startsWith('win32-')) {
    if (data.subarray(0, 2).toString() === 'MZ') {
      const offset = data.readUInt32LE(0x3c);
      const machine = target.endsWith('arm64') ? 0xaa64 : 0x8664;
      if (data.readUInt32LE(offset) === 0x00004550 && data.readUInt16LE(offset + 4) === machine) return;
    }
  } else if (data.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) && data[4] === 2 && data[5] === 1) {
    if (data.readUInt16LE(18) === (target.endsWith('arm64') ? 183 : 62)) return;
  }
  throw new Error(`The bundled executable does not match ${target}`);
}
module.exports = { targets, nativeTarget, targetConfig, verifyBinary, version };
