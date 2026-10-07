const fs = require('node:fs/promises');
const path = require('node:path');
const { run } = require('./process.cjs');
async function main() {
  const files = (await fs.readdir('test')).filter(name => name.endsWith('.test.cjs')).sort().map(name => path.join('test', name));
  await run(process.execPath, ['--test', ...files]);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
