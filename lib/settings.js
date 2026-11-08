// Settings administrators change in the app. Stored in app_meta, which row-level security limits to the
// server (system context). The AI API key is encrypted (AES-256-GCM) and never sent back to the browser.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { qs, DATA_DIR } from './db.js';

// ---------------------------------------------------------------- encryption
// The encryption key comes from TICKETFORGE_SECRET when set. Otherwise it's derived from the database user and
// password, so every copy of TicketForge that shares the database (your computer, Vercel, any pooler port) can
// read it. Without a database URL (the built-in local database) it's a random key kept in data/secret.key.
let derived = null;
function secretKey() {
  if (derived) return derived;
  let material;
  if (process.env.TICKETFORGE_SECRET) {
    material = `secret:${process.env.TICKETFORGE_SECRET}`;
  } else if (process.env.DATABASE_URL || process.env.SUPABASE_DB_URL) {
    const raw = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
    let u = null;
    try { u = new URL(raw); } catch { /* not a URL */ }
    material = `db:${u ? `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}` : raw}`;
  } else {
    const f = path.join(DATA_DIR, 'secret.key');
    if (!fs.existsSync(f)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(f, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
    }
    material = `file:${fs.readFileSync(f, 'utf8').trim()}`;
  }
  derived = crypto.scryptSync(material, 'ticketforge-settings-v1', 32);
  return derived;
}
export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const data = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}
export function decrypt(box) {
  const d = crypto.createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(box.iv, 'base64'));
  d.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]).toString('utf8');
}

// ---------------------------------------------------------------- AI settings
// { providers: [{ id, provider, model, baseUrl, keyEnc, keyHint, enabled }], accountFallback, updatedBy, updatedAt }
// The list is in priority order: TicketForge uses the first available provider and switches down the list
// when one is rate limited, out of credits or failing.
const AI = 'ai_settings';
const G = globalThis;
G.__tfSettings ??= { ai: undefined, at: 0 };
const C = G.__tfSettings;
const TTL = 30000; // other server instances (e.g. on Vercel) pick up changes within 30 seconds
const newId = () => crypto.randomUUID().slice(0, 8);

/** Older saves held one provider; turn them into a one-item list. */
function normalize(v) {
  if (!v) return { providers: [], accountFallback: true };
  if (Array.isArray(v.providers)) return { accountFallback: true, ...v };
  if (v.provider) {
    const { provider, model, baseUrl, keyEnc, keyHint, updatedBy, updatedAt } = v;
    return { providers: [{ id: newId(), provider, model: model || '', baseUrl: baseUrl || '', keyEnc: keyEnc || null, keyHint: keyHint || null, enabled: true }], accountFallback: true, updatedBy, updatedAt };
  }
  return { providers: [], accountFallback: true };
}
/** Saved AI settings (keys still encrypted). */
export async function getAiSettings({ fresh = false } = {}) {
  if (!fresh && C.ai !== undefined && Date.now() - C.at < TTL) return C.ai;
  const row = (await qs('select value from app_meta where key = $1', [AI])).rows[0];
  C.ai = normalize(row?.value || null);
  C.at = Date.now();
  return C.ai;
}
async function write(actor, next) {
  const v = { ...next, updatedBy: actor?.name || null, updatedAt: new Date().toISOString() };
  await qs('insert into app_meta (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value', [AI, JSON.stringify(v)]);
  C.ai = v; C.at = Date.now();
  return v;
}
const KEY_LOST = 'The saved API key can’t be read on this server (the database password or TICKETFORGE_SECRET changed). Enter the key again.';
function withKey(e) {
  let key = '';
  let keyError = null;
  if (e.keyEnc) { try { key = decrypt(e.keyEnc); } catch { keyError = KEY_LOST; } }
  return { ...e, key, keyError };
}
/** For server use only: the providers in priority order with keys decrypted. */
export async function aiProvidersWithKeys() {
  const s = await getAiSettings();
  return s.providers.map(withKey);
}
/** What admins see: never a key or its encrypted form. */
export const publicAiSettings = (s) => ({
  providers: (s?.providers || []).map((e) => ({ id: e.id, provider: e.provider, model: e.model || '', baseUrl: e.baseUrl || '', hasKey: Boolean(e.keyEnc), keyHint: e.keyHint || null, enabled: e.enabled !== false })),
  accountFallback: s?.accountFallback !== false,
  updatedBy: s?.updatedBy || null, updatedAt: s?.updatedAt || null,
});

const clean = (u) => String(u || '').trim().replace(/\/+$/, '');
/**
 * Adds a provider (no id) or updates one. A blank apiKey keeps the saved key, unless the provider or endpoint
 * changed: then the old key is dropped so it's never sent to a different service.
 */
export async function saveAiProvider(actor, { id, provider, model, baseUrl, apiKey, enabled }) {
  const s = await getAiSettings({ fresh: true });
  const list = [...s.providers];
  const i = id ? list.findIndex((e) => e.id === id) : -1;
  if (id && i < 0) throw Object.assign(new Error('That provider was removed. Reload the page.'), { status: 404 });
  const cur = i >= 0 ? list[i] : {};
  const next = {
    id: cur.id || newId(), provider, model: String(model || '').trim(), baseUrl: clean(baseUrl),
    keyEnc: cur.keyEnc || null, keyHint: cur.keyHint || null, enabled: enabled ?? cur.enabled ?? true,
  };
  if (cur.provider !== provider || clean(cur.baseUrl) !== next.baseUrl) { next.keyEnc = null; next.keyHint = null; }
  const key = String(apiKey || '').trim();
  if (key) { next.keyEnc = encrypt(key); next.keyHint = key.slice(-4); }
  if (i >= 0) list[i] = next; else list.push(next);
  await write(actor, { ...s, providers: list });
  return next;
}
export async function removeAiProvider(actor, id) {
  const s = await getAiSettings({ fresh: true });
  await write(actor, { ...s, providers: s.providers.filter((e) => e.id !== id) });
}
/** New priority order (ids first to last); ids not listed keep their place at the end. */
export async function reorderAiProviders(actor, ids) {
  const s = await getAiSettings({ fresh: true });
  const rank = new Map(ids.map((x, n) => [x, n]));
  const list = [...s.providers].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
  await write(actor, { ...s, providers: list });
}
export async function setAiOptions(actor, { enabled, id, accountFallback }) {
  const s = await getAiSettings({ fresh: true });
  const next = { ...s };
  if (id && typeof enabled === 'boolean') next.providers = s.providers.map((e) => (e.id === id ? { ...e, enabled } : e));
  if (typeof accountFallback === 'boolean') next.accountFallback = accountFallback;
  await write(actor, next);
}
/** For testing or listing models before saving: reuse the saved key of entry `id` only for the same provider and endpoint. */
export async function savedKeyFor(id, provider, baseUrl) {
  if (!id) return '';
  const e = (await getAiSettings()).providers.find((x) => x.id === id);
  if (!e || e.provider !== provider || clean(e.baseUrl) !== clean(baseUrl)) return '';
  return withKey(e).key || '';
}

// ---------------------------------------------------------------- remote test browser
// { urlEnc, protocol: 'playwright' | 'cdp', hint, updatedBy, updatedAt }. The address often holds an access token,
// so it is stored encrypted and never sent to the browser. TICKETFORGE_BROWSER_WS (and _PROTOCOL) override it.
const BROWSER = 'browser_settings';
const hostHint = (url) => { try { const u = new URL(url); return `${u.protocol}//${u.host}${u.pathname === '/' ? '' : u.pathname}`; } catch { return ''; } };

export async function getRemoteBrowser() {
  const env = String(process.env.TICKETFORGE_BROWSER_WS || '').trim();
  if (env) return { url: env, protocol: process.env.TICKETFORGE_BROWSER_PROTOCOL === 'cdp' ? 'cdp' : 'playwright', source: 'env' };
  const row = (await qs('select value from app_meta where key = $1', [BROWSER]).catch(() => ({ rows: [] }))).rows[0];
  const v = row ? (typeof row.value === 'string' ? JSON.parse(row.value) : row.value) : null;
  if (!v?.urlEnc) return null;
  try { return { url: decrypt(v.urlEnc), protocol: v.protocol === 'cdp' ? 'cdp' : 'playwright', source: 'settings' }; } catch { return null; }
}
/** What administrators see: whether one is set, where it points (no token), and how it connects. */
export async function publicRemoteBrowser() {
  const r = await getRemoteBrowser();
  if (!r) return null;
  const row = r.source === 'settings' ? (await qs('select value from app_meta where key = $1', [BROWSER])).rows[0] : null;
  const v = row ? (typeof row.value === 'string' ? JSON.parse(row.value) : row.value) : {};
  return { set: true, source: r.source, protocol: r.protocol, hint: hostHint(r.url), updatedBy: v.updatedBy || null, updatedAt: v.updatedAt || null };
}
export function checkBrowserUrl(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { throw Object.assign(new Error('Enter the full address, like wss://chrome.browserless.io/playwright?token=…'), { status: 400 }); }
  if (!/^(wss?|https?):$/.test(u.protocol)) throw Object.assign(new Error('The address must start with wss:// (or ws://, https:// for a Chrome DevTools endpoint).'), { status: 400 });
  return u.toString();
}
export async function saveRemoteBrowser(actor, { url, protocol }) {
  const clean = checkBrowserUrl(url);
  const v = { urlEnc: encrypt(clean), protocol: protocol === 'cdp' ? 'cdp' : 'playwright', updatedBy: actor?.name || null, updatedAt: new Date().toISOString() };
  await qs('insert into app_meta (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value', [BROWSER, JSON.stringify(v)]);
}
export async function clearRemoteBrowser() { await qs('delete from app_meta where key = $1', [BROWSER]); }
