import crypto from 'node:crypto';
import { currentWs, q } from '../db';
import { wsKey } from '../wsmeta';
import { getMeta, deleteMeta, setMeta } from '../appmeta';
import { encrypt, decrypt } from '../settings';
import { isLocked } from '../features';
import { err } from '../errors';

const KEY = 'gdrive';
const SCOPE = 'https://www.googleapis.com/auth/drive';
const API = 'https://www.googleapis.com/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
export const G = globalThis as any;
/**
 * How many times a failed save is retried before the document is marked failed. Still to be
 * confirmed with the team.
 */
export const MAX_RETRIES = Math.max(1, Number(process.env.TICKETFORGE_GDRIVE_MAX_RETRIES) || 5);
export const BASE_DELAY = 30 * 1000,
  MAX_DELAY = 60 * 60 * 1000,
  TICK = 15 * 1000;
/** Wait before retry number n (1, 2, 3…): 30 s, 1 min, 2 min, 4 min… up to 1 hour. */
const backoffMs = (n: number) => Math.min(MAX_DELAY, BASE_DELAY * 2 ** Math.max(0, n - 1));
export const FAILED_MESSAGE =
  'This document couldn’t be saved to Google Drive. Contact the Super Admin.';
const creds = () => ({
  clientId: process.env.TICKETFORGE_GDRIVE_CLIENT_ID || '',
  clientSecret: process.env.TICKETFORGE_GDRIVE_CLIENT_SECRET || '',
});
// ---------------------------------------------------------------- the connection (one per
// workspace) { accessEnc, refreshEnc, expiresAt, account: { email, name }, folder: { id, name,
// selectedAt, selectedBy }, connectedAt, connectedBy }
async function readConn(): Promise<any> {
  let v = await getMeta(wsKey(KEY));
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      v = null;
    }
  }
  return v?.refreshEnc ? v : null;
}
async function writeConn(v: any) {
  if (!v) {
    await deleteMeta(wsKey(KEY));
    return;
  }
  await setMeta(wsKey(KEY), v);
}
/** What the admin setting shows. Never the tokens. */
export async function status() {
  const c = await readConn();
  const { clientId, clientSecret } = creds();
  return {
    enabled: !(await isLocked('gdrive')),
    configured: Boolean(clientId && clientSecret),
    connected: Boolean(c),
    account: c?.account || null,
    connectedAt: c?.connectedAt || null,
    connectedBy: c?.connectedBy || null,
    folder: c?.folder ? { id: c.folder.id, name: c.folder.name } : null,
    maxRetries: MAX_RETRIES,
  };
}
// ---------------------------------------------------------------- OAuth (authorization code +
// refresh token)
G.__tfGdrivePending ??= new Map();
// state → { userId, ws, expiresAt }
const PENDING: Map<string, any> = G.__tfGdrivePending;
/**
 * The Google consent page to send the owner to. `redirectUri` is this server's
 * /api/gdrive/callback.
 */
export function authorizeUrl(user: any, redirectUri: string) {
  const { clientId, clientSecret } = creds();
  if (!clientId || !clientSecret)
    throw err(
      'Google Drive isn’t set up on this server yet. Set TICKETFORGE_GDRIVE_CLIENT_ID and TICKETFORGE_GDRIVE_CLIENT_SECRET.',
      409,
    );
  for (const [k, p] of PENDING) if (p.expiresAt < Date.now()) PENDING.delete(k);
  const state = crypto.randomBytes(16).toString('hex');
  PENDING.set(state, { userId: user.id, ws: currentWs(), expiresAt: Date.now() + 10 * 60 * 1000 });
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}
async function tokenRequest(params: Record<string, string>) {
  const { clientId, clientSecret } = creds();
  let res: Response;
  try {
    res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
    });
  } catch {
    throw err('Couldn’t reach Google to sign in.', 503);
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token)
    throw err(
      data.error === 'invalid_grant'
        ? 'Google rejected the saved sign-in. Connect Google Drive again.'
        : `Google didn’t sign in (${data.error_description || data.error || res.status}).`,
      data.error === 'invalid_grant' ? 409 : 502,
    );
  return data;
}
/**
 * Finishes the connection after Google sent the owner back with a code. Replaces any earlier
 * connection.
 */
export async function completeConnect(
  user: any,
  { code, state }: { code: string; state: string },
  redirectUri: string,
) {
  const p = PENDING.get(String(state || ''));
  PENDING.delete(String(state || ''));
  if (!p || p.userId !== user.id || p.expiresAt < Date.now())
    throw err('The Google sign-in expired. Start the connection again.');
  if (!code) throw err('Google didn’t send a sign-in code.');
  const t = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  if (!t.refresh_token)
    throw err(
      'Google didn’t allow ongoing access. Remove TicketForge from your Google account’s third-party access and connect again.',
    );
  const draft: any = {
    accessEnc: encrypt(t.access_token),
    refreshEnc: encrypt(t.refresh_token),
    expiresAt: Date.now() + (Number(t.expires_in) || 3600) * 1000,
  };
  const about = await driveJson(
    draft,
    `${API}/about?fields=user(displayName,emailAddress)`,
    {},
    false,
  );
  const prev = await readConn();
  const account = { email: about.user?.emailAddress || '', name: about.user?.displayName || '' };
  // The same account connecting again keeps its folder; another account starts without one.
  await writeConn({
    ...draft,
    account,
    folder: prev?.account?.email === account.email ? prev.folder || null : null,
    connectedAt: new Date().toISOString(),
    connectedBy: user.name || null,
  });
  return status();
}
/** A valid access token, refreshed with the refresh token when it has expired (or is about to). */
async function accessToken(c: any, force = false) {
  if (!force && c.expiresAt - Date.now() > 60 * 1000) return decrypt(c.accessEnc);
  const t = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: decrypt(c.refreshEnc),
  });
  c.accessEnc = encrypt(t.access_token);
  c.expiresAt = Date.now() + (Number(t.expires_in) || 3600) * 1000;
  if (t.refresh_token) c.refreshEnc = encrypt(t.refresh_token);
  const cur = await readConn(); // keep a folder picked meanwhile
  if (cur)
    await writeConn({
      ...cur,
      accessEnc: c.accessEnc,
      refreshEnc: c.refreshEnc,
      expiresAt: c.expiresAt,
    });
  return t.access_token as string;
}
/**
 * One Drive API call as the connected account. An expired token (401) is refreshed and the call
 * repeated once.
 */
async function driveFetch(c: any, url: string, init: any = {}, refresh = true): Promise<Response> {
  const go = async (force: boolean) => {
    const token = await accessToken(c, force);
    try {
      return await fetch(url, {
        ...init,
        headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
      });
    } catch {
      throw err('Couldn’t reach Google Drive.', 503);
    }
  };
  let res = await go(false);
  if (res.status === 401 && refresh) res = await go(true);
  if (!res.ok) {
    const data: any = await res.json().catch(() => ({}));
    throw err(
      data.error?.message || `Google Drive said ${res.status}.`,
      res.status === 401 ? 409 : res.status,
    ); // 401 would sign the person out of TicketForge
  }
  return res;
}
const driveJson = async (c: any, url: string, init: any = {}, refresh = true) =>
  (await driveFetch(c, url, init, refresh)).json();
/** The folder id in a Drive folder link (…/folders/<id>, …?id=<id>) or an id pasted as it is. */
export function parseFolderId(input: any) {
  const s = String(input || '').trim();
  if (!s) return '';
  const m = s.match(/\/folders\/([\w-]{10,})/) || s.match(/[?&]id=([\w-]{10,})/);
  if (m) return m[1];
  return /^[\w-]{10,}$/.test(s) ? s : '';
}
/**
 * Makes one folder the document destination. Needs a connection; only the folder's id and name are
 * kept.
 */
export async function selectFolder(user: any, input: any) {
  const c = await readConn();
  if (!c) throw err('Connect Google Drive first.', 409);
  const id = parseFolderId(input);
  if (!id) throw err('Paste the link of a Google Drive folder (or its ID).');
  let meta: any;
  try {
    meta = await driveJson(
      c,
      `${API}/files/${encodeURIComponent(id)}?fields=id,name,mimeType&supportsAllDrives=true`,
    );
  } catch (e: any) {
    throw err(
      e.status === 404
        ? 'Couldn’t open that folder. Check the link, and that the connected Google account can open it.'
        : e.message,
      e.status === 404 ? 404 : 502,
    );
  }
  if (meta.mimeType !== FOLDER)
    throw err('That link isn’t a folder. Choose a Google Drive folder.');
  const cur = await readConn();
  await writeConn({
    ...cur,
    folder: {
      id: meta.id,
      name: meta.name,
      selectedAt: new Date().toISOString(),
      selectedBy: user.name || null,
    },
  });
  return status();
}
/** The files in the selected folder (and nothing else: no other folder is ever opened). */
export async function listFolder() {
  const c = await readConn();
  if (!c?.folder) throw err('Select a Google Drive folder first.', 409);
  const query = encodeURIComponent(`'${c.folder.id}' in parents and trashed = false`);
  const d = await driveJson(
    c,
    `${API}/files?q=${query}&orderBy=createdTime%20desc&pageSize=25&fields=files(id,name,mimeType,createdTime,webViewLink)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
  );
  return (d.files || []).map((f: any) => ({
    id: f.id,
    name: f.name,
    mime: f.mimeType,
    createdAt: f.createdTime,
    url: f.webViewLink || '',
  }));
}
/**
 * Disconnects: the tokens are forgotten (and revoked at Google). Documents already in Drive stay
 * where they are.
 */
export async function disconnect() {
  const c = await readConn();
  if (c) {
    try {
      await fetch(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decrypt(c.refreshEnc))}`,
        { method: 'POST' },
      );
    } catch {
      /* forgotten anyway */
    }
  }
  await writeConn(null);
  return status();
}
// ---------------------------------------------------------------- saving documents
/**
 * The connection when documents go to Drive: the feature is on and a folder is picked. Otherwise
 * null (the existing storage is used).
 */
export async function destination() {
  if (await isLocked('gdrive')) return null;
  const c = await readConn();
  return c?.folder ? c : null;
}
async function upload(c: any, { name, mime, data }: { name: string; mime: string; data: Buffer }) {
  const b = `tf${crypto.randomBytes(12).toString('hex')}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [c.folder.id] })}\r\n--${b}\r\nContent-Type: ${mime || 'application/octet-stream'}\r\n\r\n`,
    ),
    data,
    Buffer.from(`\r\n--${b}--`),
  ]);
  return driveJson(
    c,
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name',
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${b}` },
      body,
    },
  );
}
export type Doc = { projectId: string; epicId: string; kind: string; docKey?: string };
const where = '(project_id = $1 and epic_id = $2 and kind = $3 and doc_key = $4)';
const ids = (d: Doc) => [d.projectId, d.epicId, d.kind, d.docKey || ''];
/**
 * One try at saving a queued document. Success: it is "saved" and its bytes are dropped. Failure:
 * it waits for the next retry (exponential backoff), or is "failed" once the retries are used up.
 * Returns the document's new state.
 */
export async function attempt(d: Doc): Promise<string> {
  const row = (
    await q(
      `select name, mime, data, attempts from drive_docs where ${where} and state = 'queued'`,
      ids(d),
    )
  ).rows[0];
  if (!row) return 'gone';
  try {
    const c = await readConn();
    if (!c?.folder) throw err('Google Drive isn’t connected or has no folder selected.', 409);
    const f = await upload(c, { name: row.name, mime: row.mime, data: Buffer.from(row.data) });
    await q(
      `update drive_docs set state = 'saved', drive_file_id = $5, data = null, next_attempt_at = null, last_error = '', updated_at = now() where ${where}`,
      [...ids(d), f.id],
    );
    return 'saved';
  } catch (e: any) {
    const failures = row.attempts + 1; // the first try plus the retries so far
    const give = failures > MAX_RETRIES;
    await q(
      `update drive_docs set state = $5, attempts = $6, next_attempt_at = $7, last_error = $8, data = case when $5 = 'failed' then null else data end, updated_at = now() where ${where}`,
      [
        ...ids(d),
        give ? 'failed' : 'queued',
        failures,
        give ? null : new Date(Date.now() + backoffMs(failures)).toISOString(),
        String(e.message || e).slice(0, 300),
      ],
    );
    if (give)
      console.error(
        `Google Drive: gave up saving "${row.name}" after ${MAX_RETRIES} retries: ${e.message}`,
      );
    return give ? 'failed' : 'queued';
  }
}
