const fs = require('node:fs/promises');
const path = require('node:path');
const { compareTwoFiles, loadWorking, previewLoaded } = require('../src/engine.cjs');
const { bundledBinary } = require('../src/platform.cjs');
async function main() {
  const [oldFile, newFile, destination = 'demo'] = process.argv.slice(2);
  if (!oldFile || !newFile) throw new Error('Usage: npm run demo -- old.json new.json [destination]');
  const data = await compareTwoFiles(path.resolve(oldFile), path.resolve(newFile), process.env.API_DIFF_TEST_BINARY || bundledBinary(path.resolve('.')));
  Object.assign(data, { diffAvailable: true, comparisonSource: 'editor' });
  const preview = previewLoaded(await loadWorking(path.resolve(newFile), { expand: false }), { file: path.basename(newFile), diffAvailable: true, baseRef: data.baseRef });
  await fs.mkdir(destination, { recursive: true });
  const css = await fs.readFile('dist/webview.css', 'utf8');
  const script = await fs.readFile('dist/webview.js', 'utf8');
  const embedded = JSON.stringify(data).replace(/</g, '\\u003c');
  const embeddedPreview = JSON.stringify(preview).replace(/</g, '\\u003c');
  const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Swagger Lens Demo</title><style>${css}</style></head><body><div id="root"></div><script>window.API_DIFF_DEMO=${embedded};window.API_PREVIEW_DEMO=${embeddedPreview};</script><script>${script.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
  await fs.writeFile(path.join(destination, 'index.html'), html);
  await fs.writeFile(path.join(destination, 'comparison.json'), JSON.stringify(data, null, 2));
  console.log(`Demo: ${destination}/index.html; affected operations: ${data.operations.length}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
