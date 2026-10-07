const fs = require('node:fs/promises');
const path = require('node:path');

async function resolveCliScript(executable, platform = process.platform) {
  let script;
  if (platform === 'win32') {
    // Windows archives can place application files in a versioned subdirectory.
    // Use the official launcher as the source of its CLI entry point.
    const launcher = path.join(path.dirname(executable), 'bin', 'code.cmd');
    const command = await fs.readFile(launcher, 'utf8');
    const entry = command.match(/"%~dp0([^"\r\n]*\\resources\\app\\out\\cli\.js)"/i);
    if (!entry) throw new Error(`Could not resolve the VS Code CLI from ${launcher}`);
    script = path.resolve(path.dirname(launcher), entry[1].replace(/\\/g, path.sep));
  } else {
    script = path.resolve(path.dirname(executable), platform === 'darwin' ? '../Resources/app/out/cli.js' : 'resources/app/out/cli.js');
  }
  await fs.access(script);
  return script;
}
module.exports = { resolveCliScript };
