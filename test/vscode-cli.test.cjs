const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { resolveCliScript } = require('../scripts/vscode-cli.cjs');

for (const application of ['', '2a59476c9b']) {
  test(`Windows CLI follows the official launcher with ${application || 'classic'} application layout`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swagger cli '));
    try {
      const executable = path.join(root, 'Code.exe');
      const cli = path.join(root, application, 'resources', 'app', 'out', 'cli.js');
      await fs.mkdir(path.dirname(cli), { recursive: true });
      await fs.writeFile(cli, '');
      await fs.mkdir(path.join(root, 'bin'));
      const relative = path.relative(path.join(root, 'bin'), cli).replaceAll(path.sep, '\\');
      await fs.writeFile(path.join(root, 'bin', 'code.cmd'), `@echo off\r\n"%~dp0..\\Code.exe" "%~dp0${relative}" %*\r\n`);
      assert.equal(await resolveCliScript(executable, 'win32'), cli);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
}

for (const platform of ['darwin', 'linux']) {
  test(`${platform} CLI preserves the existing application layout`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swagger cli '));
    try {
      const executable = platform === 'darwin' ? path.join(root, 'Contents', 'MacOS', 'Code') : path.join(root, 'code');
      const cli = platform === 'darwin' ? path.join(root, 'Contents', 'Resources', 'app', 'out', 'cli.js') : path.join(root, 'resources', 'app', 'out', 'cli.js');
      await fs.mkdir(path.dirname(cli), { recursive: true });
      await fs.writeFile(cli, '');
      assert.equal(await resolveCliScript(executable, platform), cli);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
}
