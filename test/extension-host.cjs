const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
async function waitFor(predicate, message) {
  const deadline = Date.now() + 25000;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
async function runTests() {
  const fixture = JSON.parse(await fs.readFile(process.env.API_DIFF_FIXTURE, 'utf8'));
  const manifest = require('../package.json');
  const extension = vscode.extensions.getExtension(`${manifest.publisher}.${manifest.name}`);
  assert.ok(extension, 'Extension must be discoverable by VS Code');
  if (process.env.API_DIFF_RELEASE_EXTENSIONS_DIR) {
    const relative = path.relative(process.env.API_DIFF_RELEASE_EXTENSIONS_DIR, extension.extensionPath);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Tests must load the installed VSIX, not the source checkout');
    assert.equal(extension.packageJSON.version, process.env.API_DIFF_EXPECTED_VERSION);
    assert.equal(`${process.platform}-${process.arch}`, process.env.API_DIFF_EXPECTED_TARGET);
  }
  const api = await extension.activate();
  assert.ok((await vscode.commands.getCommands()).includes('swaggerLens.open'));
  const file = vscode.Uri.file(fixture.file);
  const openFile = async uri => {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { viewColumn: vscode.ViewColumn.One, preview: false });
    await waitFor(() => vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputText, 'Ordinary editor did not activate');
    await vscode.commands.executeCommand('swaggerLens.open', uri);
    await waitFor(() => api.getPreview(uri)?.data && !api.getPreview(uri).busy, 'Ordinary Preview did not finish loading');
    return api.getPreview(uri).data;
  };
  const gitUri = (file, ref) => file.with({ scheme: 'git', query: JSON.stringify({ path: file.fsPath, ref }) });
  const openDiff = async (left, right, resource) => {
    await vscode.commands.executeCommand('vscode.diff', left, right, 'Swagger mode comparison fixture', { viewColumn: vscode.ViewColumn.One, preview: false });
    await waitFor(() => vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputTextDiff, 'Diff editor did not activate');
    await vscode.commands.executeCommand('swaggerLens.open', resource);
    // A saved workspace setting may schedule a refresh while the command runs.
    // Check the final panel state rather than a superseded command's return value.
    await waitFor(() => api.getPreview(right)?.data && !api.getPreview(right).busy, 'Comparison Preview did not finish loading');
    return api.getPreview(right).data;
  };
  const leaf = data => data.spec.paths['/items'].get.responses['200'].content['application/json'].schema.properties.status;
  const previewEnum = data => data.spec.paths['/items'].get.responses['200'].content['application/json'].schema.properties.status.enum;
  const cases = [];
  const rendered = async uri => {
    try {
      await waitFor(async () => {
        const state = api.getPreview(uri);
        if (state?.resolutions?.some(result => result.path.join('/') === 'components/schemas/Envelope')) return true;
        if (state?.ready) await api.clickPreview(uri, '.models .json-schema-2020-12-accordion:has(.json-schema-2020-12-accordion__icon--collapsed)', 'Envelope');
        return false;
      }, 'Swagger UI did not resolve the actual OpenAPI 3.1 schema');
    } catch (error) {
      const state = api.getPreview(uri);
      throw new Error(`${error.message}: ${JSON.stringify({ ready: state?.ready, error: state?.error, resolutions: state?.resolutions })}`);
    }
    assert.deepEqual(api.getPreview(uri).resolutions.flatMap(result => result.errors), [], 'The real webview must not have reference resolution errors');
  };
  for (const name of ['openapi31', 'yaml31']) {
    const uri = vscode.Uri.file(fixture[name]);
    await openFile(uri);
    await rendered(uri);
    cases.push(`${name}: real webview resolves nested OpenAPI 3.1 references`);
  }
  const contract31 = vscode.Uri.file(fixture.openapi31);
  await openFile(contract31);
  await api.setMode(contract31, 'diff');
  await waitFor(() => api.getPreview(contract31).ready, 'OpenAPI 3.1 Diff webview did not load');
  assert.equal(api.getPreview(contract31).data.operations.length, 6);
  await api.setMode(contract31, 'preview');
  await rendered(contract31);
  cases.push('OpenAPI 3.1 mode switches preserve a working reference resolver');
  const normal = await openFile(file);
  assert.equal(normal.mode, 'preview'); assert.equal(normal.diffAvailable, true);
  let data = api.getPreview(file).data;
  assert.ok(data.spec.paths['/unchanged']); assert.ok(!data.spec.paths['/deleted']);
  assert.ok(!JSON.stringify(data.spec).includes('x-diff-'));
  await waitFor(() => api.getPreview(file).ready, 'The real webview did not load its script');
  cases.push('ordinary editor defaults to Preview; real webview ready');

  const manual = await api.setMode(file, 'diff');
  assert.equal(manual.baseRef, 'HEAD');
  assert.equal(manual.mode, 'diff');
  await waitFor(() => api.getPreview(file).ready, 'The Diff webview did not reload its script');
  assert.deepEqual(leaf(api.getPreview(file).data)['x-diff-original'].enum, ['v2']);
  assert.equal(api.getPreview(file).data.spec.paths['/deleted'].get['x-diff-status'], 'deleted');
  await api.setMode(file, 'preview');
  await waitFor(() => api.getPreview(file).ready, 'The Preview webview did not reload its script');
  assert.ok(!api.getPreview(file).data.spec.paths['/deleted']);
  cases.push('manual Diff uses Git base and turning it off restores the real contract');

  await Promise.all([api.setMode(file, 'diff'), api.setMode(file, 'preview')]);
  assert.equal(api.getPreview(file).data.mode, 'preview');
  const config = vscode.workspace.getConfiguration('swaggerLens', file);
  await config.update('oasdiffPath', path.join(fixture.root, 'missing-oasdiff'), vscode.ConfigurationTarget.Workspace);
  assert.equal((await openFile(file)).mode, 'preview');
  await api.setMode(file, 'diff');
  await waitFor(() => !api.getPreview(file).busy && api.getPreview(file).error, 'The missing diff engine did not produce a final error');
  assert.match(api.getPreview(file).error, /ENOENT/);
  await api.setMode(file, 'preview');
  await waitFor(() => !api.getPreview(file).busy && api.getPreview(file).data?.mode === 'preview', 'Preview did not recover after the missing diff engine');
  await config.update('oasdiffPath', undefined, vscode.ConfigurationTarget.Workspace);
  cases.push('rapid mode switches and recovery from a missing diff engine');

  const gitExtension = vscode.extensions.getExtension('vscode.git');
  await gitExtension.activate();
  const gitAPI = gitExtension.exports.getAPI(1);
  await waitFor(() => gitAPI.getRepository(file), 'The built-in Git provider did not find the fixture');
  await gitAPI.getRepository(file).status();
  const historical = await openDiff(gitUri(file, 'HEAD~1'), file, gitUri(file, 'HEAD~1'));
  assert.equal(historical.mode, 'diff'); assert.equal(historical.baseRef, 'HEAD~1');
  assert.equal(historical.comparisonSource, 'editor');
  data = api.getPreview(file).data;
  assert.deepEqual(leaf(data)['x-diff-original'].enum, ['v1']);
  assert.deepEqual(leaf(data).enum, ['v5']);
  cases.push('historical comparison uses the actual left revision and its refs');

  const indexed = await openDiff(gitUri(file, ''), file);
  assert.equal(indexed.baseRef, 'INDEX');
  assert.deepEqual(leaf(api.getPreview(file).data)['x-diff-original'].enum, ['v4']);
  cases.push('index-to-working-tree comparison uses staged schemas');

  const rightIndex = gitUri(file, '');
  const staged = await openDiff(gitUri(file, 'HEAD'), rightIndex, rightIndex);
  assert.equal(staged.mode, 'diff');
  data = api.getPreview(rightIndex).data;
  assert.deepEqual(leaf(data)['x-diff-original'].enum, ['v2']); assert.deepEqual(leaf(data).enum, ['v4']);
  await api.setBase(rightIndex, 'HEAD~1');
  data = api.getPreview(rightIndex).data;
  assert.equal(data.comparisonSource, 'git');
  assert.deepEqual(leaf(data)['x-diff-original'].enum, ['v1']); assert.deepEqual(leaf(data).enum, ['v4']);
  await api.setMode(rightIndex, 'preview');
  data = api.getPreview(rightIndex).data;
  assert.ok(data.spec.paths['/staged-only']); assert.ok(!data.spec.paths['/working-only']);
  assert.deepEqual(previewEnum(data), ['v4']);
  cases.push('HEAD-to-index comparison, changing the base and Preview keep the actual right snapshot');

  const unstaged = vscode.Uri.file(fixture.unstaged);
  await openDiff(gitUri(unstaged, '~'), unstaged);
  assert.deepEqual(leaf(api.getPreview(unstaged).data)['x-diff-original'].enum, ['v2']);
  cases.push('Git ~ alias does not pull staged dependencies into an unstaged HEAD baseline');

  const added = vscode.Uri.file(fixture.added);
  const addedResult = await openDiff(gitUri(added, 'HEAD'), added);
  assert.equal(addedResult.baseMissing, true);
  assert.ok(api.getPreview(added).data.operations.every(op => op.status === 'added'));
  cases.push('new file missing on the left is shown as added');

  const reopened = await openFile(file);
  assert.equal(reopened.mode, 'preview'); assert.equal(api.getPreview(file).data.comparisonSource, 'git');
  cases.push('reopening from an ordinary editor resets the existing panel to Preview');

  const outside = vscode.Uri.file(fixture.outside);
  await config.update('baseRef', 'missing-reference', vscode.ConfigurationTarget.Workspace);
  await config.update('oasdiffPath', path.join(fixture.root, 'missing-oasdiff'), vscode.ConfigurationTarget.Workspace);
  const standalone = await openFile(outside);
  assert.equal(standalone.mode, 'preview'); assert.equal(standalone.diffAvailable, false);
  await waitFor(() => api.getPreview(outside).ready, 'The standalone Preview webview did not load');
  assert.equal((await api.setMode(outside, 'diff')).mode, 'preview');
  const model = await vscode.workspace.openTextDocument(fixture.outsideModel);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(model.uri, new vscode.Range(0, 0, model.lineCount, 0), model.getText().replace('outside', 'saved-dependency'));
  await vscode.workspace.applyEdit(edit); await model.save();
  await waitFor(() => {
    const data = api.getPreview(outside).data;
    return data && previewEnum(data)?.[0] === 'saved-dependency';
  }, 'Saving a standalone dependency did not refresh Preview');
  await config.update('baseRef', undefined, vscode.ConfigurationTarget.Workspace);
  await config.update('oasdiffPath', undefined, vscode.ConfigurationTarget.Workspace);
  cases.push('standalone YAML ignores invalid Git/engine settings and refreshes saved local refs');

  const fragment = vscode.Uri.file(fixture.fragment);
  const compact = await openFile(fragment);
  assert.deepEqual(compact.dependencies.sort(), [fixture.fragment, fixture.neighbor].sort());
  assert.doesNotMatch(JSON.stringify(compact.spec), /Unused|missing\.json/);
  assert.deepEqual(compact.spec.components.schemas.Envelope.example, { name: 'Asha', active: true, count: 3 });
  await rendered(fragment);
  cases.push('small neighboring schema renders from a large Swagger without loading its unrelated dependencies');

  const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs);
  assert.ok(tabs.some(tab => tab.label === `Swagger Preview: ${path.basename(file.fsPath)}` && tab.input instanceof vscode.TabInputWebview));
  assert.equal(extension.packageJSON.contributes.menus['editor/title'][0].command, 'swaggerLens.open');
  await fs.writeFile(process.env.API_DIFF_TEST_RESULT, JSON.stringify({ passed: true, version: extension.packageJSON.version, target: `${process.platform}-${process.arch}`, vscodeVersion: vscode.version, extensionPath: extension.extensionPath, cases }, null, 2));
  console.log('API_DIFF_EXTENSION_HOST_TEST_PASSED');
  if (process.env.API_DIFF_HOLD) await new Promise(resolve => setTimeout(resolve, 60000));
}
async function run() {
  try { await runTests(); }
  catch (error) {
    await fs.writeFile(process.env.API_DIFF_TEST_RESULT, JSON.stringify({ passed: false, error: error.stack }, null, 2));
    throw error;
  }
}
module.exports = { run };
