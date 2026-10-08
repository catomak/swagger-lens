const path = require('node:path');

function repositoryPath(root, file) {
  const relative = path.relative(root, file);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('The review file must be inside its repository.');
  }
  return relative.split(path.sep).join('/');
}

function reviewFile(uri) {
  const params = JSON.parse(uri.query);
  if (typeof params.repositoryRoot !== 'string' || !path.isAbsolute(params.repositoryRoot) || typeof uri.path !== 'string') {
    throw new Error('Invalid GitLab review file.');
  }
  const file = path.resolve(params.repositoryRoot, uri.path.replace(/^\/+/, ''));
  repositoryPath(params.repositoryRoot, file);
  return file;
}

function githubReviewSource(vscode, uri) {
  const params = JSON.parse(uri.query);
  let root, file;
  if (uri.scheme === 'review') {
    if (typeof params.rootPath !== 'string' || !params.rootPath || typeof params.path !== 'string') throw new Error('Invalid GitHub review file.');
    root = uri.with({ scheme: 'file', path: params.rootPath, query: '', fragment: '' }).fsPath;
    file = params.path === uri.path || params.path.startsWith(params.rootPath + '/')
      ? uri.with({ scheme: 'file', path: params.path, query: '', fragment: '' }).fsPath
      : path.resolve(root, params.path.replace(/^\/+/, ''));
  } else {
    const relative = params.isBase && params.previousFileName ? params.previousFileName : params.fileName;
    if (typeof relative !== 'string' || !relative || relative.startsWith('/') || relative.split('/').includes('..')) throw new Error('Invalid GitHub PR file.');
    file = uri.with({ scheme: 'file', query: '', fragment: '' }).fsPath;
    root = file;
    for (const part of relative.split('/')) root = path.dirname(root);
    const actual = repositoryPath(root, file);
    if ((process.platform === 'win32' ? actual.toLowerCase() !== relative.toLowerCase() : actual !== relative)) throw new Error('Invalid GitHub PR file path.');
  }
  if (!path.isAbsolute(root)) throw new Error('Invalid GitHub review repository.');
  repositoryPath(root, file);
  return { root, file, commit: uri.scheme === 'review' ? params.commit : params.isBase ? params.baseCommit : params.headCommit, params };
}

function reviewRepositoryRoot(vscode, uri) {
  if (uri.scheme === 'gl-review') return JSON.parse(uri.query).repositoryRoot;
  if (['pr', 'review'].includes(uri.scheme)) return githubReviewSource(vscode, uri).root;
  return null;
}

async function githubSnapshotReader(vscode, uri) {
  const { root, commit, params } = githubReviewSource(vscode, uri);
  const git = vscode.extensions.getExtension('vscode.git');
  if (git) await git.activate();
  const repository = git?.exports.getAPI(1).getRepository(vscode.Uri.file(root));
  return async file => {
    const relative = repositoryPath(root, file);
    if (!commit) throw new Error('The GitHub review has no commit for schema references.');
    if (repository) {
      try { return await repository.show(commit, file); }
      catch { /* A remote PR commit may be absent from the local clone. */ }
    }
    // The pr provider only knows changed files. Read other schemas by commit,
    // using the GitHub extension's authenticated provider instead of its patch cache.
    const name = params.remoteName || repository?.state.HEAD?.upstream?.remote || 'origin';
    const remotes = repository?.state.remotes || [];
    const remote = remotes.find(remote => remote.name === name) || (!params.remoteName && remotes.length === 1 ? remotes[0] : null);
    const url = remote?.fetchUrl || remote?.pushUrl;
    const pathname = url?.includes('://') ? new URL(url).pathname : url?.match(/^[^:]+:(.+)$/)?.[1];
    const parts = pathname?.split('/').filter(Boolean);
    if (parts?.length !== 2) throw new Error('Cannot resolve the GitHub repository for schema references.');
    const [owner, repo] = parts;
    return vscode.workspace.fs.readFile(uri.with({ scheme: 'githubcommit', authority: '', path: '/' + relative, fragment: '', query: JSON.stringify({ owner, repo: repo.replace(/\.git$/, ''), commit }) }));
  };
}

function fileUri(vscode, uri) {
  if (uri?.scheme === 'file') return uri;
  if (uri?.scheme === 'git') {
    const params = JSON.parse(uri.query);
    if (typeof params.path === 'string' && path.isAbsolute(params.path)) return vscode.Uri.file(params.path);
  }
  if (uri?.scheme === 'gl-review') return vscode.Uri.file(reviewFile(uri));
  if (['pr', 'review'].includes(uri?.scheme)) return vscode.Uri.file(githubReviewSource(vscode, uri).file);
  throw new Error('Open an OpenAPI JSON or YAML file, or its Git, GitLab, or GitHub comparison.');
}

function snapshotDependencyUri(vscode, uri, file) {
  const params = JSON.parse(uri.query);
  if (uri.scheme === 'gl-review') {
    // GitLab uses a repository-relative URI path and keeps the commit in its query.
    const relative = repositoryPath(params.repositoryRoot, file);
    return uri.with({ path: '/' + relative, query: JSON.stringify({ ...params, exists: '1' }) });
  }
  return uri.with({ path: vscode.Uri.file(file).path, query: JSON.stringify({ ...params, path: file }) });
}

function openingContext(vscode, resource) {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  const candidate = resource || vscode.window.activeTextEditor?.document.uri;
  const comparison = input instanceof vscode.TabInputTextDiff && (!resource || [input.original, input.modified].some(uri => uri.toString() === resource.toString())) ? input : null;
  const source = comparison?.modified || candidate;
  return { source, file: fileUri(vscode, source), original: comparison?.original || null, mode: comparison ? 'diff' : 'preview' };
}

function sourceIsOpen(vscode, file) {
  const key = uri => {
    if (!['file', 'git', 'gl-review', 'pr', 'review'].includes(uri?.scheme)) return null;
    try {
      const normalized = path.normalize(fileUri(vscode, uri).fsPath);
      return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    } catch { return null; }
  };
  const target = key(file);
  return vscode.window.tabGroups.all.some(group => group.tabs.some(tab => {
    const input = tab.input;
    const sources = input instanceof vscode.TabInputTextDiff ? [input.original, input.modified] : [input?.uri];
    return sources.some(uri => key(uri) === target);
  }));
}

function sourceLabel(uri) {
  if (['pr', 'review'].includes(uri.scheme)) {
    const params = JSON.parse(uri.query);
    const commit = uri.scheme === 'review' ? params.commit : params.isBase ? params.baseCommit : params.headCommit;
    return commit ? `GitHub ${commit.slice(0, 8)}` : 'GitHub PR';
  }
  if (uri.scheme === 'gl-review') {
    const { commit } = JSON.parse(uri.query);
    return commit ? `GitLab ${commit.slice(0, 8)}` : 'GitLab MR';
  }
  if (uri.scheme !== 'git') return path.basename(uri.fsPath);
  const { ref } = JSON.parse(uri.query);
  return ref === '' ? 'INDEX' : ref === '~' ? 'VS Code left version' : ref;
}

module.exports = { githubSnapshotReader, reviewRepositoryRoot, fileUri, snapshotDependencyUri, openingContext, sourceLabel, sourceIsOpen };
