const fs = require('node:fs/promises');
const path = require('node:path');

async function generateNotices(inputs) {
  const directories = new Set();
  for (const file of inputs) {
    const matches = [...file.matchAll(/node_modules\/((?:@[^/]+\/)?[^/]+)/g)];
    const match = matches.at(-1);
    if (match) directories.add(file.slice(0, match.index + match[0].length));
  }
  const destination = path.resolve('THIRD-PARTY/npm');
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });
  const inventory = [];
  for (const directory of [...directories].sort()) {
    const pkg = JSON.parse(await fs.readFile(path.join(directory, 'package.json')));
    const name = `${pkg.name.replace(/[@/]/g, '_')}-${pkg.version}`;
    const target = path.join(destination, name);
    await fs.mkdir(target, { recursive: true });
    const files = (await fs.readdir(directory)).filter(file => /^(license|licence|copying|copyright|notice)([._-]|$)/i.test(file));
    for (const file of files) await fs.copyFile(path.join(directory, file), path.join(target, file));
    if (!files.some(file => /^(license|licence|copying)/i.test(file))) {
      const supplemental = pkg.name.startsWith('@swagger-api/apidom-') ? 'apidom' : pkg.name;
      await fs.copyFile(path.join('THIRD-PARTY/supplemental', supplemental + '.LICENSE'), path.join(target, 'LICENSE'));
      files.push('LICENSE');
      const extra = path.join('THIRD-PARTY/supplemental', supplemental + '.NOTICE');
      try { await fs.copyFile(extra, path.join(target, 'NOTICE')); files.push('NOTICE'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (pkg.name.startsWith('@swagger-api/apidom-')) {
      await fs.cp('THIRD-PARTY/supplemental/apidom/LICENSES', path.join(target, 'LICENSES'), { recursive: true });
      files.push('LICENSES/');
    }
    inventory.push({ name: pkg.name, version: pkg.version, license: pkg.license || pkg.licenses?.[0]?.type, directory: `npm/${name}`, files: files.sort() });
  }
  inventory.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  await fs.writeFile('THIRD-PARTY/npm-components.json', JSON.stringify(inventory, null, 2) + '\n');
  const rows = inventory.map(pkg => `| ${pkg.name} | ${pkg.version} | ${pkg.license} | [Files](${pkg.directory}/) |`);
  await fs.writeFile('THIRD-PARTY/README.md', `# Third-party notices

Swagger Lens's own code is licensed under Apache-2.0. The components below retain their original licenses and copyright notices.

The npm inventory is generated from both esbuild input graphs, including transitive dependencies. Full licenses and upstream NOTICE files are copied without modification. Supplemental licenses cover notices omitted from npm packages; their provenance is recorded in supplemental/README.md. Generated bundle comments are retained in dist/*.LEGAL.txt.

oasdiff 1.33.0 and its Go runtime and module notices are in oasdiff.LICENSE, go-components.json, and go/. The Go inventory covers the union of dependencies recorded in all bundled platform binaries. Native archives are verified against pinned SHA-256 hashes before packaging.

## Bundled JavaScript components

| Component | Version | License | Notices |
| --- | --- | --- | --- |
${rows.join('\n')}
`);
  return inventory;
}

module.exports = { generateNotices };
