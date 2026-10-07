const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { downloadAndUnzipVSCode, runTests } = require('@vscode/test-electron');
const { run } = require('./process.cjs');
const { nativeTarget } = require('./targets.cjs');

async function testInstalled(vsix, target, root) {
  if (target !== nativeTarget()) throw new Error(`Native VS Code tests for ${target} require that OS and architecture; current host is ${nativeTarget()}`);
  const work = path.join(root, '.build', target, 'vscode-test');
  await fs.rm(work, { recursive: true, force: true });
  await fs.mkdir(work, { recursive: true });
  // Standalone contracts must live outside the checkout's own Git repository.
  const fixtureDirectory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'swg-fixture-')));
  const fixtureFile = path.join(fixtureDirectory, 'fixture.json');
  const report = path.join(root, 'builds', 'reports', `${target}-vscode.json`);
  let profile;
  try {
    await run(process.execPath, [path.join(root, 'test/create-host-fixture.cjs'), fixtureDirectory], { cwd: root });
    const fixture = JSON.parse(await fs.readFile(fixtureFile));
    const extensions = path.join(work, 'extensions'), harness = path.join(work, 'harness');
    await fs.mkdir(harness, { recursive: true });
    await fs.writeFile(path.join(harness, 'package.json'), JSON.stringify({ name: 'swagger-release-tests', publisher: 'local-tools', version: '1.0.0', engines: { vscode: '^1.90.0' }, main: './index.cjs' }));
    await fs.writeFile(path.join(harness, 'index.cjs'), 'exports.activate = () => {};\n');
    const platform = target.startsWith('win32-') ? `${target}-archive` : target === 'darwin-x64' ? 'darwin' : target;
    const executable = await downloadAndUnzipVSCode({ version: process.env.API_DIFF_VSCODE_VERSION || 'stable', platform, cachePath: path.join(root, '.vscode-test') });
    // Unix-domain socket paths have a small limit; the checkout can have a long path.
    profile = await fs.mkdtemp(path.join(os.tmpdir(), 'swg-'));
    const dirs = ['--user-data-dir', profile, '--extensions-dir', extensions];
    // Run the CLI directly to preserve paths with spaces and avoid Windows .cmd shell quoting.
    const cliScript = path.resolve(path.dirname(executable), process.platform === 'darwin' ? '../Resources/app/out/cli.js' : 'resources/app/out/cli.js');
    await fs.mkdir(path.dirname(report), { recursive: true });
    await fs.rm(report, { force: true });
    await run(executable, [cliScript, ...dirs, '--install-extension', vsix, '--force'], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    await runTests({
      vscodeExecutablePath: executable,
      extensionDevelopmentPath: harness,
      extensionTestsPath: path.join(root, 'test/extension-host.cjs'),
      launchArgs: [fixture.root, ...dirs, '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--disable-updates', '--disable-telemetry', '--disable-extension', 'github.copilot-chat'],
      extensionTestsEnv: { API_DIFF_FIXTURE: fixtureFile, API_DIFF_TEST_RESULT: report, API_DIFF_RELEASE_EXTENSIONS_DIR: extensions, API_DIFF_EXPECTED_VERSION: require(path.join(root, 'package.json')).version, API_DIFF_EXPECTED_TARGET: target }
    });
  } finally {
    try { if (profile) await fs.cp(path.join(profile, 'logs'), path.join(work, 'logs'), { recursive: true }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    finally {
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      if (profile) await fs.rm(profile, { recursive: true, force: true });
    }
  }
  const result = JSON.parse(await fs.readFile(report));
  if (!result.passed) throw new Error(`Installed VSIX tests failed for ${target}`);
  return result;
}
module.exports = { testInstalled };
