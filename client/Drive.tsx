'use client';
// Google Drive storage. DriveTab is Administration → Google Drive (Super Admin only, behind the "gdrive" feature flag):
// connect one Google account for the workspace and select the folder documents are saved to. DriveState is the badge that
// shows each document's save state (saved, queued, failed) next to it.
import { useEffect, useState } from 'react';
import { S, P, toast, openModal, ago, feat, useStore, type Any } from './core';
import { Ico, I, Spinner, ErrorState, EmptyState, Confirm } from './ui';
import { TF } from './fields';
import { getDriveStatus, startDriveConnect, selectDriveFolder, listDriveFiles, disconnectDrive, getDocumentStates } from './api/gdrive';

/** Administration → Google Drive. */
export function DriveTab() {
  const [st, setSt] = useState<Any>(null);
  const [err, setErr] = useState<Any>(null);
  const [busy, setBusy] = useState('');
  const [folder, setFolder] = useState('');
  const [files, setFiles] = useState<Any[] | null>(null);
  const load = () => getDriveStatus().then((d) => { setSt(d); setErr(null); }).catch(setErr);
  useEffect(() => {
    load();
    // Google sends the Super Admin back here with the result of the connection.
    const u = new URL(window.location.href); const r = u.searchParams.get('gdrive');
    if (r) {
      if (r === 'connected') toast('Google Drive connected');
      else toast(r === 'denied' ? 'Google Drive wasn’t connected: access was refused.' : `Couldn’t connect Google Drive${u.searchParams.get('message') ? `: ${u.searchParams.get('message')}` : '.'}`, 'err');
      window.history.replaceState(null, '', u.pathname);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const folderId = st?.folder?.id;
  useEffect(() => { setFiles(null); if (folderId) listDriveFiles().then((d) => setFiles(d.files)).catch(() => setFiles([])); }, [folderId]);
  if (!S.user?.isOwner) return <div className="card"><EmptyState compact icon={I.settings} tone="neutral" title="Only the Super Admin can set up Google Drive"><p>Ask the owner of this TicketForge to connect Google Drive.</p></EmptyState></div>;
  if (err) return <div className="card"><ErrorState compact title="Couldn’t load Google Drive" error={err} onRetry={() => { setErr(null); load(); }} /></div>;
  if (!st) return <div className="card"><Spinner /> Loading…</div>;

  const run = async (key: string, fn: () => Promise<Any>, ok: string) => {
    setBusy(key);
    try { const d = await fn(); if (d?.url) { window.location.href = d.url; return false; } setSt(d); toast(ok); return true; }
    catch (e: Any) { toast(e.message, 'err'); return false; } finally { setBusy(''); }
  };
  const connect = () => run('connect', startDriveConnect, '');
  const select = async () => { if (await run('folder', () => selectDriveFolder(folder.trim()), 'Document folder selected')) setFolder(''); };

  return (
    <div className="cards">
      <div className="card wide">
        <h3>Connection</h3>
        <p className="sub">Connect one Google account for the whole workspace. Generated and uploaded project documents are then saved to a folder of its Drive instead of TicketForge storage. Sign-in tokens stay on the server.</p>
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <span className={`loz ${st.connected ? 't-pass' : 's-todo'}`}>{st.connected ? 'Connected' : 'Not connected'}</span>
          {st.connected && <span className="muted small">{st.account?.email || 'Google account'}{st.connectedAt ? ` · connected ${ago(st.connectedAt)}` : ''}{st.connectedBy ? ` by ${st.connectedBy}` : ''}</span>}
          <span className="spacer" />
          <button className="btn primary" disabled={!!busy || !st.configured} onClick={connect}>{busy === 'connect' ? <><Spinner />Opening Google…</> : st.connected ? 'Connect another account' : 'Connect Google Drive'}</button>
          {st.connected && <button className="btn" disabled={!!busy} onClick={() => openModal(<Confirm title="Disconnect Google Drive?" label="Disconnect" text="New documents are saved to TicketForge storage again only after you select a folder. Documents already in Drive stay there."
            onYes={() => run('disconnect', disconnectDrive, 'Google Drive disconnected')} />)}>Disconnect</button>}
        </div>
        {!st.configured && <p className="muted small" style={{ marginBottom: 0 }}>Google Drive isn’t set up on this server yet: set <code>TICKETFORGE_GDRIVE_CLIENT_ID</code> and <code>TICKETFORGE_GDRIVE_CLIENT_SECRET</code> (a Google OAuth client) first.</p>}
      </div>
      <div className="card wide">
        <h3>Document folder</h3>
        <p className="sub">Paste the link of the Drive folder to save documents in. Only this folder is stored and used: TicketForge never opens other folders.</p>
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <TF value={folder} disabled={!st.connected || !!busy} placeholder="https://drive.google.com/drive/folders/…" aria-label="Google Drive folder link" onChange={(e: Any) => setFolder(e.target.value)} sx={{ flex: 1, minWidth: 260 }} />
          <button className="btn primary" disabled={!st.connected || !!busy || !folder.trim()} onClick={select}>{busy === 'folder' ? <><Spinner />Selecting…</> : 'Select folder'}</button>
        </div>
        {!st.connected && <p className="muted small" style={{ marginBottom: 0 }}>Connect Google Drive first, then select a folder.</p>}
        {st.folder && <p style={{ marginBottom: 0 }}><Ico svg={I.folder} /> Document destination: <b>{st.folder.name}</b></p>}
        {st.connected && !st.folder && <p className="muted small" style={{ marginBottom: 0 }}>No folder selected yet: documents keep going to TicketForge storage until you select one.</p>}
        {st.folder && <>
          <p className="muted small" style={{ marginBottom: 4 }}>A save that fails is queued and retried in the background (up to {st.maxRetries} retries, waiting longer each time). After that the document shows as failed and the people who wrote it are told to contact you.</p>
          <div className="muted small"><b>Latest files in this folder</b></div>
          {files === null ? <span className="muted small"><Spinner /> Loading…</span> : files.length ? <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{files.map((f) => <li key={f.id}>{f.url ? <a href={f.url} target="_blank" rel="noopener noreferrer">{f.name}</a> : f.name} <span className="muted">· {ago(f.createdAt)}</span></li>)}</ul> : <span className="muted small">No files yet.</span>}
        </>}
      </div>
    </div>
  );
}

// One request per epic is shared by the badges of its documents.
const recent = new Map<string, { at: number; p: Promise<Any[]> }>();
function states(epicId: string, fresh: boolean): Promise<Any[]> {
  const k = `${P().id}:${epicId}`; const c = recent.get(k);
  if (!fresh && c && Date.now() - c.at < 1000) return c.p;
  const p = getDocumentStates(P().id, epicId).then((d) => d.documents || []);
  recent.set(k, { at: Date.now(), p });
  return p;
}

/**
 * The Google Drive save state of one document of an epic: saved, queued (being retried) or failed (contact the Super
 * Admin). `kind` is psd, fbd, ard or agent; `docKey` is the agent id, or 'upload' for an uploaded document. `again`
 * changes when the document is written again, so the state is read again. Shows nothing when Google Drive is off.
 */
export function DriveState({ epic, kind, docKey = '', again = '' }: { epic: Any; kind: string; docKey?: string; again?: string }) {
  useStore();
  const on = Boolean(S.flags) && feat('gdrive');
  const [doc, setDoc] = useState<Any>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    let live = true;
    states(epic.id, tick > 0).then((all) => { if (live) setDoc(all.find((d) => d.kind === kind && d.key === docKey) || null); }).catch(() => {});
    return () => { live = false; };
  }, [on, epic.id, kind, docKey, again, tick]);
  // While it is queued, look again until it is saved or has failed.
  useEffect(() => {
    if (doc?.state !== 'queued') return;
    const t = setTimeout(() => setTick((n) => n + 1), 10000);
    return () => clearTimeout(t);
  }, [doc, tick]);
  if (!on || !doc) return null;
  const retry = doc.state === 'queued' ? ` · retry ${Math.min(doc.retries + 1, doc.maxRetries)} of ${doc.maxRetries} pending` : '';
  return <span className="row" style={{ gap: 6, alignItems: 'center' }} data-drive-state={doc.state} title={doc.error || undefined}>
    <span className={`loz ${doc.state === 'saved' ? 't-pass' : doc.state === 'failed' ? 't-fail' : 's-inprogress'}`}>
      {doc.state === 'saved' ? 'Saved to Google Drive' : doc.state === 'failed' ? 'Failed to save to Google Drive' : 'Queued for Google Drive'}</span>
    {doc.message && <span className="muted small">{doc.message}{retry}</span>}
  </span>;
}
