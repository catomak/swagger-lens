const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { $RefParser: RefParser, FileResolver } = require('@apidevtools/json-schema-ref-parser');
const YAML = require('yaml');
const { annotate } = require('./annotate.cjs');
const { compatibilityWarnings, isLiteral } = require('./schema31.cjs');
const { bundleLocal } = require('./local-bundle.cjs');
const run = promisify(execFile);
const commandOptions = { maxBuffer: 64 * 1024 * 1024, timeout: 30000, windowsHide: true };

async function git(root, args) {
  return (await run('git', ['-C', root, ...args], commandOptions)).stdout.trimEnd();
}

function checkSpec(spec) {
  if (!/^3\.[01]\.\d+$/.test(spec?.openapi || '')) throw new Error('This prototype supports OpenAPI 3.0.x and 3.1.x in JSON or YAML.');
  if (!spec.info || typeof spec.info.title !== 'string' || typeof spec.info.version !== 'string' || (!spec.paths && (!spec.openapi.startsWith('3.1.') || (!spec.webhooks && !spec.components)))) throw new Error('The selected file is not a complete OpenAPI document.');
}

async function expandLoaded(loaded, expand) {
  if (!expand) return loaded;
  const expanded = await RefParser.dereference(structuredClone(loaded.bundle), { resolve: { file: false, http: false }, resolveExcludedPathMatcher: isLiteral, dereference: { circular: 'ignore', excludedPathMatcher: isLiteral } });
  return { ...loaded, expanded };
}

async function loadWorking(file, { expand = true } = {}) {
  const parsed = YAML.parse(await fs.readFile(file, 'utf8'));
  checkSpec(parsed);
  const is31 = parsed.openapi.startsWith('3.1.');
  const loaded = await bundleLocal(pathToFileURL(path.resolve(file)).href, parsed, url => FileResolver.read({ url }), is31);
  loaded.dependencies = loaded.dependencies.map(url => fileURLToPath(url));
  return expandLoaded(loaded, expand);
}

// A VS Code comparison can contain historical or staged files. Its reader must
// resolve every dependency from that same side, never from the working tree.
async function loadSnapshot(file, content, readFile, { expand = true } = {}) {
  const parsed = YAML.parse(Buffer.from(content).toString('utf8'));
  checkSpec(parsed);
  const is31 = parsed.openapi.startsWith('3.1.');
  const toUrl = file => `snapshot://${pathToFileURL(file).pathname}`;
  const loaded = await bundleLocal(toUrl(file), parsed, source => {
    const url = new URL(source);
    if (url.hostname) throw new Error('Invalid snapshot reference path.');
    return readFile(fileURLToPath(`file://${url.pathname}`));
  }, is31);
  loaded.dependencies = [];
  return expandLoaded(loaded, expand);
}

async function findGitRoot(file) {
  try { return await git(path.dirname(file), ['rev-parse', '--show-toplevel']); }
  catch (error) {
    if (error.code === 'ENOENT' || /not a git repository/i.test(error.stderr || '')) return null;
    throw error;
  }
}

function previewLoaded(revision, metadata = {}) {
  return { spec: revision.bundle, mode: 'preview', dependencies: revision.dependencies || [], ...metadata, computedAt: new Date().toISOString() };
}

async function previewFile(file) {
  const [revision, root] = await Promise.all([loadWorking(file, { expand: false }), findGitRoot(file)]);
  return previewLoaded(revision, { file: path.basename(file), root, diffAvailable: Boolean(root) });
}

async function loadRevision(root, ref, relativePath, { expand = true } = {}) {
  if (!ref || ref.includes(':') || /\s|\0/.test(ref) || ref.startsWith('-')) throw new Error('Enter a Git branch, tag, or commit such as HEAD or origin/main.');
  const commit = await git(root, ['rev-parse', '--verify', `${ref}^{commit}`]);
  // A new working file can be absent from a valid baseline. Other Git/parser
  // failures must still surface rather than silently treating an API as new.
  const entry = await git(root, ['--literal-pathspecs', 'ls-tree', '--full-tree', '-z', commit, '--', relativePath]);
  if (!entry) return null;
  const parsed = YAML.parse(await git(root, ['show', `${commit}:${relativePath}`]));
  checkSpec(parsed);
  const is31 = parsed.openapi.startsWith('3.1.');
  const url = `gitref:///${relativePath.split('/').map(encodeURIComponent).join('/')}`;
  const loaded = await bundleLocal(url, parsed, source => {
    const url = new URL(source);
    const requested = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (url.hostname || requested.split('/').includes('..')) throw new Error('Invalid Git reference path.');
    return git(root, ['show', `${commit}:${requested}`]);
  }, is31);
  loaded.dependencies = [];
  return expandLoaded(loaded, expand);
}

async function compareLoaded(base, revision, binary, metadata = {}) {
  const baseMissing = !base, revisionMissing = !revision;
  if (!base && !revision) throw new Error('Both sides of the comparison are empty.');
  const empty = { openapi: (revision || base).bundle.openapi, info: structuredClone((revision || base).bundle.info), paths: {} };
  base ||= { bundle: empty, expanded: empty };
  revision ||= { bundle: empty, expanded: empty };
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'swagger-lens-'));
  try {
    const oldFile = path.join(temp, 'base.json'), newFile = path.join(temp, 'revision.json');
    await Promise.all([fs.writeFile(oldFile, JSON.stringify(base.bundle)), fs.writeFile(newFile, JSON.stringify(revision.bundle))]);
    const invoke = async command => JSON.parse((await run(binary, [command, oldFile, newFile, '--allow-external-refs=false', '-f', 'json', ...(command === 'changelog' ? ['-l', 'en'] : [])], commandOptions)).stdout || (command === 'diff' ? '{}' : '[]'));
    const [diff, changelog] = await Promise.all([invoke('diff'), invoke('changelog')]);
    const warnings = [...new Set([...compatibilityWarnings(base.bundle), ...compatibilityWarnings(revision.bundle)])];
    return { ...annotate(base.expanded, revision.expanded, diff, changelog), mode: 'diff', baseMissing, revisionMissing, dependencies: [...new Set([...(base.dependencies || []), ...(revision.dependencies || [])])], ...metadata, warnings, computedAt: new Date().toISOString() };
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

async function compareFile(file, ref, binary) {
  file = await fs.realpath(file);
  const root = await git(path.dirname(file), ['rev-parse', '--show-toplevel']);
  const relativePath = path.relative(root, file).split(path.sep).join('/');
  const [base, revision] = await Promise.all([loadRevision(root, ref, relativePath), loadWorking(file)]);
  return compareLoaded(base, revision, binary, { file: relativePath, baseRef: ref, root });
}

async function compareTwoFiles(oldFile, newFile, binary) {
  const [base, revision] = await Promise.all([loadWorking(oldFile), loadWorking(newFile)]);
  return compareLoaded(base, revision, binary, { file: path.basename(newFile), baseRef: path.basename(oldFile) });
}

module.exports = { compareFile, compareTwoFiles, compareLoaded, loadRevision, loadWorking, loadSnapshot, findGitRoot, previewLoaded, previewFile };
