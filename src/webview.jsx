import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import SwaggerUI from 'swagger-ui-react';
import DiffHighlightPlugin from '@inditextech/swagger-ui-plugin-diff-highlight';
import { InMemoryResolverPlugin } from './resolver.cjs';
import 'swagger-ui-react/swagger-ui.css';
import '@inditextech/swagger-ui-plugin-diff-highlight/styles.css';
import './webview.css';

const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
const send = (type, payload = {}) => vscode?.postMessage({ type, ...payload });
const submitMethods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const demoStateKey = `swaggerLens:${window.location.pathname}`;
const demoThemeKey = 'swaggerLens:theme';
const initialTheme = vscode ? document.documentElement.dataset.theme || 'light' : localStorage.getItem(demoThemeKey) || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
const applyTheme = theme => {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle('dark-mode', theme === 'dark');
};
applyTheme(initialTheme);
const initialMode = vscode ? document.body.dataset.mode || 'preview' : sessionStorage.getItem(`${demoStateKey}:mode`) || window.API_INITIAL_MODE || 'preview';
const initialDemo = initialMode === 'diff' ? window.API_DIFF_DEMO : window.API_PREVIEW_DEMO;
const saveViewState = (key, value) => {
  if (vscode) vscode.setState({ ...vscode.getState(), [key]: value });
  else sessionStorage.setItem(`${demoStateKey}:${key}`, String(value));
};
const defaultSettings = { changesOnly: true, showChangesList: true, docExpansion: 'list', schemaExpandDepth: 8, tryItOutEnabled: true };
const initialSettings = { ...defaultSettings, ...(vscode ? JSON.parse(document.body.dataset.settings || '{}') : {}) };
const statuses = { added: 'Added', deleted: 'Removed', updated: 'Modified' };
const format = value => value === undefined ? '∅' : typeof value === 'string' ? value : JSON.stringify(value);
const operationKey = op => `${op.scope || 'paths'}:${op.method}:${op.path}`;

function DiffFacets({ details }) {
  return details.length > 0 && <span className="api-facets">{details.map((detail, index) => <span className="api-facet" key={index}>
    <b>{detail.key}</b>: <del>{format(detail.before)}</del><span> → </span><ins>{format(detail.after)}</ins>
  </span>)}</span>;
}

// Preserve the original model: upstream replaces modified objects with a type-only label.
function InlineDiffPlugin(isDiff) {
  const plugin = DiffHighlightPlugin();
  for (const name of ['operation', 'parameterRow', 'response']) {
    const wrap = plugin.wrapComponents[name];
    plugin.wrapComponents[name] = Original => {
      const Wrapped = wrap(Original);
      return props => isDiff() ? <Wrapped {...props} /> : <Original {...props} />;
    };
  }
  plugin.wrapComponents.Model = Original => props => {
    if (!isDiff()) return <Original {...props} />;
    const status = props.schema?.get?.('x-diff-status');
    const details = props.schema?.get?.('x-diff-details')?.toJS?.() || [];
    const type = props.schema?.get?.('type');
    const isObject = type === 'object' || type?.includes?.('object') || props.schema?.get?.('properties');
    if (!status && !isObject) return <Original {...props} />;
    return <span className={`api-schema ${isObject ? 'api-schema-object' : ''} ${status ? `api-schema-${status}` : ''} ${status === 'added' || status === 'deleted' ? `diff-${status}` : ''}`}>
      <DiffFacets details={details} />
      <Original {...props} />
    </span>;
  };
  // OpenAPI 3.1 uses a separate renderer for every nested JSON Schema node.
  plugin.wrapComponents.JSONSchema202012 = Original => React.forwardRef((props, ref) => {
    const status = props.schema?.['x-diff-status'];
    const details = props.schema?.['x-diff-details'] || [];
    if (!isDiff() || !status) return <Original {...props} ref={ref} />;
    return <div className={`api-json-schema api-schema-${status} ${status === 'added' || status === 'deleted' ? `diff-${status}` : ''}`}>
      <DiffFacets details={details} />
      <Original {...props} ref={ref} />
    </div>;
  });
  return plugin;
}

function focusOperation(operation) {
  for (const block of document.querySelectorAll('.swagger-ui .opblock')) {
    if (Boolean(block.closest('.webhooks')) !== (operation.scope === 'webhooks')) continue;
    const method = block.querySelector('.opblock-summary-method')?.textContent?.trim().toLowerCase();
    const pathElement = block.querySelector('.opblock-summary-path');
    const path = pathElement?.getAttribute('data-path') || pathElement?.textContent?.trim();
    if (method === operation.method && path === operation.path) {
      if (!block.classList.contains('is-open')) block.querySelector('.opblock-summary-control')?.click();
      block.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
  }
}

function filteredSpec(data, changedOnly) {
  if (!changedOnly) return data.spec;
  const paths = {}, webhooks = {};
  for (const op of data.operations) {
    const scope = op.scope || 'paths', target = scope === 'webhooks' ? webhooks : paths;
    const item = data.spec[scope][op.path];
    target[op.path] ||= Object.fromEntries(Object.entries(item).filter(([key]) => !['get','post','put','patch','delete','head','options','trace'].includes(key)));
    target[op.path][op.method] = item[op.method];
  }
  return { ...data.spec, paths, ...(data.spec.webhooks && { webhooks }) };
}

function App() {
  const [data, setData] = useState(initialDemo || null);
  const [status, setStatus] = useState(initialDemo || { mode: initialMode, diffAvailable: false, baseRef: 'HEAD' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(!data);
  const [dirty, setDirty] = useState(false);
  const [theme, setTheme] = useState(initialTheme);
  const [settings, setSettings] = useState(initialSettings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [changedOnly, setChangedOnly] = useState(vscode ? vscode.getState()?.changedOnly ?? initialSettings.changesOnly : sessionStorage.getItem(`${demoStateKey}:changedOnly`) !== 'false');
  const [changesExpanded, setChangesExpanded] = useState(vscode ? vscode.getState()?.changesExpanded ?? initialSettings.showChangesList : sessionStorage.getItem(`${demoStateKey}:changesExpanded`) !== 'false');
  const [selected, setSelected] = useState(null);
  const selectedRef = useRef(null);
  const modeRef = useRef(status.mode);
  modeRef.current = status.mode;
  // Swagger UI caches its 3.1 schema context by URL across instances. Register
  // the same renderer in both modes, and gate the decoration at render time.
  const plugins = useRef([() => InlineDiffPlugin(() => modeRef.current === 'diff'), () => InMemoryResolverPlugin(result => send('resolverResult', result))]);
  useEffect(() => {
    const receive = event => {
      if (event.data.type === 'data') { setData(event.data.data); setStatus(event.data.data); setBusy(false); setError(''); }
      if (event.data.type === 'busy') { setStatus(event.data); setBusy(true); setError(''); }
      if (event.data.type === 'error') { setStatus(event.data); setError(event.data.error); setBusy(false); }
      if (event.data.type === 'dirty') setDirty(event.data.dirty);
      if (event.data.type === 'settings') {
        setSettings(event.data.settings);
        if (event.data.reset?.includes('changesOnly')) {
          setChangedOnly(event.data.settings.changesOnly);
          saveViewState('changedOnly', event.data.settings.changesOnly);
        }
        if (event.data.reset?.includes('showChangesList')) {
          setChangesExpanded(event.data.settings.showChangesList);
          saveViewState('changesExpanded', event.data.settings.showChangesList);
        }
      }
      // Installed-package tests click real controls instead of invoking Swagger internals.
      if (event.data.type === 'testInspect') send('viewState', { state: {
        theme: document.documentElement.dataset.theme,
        changesOnly: document.querySelector('.api-tools input')?.checked,
        changesExpanded: Boolean(document.querySelector('.api-sidebar:not([hidden])')),
        operations: document.querySelectorAll('.swagger-ui .opblock').length,
        expandedOperations: document.querySelectorAll('.swagger-ui .opblock.is-open').length,
        tryOutButtons: document.querySelectorAll('.swagger-ui .try-out__btn').length,
        baseDisabled: [...document.querySelectorAll('.api-tools button')].find(button => button.textContent.startsWith('Base:'))?.disabled
      } });
      if (event.data.type === 'testClick' && typeof event.data.selector === 'string') {
        [...document.querySelectorAll(event.data.selector)].find(element => element.textContent.trim().startsWith(event.data.text || ''))?.click();
      }
      if (event.data.type === 'theme' && ['light', 'dark'].includes(event.data.theme)) {
        applyTheme(event.data.theme);
        setTheme(event.data.theme);
      }
    };
    window.addEventListener('message', receive);
    send('ready');
    return () => window.removeEventListener('message', receive);
  }, []);
  const diffs = status.mode === 'diff';
  const changesVisible = diffs && changesExpanded;
  const renderedSpec = useMemo(() => data && (diffs ? filteredSpec(data, changedOnly) : data.spec), [data, diffs, changedOnly]);
  const changeMode = mode => {
    if (mode === status.mode || (mode === 'diff' && !status.diffAvailable)) return;
    modeRef.current = mode;
    selectedRef.current = null;
    setSelected(null);
    if (vscode) { setBusy(true); setError(''); send('mode', { mode }); }
    else {
      sessionStorage.setItem(`${demoStateKey}:mode`, mode);
      window.location.reload();
    }
  };
  const changeFilter = value => {
    setChangedOnly(value);
    saveViewState('changedOnly', value);
  };
  const toggleChanges = () => {
    const value = !changesExpanded;
    setChangesExpanded(value);
    saveViewState('changesExpanded', value);
  };
  const toggleTheme = () => {
    const value = theme === 'dark' ? 'light' : 'dark';
    applyTheme(value);
    setTheme(value);
    if (vscode) send('theme', { theme: value });
    else localStorage.setItem(demoThemeKey, value);
  };
  const choose = op => { selectedRef.current = op; setSelected(operationKey(op)); focusOperation(op); };
  const globalChanges = data?.changelog?.filter(change => !change.operation || !change.path) || [];
  return <>
    <header className="api-header">
      <div className="api-tools">
        {diffs && <button className="api-sidebar-toggle" aria-label={changesVisible ? 'Hide changes' : 'Show changes'} aria-controls="api-changes" aria-expanded={changesVisible} disabled={busy || !data || Boolean(error)} title={changesVisible ? 'Hide changes' : 'Show changes'} onClick={toggleChanges}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
        </button>}
        <div className="api-mode-switch" role="group" aria-label="View mode">
          <button className="api-mode" aria-pressed={!diffs} onClick={() => changeMode('preview')}>Preview</button>
          <button className="api-mode" aria-pressed={diffs} disabled={!status.diffAvailable} title={status.diffAvailable ? 'Compare API changes' : status.diffUnavailableReason || 'Checking Git availability…'} onClick={() => changeMode('diff')}>Diffs</button>
        </div>
        <label className={!diffs ? 'api-disabled' : ''}><input type="checkbox" checked={diffs && changedOnly} disabled={!diffs || busy} onChange={event => changeFilter(event.target.checked)} />Changes only</label>
        {vscode && <><button disabled={!diffs || busy || !status.canSelectBase} title={status.comparisonSource === 'editor' ? `Using the left version of the comparison.${status.canSelectBase ? ' You can select another Git base.' : ''}` : 'Select a branch, tag, or commit'} onClick={() => send('base')}>Base: {status.baseRef || 'HEAD'}</button><button onClick={() => send('refresh')}>Refresh</button></>}
      </div>
      <button className="api-theme-toggle" aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} aria-pressed={theme === 'dark'} onClick={toggleTheme}>
        <svg viewBox="0 0 24 24" aria-hidden="true">{theme === 'dark'
          ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>
          : <path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z" />}</svg>
      </button>
    </header>
    {dirty && <div className="api-notice">There are unsaved changes. Save the file to update the preview.</div>}
    {!error && diffs && data?.baseMissing && <div className="api-notice">This file is missing from the base version {data.baseRef}. All operations are shown as added.</div>}
    {!error && diffs && data?.revisionMissing && <div className="api-notice">The right version is empty. All operations are shown as removed.</div>}
    {!error && diffs && data?.warnings?.map(warning => <div className="api-notice" key={warning}>{warning}</div>)}
    {busy && <div className="api-notice">{diffs ? 'Computing changes…' : 'Loading preview…'}</div>}
    {error && <div className="api-error"><b>{diffs ? 'Could not compare the contract' : 'Could not preview the file'}</b><pre>{error}</pre></div>}
    {data && <div className={`api-layout ${diffs ? 'api-diff' : 'api-preview'} ${diffs && !changesExpanded ? 'api-sidebar-collapsed' : ''}`} style={error ? { display: 'none' } : undefined} aria-busy={busy}>
      {diffs && <aside className="api-sidebar" id="api-changes" hidden={!changesExpanded}>
        <div className="api-sidebar-header">
          <h2>Affected operations <span>{data.operations.length}</span></h2>
          {data.operations.length > 0
            ? <div className="api-legend"><span className="added">● Added</span><span className="deleted">● Removed</span><span className="updated">● Modified</span></div>
            : <p className="api-hint">No operation changes.</p>}
        </div>
        {data.operations.map(op => <button key={operationKey(op)} className={`api-endpoint ${selected === operationKey(op) ? 'selected' : ''}`} onClick={() => choose(op)}>
          <span className="api-method"><span className={`api-status-dot ${op.status}`} role="img" aria-label={statuses[op.status]} title={statuses[op.status]} />{op.method.toUpperCase()}</span><code>{op.path}</code>
          {op.scope === 'webhooks' && <span className="api-badge">Webhook</span>}
          {op.changes.map((change, index) => <span key={index} className="api-change">{change.level === 3 && <b className="api-breaking">Breaking · </b>}{change.text}</span>)}
        </button>)}
        {globalChanges.length > 0 && <details className="api-global"><summary>Global changes ({globalChanges.length})</summary>{globalChanges.map((change, index) => <p key={index}>{change.text}</p>)}</details>}
      </aside>}
      <main><SwaggerUI spec={renderedSpec} plugins={plugins.current} docExpansion={settings.docExpansion} defaultModelRendering="model" defaultModelExpandDepth={settings.schemaExpandDepth} defaultModelsExpandDepth={diffs ? -1 : 1} supportedSubmitMethods={diffs || !settings.tryItOutEnabled ? [] : submitMethods} requestInterceptor={request => { if (modeRef.current === 'diff' || !settingsRef.current.tryItOutEnabled) throw new Error('Sending requests is disabled for this view.'); return request; }} validatorUrl={null} displayOperationId={true} onComplete={() => { if (diffs && selectedRef.current) requestAnimationFrame(() => focusOperation(selectedRef.current)); }} />
        {diffs && !data.operations.length && changedOnly && <p className="api-empty">No operations have changed. Uncheck “Changes only” to view the entire contract.</p>}
      </main>
    </div>}
  </>;
}

createRoot(document.getElementById('root')).render(<App />);
