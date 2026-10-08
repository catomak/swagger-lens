const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const defaults = require('../package.json').contributes.configuration.properties;

// Run the real extension handlers against editor tabs and configuration events.
function host(kind = 2, storage = new Map(), settings = {}, options = {}) {
  const panels = [], themeListeners = [], configListeners = [], tabListeners = [], groupListeners = [], saveListeners = [];
  const disposable = () => ({ dispose() {} });
  const listen = (listeners, callback) => { listeners.push(callback); return { dispose: () => listeners.splice(listeners.indexOf(callback), 1) }; };
  const sourceUri = value => ({
    ...value,
    toString() { return this.scheme === 'file' ? this.fsPath : `${this.scheme}:${this.path}?${this.query}`; },
    with(changes) { return sourceUri({ ...value, ...changes, ...(changes.path !== undefined && { fsPath: changes.path.split('/').join(path.sep) }) }); }
  });
  const uri = file => sourceUri({ fsPath: file, path: file.split(path.sep).join('/'), scheme: 'file', query: '' });
  class TabInputText { constructor(uri) { this.uri = uri; } }
  class TabInputTextDiff { constructor(original, modified) { this.original = original; this.modified = modified; } }
  const firstGroup = { tabs: [], viewColumn: 1 };
  const commands = new Map();
  const vscode = {
    TabInputText, TabInputTextDiff,
    ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    Uri: { file: uri, joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) },
    ViewColumn: { Beside: 2 },
    commands: { registerCommand: (name, handler) => { commands.set(name, handler); return disposable(); } },
    workspace: {
      isTrusted: true, textDocuments: [],
      fs: { readFile: async () => Buffer.from('{}') },
      getConfiguration: section => ({
        get: (name, fallback) => settings[section + '.' + name] ?? defaults[section + '.' + name]?.default ?? fallback,
        inspect: name => ({ workspaceValue: settings[section + '.' + name] }),
        update: async (name, value) => changeSetting(section + '.' + name, value)
      }),
      onDidChangeConfiguration: callback => listen(configListeners, callback),
      onDidSaveTextDocument: callback => listen(saveListeners, callback),
      onDidChangeTextDocument: disposable
    },
    window: {
      tabGroups: { all: [firstGroup], activeTabGroup: firstGroup,
        onDidChangeTabs: callback => listen(tabListeners, callback),
        onDidChangeTabGroups: callback => listen(groupListeners, callback)
      },
      activeColorTheme: { kind },
      onDidChangeActiveColorTheme: callback => listen(themeListeners, callback),
      createOutputChannel: () => ({ ...disposable(), appendLine() {} }),
      createWebviewPanel: () => {
        const disposeListeners = [];
        const panel = { reveal() {}, disposed: false, messages: [], webview: { cspSource: 'test:', asWebviewUri: value => value } };
        panel.webview.postMessage = message => { panel.messages.push(message); return Promise.resolve(true); };
        panel.webview.onDidReceiveMessage = handler => { panel.send = handler; return disposable(); };
        panel.onDidDispose = callback => listen(disposeListeners, callback);
        panel.dispose = () => { if (!panel.disposed) { panel.disposed = true; disposeListeners.forEach(callback => callback()); } };
        panels.push(panel);
        return panel;
      }
    }
  };
  const context = {
    subscriptions: [], extensionUri: uri('/extension'), extensionPath: '/extension',
    globalState: { get: key => storage.get(key), update: async (key, value) => value === undefined ? storage.delete(key) : storage.set(key, value) }
  };
  let loads = 0;
  const engine = {
    findGitRoot: async () => options.root || null,
    loadWorking: async file => { loads++; return { file }; },
    loadSnapshot: async file => ({ file }),
    previewLoaded: loaded => ({ spec: {}, dependencies: [loaded.file] }),
    compareFile: async file => ({ spec: {}, operations: [], dependencies: [file] }),
    compareLoaded: async (base, revision) => ({ spec: {}, operations: [], dependencies: [revision.file] }),
    ...options.engine
  };
  const module = { exports: {} };
  const requireMock = name => name === 'vscode' ? vscode : name === './engine.cjs' ? engine
    : name.startsWith('./') ? require(path.resolve('src', name)) : require(name);
  vm.runInNewContext(fs.readFileSync(path.resolve('src/extension.cjs'), 'utf8'), { require: requireMock, module, Buffer, process, setTimeout, clearTimeout });
  const api = module.exports.activate(context);
  function changeSetting(name, value) {
    if (value === undefined) delete settings[name]; else settings[name] = value;
    configListeners.forEach(callback => callback({ affectsConfiguration: section => name === section || name.startsWith(section + '.') }));
  }
  function addTab(file, group = firstGroup, original) {
    if (!vscode.window.tabGroups.all.includes(group)) vscode.window.tabGroups.all.push(group);
    const source = typeof file === 'string' ? uri(file) : file;
    const tab = { input: original ? new TabInputTextDiff(original, source) : new TabInputText(source) };
    group.tabs.push(tab); group.activeTab = tab; vscode.window.tabGroups.activeTabGroup = group;
    tabListeners.forEach(callback => callback({ opened: [tab], closed: [], changed: [] }));
    return tab;
  }
  return {
    panels, storage, settings, api, vscode, uri,
    get loads() { return loads; },
    addTab,
    async openSource(source, original) {
      addTab(source, firstGroup, original);
      await commands.get('swaggerLens.open')(source);
      return panels.at(-1);
    },
    async open(file, original) {
      addTab(file, firstGroup, original);
      await commands.get('swaggerLens.open')(uri(file));
      return panels.at(-1);
    },
    async openFromExplorer(file) { await commands.get('swaggerLens.open')(uri(file)); return panels.at(-1); },
    closeTab(tab) {
      for (const group of vscode.window.tabGroups.all) group.tabs = group.tabs.filter(candidate => candidate !== tab);
      tabListeners.forEach(callback => callback({ opened: [], closed: [tab], changed: [] }));
    },
    closeGroup(group) {
      vscode.window.tabGroups.all = vscode.window.tabGroups.all.filter(candidate => candidate !== group);
      groupListeners.forEach(callback => callback({ closed: [group], opened: [], changed: [] }));
    },
    changeSetting,
    save(file) { saveListeners.forEach(callback => callback({ uri: uri(file) })); },
    changeTheme(kind) { vscode.window.activeColorTheme = { kind }; themeListeners.forEach(callback => callback({ kind })); },
    async flush() { await new Promise(resolve => setTimeout(resolve, 10)); }
  };
}

module.exports = { host };
