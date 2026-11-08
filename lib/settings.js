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
const AI = 'ai_settings';
const G = globalThis;
G.__tfSettings ??= { ai: undefined, at: 0 };
const C = G.__tfSettings;
const TTL = 30000; // other server instances (e.g. on Vercel) pick up changes within 30 seconds

/** Saved AI settings without the key: { provider, model, baseUrl, keyHint, hasKey, updatedBy, updatedAt } or null. */
export async function getAiSettings({ fresh = false } = {}) {
  if (!fresh && C.ai !== undefined && Date.now() - C.at < TTL) return C.ai;
  const row = (await qs('select value from app_meta where key = $1', [AI])).rows[0];
  C.ai = row?.value || null;
  C.at = Date.now();
  return C.ai;
}
/** For server use only: the saved settings with the key decrypted. */
export async function aiSettingsWithKey() {
  const s = await getAiSettings();
  if (!s?.provider) return null;
  let key = '';
  let keyError = null;
  if (s.keyEnc) {
    try { key = decrypt(s.keyEnc); }
    catch { keyError = 'The saved API key can’t be read on this server (the database password or TICKETFORGE_SECRET changed). Enter the key again.'; }
  }
  return { ...s, key, keyError };
}
/** What admins see: never the key or its encrypted form. */
export const publicAiSettings = (s) => (s?.provider ? {
  provider: s.provider, model: s.model || '', baseUrl: s.baseUrl || '', hasKey: Boolean(s.keyEnc), keyHint: s.keyHint || null,
  updatedBy: s.updatedBy || null, updatedAt: s.updatedAt || null,
} : null);

/**
 * Saves the AI API settings. A new apiKey replaces the saved one; leaving it out keeps it, unless the provider or
 * endpoint changed. Then the old key is dropped so it's never sent to a different service.
 */
export async function saveAiSettings(actor, { provider, model, baseUrl, apiKey, clearKey }) {
  const cur = (await getAiSettings({ fresh: true })) || {};
  const next = {
    provider, model: String(model || '').trim(), baseUrl: String(baseUrl || '').trim().replace(/\/+$/, ''),
    keyEnc: cur.keyEnc || null, keyHint: cur.keyHint || null,
    updatedBy: actor?.name || null, updatedAt: new Date().toISOString(),
  };
  if (cur.provider !== provider || (cur.baseUrl || '') !== next.baseUrl) { next.keyEnc = null; next.keyHint = null; }
  const key = String(apiKey || '').trim();
  if (key) { next.keyEnc = encrypt(key); next.keyHint = key.slice(-4); }
  if (clearKey) { next.keyEnc = null; next.keyHint = null; }
  await qs('insert into app_meta (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value', [AI, JSON.stringify(next)]);
  C.ai = next; C.at = Date.now();
  return next;
}
/** Removes the panel settings; environment variables apply again. */
export async function clearAiSettings() {
  await qs('delete from app_meta where key = $1', [AI]);
  C.ai = null; C.at = Date.now();
}
/** For a test before saving: the saved key may only be reused for the same provider and endpoint. */
export async function savedKeyFor(provider, baseUrl) {
  const s = await aiSettingsWithKey();
  if (!s || s.provider !== provider || (s.baseUrl || '') !== String(baseUrl || '').trim().replace(/\/+$/, '')) return '';
  return s.key || '';
}
