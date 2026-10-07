const vscode = require('vscode');
const path = require('node:path');
const crypto = require('node:crypto');
const { compareFile, compareLoaded, loadWorking, loadSnapshot, loadRevision, findGitRoot, previewLoaded } = require('./engine.cjs');
const { openingContext, sourceLabel } = require('./editor-context.cjs');
const { bundledBinary } = require('./platform.cjs');

function configuration(file) {
  const current = vscode.workspace.getConfiguration('swaggerLens', file);
  const legacy = vscode.workspace.getConfiguration('swaggerApiDiff', file);
  return {
    get(name, fallback) {
      const inspected = current.inspect?.(name);
      const explicit = inspected && ['globalValue', 'workspaceValue', 'workspaceFolderValue', 'globalLanguageValue', 'workspaceLanguageValue', 'workspaceFolderLanguageValue'].some(key => inspected[key] !== undefined);
      return explicit ? current.get(name, fallback) : legacy.get(name, current.get(name, fallback));
    }
  };
}

async function loadSource(uri, allowEmpty = false, options) {
  if (uri.scheme === 'file') return loadWorking(uri.fsPath, options);
  const params = JSON.parse(uri.query);
  let content;
  try { content = await vscode.workspace.fs.readFile(uri); }
  catch (error) { if (allowEmpty && error.code === 'FileNotFound') return null; throw error; }
  if (allowEmpty && !Buffer.from(content).toString('utf8').trim()) return null;
  // Freeze the Git provider's per-file ~ alias for the root document, so all
  // dependencies are read from the same side of the comparison.
  if (params.ref === '~') {
    const git = vscode.extensions.getExtension('vscode.git');
    await git.activate();
    const repository = git.exports.getAPI(1).getRepository(vscode.Uri.file(params.path));
    params.ref = repository.state.indexChanges.some(change => change.uri.fsPath === params.path) ? '' : 'HEAD';
  }
  const read = file => vscode.workspace.fs.readFile(uri.with({ path: vscode.Uri.file(file).path, query: JSON.stringify({ ...params, path: file }) }));
  return loadSnapshot(params.path, content, read, options);
}

function activate(context) {
  const panels = new Map();
  const savedTheme = context.globalState.get('previewTheme');
  let themePreference = ['light', 'dark'].includes(savedTheme) ? savedTheme : null;
  const currentTheme = () => themePreference || ([vscode.ColorThemeKind.Dark, vscode.ColorThemeKind.HighContrast].includes(vscode.window.activeColorTheme.kind) ? 'dark' : 'light');
  const updateThemes = () => {
    for (const state of panels.values()) if (state.ready) state.panel.webview.postMessage({ type: 'theme', theme: currentTheme() });
  };
  context.subscriptions.push(vscode.window.onDidChangeActiveColorTheme(() => {
    if (!themePreference) updateThemes();
  }));
  const output = vscode.window.createOutputChannel('Swagger Lens');
  context.subscriptions.push(output);
  const open = async resource => {
    let opening;
    try { opening = openingContext(vscode, resource); }
    catch (error) { return vscode.window.showErrorMessage(error.message); }
    if (!vscode.workspace.isTrusted) return vscode.window.showErrorMessage('Swagger Preview requires a trusted workspace to read local references.');
    const { source, file, original } = opening;
    const key = source.toString();
    let state = panels.get(key);
    if (state) {
      state.original = original;
      const modeChanged = state.mode !== opening.mode;
      state.mode = opening.mode;
      if (modeChanged) state.resetView();
      state.panel.reveal(vscode.ViewColumn.Beside);
      return state.refresh();
    }
    const config = configuration(file);
    state = { uri: source, file, original, mode: opening.mode, ref: config.get('baseRef', 'HEAD'), sequence: 0, ready: false, data: null, timer: null, busy: false };
    const panel = state.panel = vscode.window.createWebviewPanel('swaggerLens', `Swagger Preview: ${path.basename(file.fsPath)}`, vscode.ViewColumn.Beside, {
      enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')]
    });
    panels.set(key, state);
    const asset = name => panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', name)).toString();
    state.resetView = () => {
      // Swagger UI 3.1 caches schema contexts at module scope, including the
      // previous store and settings. A mode transition needs a fresh document.
      state.ready = false;
      state.resolutions = [];
      const nonce = crypto.randomBytes(24).toString('base64');
      const connect = state.mode === 'diff' ? "'none'" : 'http: https:';
      const theme = currentTheme();
      panel.webview.html = `<!doctype html><html lang="en" data-theme="${theme}" class="${theme === 'dark' ? 'dark-mode' : ''}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${panel.webview.cspSource} 'unsafe-inline'; img-src ${panel.webview.cspSource} data:; font-src ${panel.webview.cspSource} data:; connect-src ${connect};"><link rel="stylesheet" href="${asset('webview.css')}"><title>Swagger Preview</title></head><body data-mode="${state.mode}"><div id="root"></div><script nonce="${nonce}" src="${asset('webview.js')}"></script></body></html>`;
    };
    state.resetView();
    const post = message => state.ready && panel.webview.postMessage(message);
    const status = () => ({ mode: state.mode, diffAvailable: Boolean(state.root), diffUnavailableReason: state.root ? '' : 'Diff is available for files in a Git repository.', baseRef: state.original ? sourceLabel(state.original) : state.ref, comparisonSource: state.original ? 'editor' : 'git' });
    const dirty = () => vscode.workspace.textDocuments.some(doc => doc.isDirty && state.dependencies?.includes(doc.uri.fsPath));
    const refresh = state.refresh = async () => {
      const sequence = ++state.sequence;
      state.busy = true;
      state.error = null;
      state.data = null;
      const mainDependencies = [file.fsPath, ...[state.original].filter(uri => uri?.scheme === 'file').map(uri => uri.fsPath)];
      state.dependencies = [...new Set([...(state.dependencies || []), ...mainDependencies])];
      post({ type: 'busy', ...status() });
      try {
        const root = await findGitRoot(file.fsPath);
        if (sequence !== state.sequence) return;
        state.root = root;
        if (!root && state.mode === 'diff') { state.mode = 'preview'; state.resetView(); }
        const mode = state.mode, left = state.original;
        post({ type: 'busy', ...status() });
        let data;
        if (mode === 'preview') data = previewLoaded(await loadSource(source, false, { expand: false }), { file: path.basename(file.fsPath) });
        else {
          const selected = configuration(file).get('oasdiffPath', '');
          const binary = selected || bundledBinary(context.extensionPath);
          if (left) {
            const [base, revision] = await Promise.all([loadSource(left, true), loadSource(source, true)]);
            data = await compareLoaded(base, revision, binary, { file: path.basename(file.fsPath), revisionLabel: source.scheme === 'file' ? 'saved file' : sourceLabel(source) });
          } else if (source.scheme === 'git') {
            const relative = path.relative(root, file.fsPath).split(path.sep).join('/');
            const [base, revision] = await Promise.all([loadRevision(root, state.ref, relative), loadSource(source)]);
            data = await compareLoaded(base, revision, binary, { file: relative, revisionLabel: sourceLabel(source) });
          } else data = await compareFile(file.fsPath, state.ref, binary);
        }
        if (sequence !== state.sequence) return;
        state.dependencies = [...new Set([...mainDependencies, ...(data.dependencies || [])])];
        state.data = { ...data, ...status(), root, dependencies: state.dependencies };
        state.busy = false;
        panel.title = `${mode === 'diff' ? 'API Diff' : 'Swagger Preview'}: ${path.basename(file.fsPath)}`;
        post({ type: 'data', data: state.data });
        post({ type: 'dirty', dirty: dirty() });
        output.appendLine(mode === 'diff' ? `${data.file}: ${data.operations.length} affected operations against ${state.data.baseRef}` : `${data.file}: Swagger Preview`);
        return { file: data.file, mode, diffAvailable: Boolean(root), baseRef: state.data.baseRef, baseMissing: data.baseMissing, comparisonSource: state.data.comparisonSource, affectedMethods: data.operations?.map(op => `${op.method.toUpperCase()} ${op.scope === 'webhooks' ? 'webhook:' : ''}${op.path}`) || [] };
      } catch (error) {
        if (sequence !== state.sequence) return;
        state.busy = false;
        state.error = error.message;
        post({ type: 'error', error: error.message, ...status() });
        output.appendLine(error.stack || error.message);
      }
    };
    const setMode = state.setMode = async mode => {
      if (!['preview', 'diff'].includes(mode)) return;
      if (mode === 'diff' && !state.root) mode = 'preview';
      const modeChanged = mode !== state.mode;
      state.mode = mode;
      if (modeChanged) state.resetView();
      return refresh();
    };
    state.setBase = ref => {
      if (!ref) return;
      state.ref = ref; state.original = null;
      return refresh();
    };
    panel.webview.onDidReceiveMessage(async message => {
      if (message.type === 'ready') {
        state.ready = true;
        post({ type: 'theme', theme: currentTheme() });
        if (state.busy) post({ type: 'busy', ...status() });
        else if (state.data) post({ type: 'data', data: state.data });
        else if (state.error) post({ type: 'error', error: state.error, ...status() });
        post({ type: 'dirty', dirty: dirty() });
      } else if (message.type === 'theme' && ['light', 'dark'].includes(message.theme)) {
        themePreference = message.theme;
        updateThemes();
        await context.globalState.update('previewTheme', themePreference);
      } else if (message.type === 'resolverResult' && Array.isArray(message.path) && Array.isArray(message.errors)) {
        const result = { path: message.path.filter(value => typeof value === 'string'), errors: message.errors.filter(value => typeof value === 'string') };
        state.resolutions.push(result);
        for (const error of result.errors) output.appendLine(`Swagger UI: ${error}`);
      } else if (message.type === 'refresh') await refresh();
      else if (message.type === 'mode') await setMode(message.mode);
      else if (message.type === 'base' && state.root && state.mode === 'diff') {
        const ref = await vscode.window.showInputBox({ title: 'Compare API with Git revision', value: state.ref, prompt: 'Branch, tag, or commit, e.g. HEAD or origin/main' });
        if (ref) await state.setBase(ref);
      }
    }, null, context.subscriptions);
    panel.onDidDispose(() => { state.sequence++; clearTimeout(state.timer); panels.delete(key); }, null, context.subscriptions);
    return refresh();
  };
  context.subscriptions.push(vscode.commands.registerCommand('swaggerLens.open', open));
  context.subscriptions.push(vscode.commands.registerCommand('swaggerApiDiff.open', open));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
    for (const state of panels.values()) {
      const relative = state.root && path.relative(state.root, document.uri.fsPath);
      if (state.dependencies?.includes(document.uri.fsPath) || (relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
        clearTimeout(state.timer);
        state.timer = setTimeout(() => state.refresh(), 250);
      }
    }
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
    for (const state of panels.values()) if (state.ready && state.dependencies?.includes(event.document.uri.fsPath)) {
      state.panel.webview.postMessage({ type: 'dirty', dirty: vscode.workspace.textDocuments.some(doc => doc.isDirty && state.dependencies.includes(doc.uri.fsPath)) });
    }
  }));
  // Host tests use the same transitions as the webview through this small API.
  return {
    setMode: (uri, mode) => panels.get(uri.toString())?.setMode(mode),
    setBase: (uri, ref) => panels.get(uri.toString())?.setBase(ref),
    ...(process.env.API_DIFF_TEST_RESULT && {
      clickPreview: (uri, selector, text = '') => panels.get(uri.toString())?.panel.webview.postMessage({ type: 'testClick', selector, text })
    }),
    getPreview: uri => {
      const state = panels.get(uri.toString());
      return state && { mode: state.mode, busy: state.busy, ready: state.ready, data: state.data, error: state.error, resolutions: state.resolutions };
    }
  };
}

module.exports = { activate, deactivate() {} };
