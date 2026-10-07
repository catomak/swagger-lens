const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the real extension message handlers with a small VS Code host.
function host(kind, storage = new Map(), settings = {}) {
  const panels = [], themeListeners = [];
  let open;
  const disposable = () => ({ dispose() {} });
  const uri = file => ({ fsPath: file, scheme: 'file', toString: () => file });
  const vscode = {
    ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
    Uri: { joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) },
    ViewColumn: { Beside: 2 },
    commands: { registerCommand: (name, handler) => { open = handler; return disposable(); } },
    workspace: {
      isTrusted: true, textDocuments: [],
      getConfiguration: section => ({
        get: (name, fallback) => settings[`${section}.${name}`] ?? fallback,
        inspect: name => ({ workspaceValue: settings[`${section}.${name}`] })
      }),
      onDidSaveTextDocument: disposable, onDidChangeTextDocument: disposable
    },
    window: {
      activeColorTheme: { kind },
      onDidChangeActiveColorTheme: listener => { themeListeners.push(listener); return disposable(); },
      createOutputChannel: () => ({ ...disposable(), appendLine() {} }),
      createWebviewPanel: () => {
        const panel = { reveal() {}, messages: [], webview: { cspSource: 'test:', asWebviewUri: value => value } };
        panel.webview.postMessage = message => { panel.messages.push(message); return Promise.resolve(true); };
        panel.webview.onDidReceiveMessage = handler => { panel.send = handler; return disposable(); };
        panel.onDidDispose = handler => { panel.dispose = handler; return disposable(); };
        panels.push(panel);
        return panel;
      }
    }
  };
  const context = {
    subscriptions: [], extensionUri: uri('/extension'), extensionPath: '/extension',
    globalState: { get: key => storage.get(key), update: async (key, value) => storage.set(key, value) }
  };
  const engine = {
    findGitRoot: async () => null,
    loadWorking: async file => ({ file }),
    previewLoaded: loaded => ({ spec: {}, dependencies: [loaded.file] })
  };
  const module = { exports: {} };
  const requireMock = name => name === 'vscode' ? vscode : name === './engine.cjs' ? engine : name === './editor-context.cjs'
    ? { openingContext: (vscode, file) => ({ source: file, file, original: null, mode: 'preview' }), sourceLabel: () => 'HEAD' }
    : name === './platform.cjs' ? require('../src/platform.cjs') : require(name);
  vm.runInNewContext(fs.readFileSync(path.resolve('src/extension.cjs'), 'utf8'), { require: requireMock, module, Buffer, process, setTimeout, clearTimeout });
  module.exports.activate(context);
  return {
    panels, storage,
    async open(file) { await open(uri(file)); return panels.at(-1); },
    changeTheme(kind) { vscode.window.activeColorTheme = { kind }; themeListeners.forEach(listener => listener({ kind })); }
  };
}

test('the initial preview theme follows VS Code, including both high contrast variants', async () => {
  for (const [kind, theme] of [[1, 'light'], [2, 'dark'], [3, 'dark'], [4, 'light']]) {
    const app = host(kind), panel = await app.open('/api.json');
    assert.ok(panel.webview.html.includes(`data-theme="${theme}"`));
    if (theme === 'dark') assert.ok(panel.webview.html.includes('class="dark-mode"'));
    await panel.send({ type: 'ready' });
    assert.equal(panel.messages.find(message => message.type === 'theme').theme, theme);
    assert.equal(app.storage.has('previewTheme'), false);
    panel.messages.length = 0;
    app.changeTheme(theme === 'dark' ? 1 : 2);
    assert.equal(panel.messages.at(-1).theme, theme === 'dark' ? 'light' : 'dark');
  }
});

test('a user theme choice updates open previews and survives closing and reactivating the extension', async () => {
  const app = host(2), first = await app.open('/first.json'), second = await app.open('/second.json');
  await first.send({ type: 'ready' }); await second.send({ type: 'ready' });
  first.messages.length = 0; second.messages.length = 0;
  await first.send({ type: 'theme', theme: 'light' });
  assert.equal(app.storage.get('previewTheme'), 'light');
  assert.equal(first.messages.at(-1).theme, 'light');
  assert.equal(second.messages.at(-1).theme, 'light');
  first.messages.length = 0; second.messages.length = 0;
  app.changeTheme(1); app.changeTheme(2);
  assert.equal(first.messages.length, 0); assert.equal(second.messages.length, 0);
  first.dispose();
  assert.ok((await app.open('/first.json')).webview.html.includes('data-theme="light"'));
  const restarted = host(2, app.storage);
  assert.ok((await restarted.open('/third.json')).webview.html.includes('data-theme="light"'));
});

test('invalid theme messages cannot override a saved choice', async () => {
  const app = host(2, new Map([['previewTheme', 'light']])), panel = await app.open('/api.json');
  await panel.send({ type: 'ready' });
  panel.messages.length = 0;
  await panel.send({ type: 'theme', theme: 'invalid' });
  assert.equal(app.storage.get('previewTheme'), 'light');
  assert.equal(panel.messages.length, 0);
});

test('legacy configuration remains usable and explicit Swagger Lens settings take precedence', async () => {
  for (const [settings, expected] of [
    [{ 'swaggerApiDiff.baseRef': 'legacy-branch' }, 'legacy-branch'],
    [{ 'swaggerApiDiff.baseRef': 'legacy-branch', 'swaggerLens.baseRef': 'lens-branch' }, 'lens-branch']
  ]) {
    const app = host(2, new Map(), settings), panel = await app.open('/api.json');
    await panel.send({ type: 'ready' });
    assert.equal(panel.messages.find(message => message.type === 'data').data.baseRef, expected);
  }
});
