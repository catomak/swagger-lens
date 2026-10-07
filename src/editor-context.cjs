const path = require('node:path');

function fileUri(vscode, uri) {
  if (uri?.scheme === 'file') return uri;
  if (uri?.scheme === 'git') {
    const params = JSON.parse(uri.query);
    if (typeof params.path === 'string' && path.isAbsolute(params.path)) return vscode.Uri.file(params.path);
  }
  throw new Error('Open a saved OpenAPI JSON or YAML file, or its Git comparison.');
}

function openingContext(vscode, resource) {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  const candidate = resource || vscode.window.activeTextEditor?.document.uri;
  const comparison = input instanceof vscode.TabInputTextDiff && (!resource || [input.original, input.modified].some(uri => uri.toString() === resource.toString())) ? input : null;
  const source = comparison?.modified || candidate;
  return { source, file: fileUri(vscode, source), original: comparison?.original || null, mode: comparison ? 'diff' : 'preview' };
}

function sourceLabel(uri) {
  if (uri.scheme !== 'git') return path.basename(uri.fsPath);
  const { ref } = JSON.parse(uri.query);
  return ref === '' ? 'INDEX' : ref === '~' ? 'VS Code left version' : ref;
}

module.exports = { fileUri, openingContext, sourceLabel };
