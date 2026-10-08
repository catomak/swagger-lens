const YAML = require('yaml');

// Replay the readonly URI/provider protocol used by GitLab Workflow 7.1.
function reviewFixture(vscode, repositoryRoot) {
  const baseCommit = '1111111111111111111111111111111111111111';
  const headCommit = '2222222222222222222222222222222222222222';
  const uri = (file, commit, exists = true, changeType = 'renamed') => vscode.Uri.file(file).with({
    scheme: 'gl-review',
    query: JSON.stringify({ commit, exists: exists ? '1' : '', repositoryRoot, projectId: 17, mrId: 42, changeType })
  });
  const documents = new Map(), reads = [];
  for (const [commit, file, value] of [[baseCommit, '/legacy/core api.yaml', 'before'], [headCommit, '/services/core api.json', 'after']]) {
    const contract = { openapi: '3.1.2', info: { title: 'GitLab review API', version: '1' }, paths: {
      '/items': { get: { responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Envelope' } } } } } } }
    }, components: { schemas: { Envelope: { $ref: '../shared/models.yaml#/components/schemas/Envelope' } } } };
    documents.set(`${commit}:${file}`, file.endsWith('.yaml') ? YAML.stringify(contract) : JSON.stringify(contract));
    documents.set(`${commit}:/shared/models.yaml`, YAML.stringify({ components: { schemas: {
      Envelope: { type: 'object', properties: { status: { $ref: './status.json#/Status' } } },
      Unused: { $ref: './missing.json#/Unused' }
    } } }));
    documents.set(`${commit}:/shared/status.json`, JSON.stringify({ Status: { type: 'string', enum: [value] } }));
  }
  const readFile = source => {
    const params = JSON.parse(source.query);
    reads.push({ path: source.path, ...params });
    if (!params.exists || !params.commit) return Buffer.alloc(0);
    const text = documents.get(`${params.commit}:${source.path}`);
    if (text === undefined) throw vscode.FileSystemError?.FileNotFound(source) || Object.assign(new Error(`Missing review file: ${source.path}`), { code: 'FileNotFound' });
    return Buffer.from(text);
  };
  return { uri, readFile, reads, documents, baseCommit, headCommit, left: uri('/legacy/core api.yaml', baseCommit), right: uri('/services/core api.json', headCommit) };
}

module.exports = { reviewFixture };
