const test = require('node:test');
const assert = require('node:assert/strict');
const { host } = require('./mock-vscode.cjs');
const { previewSettings } = require('../src/configuration.cjs');

test('defaultMode overrides opening context while standalone files still fall back to Preview', async () => {
  const diff = host(2, new Map(), { 'swaggerLens.defaultMode': 'diff' }, { root: '/' });
  await diff.open('/api.json');
  assert.equal(diff.api.getPreview(diff.uri('/api.json')).mode, 'diff');
  const preview = host(2, new Map(), { 'swaggerLens.defaultMode': 'preview' }, { root: '/' });
  await preview.open('/api.json', preview.uri('/old.json'));
  assert.equal(preview.api.getPreview(preview.uri('/api.json')).mode, 'preview');
  const standalone = host(2, new Map(), { 'swaggerLens.defaultMode': 'diff' });
  await standalone.open('/api.json');
  assert.equal(standalone.api.getPreview(standalone.uri('/api.json')).mode, 'preview');
});

test('disabling autoRefresh cancels a pending save refresh but leaves manual refresh available', async () => {
  const app = host(), panel = await app.open('/api.json');
  assert.equal(app.loads, 1);
  app.save('/api.json');
  app.changeSetting('swaggerLens.autoRefresh', false);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(app.loads, 1);
  app.save('/api.json');
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(app.loads, 1);
  await panel.send({ type: 'refresh' });
  assert.equal(app.loads, 2);
  app.changeSetting('swaggerLens.autoRefresh', true);
  app.save('/api.json');
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(app.loads, 3);
});

test('view preferences reach the webview; disabling Try it out also blocks network connections', async () => {
  const app = host(2, new Map(), {
    'swaggerLens.changesOnly': false, 'swaggerLens.showChangesList': false,
    'swaggerLens.docExpansion': 'none', 'swaggerLens.schemaExpandDepth': 2,
    'swaggerLens.tryItOutEnabled': false
  });
  const panel = await app.open('/api.json');
  assert.match(panel.webview.html, /connect-src 'none'/);
  await panel.send({ type: 'ready' });
  const settings = panel.messages.find(message => message.type === 'settings').settings;
  assert.equal(settings.changesOnly, false); assert.equal(settings.showChangesList, false);
  assert.equal(settings.docExpansion, 'none'); assert.equal(settings.schemaExpandDepth, 2);
  assert.equal(settings.tryItOutEnabled, false);
  app.changeSetting('swaggerLens.tryItOutEnabled', true); await app.flush();
  assert.match(panel.webview.html, /connect-src http: https:/);
});

test('filter preferences changed while the webview is loading apply after it becomes ready', async () => {
  const app = host(), panel = await app.open('/api.json');
  app.changeSetting('swaggerLens.changesOnly', false);
  app.changeSetting('swaggerLens.showChangesList', false);
  await panel.send({ type: 'ready' });
  const message = panel.messages.find(message => message.type === 'settings');
  assert.equal(message.settings.changesOnly, false); assert.equal(message.settings.showChangesList, false);
  assert.ok(message.reset.includes('changesOnly')); assert.ok(message.reset.includes('showChangesList'));
});

test('explicit theme configuration overrides a remembered choice, and auto resumes VS Code theme tracking', async () => {
  const app = host(2, new Map([['previewTheme', 'dark']]), { 'swaggerLens.theme': 'light' });
  const panel = await app.open('/api.json');
  assert.match(panel.webview.html, /data-theme="light"/);
  await panel.send({ type: 'ready' });
  app.changeSetting('swaggerLens.theme', 'auto');
  assert.equal(panel.messages.at(-1).theme, 'dark');
  app.changeTheme(1);
  assert.equal(panel.messages.at(-1).theme, 'light');
  panel.dispose();
  app.changeSetting('swaggerLens.theme', 'auto');
  assert.equal(app.storage.has('previewTheme'), false);
  const restarted = host(1, new Map([['previewTheme', 'dark']]), { 'swaggerLens.theme': 'auto' });
  const another = await restarted.open('/another.json');
  assert.match(another.webview.html, /data-theme="light"/);
  await another.send({ type: 'ready' });
  restarted.changeTheme(2);
  assert.equal(another.messages.at(-1).theme, 'dark');
});

test('invalid rendering settings fall back without being interpolated into the webview document', () => {
  const invalid = { docExpansion: 'injected', schemaExpandDepth: -1, theme: 'invalid', tryItOutEnabled: 'yes' };
  const settings = previewSettings({ get: (name, fallback) => invalid[name] ?? fallback });
  assert.equal(settings.docExpansion, 'list'); assert.equal(settings.schemaExpandDepth, 8);
  assert.equal(settings.theme, 'auto'); assert.equal(settings.tryItOutEnabled, true);
});
