'use client';
// Test automation → Settings → Test browser (administrators): the browser tests use, and a remote browser to
// connect. Needed on serverless hosting (Vercel), where no browser can run; optional anywhere else.
import { useEffect, useState } from 'react';
import { S, emit, api, toast, ago, type Any } from './core';
import { Ico, I, Spinner, Confirm } from './ui';
import { TF, SF, MenuItem } from './fields';
import { openModal } from './core';

export function RemoteBrowser() {
  const [data, setData] = useState<Any>(null);
  const [url, setUrl] = useState('');
  const [protocol, setProtocol] = useState('playwright');
  const [busy, setBusy] = useState('');
  const [test, setTest] = useState<Any>(null);
  const [edit, setEdit] = useState(false);
  const load = () => api('/api/admin/browser').then((d) => { setData(d); S.engine = { ...(S.engine || {}), ...d.engine }; emit(); }).catch(() => {});
  useEffect(() => { load(); }, []);
  const r = data?.remote;
  const run = async (kind: string, fn: () => Promise<Any>) => { setBusy(kind); setTest(null); try { await fn(); } catch (e: Any) { setTest({ ok: false, error: e.message }); } finally { setBusy(''); } };
  const testIt = () => run('test', async () => setTest(await api('/api/admin/browser', { method: 'POST', body: url ? { url, protocol } : {} })));
  const save = () => run('save', async () => {
    const d = await api('/api/admin/browser', { method: 'PUT', body: { url, protocol } });
    setData(d); S.engine = { ...(S.engine || {}), ...d.engine }; emit(); setTest(d.test); setUrl(''); setEdit(false);
    toast('Remote browser connected. Tests run there now.');
  });
  const remove = () => openModal(<Confirm title="Disconnect the remote browser?" label="Disconnect"
    text={data?.engine?.serverless ? 'This server can’t run a browser itself, so test automation stops working until you connect one again.' : 'Tests go back to the browser on this computer.'}
    onYes={async () => { const d = await api('/api/admin/browser', { method: 'DELETE' }); setData(d); S.engine = { ...(S.engine || {}), ...d.engine }; emit(); toast('Remote browser disconnected'); }} />);
  const showForm = !r || edit;
  return (
    <div className="rb">
      <div className="rb-h"><Ico svg={I.external} /><b>Remote browser</b><span className="label-chip">Administrators</span>
        <span className="muted small">{r ? 'Connected' : data?.engine?.serverless ? 'Needed on this server' : 'Optional'}</span></div>
      <p className="muted small" style={{ margin: '4px 0 10px' }}>Run tests in a hosted browser instead of on this server, for example <a href="https://www.browserless.io" target="_blank" rel="noopener noreferrer">Browserless</a>, or
        your own machine running <code>npx playwright run-server</code>. Required on serverless hosting such as Vercel. The address is stored encrypted and never shown again.</p>
      {r && !edit && <div className="rb-current">
        <span className="dot ok" /><span><b>{r.hint}</b> · {r.protocol === 'cdp' ? 'Chrome DevTools' : 'Playwright'}{r.source === 'env' ? ' · set by TICKETFORGE_BROWSER_WS' : r.updatedAt ? ` · connected ${ago(r.updatedAt)}${r.updatedBy ? ` by ${r.updatedBy}` : ''}` : ''}</span>
        <span className="spacer" />
        <button className="btn sm" disabled={!!busy} onClick={testIt}>{busy === 'test' ? <><Spinner />Testing…</> : 'Test'}</button>
        {r.source !== 'env' && <><button className="btn sm subtle" onClick={() => setEdit(true)}>Change</button><button className="btn sm subtle" onClick={remove}>Disconnect</button></>}
      </div>}
      {showForm && <div className="rb-form">
        <label className="field" style={{ flex: 1, margin: 0 }}><span>Address</span>
          <TF value={url} type="password" autoComplete="off" spellCheck={false} placeholder="wss://production-sfo.browserless.io/chromium/playwright?token=…" onChange={(e) => setUrl(e.target.value)} /></label>
        <label className="field" style={{ width: 190, margin: 0 }}><span>Connects with</span>
          <SF value={protocol} onChange={(e) => setProtocol(e.target.value)}><MenuItem value="playwright">Playwright (recommended)</MenuItem><MenuItem value="cdp">Chrome DevTools (CDP)</MenuItem></SF></label>
        <button className="btn" disabled={!url.trim() || !!busy} onClick={testIt}>{busy === 'test' ? <><Spinner />Testing…</> : 'Test'}</button>
        <button className="btn primary" disabled={!url.trim() || !!busy} onClick={save}>{busy === 'save' ? <><Spinner />Connecting…</> : 'Connect'}</button>
        {edit && <button className="btn subtle" onClick={() => { setEdit(false); setUrl(''); setTest(null); }}>Cancel</button>}
      </div>}
      {test && (test.ok
        ? <div className="ok-banner" style={{ marginTop: 10 }}><Ico svg={I.check} /><span>Works: {test.browser}{test.version ? ` (browser ${test.version})` : ''}, opened a page in {(test.ms / 1000).toFixed(1)} s.</span></div>
        : <div className="warn-banner danger" style={{ marginTop: 10 }}><Ico svg={I.warn} /><span>{test.browser ? `${test.browser}: ` : ''}{test.error}</span></div>)}
    </div>
  );
}
