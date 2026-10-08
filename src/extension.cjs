const vscode = require('vscode');
const path = require('node:path');
const crypto = require('node:crypto');
const { compareFile, compareLoaded, loadWorking, loadSnapshot, loadRevision, findGitRoot, previewLoaded } = require('./engine.cjs');
const { githubSnapshotReader, reviewRepositoryRoot, fileUri, snapshotDependencyUri, openingContext, sourceLabel, sourceIsOpen } = require('./editor-context.cjs');
const { configuration: readConfiguration, previewSettings } = require('./configuration.cjs');
const configuration = file => readConfiguration(vscode, file);
const { bundledBinary } = require('./platform.cjs');

async function loadSource(uri, allowEmpty = false, options) {
  if (uri.scheme === 'file') return loadWorking(uri.fsPath, options);
  const file = fileUri(vscode, uri).fsPath;
  const params = JSON.parse(uri.query);
  let content;
  try { content = await vscode.workspace.fs.readFile(uri); }
  catch (error) { if (allowEmpty && error.code === 'FileNotFound') return null; throw error; }
  if (allowEmpty && !Buffer.from(content).toString('utf8').trim()) return null;
  // Freeze the Git provider's per-file ~ alias for the root document, so all
  // dependencies are read from the same side of the comparison.
  if (uri.scheme === 'git' && params.ref === '~') {
    const git = vscode.extensions.getExtension('vscode.git');
    await git.activate();
    const repository = git.exports.getAPI(1).getRepository(vscode.Uri.file(params.path));
    params.ref = repository.state.indexChanges.some(change => change.uri.fsPath === params.path) ? '' : 'HEAD';
  }
  const snapshot = uri.with({ query: JSON.stringify(params) });
  const read = ['pr', 'review'].includes(uri.scheme) ? await githubSnapshotReader(vscode, uri)
    : dependency => vscode.workspace.fs.readFile(snapshotDependencyUri(vscode, snapshot, dependency));
  return loadSnapshot(file, content, read, options);
}

function activate(context) {
  const panels = new Map();
  const savedTheme = context.globalState.get('previewTheme');
  let themePreference = ['light', 'dark'].includes(savedTheme) ? savedTheme : null;
  const currentTheme = file => {
    const configured = previewSettings(configuration(file)).theme;
    const explicit = configuration(file).isExplicit('theme');
    return (configured !== 'auto' ? configured : explicit ? null : themePreference) || ([vscode.ColorThemeKind.Dark, vscode.ColorThemeKind.HighContrast].includes(vscode.window.activeColorTheme.kind) ? 'dark' : 'light');
  };
  const updateThemes = (followEditorOnly = false) => {
    for (const state of panels.values()) {
      const followsEditor = state.settings.theme === 'auto' && (!themePreference || configuration(state.file).isExplicit('theme'));
      if (state.ready && (!followEditorOnly || followsEditor)) state.panel.webview.postMessage({ type: 'theme', theme: currentTheme(state.file) });
    }
  };
  context.subscriptions.push(vscode.window.onDidChangeActiveColorTheme(() => updateThemes(true)));
  const output = vscode.window.createOutputChannel('Swagger Lens');
  context.subscriptions.push(output);
  const open = async resource => {
    let opening;
    try { opening = openingContext(vscode, resource); }
    catch (error) { return vscode.window.showErrorMessage(error.message); }
    if (!vscode.workspace.isTrusted) return vscode.window.showErrorMessage('Swagger Preview requires a trusted workspace to read local references.');
    const { source, file, original } = opening;
    const config = configuration(file);
    const settings = previewSettings(config);
    if (settings.defaultMode !== 'auto') opening.mode = settings.defaultMode;
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
    state = { uri: source, file, original, mode: opening.mode, ref: config.get('baseRef', 'HEAD'), sequence: 0, ready: false, data: null, timer: null, busy: false, settings, viewReset: new Set(), sourceWasOpen: sourceIsOpen(vscode, file) };
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
      const connect = state.mode === 'diff' || !state.settings.tryItOutEnabled ? "'none'" : 'http: https:';
      const theme = currentTheme(file);
      const settingsAttribute = JSON.stringify(state.settings).replaceAll('"', '&quot;');
      panel.webview.html = `<!doctype html><html lang="en" data-theme="${theme}" class="${theme === 'dark' ? 'dark-mode' : ''}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${panel.webview.cspSource} 'unsafe-inline'; img-src ${panel.webview.cspSource} data:; font-src ${panel.webview.cspSource} data:; connect-src ${connect};"><link rel="stylesheet" href="${asset('webview.css')}"><title>Swagger Preview</title></head><body data-mode="${state.mode}" data-settings="${settingsAttribute}"><div id="root"></div><script nonce="${nonce}" src="${asset('webview.js')}"></script></body></html>`;
    };
    state.resetView();
    const post = message => state.ready && panel.webview.postMessage(message);
    const status = () => ({ mode: state.mode, diffAvailable: Boolean(state.root || state.original), canSelectBase: Boolean(state.root), diffUnavailableReason: state.root || state.original ? '' : 'Diff needs a Git repository or an open comparison.', baseRef: state.original ? sourceLabel(state.original) : state.ref, comparisonSource: state.original ? 'editor' : 'git' });
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
        // Local Git is optional for review snapshots fetched by extension providers.
        const reviewRoot = reviewRepositoryRoot(vscode, source);
        const root = reviewRoot
          ? await findGitRoot(path.join(reviewRoot, '.swagger-lens-source')).catch(() => null)
          : await findGitRoot(file.fsPath);
        if (sequence !== state.sequence) return;
        state.root = root;
        if (!root && !state.original && state.mode === 'diff') { state.mode = 'preview'; state.resetView(); }
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
          } else if (source.scheme !== 'file') {
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
        return { file: data.file, mode, diffAvailable: Boolean(root || state.original), baseRef: state.data.baseRef, baseMissing: data.baseMissing, comparisonSource: state.data.comparisonSource, affectedMethods: data.operations?.map(op => `${op.method.toUpperCase()} ${op.scope === 'webhooks' ? 'webhook:' : ''}${op.path}`) || [] };
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
      if (mode === 'diff' && !state.root && !state.original) mode = 'preview';
      const modeChanged = mode !== state.mode;
      state.mode = mode;
      if (modeChanged) state.resetView();
      return refresh();
    };
    state.setBase = ref => {
      if (!ref || !state.root) return;
      state.ref = ref; state.original = null;
      return refresh();
    };
    panel.webview.onDidReceiveMessage(async message => {
      if (message.type === 'ready') {
        state.ready = true;
        post({ type: 'theme', theme: currentTheme(state.file) });
        post({ type: 'settings', settings: state.settings, reset: [...state.viewReset] });
        state.viewReset.clear();
        if (state.busy) post({ type: 'busy', ...status() });
        else if (state.data) post({ type: 'data', data: state.data });
        else if (state.error) post({ type: 'error', error: state.error, ...status() });
        post({ type: 'dirty', dirty: dirty() });
      } else if (message.type === 'theme' && ['light', 'dark'].includes(message.theme)) {
        themePreference = message.theme;
        await context.globalState.update('previewTheme', themePreference);
        const themeConfig = vscode.workspace.getConfiguration('swaggerLens');
        const target = themeConfig.inspect('theme')?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
        await themeConfig.update('theme', message.theme, target);
        updateThemes();
      } else if (message.type === 'viewState' && process.env.API_DIFF_TEST_RESULT) {
        state.viewState = message.state;
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
      if (state.settings.autoRefresh && (state.dependencies?.includes(document.uri.fsPath) || (relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)))) {
        clearTimeout(state.timer);
        state.timer = setTimeout(() => { if (state.settings.autoRefresh) state.refresh(); }, 250);
      }
    }
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
    for (const state of panels.values()) if (state.ready && state.dependencies?.includes(event.document.uri.fsPath)) {
      state.panel.webview.postMessage({ type: 'dirty', dirty: vscode.workspace.textDocuments.some(doc => doc.isDirty && state.dependencies.includes(doc.uri.fsPath)) });
    }
  }));
  // Tab events reflect editor closure; document disposal also fires on language changes.
  let closeTimer;
  const reconcileSources = () => {
    for (const state of panels.values()) {
      if (sourceIsOpen(vscode, state.file)) state.sourceWasOpen = true;
      else if (state.sourceWasOpen && state.settings.autoClosePreview) state.panel.dispose();
    }
  };
  const scheduleClosure = () => {
    clearTimeout(closeTimer);
    // Moving an editor between groups can emit close/open events in one turn.
    closeTimer = setTimeout(reconcileSources, 0);
  };
  context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(scheduleClosure));
  context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabGroups(scheduleClosure));
  context.subscriptions.push({ dispose: () => clearTimeout(closeTimer) });
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('swaggerLens.theme') && previewSettings(configuration()).theme === 'auto') {
      themePreference = null;
      void context.globalState.update('previewTheme', undefined);
    }
    for (const state of panels.values()) {
      if (!event.affectsConfiguration('swaggerLens', state.file) && !event.affectsConfiguration('swaggerApiDiff', state.file)) continue;
      const config = configuration(state.file), previous = state.settings;
      state.settings = previewSettings(config);
      for (const name of ['changesOnly', 'showChangesList']) if (previous[name] !== state.settings[name]) state.viewReset.add(name);
      if (!state.settings.autoRefresh) clearTimeout(state.timer);
      const baseChanged = event.affectsConfiguration('swaggerLens.baseRef', state.file) || event.affectsConfiguration('swaggerApiDiff.baseRef', state.file);
      if (baseChanged) state.ref = config.get('baseRef', 'HEAD');
      const viewChanged = ['docExpansion', 'schemaExpandDepth', 'tryItOutEnabled'].some(name => previous[name] !== state.settings[name]);
      const engineChanged = event.affectsConfiguration('swaggerLens.oasdiffPath', state.file) || event.affectsConfiguration('swaggerApiDiff.oasdiffPath', state.file);
      if (viewChanged) state.resetView();
      if (state.ready) {
        state.panel.webview.postMessage({ type: 'settings', settings: state.settings, reset: [...state.viewReset] });
        state.viewReset.clear();
      }
      if (viewChanged || (state.mode === 'diff' && ((baseChanged && !state.original) || engineChanged))) void state.refresh();
    }
    updateThemes();
    scheduleClosure();
  }));
  // Host tests use the same transitions as the webview through this small API.
  return {
    setMode: (uri, mode) => panels.get(uri.toString())?.setMode(mode),
    setBase: (uri, ref) => panels.get(uri.toString())?.setBase(ref),
    ...(process.env.API_DIFF_TEST_RESULT && {
      clickPreview: (uri, selector, text = '') => panels.get(uri.toString())?.panel.webview.postMessage({ type: 'testClick', selector, text }),
      inspectPreview: uri => {
        const state = panels.get(uri.toString());
        if (state) { state.viewState = null; return state.panel.webview.postMessage({ type: 'testInspect' }); }
      }
    }),
    getPreview: uri => {
      const state = panels.get(uri.toString());
      return state && { mode: state.mode, busy: state.busy, ready: state.ready, data: state.data, error: state.error, resolutions: state.resolutions, settings: state.settings, ...(process.env.API_DIFF_TEST_RESULT && { viewState: state.viewState }) };
    }
  };
}

module.exports = { activate, deactivate() {} };
