const test = require('node:test');
const assert = require('node:assert/strict');
const { host } = require('./mock-vscode.cjs');

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
