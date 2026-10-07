const path = require('node:path');
const targets = ['darwin-arm64', 'darwin-x64', 'win32-x64', 'win32-arm64', 'linux-x64', 'linux-arm64'];
function nativeTarget(platform = process.platform, arch = process.arch) {
  const target = `${platform}-${arch}`;
  if (!targets.includes(target)) throw new Error(`Unsupported release target: ${target}`);
  return target;
}
const executableName = (platform = process.platform) => platform === 'win32' ? 'oasdiff.exe' : 'oasdiff';
const bundledBinary = (root, platform = process.platform) => path.join(root, 'bin', executableName(platform));
module.exports = { targets, nativeTarget, executableName, bundledBinary };
