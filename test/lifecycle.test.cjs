const test = require('node:test');
const assert = require('node:assert/strict');
const { host } = require('./mock-vscode.cjs');

test('closing the last source tab disposes its panel even when VS Code retains the document', async () => {
  const app = host(), panel = await app.open('/api.json');
  app.vscode.workspace.textDocuments.push({ uri: app.uri('/api.json'), isDirty: false });
  app.closeTab(app.vscode.window.tabGroups.all[0].tabs[0]);
  await app.flush();
  assert.equal(panel.disposed, true);
  assert.equal(app.api.getPreview(app.uri('/api.json')), undefined);
});

test('a second editor group keeps the source preview open until its last tab closes', async () => {
  const app = host(), panel = await app.open('/api.json');
  const first = app.vscode.window.tabGroups.all[0].tabs[0];
  const second = app.addTab('/api.json', { tabs: [], viewColumn: 3 });
  app.closeTab(first); await app.flush();
  assert.equal(panel.disposed, false);
  app.closeTab(second); await app.flush();
  assert.equal(panel.disposed, true);
});

test('comparison tabs keep the same source open, and closing the final comparison closes Diffs', async () => {
  const app = host(2, new Map(), {}, { root: '/' });
  const panel = await app.open('/api.json', app.uri('/old.json'));
  assert.equal(app.api.getPreview(app.uri('/api.json')).mode, 'diff');
  const ordinary = app.addTab('/api.json', { tabs: [], viewColumn: 3 });
  app.closeTab(ordinary); await app.flush();
  assert.equal(panel.disposed, false);
  app.closeTab(app.vscode.window.tabGroups.all[0].tabs[0]); await app.flush();
  assert.equal(panel.disposed, true);
});

test('moving a source tab between groups preserves its preview', async () => {
  const app = host(), panel = await app.open('/api.json');
  app.closeTab(app.vscode.window.tabGroups.all[0].tabs[0]);
  app.addTab('/api.json', { tabs: [], viewColumn: 3 });
  await app.flush();
  assert.equal(panel.disposed, false);
});

test('closing an entire source editor group closes its preview', async () => {
  const app = host(), panel = await app.open('/api.json');
  app.closeGroup(app.vscode.window.tabGroups.all[0]); await app.flush();
  assert.equal(panel.disposed, true);
});

test('autoClosePreview=false preserves panels, and enabling it applies to the already closed source', async () => {
  const app = host(2, new Map(), { 'swaggerLens.autoClosePreview': false });
  const panel = await app.open('/api.json');
  app.closeTab(app.vscode.window.tabGroups.all[0].tabs[0]); await app.flush();
  assert.equal(panel.disposed, false);
  app.changeSetting('swaggerLens.autoClosePreview', true); await app.flush();
  assert.equal(panel.disposed, true);
});

test('closing unrelated or referenced schema tabs does not close the source preview', async () => {
  const app = host(), panel = await app.open('/api.json');
  const schema = app.addTab('/schemas.json');
  app.closeTab(schema); await app.flush();
  assert.equal(panel.disposed, false);
});

test('Explorer previews remain open without a source tab, then follow a source opened later', async () => {
  const app = host(), panel = await app.openFromExplorer('/api.json');
  const unrelated = app.addTab('/unrelated.json');
  app.closeTab(unrelated); await app.flush();
  assert.equal(panel.disposed, false);
  const source = app.addTab('/api.json'); await app.flush();
  app.closeTab(source); await app.flush();
  assert.equal(panel.disposed, true);
});

test('closing the source during loading prevents a late result from restoring its panel', async () => {
  let complete;
  const app = host(2, new Map(), {}, { engine: { loadWorking: () => new Promise(resolve => { complete = resolve; }) } });
  const opening = app.open('/api.json');
  await app.flush();
  const panel = app.panels[0];
  app.closeTab(app.vscode.window.tabGroups.all[0].tabs[0]); await app.flush();
  complete({ file: '/api.json' }); await opening;
  assert.equal(panel.disposed, true);
  assert.equal(app.api.getPreview(app.uri('/api.json')), undefined);
  assert.equal(panel.messages.some(message => message.type === 'data'), false);
});

test('a Git-backed source tab counts as an open editor for the same physical contract', async () => {
  const app = host(), panel = await app.open('/api.json');
  const ordinary = app.vscode.window.tabGroups.all[0].tabs[0];
  const snapshot = app.addTab('/snapshot.json');
  snapshot.input = new app.vscode.TabInputText({ scheme: 'git', query: JSON.stringify({ path: '/api.json', ref: 'HEAD' }), toString: () => 'git:/api.json?HEAD' });
  app.closeTab(ordinary); await app.flush();
  assert.equal(panel.disposed, false);
  app.closeTab(snapshot); await app.flush();
  assert.equal(panel.disposed, true);
});
