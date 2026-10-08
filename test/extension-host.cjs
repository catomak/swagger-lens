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
    await waitFor(() => {
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      return input instanceof vscode.TabInputTextDiff && input.original.toString() === left.toString() && input.modified.toString() === right.toString();
    }, 'Diff editor did not activate');
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
  await waitFor(() => {
    const state = api.getPreview(rightIndex);
    return !state.busy && state.data?.baseRef === 'HEAD~1' && state.data.comparisonSource === 'git';
  }, 'Changing the Git base did not finish loading');
  data = api.getPreview(rightIndex).data;
  assert.equal(data.comparisonSource, 'git');
  assert.deepEqual(leaf(data)['x-diff-original'].enum, ['v1']); assert.deepEqual(leaf(data).enum, ['v4']);
  await api.setMode(rightIndex, 'preview');
  await waitFor(() => !api.getPreview(rightIndex).busy && api.getPreview(rightIndex).data?.mode === 'preview', 'The index Preview did not finish loading');
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
  assert.deepEqual(compact.dependencies.sort(), [fixture.fragment, fixture.neighbor].map(file => vscode.Uri.file(file).fsPath).sort());
  assert.doesNotMatch(JSON.stringify(compact.spec), /Unused|missing\.json/);
  assert.deepEqual(compact.spec.components.schemas.Envelope.example, { name: 'Asha', active: true, count: 3 });
  await rendered(fragment);
  cases.push('small neighboring schema renders from a large Swagger without loading its unrelated dependencies');

  const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs);
  assert.ok(tabs.some(tab => tab.label === `Swagger Preview: ${path.basename(file.fsPath)}` && tab.input instanceof vscode.TabInputWebview));
  assert.equal(extension.packageJSON.contributes.menus['editor/title'][0].command, 'swaggerLens.open');
  const sourceTabs = uri => vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => {
    const input = tab.input;
    const uris = input instanceof vscode.TabInputTextDiff ? [input.original, input.modified] : [input?.uri];
    return uris.some(candidate => {
      if (candidate?.scheme === 'file') return candidate.toString() === uri.toString();
      if (candidate?.scheme === 'git') return vscode.Uri.file(JSON.parse(candidate.query).path).toString() === uri.toString();
      return false;
    });
  });
  const inspect = async uri => {
    await api.inspectPreview(uri);
    await waitFor(() => api.getPreview(uri)?.viewState, 'Webview controls did not report their state');
    return api.getPreview(uri).viewState;
  };
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  // Clear earlier editors and panels so global workspace settings affect only these cases.
  await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap(group => group.tabs), true);
  await waitFor(() => !api.getPreview(file), 'Closed preview remained registered');

  await openFile(outside);
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(outside), { viewColumn: vscode.ViewColumn.Three, preview: false });
  const duplicates = sourceTabs(outside);
  assert.equal(duplicates.length, 2, 'The source must be open in two editor groups');
  await vscode.window.tabGroups.close(duplicates[0], true); await delay(100);
  assert.ok(api.getPreview(outside), 'Closing one duplicate source must preserve Preview');
  await vscode.window.tabGroups.close(sourceTabs(outside), true);
  await waitFor(() => !api.getPreview(outside), 'Closing the last source tab did not close Preview');
  cases.push('auto closure preserves a duplicate source editor and closes after its last tab');

  await config.update('autoClosePreview', false, vscode.ConfigurationTarget.Workspace);
  await openFile(outside);
  await vscode.window.tabGroups.close(sourceTabs(outside), true); await delay(100);
  assert.ok(api.getPreview(outside), 'Disabled auto closure must preserve Preview');
  await config.update('autoClosePreview', true, vscode.ConfigurationTarget.Workspace);
  await waitFor(() => !api.getPreview(outside), 'Enabling auto closure did not close the already closed source');
  cases.push('autoClosePreview can be disabled and enabled on an existing panel');

  await openDiff(gitUri(unstaged, 'HEAD'), unstaged, unstaged);
  await vscode.window.tabGroups.close(sourceTabs(unstaged), true);
  await waitFor(() => !api.getPreview(unstaged), 'Closing a comparison did not close Diffs');
  cases.push('closing the last comparison editor closes Diffs');

  for (const [name, value] of Object.entries({ autoRefresh: false, docExpansion: 'full', schemaExpandDepth: 2, tryItOutEnabled: false, changesOnly: false, showChangesList: false })) {
    await config.update(name, value, vscode.ConfigurationTarget.Workspace);
  }
  await openFile(outside);
  await waitFor(() => api.getPreview(outside).ready, 'Configured Preview did not load');
  let view;
  await waitFor(async () => { view = await inspect(outside); return view.expandedOperations > 0; }, 'Full expansion must open rendered operations');
  assert.equal(view.tryOutButtons, 0, 'Try it out must be absent when disabled');
  await config.update('tryItOutEnabled', true, vscode.ConfigurationTarget.Workspace);
  await waitFor(() => api.getPreview(outside).settings.tryItOutEnabled && api.getPreview(outside).ready && !api.getPreview(outside).busy, 'Try it out setting did not apply');
  await waitFor(async () => { view = await inspect(outside); return view.tryOutButtons > 0; }, 'Try it out must return when enabled');
  cases.push('Swagger UI applies operation expansion and live Try it out configuration');

  const oldValue = previewEnum(api.getPreview(outside).data)[0];
  const savedModel = await vscode.workspace.openTextDocument(fixture.outsideModel);
  const manualEdit = new vscode.WorkspaceEdit();
  manualEdit.replace(savedModel.uri, new vscode.Range(0, 0, savedModel.lineCount, 0), savedModel.getText().replace(oldValue, 'manual-refresh'));
  await vscode.workspace.applyEdit(manualEdit); await savedModel.save(); await delay(350);
  assert.equal(previewEnum(api.getPreview(outside).data)[0], oldValue, 'Disabled autoRefresh must retain the previous contract');
  await api.clickPreview(outside, '.api-tools button', 'Refresh');
  await waitFor(() => api.getPreview(outside)?.data && previewEnum(api.getPreview(outside).data)[0] === 'manual-refresh', 'Manual Refresh failed while autoRefresh was disabled');
  cases.push('disabled autoRefresh preserves saved-data state while manual Refresh still works');

  await openFile(file); await api.setMode(file, 'diff');
  await waitFor(() => api.getPreview(file).ready && !api.getPreview(file).busy, 'Configured Diffs did not load');
  view = await inspect(file);
  assert.equal(view.changesOnly, false); assert.equal(view.changesExpanded, false);
  await config.update('changesOnly', true, vscode.ConfigurationTarget.Workspace);
  await config.update('showChangesList', true, vscode.ConfigurationTarget.Workspace);
  await waitFor(async () => {
    const view = await inspect(file);
    return view.changesOnly && view.changesExpanded;
  }, 'Diff filters did not apply to real toolbar controls');
  cases.push('change filter and list visibility settings update real Diffs controls');

  await config.update('defaultMode', 'diff', vscode.ConfigurationTarget.Workspace);
  assert.equal((await openFile(file)).mode, 'diff');
  await config.update('defaultMode', 'preview', vscode.ConfigurationTarget.Workspace);
  assert.equal((await openDiff(gitUri(file, 'HEAD'), file, file)).mode, 'preview');
  cases.push('defaultMode overrides ordinary and comparison editors');

  await waitFor(() => api.getPreview(file).ready, 'Preview for theme test did not load');
  const expectedTheme = (await inspect(file)).theme === 'dark' ? 'light' : 'dark';
  await api.clickPreview(file, '.api-theme-toggle');
  await waitFor(() => vscode.workspace.getConfiguration('swaggerLens').get('theme') === expectedTheme, 'Toolbar theme choice did not persist in configuration');
  assert.equal((await inspect(file)).theme, expectedTheme);
  cases.push('toolbar theme choice is saved to VS Code configuration');
  for (const name of ['autoClosePreview', 'autoRefresh', 'docExpansion', 'schemaExpandDepth', 'tryItOutEnabled', 'changesOnly', 'showChangesList', 'defaultMode']) {
    await config.update(name, undefined, vscode.ConfigurationTarget.Workspace);
  }
  await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap(group => group.tabs), true);
  const { reviewFixture } = require('./gitlab-review-fixture.cjs');
  const review = reviewFixture(vscode, path.dirname(fixture.outside));
  const reviewChanges = new vscode.EventEmitter();
  const provider = vscode.workspace.registerFileSystemProvider('gl-review', {
    onDidChangeFile: reviewChanges.event,
    watch: () => ({ dispose() {} }),
    stat: uri => ({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: review.readFile(uri).length }),
    readFile: review.readFile,
    readDirectory() { throw vscode.FileSystemError.NoPermissions(); },
    createDirectory() { throw vscode.FileSystemError.NoPermissions(); },
    writeFile() { throw vscode.FileSystemError.NoPermissions(); },
    delete() { throw vscode.FileSystemError.NoPermissions(); },
    rename() { throw vscode.FileSystemError.NoPermissions(); }
  }, { isReadonly: true, isCaseSensitive: true });
  try {
    const reviewData = await openDiff(review.left, review.right, review.left);
    assert.equal(reviewData.mode, 'diff'); assert.equal(reviewData.diffAvailable, true);
    assert.equal(reviewData.root, null); assert.equal(reviewData.canSelectBase, false);
    assert.deepEqual(leaf(reviewData)['x-diff-original'].enum, ['before']);
    assert.deepEqual(leaf(reviewData).enum, ['after']);
    assert.ok(review.reads.some(read => read.commit === review.baseCommit && read.path === '/shared/status.json'));
    assert.ok(review.reads.some(read => read.commit === review.headCommit && read.path === '/shared/status.json'));
    assert.ok(!review.reads.some(read => read.path.endsWith('missing.json')));
    await waitFor(() => api.getPreview(review.right).ready, 'GitLab Diff webview did not load');
    assert.equal((await inspect(review.right)).baseDisabled, true);
    assert.match(extension.packageJSON.contributes.menus['editor/title'][0].when, /gl-review/);
    cases.push('GitLab MR provider: renamed files compare both commits and nested refs without local Git');

    await api.setMode(review.right, 'preview');
    await rendered(review.right);
    assert.deepEqual(api.getPreview(review.right).data.spec.components.schemas.Envelope.properties.status.enum, ['after']);
    assert.doesNotMatch(JSON.stringify(api.getPreview(review.right).data.spec), /x-diff-/);
    await api.setMode(review.right, 'diff');
    await waitFor(() => api.getPreview(review.right).ready, 'GitLab Diff did not recover after Preview');
    assert.deepEqual(leaf(api.getPreview(review.right).data)['x-diff-original'].enum, ['before']);
    cases.push('GitLab MR provider: real OpenAPI 3.1 Preview resolves refs and mode switches preserve the comparison');

    const reviewTabs = () => vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => {
      const input = tab.input;
      return input instanceof vscode.TabInputTextDiff && input.modified.toString() === review.right.toString();
    });
    await vscode.commands.executeCommand('vscode.diff', review.left, review.right, 'Duplicate GitLab review', { viewColumn: vscode.ViewColumn.Three, preview: false });
    await waitFor(() => reviewTabs().length === 2, 'Duplicate GitLab comparison did not open');
    await vscode.window.tabGroups.close(reviewTabs()[0], true); await delay(100);
    assert.ok(api.getPreview(review.right), 'A duplicate GitLab comparison must keep Preview open');
    await vscode.window.tabGroups.close(reviewTabs(), true);
    await waitFor(() => !api.getPreview(review.right), 'Closing the last GitLab comparison did not close Preview');
    cases.push('GitLab MR provider: duplicate comparison tabs preserve Preview until the last tab closes');

    const yamlReview = await openFile(review.left);
    assert.equal(yamlReview.mode, 'preview');
    await rendered(review.left);
    assert.deepEqual(yamlReview.spec.components.schemas.Envelope.properties.status.enum, ['before']);
    cases.push('GitLab MR provider: an ordinary YAML review editor opens the correct snapshot in Preview');

    for (const change of ['added', 'deleted']) {
      const left = change === 'added' ? review.uri(review.right.path, review.baseCommit, false, change) : review.left;
      const right = change === 'deleted' ? review.uri(review.left.path, review.headCommit, false, change) : review.right;
      const data = await openDiff(left, right, right);
      assert.equal(data.baseMissing, change === 'added'); assert.equal(data.revisionMissing, change === 'deleted');
      assert.equal(data.spec.paths['/items'].get['x-diff-status'], change);
      await waitFor(() => api.getPreview(right).ready, 'GitLab empty-side Diff webview did not load');
    }
    cases.push('GitLab MR provider: added and deleted files use the empty comparison side');
  } finally {
    await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap(group => group.tabs), true);
    provider.dispose(); reviewChanges.dispose();
  }
  const { githubFixture } = require('./github-review-fixture.cjs');
  const github = githubFixture(vscode, fixture.root);
  require('node:child_process').execFileSync('git', ['-C', fixture.root, 'remote', 'add', 'origin', 'git@github.com:catomak/swagger-lens.git']);
  await gitAPI.getRepository(file).status();
  await waitFor(() => gitAPI.getRepository(file).state.remotes.some(remote => remote.name === 'origin'), 'GitHub fixture remote was not detected');
  const githubChanges = new vscode.EventEmitter();
  const githubProvider = {
    onDidChangeFile: githubChanges.event,
    watch: () => ({ dispose() {} }),
    stat: uri => ({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: github.readFile(uri).length }),
    readFile: github.readFile,
    readDirectory() { throw vscode.FileSystemError.NoPermissions(); },
    createDirectory() { throw vscode.FileSystemError.NoPermissions(); },
    writeFile() { throw vscode.FileSystemError.NoPermissions(); },
    delete() { throw vscode.FileSystemError.NoPermissions(); },
    rename() { throw vscode.FileSystemError.NoPermissions(); }
  };
  const githubProviders = ['pr', 'review', 'githubcommit'].map(scheme => vscode.workspace.registerFileSystemProvider(scheme, githubProvider, { isReadonly: true, isCaseSensitive: true }));
  try {
    const data = await openDiff(github.left, github.right, github.left);
    assert.equal(data.mode, 'diff'); assert.equal(data.baseRef, 'GitHub 11111111');
    assert.deepEqual(leaf(data)['x-diff-original'].enum, ['before']); assert.deepEqual(leaf(data).enum, ['after']);
    for (const commit of [github.baseCommit, github.headCommit]) assert.ok(github.reads.some(read => read.scheme === 'githubcommit' && read.commit === commit && read.path === '/shared/status.json'));
    assert.ok(!github.reads.some(read => read.path.endsWith('missing.json')));
    assert.match(extension.packageJSON.contributes.menus['editor/title'][0].when, /pr\|review/);
    cases.push('GitHub PR provider: renamed JSON/YAML comparison loads unchanged refs from both remote commits');

    await api.setMode(github.right, 'preview'); await rendered(github.right);
    assert.deepEqual(api.getPreview(github.right).data.spec.components.schemas.Envelope.properties.status.enum, ['after']);
    await api.setMode(github.right, 'diff');
    await waitFor(() => api.getPreview(github.right).ready, 'GitHub Diff webview did not reload');
    assert.deepEqual(leaf(api.getPreview(github.right).data)['x-diff-original'].enum, ['before']);
    cases.push('GitHub PR provider: OpenAPI 3.1 renders in Preview and returns to the actual comparison');

    const githubTabs = () => vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.toString() === github.right.toString());
    await vscode.commands.executeCommand('vscode.diff', github.left, github.right, 'Duplicate GitHub PR', { viewColumn: vscode.ViewColumn.Three, preview: false });
    await waitFor(() => githubTabs().length === 2, 'Duplicate GitHub comparison did not open');
    await vscode.window.tabGroups.close(githubTabs()[0], true); await delay(100);
    assert.ok(api.getPreview(github.right));
    await vscode.window.tabGroups.close(githubTabs(), true);
    await waitFor(() => !api.getPreview(github.right), 'Closing the last GitHub comparison did not close Preview');
    cases.push('GitHub PR provider: auto closure waits for the last duplicate source tab');

    for (const [key, content] of github.documents) {
      if (!key.startsWith(github.headCommit + ':')) continue;
      const target = path.join(fixture.root, key.slice(github.headCommit.length + 2));
      await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content);
    }
    const working = vscode.Uri.file(path.join(fixture.root, github.headPath));
    const reviewLeft = github.reviewUri(github.basePath);
    const checkedOut = await openDiff(reviewLeft, working, reviewLeft);
    assert.deepEqual(leaf(checkedOut)['x-diff-original'].enum, ['before']); assert.deepEqual(leaf(checkedOut).enum, ['after']);
    await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap(group => group.tabs), true);
    const outdated = github.reviewUri(github.basePath, github.baseCommit, '.git');
    await openFile(outdated); await rendered(outdated);
    assert.deepEqual(api.getPreview(outdated).data.spec.components.schemas.Envelope.properties.status.enum, ['before']);
    cases.push('GitHub review provider: checkout comparisons and historical .yaml.git editors preserve query paths');

    for (const [change, status] of [['added', 0], ['deleted', 2]]) {
      const left = github.prUri(true, status), right = github.prUri(false, status);
      const result = await openDiff(left, right, right);
      assert.equal(result.baseMissing, status === 0); assert.equal(result.revisionMissing, status === 2);
      assert.equal(result.spec.paths['/items'].get['x-diff-status'], change);
      await waitFor(() => api.getPreview(right).ready, 'GitHub empty-side Diff webview did not load');
    }
    cases.push('GitHub PR provider: added and deleted files use the empty comparison side');
  } finally {
    await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap(group => group.tabs), true);
    githubProviders.forEach(provider => provider.dispose()); githubChanges.dispose();
  }
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
