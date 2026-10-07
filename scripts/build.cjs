const esbuild = require('esbuild');
const fs = require('node:fs/promises');
const { generateNotices } = require('./notices.cjs');
async function main() {
  await fs.mkdir('dist', { recursive: true });
  const results = await Promise.all([
    esbuild.build({ entryPoints: ['src/extension.cjs'], outfile: 'dist/extension.cjs', bundle: true, platform: 'node', target: 'node20', external: ['vscode'], legalComments: 'linked', metafile: true }),
    esbuild.build({ entryPoints: ['src/webview.jsx'], outfile: 'dist/webview.js', bundle: true, platform: 'browser', target: 'chrome120', minify: true, define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'linked', metafile: true })
  ]);
  await generateNotices(results.flatMap(result => Object.keys(result.metafile.inputs)));
  await fs.mkdir('.build', { recursive: true });
  await fs.writeFile('.build/bundle-inputs.json', JSON.stringify(results.flatMap(result => Object.keys(result.metafile.inputs)), null, 2) + '\n');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
