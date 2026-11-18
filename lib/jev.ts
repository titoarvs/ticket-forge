// Jev (TypeSafe AI, https://docs.typesafe.ai): a "System One" model for decisions. It doesn't write text: you give it
// the state of something and questions (choose one of up to 255 options, rate 0-9, yes/no), and it returns typed
// answers with calibrated probabilities in a few hundred milliseconds. TicketForge uses it, when an owner turns it on
// (Administration → AI → Decisions), for the small classification calls that otherwise go to the AI: frontend / backend
// / both for an issue, and which tests are worth running. When it is off, unreachable, or unsure, the AI answers as before.
//   TYPESAFE_API_KEY          the API key, when you'd rather not save one in the app
//   TICKETFORGE_JEV_URL       the API address (default https://api.typesafe.ai), for tests against a stand-in
import { getMeta, setMeta } from './appmeta';
import { wsKey } from './wsmeta';
import { encrypt, decrypt } from './settings';
import { err } from './errors';

const KEY = 'jev';
const base = () => String(process.env.TICKETFORGE_JEV_URL || 'https://api.typesafe.ai').replace(/\/$/, '');

export type Question =
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
  | { type: 'score'; instructions: string; criteria: string[] }
  | { type: 'noul'; instructions: string; criteria?: { true?: string; false?: string } };
export type Answer = { type: string; choice?: string; score?: number; noul?: number; confidence?: number; probabilities?: Record<string, number> };

async function load() {
  const v = await getMeta(wsKey(KEY));
  return (typeof v === 'string' ? JSON.parse(v) : v) || {};
}
async function save(patch: any) {
  const next = { ...(await load()), ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  await setMeta(wsKey(KEY), next);
}
async function apiKey(c?: any) {
  const s = c || await load();
  if (s.keyEnc) { try { return decrypt(s.keyEnc); } catch { /* saved with another key */ } }
  return process.env.TYPESAFE_API_KEY || '';
}

/** What the app may show: never the key. */
export async function jevStatus() {
  const s = await load();
  const key = await apiKey(s);
  return { configured: Boolean(key), keySource: s.keyEnc ? 'saved' : process.env.TYPESAFE_API_KEY ? 'env' : '', keyEnd: s.keyHint || '', enabled: Boolean(key) && s.enabled === true,
    model: s.model || 'jev-latest', minConfidence: Number(s.minConfidence) || 0.6, updatedAt: s.updatedAt || null, updatedBy: s.updatedBy || null };
}
export async function saveJev({ apiKey: k, enabled, model, minConfidence }: any, actor?: any) {
  const patch: any = { updatedAt: new Date().toISOString(), updatedBy: actor?.name || null };
  const key = typeof k === 'string' ? k.trim() : '';
  if (key) {
    if (!/^[\w.-]{16,200}$/.test(key)) throw err('That doesn’t look like a TypeSafe API key. Copy it from console.typesafe.ai → Keys.');
    patch.keyEnc = encrypt(key); patch.keyHint = key.slice(-4);
  }
  if (model !== undefined) patch.model = /^[\w.-]{1,60}$/.test(String(model)) ? String(model) : 'jev-latest';
  if (minConfidence !== undefined) patch.minConfidence = Math.min(0.99, Math.max(0.3, Number(minConfidence) || 0.6));
  if (enabled !== undefined) {
    if (enabled && !key && !(await apiKey())) throw err('Add the TypeSafe API key first.');
    patch.enabled = Boolean(enabled);
  }
  await save(patch);
  return jevStatus();
}
export async function removeJevKey() { await save({ keyEnc: undefined, keyHint: undefined, enabled: false }); return jevStatus(); }
/** Whether decisions may go to Jev now (turned on, with a key). */
export async function jevEnabled() { return (await jevStatus()).enabled; }

/**
 * Asks Jev: `state` is any text or JSON about the thing being decided, `questions` are keyed by name. Retries a busy
 * service (429, 529) twice with a short wait. Returns { answers, model, usage }.
 */
export async function jevDecide({ state, questions, signal }: { state: any; questions: Record<string, Question>; signal?: AbortSignal }) {
  const s = await load();
  const key = await apiKey(s);
  if (!key) throw err('Jev isn’t set up: add the TypeSafe API key in Administration → AI → Decisions.', 400);
  const names = Object.keys(questions);
  if (!names.length) return { answers: {} as Record<string, Answer>, model: '', usage: null };
  let last: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${base()}/v1/systemone`, { method: 'POST', signal: signal || AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: s.model || 'jev-latest', state, questions }) });
    } catch (e: any) { throw err(`Couldn’t reach Jev (${e.message}).`, 502); }
    if (res.ok) {
      const j: any = await res.json();
      return { answers: (j.answers || {}) as Record<string, Answer>, model: String(j.model || ''), usage: j.usage || null };
    }
    const body: any = await res.json().catch(() => ({}));
    const detail = typeof body.detail === 'string' ? body.detail : Array.isArray(body.detail) ? body.detail.map((d: any) => d.msg).filter(Boolean).join('; ') : '';
    last = err(res.status === 401 ? 'TypeSafe rejected the API key. Check it in Administration → AI → Decisions.' : `Jev answered ${res.status}${detail ? `: ${detail}` : ''}.`, res.status === 401 ? 401 : res.status >= 500 || res.status === 429 ? 502 : 400);
    if (![429, 529, 503].includes(res.status)) break;
    await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
  }
  throw last;
}

/** A small real call, to check the key and the connection. Returns { ok, ms, model } or { ok: false, error }. */
export async function testJev() {
  const t0 = Date.now();
  try {
    const r = await jevDecide({ state: 'The checkout page shows a blank screen when the cart has more than 20 items.', questions: {
      layer: { type: 'choice', instructions: 'Where does the fix most likely live?', criteria: { frontend: 'the user interface', backend: 'the server, API or data' } },
      urgent: { type: 'noul', instructions: 'The problem is urgent' } } });
    const a: any = r.answers.layer;
    return { ok: true, ms: Date.now() - t0, model: r.model, sample: a ? `${a.choice} (${Math.round((a.confidence ?? 0) * 100)}% sure)` : '' };
  } catch (e: any) { return { ok: false, error: e.message, ms: Date.now() - t0 }; }
}
