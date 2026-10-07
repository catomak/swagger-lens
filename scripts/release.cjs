const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createVSIX } = require('@vscode/vsce');
const { targets, nativeTarget, targetConfig, verifyBinary, version: engineVersion } = require('./targets.cjs');
const { verifyVsix } = require('./vsix.cjs');
const { testInstalled } = require('./test-installed.cjs');
const { run } = require('./process.cjs');
const exec = promisify(execFile);
const root = path.resolve(__dirname, '..');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');

async function prepareBinary(config, destination) {
  const cache = path.join(root, '.cache', 'oasdiff', engineVersion);
  await fs.mkdir(cache, { recursive: true });
  const archive = path.join(cache, config.archive);
  let data;
  try { data = await fs.readFile(archive); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!data || hash(data) !== config.sha256) {
    const response = await fetch(config.url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Could not download ${config.archive}: HTTP ${response.status}`);
    data = Buffer.from(await response.arrayBuffer());
    if (hash(data) !== config.sha256) throw new Error(`Checksum mismatch for ${config.archive}`);
    await fs.writeFile(archive, data);
  }
  const unpacked = path.join(cache, config.archive.replace('.tar.gz', ''));
  await fs.mkdir(unpacked, { recursive: true });
  await exec('tar', ['-xzf', archive, '-C', unpacked], { windowsHide: true });
  const binary = await fs.readFile(path.join(unpacked, config.binary));
  verifyBinary(binary, config.target);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, binary, { mode: 0o755 });
  await fs.chmod(destination, 0o755);
}

async function stageTarget(target) {
  const config = targetConfig(target), stage = path.join(root, '.build', target, 'extension');
  await fs.rm(stage, { recursive: true, force: true });
  await fs.mkdir(stage, { recursive: true });
  for (const name of ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'NOTICE', 'THIRD-PARTY', 'dist', '.vscodeignore']) await fs.cp(path.join(root, name), path.join(stage, name), { recursive: true });
  await fs.mkdir(path.join(stage, 'assets'), { recursive: true });
  await fs.copyFile(path.join(root, 'assets/icon.png'), path.join(stage, 'assets/icon.png'));
  await prepareBinary(config, path.join(stage, 'bin', config.binary));
  return stage;
}

async function main() {
  const args = process.argv.slice(2), host = nativeTarget();
  const all = args.length === 1 && args[0] === '--all';
  const selected = args.length === 0 ? host : args.length === 2 && args[0] === '--target' ? args[1] : null;
  if (!all && !selected) throw new Error('Usage: npm run release -- [--all | --target <platform-architecture>]');
  if (!all && selected !== host) throw new Error(`Use --all for cross-packaging; native tests for ${selected} must run on that target, not ${host}`);
  const requested = all ? targets : [selected], packageJson = require(path.join(root, 'package.json'));
  const report = { version: packageJson.version, host, engineVersion, startedAt: new Date().toISOString(), status: 'running', targets: [] };
  await fs.mkdir(path.join(root, 'builds/reports'), { recursive: true });
  const reportFile = path.join(root, 'builds/reports', `${host}-release.json`);
  try {
    await run(process.execPath, [path.join(root, 'scripts/build.cjs')], { cwd: root });
    const hostStage = await stageTarget(host);
    const nativeBinary = path.join(hostStage, 'bin', targetConfig(host).binary);
    const version = (await exec(nativeBinary, ['--version'], { windowsHide: true })).stdout;
    if (!version.includes(engineVersion)) throw new Error('Unexpected bundled oasdiff version');
    await run(process.execPath, [path.join(root, 'scripts/test.cjs')], { cwd: root, env: { ...process.env, API_DIFF_TEST_BINARY: nativeBinary } });
    report.unitTests = 'passed';
    for (const target of requested) {
      const entry = { target, status: 'running', runtime: 'not-run' };
      report.targets.push(entry);
      const stage = target === host ? hostStage : await stageTarget(target);
      const vsix = path.join(root, 'builds', `${packageJson.name}-${packageJson.version}-${targetConfig(target).artifactTarget}.vsix`);
      await createVSIX({ cwd: stage, target, packagePath: vsix, dependencies: false });
      entry.package = await verifyVsix(vsix, target, stage);
      entry.vsix = path.relative(root, vsix);
      entry.sha256 = hash(await fs.readFile(vsix));
      if (target === host) { entry.runtime = await testInstalled(vsix, target, root); entry.status = 'passed'; }
      else { entry.status = 'packaged-only'; entry.runtimeReason = `Native execution requires a ${target} runner`; }
    }
    report.status = all ? 'packaged-with-native-host-check' : 'passed';
  } catch (error) {
    report.status = 'failed'; report.error = error.stack;
    if (report.targets.at(-1)?.status === 'running') report.targets.at(-1).status = 'failed';
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
    console.log(`Release report: ${path.relative(root, reportFile)}`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
