const path = require('node:path');
const { reviewFixture } = require('./gitlab-review-fixture.cjs');

function githubFixture(vscode, root, { local = false, remoteUrl = 'git@github.com:catomak/swagger-lens.git' } = {}) {
  const data = reviewFixture(vscode, root), reads = [], gitReads = [];
  const headPath = 'services/core api.json', basePath = 'legacy/core api.yaml';
  const prUri = (base, status = 4) => vscode.Uri.file(path.join(root, base ? basePath : headPath)).with({ scheme: 'pr', query: JSON.stringify({
    baseCommit: data.baseCommit, headCommit: data.headCommit, isBase: base, fileName: headPath, previousFileName: basePath, prNumber: 42, status, remoteName: 'origin'
  }) });
  const reviewUri = (file, commit = data.baseCommit, suffix = '') => vscode.Uri.file(path.join(root, file)).with({ scheme: 'review', path: vscode.Uri.file(path.join(root, file)).path + suffix,
    query: JSON.stringify({ path: file, commit, base: true, isOutdated: Boolean(suffix), rootPath: vscode.Uri.file(root).path }) });
  const readDocument = (commit, file) => {
    const content = data.documents.get(`${commit}:/${file.replace(/^\/+/, '')}`);
    if (content === undefined) throw vscode.FileSystemError?.FileNotFound() || Object.assign(new Error(`Missing GitHub file: ${file}`), { code: 'FileNotFound' });
    return Buffer.from(content);
  };
  const readFile = source => {
    const params = JSON.parse(source.query);
    reads.push({ scheme: source.scheme, path: source.path, ...params });
    if (source.scheme === 'pr') {
      if ((params.isBase && params.status === 0) || (!params.isBase && params.status === 2)) return Buffer.alloc(0);
      // Like the real PR patch provider, expose only files changed in the PR.
      if (params.fileName !== headPath) return Buffer.alloc(0);
      return readDocument(params.isBase ? params.baseCommit : params.headCommit, params.isBase ? params.previousFileName : params.fileName);
    }
    if (source.scheme === 'review') return params.commit ? readDocument(params.commit, params.path) : Buffer.alloc(0);
    if (source.scheme === 'githubcommit' && params.owner === 'catomak' && params.repo === 'swagger-lens') return readDocument(params.commit, source.path);
    throw new Error('Unexpected GitHub provider URI');
  };
  const repository = {
    rootUri: vscode.Uri.file(root), state: { remotes: [{ name: 'origin', fetchUrl: remoteUrl }] },
    show: async (commit, file) => {
      gitReads.push({ commit, file });
      if (!local) throw new Error('Commit absent from local clone');
      return readDocument(commit, path.relative(root, file).split(path.sep).join('/')).toString();
    }
  };
  return { ...data, root, reads, gitReads, readFile, prUri, reviewUri, repository, left: prUri(true), right: prUri(false), headPath, basePath };
}

module.exports = { githubFixture };
