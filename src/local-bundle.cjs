const { $RefParser: RefParser, FileResolver } = require('@apidevtools/json-schema-ref-parser');
const { fileURLToPath, pathToFileURL } = require('node:url');
const YAML = require('yaml');
const { prepareRefs, isLiteral } = require('./schema31.cjs');

class FullDocumentResolution extends Error {}
const pointerToken = key => key.replace(/~/g, '~0').replace(/\//g, '~1');
const identifier = value => ['$id', '$anchor', '$dynamicAnchor', '$dynamicRef', '$recursiveRef'].some(key => key in value) || typeof value.id === 'string';

function select(document, pointer) {
  if (pointer && !pointer.startsWith('/')) throw new FullDocumentResolution();
  const tokens = pointer ? pointer.slice(1).split('/').map(token => token.replace(/~1/g, '/').replace(/~0/g, '~')) : [];
  let value = document;
  for (const token of tokens) {
    // Schema identifiers can change the meaning of relative references. Let the
    // existing resolver handle their scope and named anchors without pruning.
    if (!value || typeof value !== 'object' || identifier(value) || !Object.hasOwn(value, token)) throw new FullDocumentResolution();
    value = value[token];
  }
  return { value, tokens };
}

function project(document, pointers) {
  if (pointers.has('')) return document;
  const result = Array.isArray(document) ? [] : {};
  const included = [];
  for (const pointer of [...pointers].sort((a, b) => a.length - b.length)) {
    if (included.some(parent => pointer === parent || pointer.startsWith(`${parent}/`))) continue;
    const { value, tokens } = select(document, pointer);
    let target = result, original = document;
    for (const [index, token] of tokens.entries()) {
      if (index === tokens.length - 1) Object.defineProperty(target, token, { value, enumerable: true, configurable: true, writable: true });
      else {
        original = original[token];
        if (!Object.hasOwn(target, token)) Object.defineProperty(target, token, { value: Array.isArray(original) ? [] : {}, enumerable: true, configurable: true, writable: true });
        target = target[token];
      }
    }
    included.push(pointer);
  }
  return result;
}

// Keep original document paths so the mature bundler still handles circular
// references, aliases and deduplication. Only its input documents are trimmed.
async function bundleLocal(root, parsed, readDocument, is31) {
  const rootDrive = root.startsWith('file:') && new URL(root).pathname.match(/^\/([a-z]):/i)?.[1];
  const canonical = source => {
    const url = new URL(/^[a-z]:\//i.test(source) ? `file:///${source}` : source, root);
    // RefParser lowercases Windows drive letters. Keep the caller's casing
    // for stable cache keys and dependency paths used by VS Code save events.
    if (url.protocol === 'file:' && rootDrive) url.pathname = url.pathname.replace(/^\/([a-z]):/i, (_, drive) => `/${rootDrive === rootDrive.toUpperCase() ? drive.toUpperCase() : drive.toLowerCase()}:`);
    const href = url.protocol === 'file:' ? pathToFileURL(fileURLToPath(url)).href : url.href;
    // Unreserved characters have the same URI identity whether encoded or not.
    return href.replace(/%[0-9a-f]{2}/gi, token => {
      const character = String.fromCharCode(parseInt(token.slice(1), 16));
      return /^[a-z0-9._~-]$/i.test(character) ? character : token.toUpperCase();
    });
  };
  root = canonical(root);
  const documents = new Map([[root, Promise.resolve(parsed)]]);
  const selected = new Map(), visited = new Set();
  const document = url => {
    if (!documents.has(url)) documents.set(url, Promise.resolve().then(() => readDocument(url)).then(content => YAML.parse(Buffer.from(content).toString('utf8'))));
    return documents.get(url);
  };
  const include = async url => {
    const target = new URL(url), pointer = decodeURIComponent(target.hash.slice(1));
    target.hash = '';
    const file = canonical(target.href), key = `${file}#${pointer}`;
    if (!['file:', 'snapshot:', 'gitref:'].includes(target.protocol)) throw new FullDocumentResolution();
    if (visited.has(key)) return;
    visited.add(key);
    const raw = await document(file);
    const { value } = select(raw, pointer);
    if (file !== root) {
      if (!selected.has(file)) selected.set(file, new Set());
      selected.get(file).add(pointer);
    }
    await walk(value, file, pointer);
  };
  const walk = async (value, file, pointer, ancestors = new Set()) => {
    if (isLiteral(`#${pointer}`) || !value || typeof value !== 'object' || ancestors.has(value)) return;
    if (identifier(value)) throw new FullDocumentResolution();
    if (typeof value.$ref === 'string') await include(new URL(value.$ref, file).href);
    const next = new Set(ancestors); next.add(value);
    for (const [key, child] of Object.entries(value)) await walk(child, file, `${pointer}/${pointerToken(key)}`, next);
  };
  let selective = true;
  try { await include(root); }
  catch (error) { if (!(error instanceof FullDocumentResolution)) throw error; selective = false; }
  const prepared = new Map();
  if (selective) {
    for (const [file, pointers] of selected) {
      const value = project(await document(file), pointers);
      prepared.set(file, is31 ? prepareRefs(value) : value);
    }
  }
  const resolver = {
    order: 1, canRead: file => /^(snapshot|gitref):/.test(file.url) || FileResolver.canRead(file),
    async read(file) {
      const url = canonical(file.url);
      if (!prepared.has(url)) {
        const raw = await document(url);
        prepared.set(url, is31 ? prepareRefs(raw) : raw);
      }
      return JSON.stringify(prepared.get(url));
    }
  };
  // The parser encodes file paths itself, including file:// inputs. Pass a
  // physical path to avoid encoding an already encoded URL a second time.
  const parserRoot = root.startsWith('file:') ? fileURLToPath(root) : root;
  const bundle = await RefParser.bundle(parserRoot, is31 ? prepareRefs(parsed) : parsed, {
    resolve: { file: false, http: false, local: resolver },
    resolveExcludedPathMatcher: isLiteral, bundle: { excludedPathMatcher: isLiteral }
  });
  return { bundle, dependencies: [...documents.keys()] };
}

module.exports = { bundleLocal };
