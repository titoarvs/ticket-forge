// AI for TicketForge. Two modes, picked per request:
//  - "account": on your own computer (opened at localhost), the Claude Code CLI (`claude -p`) with the
//    personal Claude account you're signed into there. No API key needed.
//  - "api": anywhere else (Vercel, a server, a domain), an AI API you configure with environment variables:
//    Anthropic, or any OpenAI-compatible API (OpenAI, Google Gemini, OpenRouter, Groq, DeepSeek, Mistral,
//    xAI, Together, Ollama, or your own endpoint). Set up by an administrator in Administration → AI, or with
//    environment variables (see .env.example). The panel's settings win.
// AI_MODE=account|api overrides the automatic choice.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { SERVERLESS, currentContext } from './db.js';
import { aiSettingsWithKey, savedKeyFor, getAiSettings, publicAiSettings } from './settings.js';

let CLI_BIN = process.env.CLAUDE_BIN || 'claude';
const WORKDIR = path.join(os.tmpdir(), 'ticketforge-claude');
fs.mkdirSync(WORKDIR, { recursive: true });

export const DEFAULT_API_MODEL = 'claude-opus-5-5';
export const DEFAULT_CLI_MODEL = 'opus';

// Candidate Claude Code executables: $CLAUDE_BIN, `claude` on PATH, native installs, and the copy
// bundled with the Claude desktop app. The newest version wins, because old versions can't use
// current models.
function candidateBins() {
  if (process.env.CLAUDE_BIN) return [process.env.CLAUDE_BIN];
  const home = os.homedir();
  const out = ['claude'];
  const globDir = (dir, sub = []) => {
    try {
      return fs.readdirSync(dir).flatMap((v) => {
        const base = path.join(dir, v);
        if (!sub.length) return [base];
        return globDir(base, sub.slice(1)).map((x) => x);
      });
    } catch { return []; }
  };
  out.push(...globDir(path.join(home, '.local', 'share', 'claude', 'versions')));
  for (const d of globDir(path.join(home, 'Library', 'Application Support', 'Claude', 'claude-code'), ['*'])) {
    out.push(path.join(d, 'claude.app', 'Contents', 'MacOS', 'claude'));
  }
  out.push(path.join(home, '.claude', 'local', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude');
  return [...new Set(out)];
}
const versionOf = (bin) => new Promise((resolve) => {
  execFile(/*turbopackIgnore: true*/ bin, ['--version'], { timeout: 15000 }, (err, stdout) => {
    const m = !err && String(stdout).match(/(\d+)\.(\d+)\.(\d+)/);
    resolve(m ? { bin, version: m[0], n: [Number(m[1]), Number(m[2]), Number(m[3])] } : null);
  });
});
const newer = (a, b) => { for (let i = 0; i < 3; i++) if (a.n[i] !== b.n[i]) return a.n[i] > b.n[i]; return false; };

let cliInfoPromise = null;
export function cliInfo() {
  cliInfoPromise ??= (async () => {
    const found = (await Promise.all(candidateBins().map(versionOf))).filter(Boolean);
    if (!found.length) return { available: false };
    const best = found.reduce((a, b) => (newer(b, a) ? b : a));
    CLI_BIN = best.bin;
    const outdated = best.n[0] < 2 || (best.n[0] === 2 && best.n[1] < 1);
    return { available: true, version: `${best.version} (Claude Code)`, path: best.bin, outdated };
  })();
  return cliInfoPromise;
}

// ---------------------------------------------------------------- which mode
const LOCAL_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1|[a-z0-9-]+\.localhost)$/i;
/** True when the app was opened on this computer (localhost). Behind a proxy, X-Forwarded-Host counts. */
export function isLocalHost(hostHeader) {
  const h = String(hostHeader || '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '');
  return LOCAL_HOST.test(h);
}
function isLocalRequest() {
  const c = currentContext();
  if (typeof c.local === 'boolean') return c.local;
  return !SERVERLESS; // scripts and the legacy server run on this computer
}
/** "account" (your Claude account through Claude Code) or "api" (the configured AI API). */
export function aiMode() {
  const forced = String(process.env.AI_MODE || '').toLowerCase();
  if (forced === 'account' || forced === 'api') return forced;
  return !SERVERLESS && isLocalRequest() ? 'account' : 'api';
}

// ---------------------------------------------------------------- AI API providers
// Everything except Anthropic speaks the OpenAI chat-completions format.
export const PROVIDERS = {
  anthropic: { label: 'Anthropic (Claude)', kind: 'anthropic', keys: ['ANTHROPIC_API_KEY'], model: 'claude-opus-5-5', site: 'console.anthropic.com' },
  openai: { label: 'OpenAI', base: 'https://api.openai.com/v1', keys: ['OPENAI_API_KEY'], site: 'platform.openai.com' },
  gemini: { label: 'Google Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', keys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], site: 'aistudio.google.com' },
  openrouter: { label: 'OpenRouter', base: 'https://openrouter.ai/api/v1', keys: ['OPENROUTER_API_KEY'], site: 'openrouter.ai' },
  groq: { label: 'Groq', base: 'https://api.groq.com/openai/v1', keys: ['GROQ_API_KEY'], site: 'console.groq.com' },
  deepseek: { label: 'DeepSeek', base: 'https://api.deepseek.com/v1', keys: ['DEEPSEEK_API_KEY'], site: 'platform.deepseek.com' },
  mistral: { label: 'Mistral', base: 'https://api.mistral.ai/v1', keys: ['MISTRAL_API_KEY'], site: 'console.mistral.ai' },
  xai: { label: 'xAI (Grok)', base: 'https://api.x.ai/v1', keys: ['XAI_API_KEY'], site: 'console.x.ai' },
  together: { label: 'Together AI', base: 'https://api.together.xyz/v1', keys: ['TOGETHER_API_KEY'], site: 'api.together.ai' },
  ollama: { label: 'Ollama', base: 'http://localhost:11434/v1', keys: [], keyOptional: true, site: 'ollama.com' },
  custom: { label: 'OpenAI-compatible API', base: '', keys: [], keyOptional: true },
};

function buildConfig({ id, key = '', model = '', baseUrl = '', source, keyError = null }) {
  const p = PROVIDERS[id];
  if (!p) return { id: id || null, label: id || null, source, configured: false, missing: id ? [] : ['provider'], error: id ? `Unknown AI provider "${id}". Use one of: ${Object.keys(PROVIDERS).join(', ')}.` : null };
  const base = String(baseUrl || p.base || '').replace(/\/+$/, '');
  const m = String(model || p.model || '').trim();
  const kind = p.kind || 'openai';
  const missing = [!key && !p.keyOptional && 'key', kind === 'openai' && !base && 'baseUrl', !m && 'model'].filter(Boolean);
  return { id, label: p.label, kind, baseUrl: base, model: m, key, keySet: Boolean(key), keyNames: p.keys, site: p.site || null, source, missing, configured: !missing.length && !keyError, error: keyError };
}
/** From AI_PROVIDER / AI_API_KEY / AI_MODEL / AI_BASE_URL, or a provider's own key variable (e.g. OPENAI_API_KEY). */
function envConfig() {
  let id = String(process.env.AI_PROVIDER || '').toLowerCase().trim();
  if (!id) id = Object.keys(PROVIDERS).find((k) => PROVIDERS[k].keys.some((e) => process.env[e])) || (process.env.AI_BASE_URL ? 'custom' : '');
  if (!id) return { id: null, label: null, source: 'env', configured: false, missing: ['provider'], error: null };
  const p = PROVIDERS[id];
  const key = process.env.AI_API_KEY || (p ? p.keys.map((e) => process.env[e]).find(Boolean) : '') || '';
  return buildConfig({ id, key, model: process.env.AI_MODEL, baseUrl: process.env.AI_BASE_URL, source: 'env' });
}
/** The AI API in use: what an administrator saved in Administration → AI, otherwise the environment variables. */
export async function apiConfig() {
  let saved = null;
  try { saved = await aiSettingsWithKey(); } catch { /* database not ready: fall back to the environment */ }
  if (saved) return buildConfig({ id: saved.provider, key: saved.key, model: saved.model, baseUrl: saved.baseUrl, source: 'panel', keyError: saved.keyError });
  return envConfig();
}
/** Settings typed in the panel but not saved yet, for "Test" and "Load models". A blank key reuses the saved one only for the same provider and endpoint. */
async function draftConfig(d) {
  const id = String(d?.provider || '');
  const key = String(d?.apiKey || '').trim() || await savedKeyFor(id, d?.baseUrl);
  return buildConfig({ id, key, model: d?.model, baseUrl: d?.baseUrl, source: 'draft' });
}
/** What the browser may see: never the key. */
const publicApi = (c) => ({ id: c.id, label: c.label, kind: c.kind, model: c.model || null, baseUrl: c.baseUrl || null, keySet: Boolean(c.keySet), keyNames: c.keyNames || [], site: c.site || null, source: c.source, missing: c.missing, configured: c.configured, error: c.error });

const ENV_NAMES = { provider: 'AI_PROVIDER', key: 'AI_API_KEY', model: 'AI_MODEL', baseUrl: 'AI_BASE_URL' };
const UI_NAMES = { provider: 'a provider', key: 'the API key', model: 'the model', baseUrl: 'the endpoint URL' };
const list = (xs) => xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0];
function apiSetupMessage(c) {
  if (c.error) return c.error;
  if (!c.id) return 'No AI API is set up for this address. An administrator can add one in Administration → AI, or open TicketForge on your own computer to use your Claude account.';
  if (c.source === 'env') return `${c.label} isn’t fully set up: set ${list(c.missing.map((m) => ENV_NAMES[m]))} in the server’s environment, or set it up in Administration → AI.`;
  return `${c.label} isn’t fully set up: add ${list(c.missing.map((m) => UI_NAMES[m]))} in Administration → AI.`;
}

/** Which AI this request uses and whether it's ready. `details` adds account email and organization (admins). */
export async function providerStatus({ details = false } = {}) {
  const mode = aiMode();
  const cfg = await apiConfig();
  let account = null;
  if (mode === 'account') {
    const cli = await cliInfo();
    const acct = cli.available ? await accountStatus() : null;
    account = {
      cli, signedIn: Boolean(cli.available && acct?.loggedIn !== false),
      ...(acct ? (details ? acct : { loggedIn: acct.loggedIn, subscriptionType: acct.subscriptionType || null }) : {}),
    };
  }
  const ready = mode === 'account' ? Boolean(account?.signedIn) : cfg.configured;
  return {
    mode, ready, local: isLocalRequest(), forced: ['account', 'api'].includes(String(process.env.AI_MODE || '').toLowerCase()), serverless: SERVERLESS,
    label: mode === 'account' ? 'Claude account' : cfg.configured ? cfg.label : 'AI not set up',
    model: mode === 'account' ? DEFAULT_CLI_MODEL : cfg.model || null,
    account, api: publicApi(cfg),
    ...(details ? { settings: publicAiSettings(await getAiSettings().catch(() => null)) } : {}),
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, keys: p.keys, base: p.base || null, model: p.model || null, site: p.site || null })),
  };
}

// ---------------------------------------------------------------- Claude Code (local, personal account)
const G = globalThis;
G.__tfClaude ??= { status: null, statusAt: 0 };
const C = G.__tfClaude;

function cliEnv() {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  // Keep the CLI on your signed-in Claude account even when an API key is in the environment.
  if (!process.env.TICKETFORGE_CLI_USE_API_KEY) delete env.ANTHROPIC_API_KEY;
  return env;
}
function runCli(args, { timeout = 20000 } = {}) {
  return new Promise((resolve) => {
    const child = execFile(/*turbopackIgnore: true*/ CLI_BIN, args, { cwd: WORKDIR, env: cliEnv(), timeout, maxBuffer: 1 << 20 },
      (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) }));
    child.stdin.end();
  });
}
/** Whether Claude Code on this computer is signed in, cached for a minute. */
export async function accountStatus({ fresh = false } = {}) {
  if (!fresh && C.status && Date.now() - C.statusAt < 60000) return C.status;
  await cliInfo();
  const r = await runCli(['auth', 'status', '--json']);
  let st;
  try {
    const j = JSON.parse(r.stdout);
    st = { loggedIn: Boolean(j.loggedIn), authMethod: j.authMethod || null, email: j.email || null, orgName: j.orgName || null, subscriptionType: j.subscriptionType || null };
  } catch {
    st = { loggedIn: null }; // an older Claude Code without `claude auth`: unknown, so don't block it
  }
  C.status = st; C.statusAt = Date.now();
  return st;
}

/**
 * Ask the AI once and return the full text reply. Uses your Claude account locally, the AI API elsewhere.
 * opts: { system, prompt, model, onText(chunkLength, totalLength), signal }. `model` only applies to the Claude account.
 */
/** AI isn't set up: a 503 the app shows as a message, not a crash. */
const notReady = (msg) => Object.assign(new Error(msg), { status: 503 });

export async function askAI(opts) {
  if (aiMode() === 'account') {
    const cli = await cliInfo();
    if (!cli.available) throw notReady('Claude Code isn’t installed on this computer. Install it (npm install -g @anthropic-ai/claude-code) and run `claude` once to sign in with your Claude account.');
    if ((await accountStatus()).loggedIn === false) throw notReady('Claude Code isn’t signed in on this computer. Run `claude` in a terminal and sign in with your Claude account.');
    return askViaCli({ ...opts, model: opts.model || DEFAULT_CLI_MODEL });
  }
  const cfg = await apiConfig();
  if (!cfg.configured) throw notReady(apiSetupMessage(cfg));
  return callApi(cfg, opts);
}
const callApi = (cfg, opts) => (cfg.kind === 'anthropic' ? askViaAnthropic : askViaOpenAICompatible)({ ...opts, model: cfg.model, cfg });
/** Older name, kept for existing callers. */
export const askClaude = askAI;

function askViaCli({ system, prompt, model, onText, signal }) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--model', model,
      '--tools', '',
      '--strict-mcp-config',
      '--system-prompt', system,
    ];
    // Keeps the CLI on the signed-in Claude account unless TICKETFORGE_CLI_USE_API_KEY is set.
    const env = cliEnv();
    const child = spawn(/*turbopackIgnore: true*/ CLI_BIN, args, { cwd: WORKDIR, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '';
    let streamed = '';
    let finalResult = null;
    let errorText = '';
    let stderr = '';

    const onAbort = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', onAbort);

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let evt;
        try { evt = JSON.parse(line); } catch { continue; }
        if (evt.type === 'stream_event' && evt.event?.type === 'content_block_delta' && evt.event.delta?.type === 'text_delta') {
          streamed += evt.event.delta.text;
          onText?.(evt.event.delta.text.length, streamed.length);
        } else if (evt.type === 'result') {
          if (evt.is_error || evt.subtype !== 'success') errorText = evt.result || evt.subtype || 'Claude CLI returned an error';
          else finalResult = evt.result;
        }
      }
    });
    child.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return reject(new Error('Cancelled'));
      if (errorText) {
        const hint = /does not support this model|not_found_error|model:/i.test(errorText)
          ? ' Your Claude Code version may be too old for this model: run `claude update`, or pick another model in the connection settings.' : '';
        return reject(new Error(errorText + hint));
      }
      const text = finalResult ?? streamed;
      if (!text) return reject(new Error(`Claude CLI exited with code ${code}. ${stderr.slice(-800)}`.trim()));
      resolve(text);
    });
    child.stdin.end(prompt);
  });
}

const anthropicClients = new Map();
function anthropicClient(cfg) {
  const k = `${cfg.key}|${cfg.baseUrl}`;
  if (!anthropicClients.has(k)) anthropicClients.set(k, new Anthropic({ apiKey: cfg.key, ...(cfg.baseUrl ? { baseURL: cfg.baseUrl } : {}) }));
  return anthropicClients.get(k);
}
async function askViaAnthropic({ system, prompt, model, onText, signal, cfg }) {
  const client = anthropicClient(cfg);
  const params = {
    model,
    max_tokens: 64000,
    system,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    messages: [{ role: 'user', content: prompt }],
  };
  // Server-side refusal fallback is supported on the current Opus/Sonnet models.
  const useFallback = /^claude-(opus-5|sonnet-5-5|fable-5-1)/.test(model);
  const stream = useFallback
    ? client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal })
    : client.messages.stream(params, { signal });
  let total = 0;
  stream.on('text', (t) => { total += t.length; onText?.(t.length, total); });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') {
    throw new Error(`Claude declined this request${msg.stop_details?.category ? ` (${msg.stop_details.category})` : ''}.`);
  }
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (msg.stop_reason === 'max_tokens') throw new Error('Response hit the output limit. Try a smaller document or fewer tickets per run.');
  return text;
}

function openAIHeaders(cfg) {
  return {
    'Content-Type': 'application/json',
    ...(cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}),
    ...(cfg.id === 'openrouter' ? { 'X-Title': 'TicketForge' } : {}),
  };
}
async function apiError(res, cfg) {
  const body = await res.text().catch(() => '');
  let msg = body;
  try { const j = JSON.parse(body); msg = j.error?.message || j.message || (Array.isArray(j) ? j[0]?.error?.message : '') || body; } catch { /* not JSON */ }
  const hint = res.status === 401 || res.status === 403 ? ' Check the API key.' : res.status === 404 ? ' Check the model name and the endpoint URL.' : res.status === 429 ? ' Rate limit or quota reached.' : '';
  const text = String(msg || res.statusText).trim().slice(0, 400).replace(/[.\s]+$/, '');
  const who = /API$/.test(cfg.label) ? cfg.label : `${cfg.label} API`;
  return Object.assign(new Error(`${who} error ${res.status}: ${text}.${hint}`), { status: 502 });
}
/** fetch that says which server couldn't be reached instead of just "fetch failed". */
async function reach(cfg, url, init) {
  try { return await fetch(url, init); }
  catch (e) {
    if (e.name === 'AbortError' || init?.signal?.aborted) throw e;
    const why = e.cause?.code || e.cause?.message || e.message;
    throw Object.assign(new Error(`Couldn’t reach ${cfg.baseUrl} (${why}). Check the endpoint URL and that the server is running.`), { status: 502 });
  }
}
/** Chat completions with streaming, for OpenAI and every OpenAI-compatible API. */
async function askViaOpenAICompatible({ system, prompt, model, onText, signal, cfg }) {
  const res = await reach(cfg, `${cfg.baseUrl}/chat/completions`, {
    method: 'POST', signal, headers: openAIHeaders(cfg),
    body: JSON.stringify({ model, stream: true, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw await apiError(res, cfg);
  let text = '';
  let finish = null;
  if (!(res.headers.get('content-type') || '').includes('text/event-stream')) {
    const j = await res.json();
    text = j.choices?.[0]?.message?.content || '';
    finish = j.choices?.[0]?.finish_reason || null;
    if (text) onText?.(text.length, text.length);
  } else {
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let j;
        try { j = JSON.parse(data); } catch { continue; }
        if (j.error) throw Object.assign(new Error(`${cfg.label}: ${j.error.message || JSON.stringify(j.error)}`), { status: 502 });
        const choice = j.choices?.[0];
        const delta = choice?.delta?.content;
        if (typeof delta === 'string' && delta) { text += delta; onText?.(delta.length, text.length); }
        if (choice?.finish_reason) finish = choice.finish_reason;
      }
    }
  }
  if (finish === 'length') throw new Error('Response hit the output limit. Try a smaller document or fewer tickets per run.');
  if (finish === 'content_filter') throw new Error(`${cfg.label} declined this request.`);
  if (!text.trim()) throw Object.assign(new Error(`${cfg.label} returned an empty reply. Check that AI_MODEL is a chat model.`), { status: 502 });
  return text;
}

/** Model IDs the API offers: the saved setup, or `draft` (settings typed in the panel but not saved yet). */
export async function listModels(draft) {
  const cfg = draft ? await draftConfig(draft) : await apiConfig();
  if (!cfg.id || (cfg.error && !cfg.keySet)) throw notReady(apiSetupMessage(cfg));
  if (!cfg.keySet && !PROVIDERS[cfg.id]?.keyOptional) throw notReady('Enter the API key first.');
  if (cfg.kind === 'openai' && !cfg.baseUrl) throw notReady('Enter the endpoint URL first.');
  if (cfg.kind === 'anthropic') {
    const out = [];
    for await (const m of anthropicClient(cfg).models.list({ limit: 100 })) out.push(m.id);
    return out;
  }
  const res = await reach(cfg, `${cfg.baseUrl}/models`, { headers: openAIHeaders(cfg), signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw await apiError(res, cfg);
  const j = await res.json();
  return (j.data || j.models || []).map((m) => String(m.id || m.name || '').replace(/^models\//, '')).filter(Boolean).sort();
}

/** Sends a tiny prompt with the current setup, or with `draft` settings before they're saved. Lists models when it fails. */
export async function testConnection(draft) {
  const mode = draft ? 'api' : aiMode();
  const started = Date.now();
  const req = { system: 'You are a connection test. Follow the instruction exactly.', prompt: 'Reply with exactly: OK' };
  try {
    let reply;
    if (draft) {
      const cfg = await draftConfig(draft);
      if (!cfg.configured) throw notReady(apiSetupMessage(cfg));
      reply = await callApi(cfg, req);
    } else {
      reply = await askAI({ ...req, model: mode === 'account' ? 'haiku' : undefined });
    }
    return { ok: true, mode, ms: Date.now() - started, reply: reply.trim().slice(0, 80) };
  } catch (e) {
    const out = { ok: false, mode, ms: Date.now() - started, error: e.message };
    if (mode === 'api') { try { out.models = (await listModels(draft)).slice(0, 200); } catch { /* can't list either */ } }
    return out;
  }
}

/** Extract the first JSON object/array from a model reply. */
export function extractJson(text) {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.search(/[[{]/);
  if (start < 0) throw new Error('No JSON found in Claude response');
  const open = t[start];
  const close = open === '{' ? '}' : ']';
  const end = t.lastIndexOf(close);
  return JSON.parse(t.slice(start, end + 1));
}

/** Ask for JSON; if parsing fails, ask Claude once to repair its own output. */
export async function askJson(opts) {
  const text = await askClaude(opts);
  try {
    return extractJson(text);
  } catch (err) {
    const repaired = await askClaude({
      ...opts,
      onText: undefined,
      system: 'You repair malformed JSON. Output only the corrected JSON, nothing else.',
      prompt: `This JSON failed to parse (${err.message}). Fix it and return valid JSON only, preserving all content:\n\n${text}`,
    });
    return extractJson(repaired);
  }
}
