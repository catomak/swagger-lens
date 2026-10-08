function configuration(vscode, file) {
  const current = vscode.workspace.getConfiguration('swaggerLens', file);
  const legacy = vscode.workspace.getConfiguration('swaggerApiDiff', file);
  const isExplicit = name => {
    const inspected = current.inspect?.(name);
    return Boolean(inspected && ['globalValue', 'workspaceValue', 'workspaceFolderValue', 'globalLanguageValue', 'workspaceLanguageValue', 'workspaceFolderLanguageValue'].some(key => inspected[key] !== undefined));
  };
  return {
    isExplicit,
    get: (name, fallback) => isExplicit(name) ? current.get(name, fallback) : legacy.get(name, current.get(name, fallback))
  };
}

function previewSettings(config) {
  const boolean = (name, fallback) => typeof config.get(name, fallback) === 'boolean' ? config.get(name, fallback) : fallback;
  const choice = (name, choices, fallback) => choices.includes(config.get(name, fallback)) ? config.get(name, fallback) : fallback;
  const depth = config.get('schemaExpandDepth', 8);
  return {
    autoClosePreview: boolean('autoClosePreview', true),
    autoRefresh: boolean('autoRefresh', true),
    defaultMode: choice('defaultMode', ['auto', 'preview', 'diff'], 'auto'),
    theme: choice('theme', ['auto', 'light', 'dark'], 'auto'),
    changesOnly: boolean('changesOnly', true),
    showChangesList: boolean('showChangesList', true),
    docExpansion: choice('docExpansion', ['list', 'full', 'none'], 'list'),
    schemaExpandDepth: Number.isInteger(depth) && depth >= 0 && depth <= 20 ? depth : 8,
    tryItOutEnabled: boolean('tryItOutEnabled', true)
  };
}

module.exports = { configuration, previewSettings };
