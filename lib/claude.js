// AI for TicketForge. Two modes, picked per request:
//  - "account": on your own computer (opened at localhost), the Claude Code CLI (`claude -p`) with the
//    personal Claude account you're signed into there. No API key needed.
//  - "api": anywhere else (Vercel, a server, a domain), an AI API you configure with environment variables:
//    Anthropic, or any OpenAI-compatible API (OpenAI, Google Gemini, OpenRouter, Groq, DeepSeek, Mistral,
//    xAI, Together, Ollama, or your own endpoint). Set up by an administrator in Administration → AI, or with
//    environment variables (see .env.example). Several APIs can be set up in priority order: when one is rate
//    limited, out of credits or failing, TicketForge switches to the next and retries the first one later.
//    Locally, when your Claude account hits its usage limit, it can switch to those APIs too.
// AI_MODE=account|api overrides the automatic choice.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { SERVERLESS, currentContext, qs } from './db.js';
import { aiProvidersWithKeys, savedKeyFor, getAiSettings, publicAiSettings } from './settings.js';
import { askViaCopilot, copilotInfo, COPILOT_MODELS } from './copilot.js';
import { cacheKey, cacheGet, cachePut, cacheStats } from './aicache.js';
import { planUsage } from './claudeusage.js';
import { normalizeRouting, normalizeConfigs, tierFor, pickFor, AI_TASKS, TIERS, CLAUDE_TIER_DEFAULTS, API_TIER_HINTS, AGENT_TASK, costOf, maxOutFor } from './aitasks.js';

const G0 = globalThis;
let CLI_BIN = process.env.CLAUDE_BIN || 'claude';
const WORKDIR = path.join(os.tmpdir(), 'ticketforge-claude');
fs.mkdirSync(WORKDIR, { recursive: true });

export const DEFAULT_API_MODEL = 'claude-opus-5-5';
export const DEFAULT_CLI_MODEL = 'opus';
/** Reasoning level (Administration → Generation) → provider effort. Fast is the default: direct and consistent. */
const EFFORT = { fast: 'low', balanced: 'medium', thorough: 'high' };
const effortOf = (reasoning) => EFFORT[reasoning] || EFFORT.fast;

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

/** A Claude subscription token (from `claude setup-token`) only works inside Claude Code, never as an API key. */
export const SUBSCRIPTION_TOKEN_NOTE = 'This is a Claude subscription token (sk-ant-oat…, from claude setup-token). It only works inside Claude Code: TicketForge uses your subscription for code jobs on GitHub Actions (Project settings → Code & GitHub → Where code jobs run) and through Claude Code on your computer. AI providers need an Anthropic API key (sk-ant-api03-…, from console.anthropic.com).';
export const isSubscriptionToken = (k) => /^sk-ant-oat/i.test(String(k || '').trim());
function buildConfig({ id, key = '', model = '', baseUrl = '', source, keyError = null }) {
  const p = PROVIDERS[id];
  if (p?.kind === 'anthropic' && isSubscriptionToken(key)) keyError = SUBSCRIPTION_TOKEN_NOTE;
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
/** Every AI API in priority order: the providers saved in Administration → AI, then the environment's. */
export async function apiChain({ all = false } = {}) {
  let saved = [];
  try { saved = await aiProvidersWithKeys(); } catch { /* database not ready: environment only */ }
  const chain = saved.filter((e) => all || e.enabled !== false).map((e) => ({
    ...buildConfig({ id: e.provider, key: e.key, model: e.model, baseUrl: e.baseUrl, source: 'panel', keyError: e.keyError }),
    entryId: e.id, enabled: e.enabled !== false,
  }));
  const env = envConfig();
  if (env.id && !chain.some((c) => c.id === env.id && c.key === env.key && c.baseUrl === env.baseUrl)) chain.push({ ...env, entryId: 'env', enabled: true });
  return chain;
}
/** The provider that would be used right now: the first ready one that isn't cooling down. */
export async function apiConfig() {
  const all = await apiChain();
  const ready = all.filter((c) => c.configured);
  return ready.find((c) => !cooling(c.entryId)) || ready[0] || all[0] || envConfig();
}
/** Settings typed in the panel but not saved yet. A blank key reuses entry `id`'s saved key only for the same provider and endpoint. */
async function draftConfig(d) {
  const id = String(d?.provider || '');
  const key = String(d?.apiKey || '').trim() || await savedKeyFor(d?.id, id, d?.baseUrl);
  return buildConfig({ id, key, model: d?.model, baseUrl: d?.baseUrl, source: 'draft' });
}
/** A saved provider by its entry id ('env' = the environment's), or unsaved draft settings. */
async function targetConfig(t) {
  if (t?.draft) return draftConfig(t.draft);
  if (t?.id) {
    const c = (await apiChain({ all: true })).find((x) => x.entryId === t.id);
    if (!c) throw Object.assign(new Error('That provider was removed. Reload the page.'), { status: 404 });
    return c;
  }
  return apiConfig();
}

// ---------------------------------------------------------------- switching when a provider is limited
// In-memory per server instance: which providers are cooling down after a limit or failure, and which was used last.
G0.__tfAiHealth ??= { cool: new Map(), last: null };
const H = G0.__tfAiHealth;
function cooling(key) {
  const c = H.cool.get(key);
  if (c && c.until > Date.now()) return c;
  if (c) H.cool.delete(key);
  return null;
}
function markFailed(key, label, f, message) {
  if (f.waitMs > 0) H.cool.set(key, { kind: f.kind, reason: f.reason, label, message: String(message || '').slice(0, 300), at: Date.now(), until: Date.now() + f.waitMs });
}
export function clearCooldown(key) { if (key) H.cool.delete(key); else H.cool.clear(); }
const health = (key) => { const c = cooling(key); return c && { kind: c.kind, reason: c.reason, message: c.message, at: new Date(c.at).toISOString(), until: new Date(c.until).toISOString() }; };

/** How long a provider asked us to wait: Retry-After, or the rate-limit reset headers. */
function retryAfterMs(headers) {
  const get = (k) => (typeof headers?.get === 'function' ? headers.get(k) : headers?.[k]);
  const ra = get('retry-after');
  if (ra) {
    const n = Number(ra);
    if (Number.isFinite(n)) return n * 1000;
    const d = Date.parse(ra);
    if (d) return Math.max(0, d - Date.now());
  }
  for (const k of ['x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens', 'anthropic-ratelimit-requests-reset', 'anthropic-ratelimit-tokens-reset']) {
    const v = get(k);
    if (!v) continue;
    const d = /^\d{4}-/.test(v) ? Date.parse(v) - Date.now() : [...String(v).matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)].reduce((t, [, n, u]) => t + Number(n) * { ms: 1, s: 1e3, m: 6e4, h: 36e5 }[u], 0);
    if (d > 0) return d;
  }
  return 0;
}
const capWait = (ms, dflt) => Math.min(Math.max(ms || dflt, 5000), 6 * 36e5);
/** Why a provider failed and how long to leave it alone. null: not the provider's fault (cancelled). */
function classify(e) {
  if (e?.name === 'AbortError' || e?.message === 'Cancelled') return null;
  const status = e?.httpStatus;
  const msg = String(e?.message || '');
  if (status === 402 || /credit balance|insufficient_quota|exceeded your current quota|quota exceeded|billing|payment required|out of credits|insufficient (funds|credit)/i.test(msg)) {
    return { kind: 'credits', reason: 'is out of credits or over its quota', waitMs: capWait(e.retryAfterMs, 36e5) };
  }
  // Claude subscription limits ("You've hit your weekly limit · resets Nov 13 at 4am", "5-hour limit", "session limit"):
  // the account rests for hours, so move work to the AI APIs and don't retry it every minute.
  if (/hit your (weekly|daily|monthly|session|\d+-hour|usage)? ?limit|(weekly|daily|monthly|session|\d+-hour) limit|limit\s*·\s*resets/i.test(msg)) {
    const kind = /weekly|monthly/i.test(msg) ? 'weekly' : /daily/i.test(msg) ? 'daily' : 'session';
    return { kind: 'rate', reason: `hit its ${kind === 'session' ? 'usage' : kind} limit`, waitMs: kind === 'weekly' ? 6 * 36e5 : kind === 'daily' ? 2 * 36e5 : 30 * 6e4 };
  }
  if (status === 429 || /rate.?limit|too many requests|resource.?exhausted|usage limit|limit reached|tokens per min/i.test(msg)) {
    return { kind: 'rate', reason: 'hit its rate limit', waitMs: capWait(e.retryAfterMs, 6e4) };
  }
  if (status === 529 || status === 503 || /overloaded|temporarily unavailable|over capacity/i.test(msg)) {
    return { kind: 'busy', reason: 'is overloaded', waitMs: capWait(e.retryAfterMs, 3e4) };
  }
  if (status === 401 || status === 403) return { kind: 'auth', reason: 'rejected its API key', waitMs: 6e5 };
  if (/output limit|context length|context window|maximum context|too many tokens|prompt is too long/i.test(msg)) return { kind: 'size', reason: 'can’t handle a request this large', waitMs: 0 };
  return { kind: 'error', reason: 'failed', waitMs: 12e4 };
}
const nameOf = (c) => `${c.label}${c.model ? ` (${c.model})` : ''}`;
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/**
 * Tries each provider in order until one answers. Providers that are cooling down go last. `from` describes why we
 * got here (the Claude account's limit) so the first switch can be reported.
 */
async function runChain(chain, opts, from) {
  const fresh = chain.filter((c) => !cooling(c.entryId));
  const resting = chain.filter((c) => cooling(c.entryId)).sort((a, b) => cooling(a.entryId).until - cooling(b.entryId).until);
  const order = [...fresh, ...resting];
  const problems = [];
  let prev = from;
  for (const base of order) {
    // Model routing: this task's tier may use another model of the same provider.
    const tm = opts.tier && opts.routing?.api?.[base.entryId]?.[opts.tier];
    const cfg = tm ? { ...base, model: tm } : base;
    if (opts.signal?.aborted) throw new Error('Cancelled');
    const c = cooling(cfg.entryId);
    if (prev) opts.onSwitch?.(`${prev.name} ${prev.reason}, so TicketForge switched to ${nameOf(cfg)}${c ? ` (it ${c.reason} earlier; trying it again)` : ''}.`);
    try {
      const out = await callApi(cfg, opts);
      H.last = { key: cfg.entryId, label: nameOf(cfg), at: new Date().toISOString() };
      opts.used = { label: cfg.label, model: cfg.model };
      if (c) clearCooldown(cfg.entryId);
      return out;
    } catch (e) {
      const f = classify(e);
      if (!f) throw e;
      markFailed(cfg.entryId, nameOf(cfg), f, e.message);
      problems.push(`${nameOf(cfg)} ${f.reason}${f.waitMs ? ` (retrying after ${clock(Date.now() + f.waitMs)})` : ''}: ${e.message}`);
      if (order.length === 1 && !from) throw e; // only one provider: its own error says it best
      prev = { name: nameOf(cfg), reason: f.reason };
    }
  }
  throw Object.assign(new Error(`Every AI provider is unavailable right now. ${problems.join(' · ')} Add another provider in Administration → AI, or try again later.`), { status: 503 });
}
async function accountFallbackOn() {
  try { return (await getAiSettings()).accountFallback !== false; } catch { return true; }
}

/** What the browser may see: never the key. */
const publicApi = (c) => ({ id: c.id, label: c.label, kind: c.kind, model: c.model || null, baseUrl: c.baseUrl || null, keySet: Boolean(c.keySet), keyNames: c.keyNames || [], site: c.site || null, source: c.source, missing: c.missing, configured: c.configured, error: c.error });

const ENV_NAMES = { provider: 'AI_PROVIDER', key: 'AI_API_KEY', model: 'AI_MODEL', baseUrl: 'AI_BASE_URL' };
const UI_NAMES = { provider: 'a provider', key: 'the API key', model: 'the model', baseUrl: 'the endpoint URL' };
const list = (xs) => xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0];
function apiSetupMessage(c) {
  if (!c) return 'No AI API is set up for this address. An administrator can add one in Administration → AI.';
  if (c.error) return c.error;
  if (!c.id) return 'No AI API is set up for this address. An administrator can add one in Administration → AI, or open TicketForge on your own computer to use your Claude account.';
  if (c.source === 'env') return `${c.label} isn’t fully set up: set ${list(c.missing.map((m) => ENV_NAMES[m]))} in the server’s environment, or set it up in Administration → AI.`;
  return `${c.label} isn’t fully set up: add ${list(c.missing.map((m) => UI_NAMES[m]))} in Administration → AI.`;
}

/** Which AI this request uses, every API in priority order with its health, and whether it's ready. `details` adds account email and organization (admins). */
export async function providerStatus({ details = false, planFresh = false } = {}) {
  const mode = aiMode();
  const chainAll = await apiChain({ all: true });
  const usable = chainAll.filter((c) => c.enabled && c.configured);
  const active = usable.find((c) => !cooling(c.entryId)) || usable[0] || null;
  const cfg = active || chainAll[0] || envConfig();
  let account = null;
  if (mode === 'account') {
    const cli = await cliInfo();
    const acct = cli.available ? await accountStatus() : null;
    account = {
      cli, signedIn: Boolean(cli.available && acct?.loggedIn !== false), cooldown: health('account'),
      ...(acct ? (details ? acct : { loggedIn: acct.loggedIn, subscriptionType: acct.subscriptionType || null }) : {}),
    };
  }
  const aiSet = await getAiSettings().catch(() => ({}));
  const fallback = await accountFallbackOn();
  // Locally: the providers stand in while your Claude account is limited, signed out or not installed.
  const accountLimited = mode === 'account' && (Boolean(account?.cooldown) || !account?.signedIn) && fallback && usable.length > 0;
  const ready = mode === 'account' ? Boolean(account?.signedIn) || (fallback && usable.length > 0) : usable.length > 0;
  return {
    mode, ready, local: isLocalRequest(), forced: ['account', 'api'].includes(String(process.env.AI_MODE || '').toLowerCase()), serverless: SERVERLESS,
    // The monthly AI budget (shown in the AI menu when it's 80% used or more).
    budget: await (async () => { const r = normalizeRouting(aiSet.routing); const b = await budgetState(r); return b.limit ? { ...b, action: r.budget.action } : null; })(),
    ...(await (async () => {
      // Which AI answers next on this computer: Copilot (chosen, or standing in for a limited Claude account), Claude, or an API.
      const cp = mode === 'account' ? await copilotInfo() : { available: false };
      const cpOk = cp.available && !cooling('copilot');
      if (mode === 'account' && aiSet.localEngine === 'copilot' && cpOk) return { label: 'GitHub Copilot', model: aiSet.copilotModel || 'default', switched: false };
      if (mode === 'account' && aiSet.localEngine === 'copilot' && !cpOk) return { label: !accountLimited && account?.signedIn ? 'Claude account' : active ? active.label : 'AI not set up', model: !accountLimited && account?.signedIn ? DEFAULT_CLI_MODEL : active?.model || null, switched: true };
      if (mode === 'account' && accountLimited && aiSet.copilotBackup && cpOk) return { label: 'GitHub Copilot', model: aiSet.copilotModel || 'default', switched: true };
      return {
        label: mode === 'account' && !accountLimited ? 'Claude account' : active ? active.label : 'AI not set up',
        model: normalizeRouting(aiSet.routing).enabled ? 'per task' : mode === 'account' && !accountLimited ? DEFAULT_CLI_MODEL : active?.model || null,
        switched: mode === 'account' ? accountLimited : Boolean(active && usable[0] && active !== usable[0]),
      };
    })()),
    backups: Math.max(0, usable.length - 1),
    account, accountFallback: fallback,
    // GitHub Copilot as the local AI or Claude's backup (this computer only).
    copilot: mode === 'account' ? { ...(await copilotInfo()), cooldown: health('copilot'), models: COPILOT_MODELS } : null,
    // Your Claude plan's 5-hour and weekly limits (this computer only, when signed in to Claude Code with a plan).
    planUsage: mode === 'account' && account?.signedIn ? await planUsage({ fresh: planFresh }).catch(() => null) : null,
    localEngine: aiSet.localEngine === 'copilot' ? 'copilot' : 'claude', copilotModel: aiSet.copilotModel || '', copilotBackup: Boolean(aiSet.copilotBackup),
    api: publicApi(cfg),
    // Admins get the full list; everyone else only names, models and health.
    apis: chainAll.map((c) => (details
      ? { ...publicApi(c), entryId: c.entryId, enabled: c.enabled, cooldown: health(c.entryId), active: c === active }
      : { label: c.label, model: c.model || null, enabled: c.enabled, configured: c.configured, cooldown: health(c.entryId), active: c === active })),
    last: H.last,
    ...(details ? { settings: publicAiSettings(await getAiSettings().catch(() => null)), tasks: AI_TASKS, tiers: TIERS, claudeTiers: CLAUDE_TIER_DEFAULTS, tierHints: API_TIER_HINTS, usage: U, cacheStore: await cacheStats() } : {}),
    routingOn: normalizeRouting(aiSet.routing).enabled,
    // For the model picker on AI buttons (everyone): what each tier runs on here, and the custom configurations.
    aiChoices: (() => {
      const r = normalizeRouting(aiSet.routing);
      const api = active || usable[0] || null;
      const tierModel = (t) => (mode === 'account' ? (aiSet.localEngine === 'copilot' ? r.copilot[t] || aiSet.copilotModel || 'Copilot default' : r.claude[t] || CLAUDE_TIER_DEFAULTS[t]) : (api ? r.api[api.entryId]?.[t] || api.model : ''));
      return { tiers: Object.fromEntries(TIERS.map((t) => [t, tierModel(t)])), configs: normalizeConfigs(aiSet.configs).filter((c) => c.enabled).map((c) => ({ id: c.id, name: c.name, engine: c.engine, model: c.model, reasoning: c.reasoning })) };
    })(),
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, keys: p.keys, base: p.base || null, model: p.model || null, site: p.site || null })),
  };
}

// ---------------------------------------------------------------- Claude Code (local, personal account)
const G = globalThis;
G.__tfClaude ??= { status: null, statusAt: 0, pending: null };
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
/**
 * Whether Claude Code on this computer is signed in. Fresh for a minute; after that the last answer is returned
 * at once and checked again in the background, so the status bar never waits on (or flickers with) the CLI.
 */
export async function accountStatus({ fresh = false } = {}) {
  const age = Date.now() - C.statusAt;
  if (!fresh && C.status && age < 60000) return C.status;
  if (!fresh && C.status && age < 15 * 60000) { checkAccount().catch(() => {}); return C.status; }
  return checkAccount();
}
async function readAccount() {
  const r = await runCli(['auth', 'status', '--json'], { timeout: 15000 });
  try {
    const j = JSON.parse(r.stdout);
    return { loggedIn: Boolean(j.loggedIn), authMethod: j.authMethod || null, email: j.email || null, orgName: j.orgName || null, subscriptionType: j.subscriptionType || null };
  } catch {
    // No JSON: an older Claude Code without `claude auth` (unknown, so don't block it), or a failed or
    // timed-out check (null: keep what we knew).
    return r.code === 0 ? { loggedIn: null } : null;
  }
}
/** One check at a time: requests that arrive meanwhile share it. */
function checkAccount() {
  C.pending ??= (async () => {
    try {
      await cliInfo();
      let st = await readAccount();
      // Signed in a moment ago and now not? Ask once more before showing it (token refreshes can blip).
      if (st?.loggedIn === false && C.status?.loggedIn === true) { await new Promise((r) => setTimeout(r, 1500)); st = await readAccount(); }
      if (st) C.status = st;
      else C.status ??= { loggedIn: null };
      C.statusAt = Date.now();
      return C.status;
    } finally { C.pending = null; }
  })();
  return C.pending;
}

/**
 * Ask the AI once and return the full text reply. Uses your Claude account locally, the AI API elsewhere.
 * opts: { system, prompt, model, onText(chunkLength, totalLength), signal }. `model` only applies to the Claude account.
 */
/** AI isn't set up: a 503 the app shows as a message, not a crash. */
const notReady = (msg) => Object.assign(new Error(msg), { status: 503 });

/** Your Claude account through Claude Code, then (optionally) GitHub Copilot, then the AI APIs. */
async function askAccount(opts, { useCopilot, viaCopilotFirst }) {
    const fallback = await accountFallbackOn();
    const resting = cooling('account');
    let from = null;
    if (resting && fallback) {
      from = { name: 'Your Claude account', reason: `${resting.reason} (resets ${clock(resting.until)})` };
    } else {
      const cli = await cliInfo();
      const unusable = !cli.available ? 'isn’t set up (Claude Code isn’t installed)' : (await accountStatus()).loggedIn === false ? 'isn’t signed in on this computer' : null;
      if (unusable) {
        const hasApis = (await apiChain()).some((c) => c.configured);
        if (!fallback || (!hasApis && !useCopilot)) {
          throw notReady(!cli.available ? 'Claude Code isn’t installed on this computer. Install it (npm install -g @anthropic-ai/claude-code) and run `claude` once to sign in with your Claude account.'
            : 'Claude Code isn’t signed in on this computer. Run `claude` in a terminal and sign in with your Claude account.');
        }
        from = { name: 'Your Claude account', reason: unusable };
      }
    }
    if (!from && viaCopilotFirst) opts.onSwitch?.(`${viaCopilotFirst.name} ${viaCopilotFirst.reason}, so TicketForge switched to your Claude account.`);
    if (!from) {
      try {
        const model = opts.model || DEFAULT_CLI_MODEL;
        const out = await askViaCli({ ...opts, model });
        H.last = { key: 'account', label: `Your Claude account (${model})`, at: new Date().toISOString() };
        opts.used = { label: 'Claude account', model };
        if (resting) clearCooldown('account');
        return out;
      } catch (e) {
        let f = classify(e);
        // A sign-in that expired or was never finished, or Claude Code that won't start, also moves work to the
        // connected AI APIs (and rests the account for 10 minutes); other errors are shown as they are.
        if (f && (CLI_SIGNIN_RE.test(e.message) || e.code === 'ENOENT')) {
          f = { kind: 'auth', reason: e.code === 'ENOENT' ? 'isn’t available (Claude Code didn’t start)' : 'isn’t signed in, or its sign-in expired', waitMs: 6e5 };
          C.status = { loggedIn: false }; C.statusAt = Date.now();
        }
        if (!f || !['rate', 'credits', 'busy', 'auth'].includes(f.kind)) throw e;
        if (f.kind === 'rate' && !/limit$/.test(f.reason)) f.reason = 'hit its usage limit';
        markFailed('account', 'Your Claude account', f, e.message);
        if (!fallback) throw e;
        from = { name: 'Your Claude account', reason: `${f.reason} (resets ${clock(Date.now() + f.waitMs)})` };
      }
    }
    // GitHub Copilot as the backup for the Claude account (Administration → AI → Local AI), before the AI APIs.
    if (useCopilot) {
      const r = await tryCopilot(opts, from);
      if (r.ok) return r.text;
      from = r.from;
    }
    const chain = (await apiChain()).filter((c) => c.configured);
    if (!chain.length) {
      throw Object.assign(new Error(`${from.name === 'GitHub Copilot' ? 'Your Claude account and GitHub Copilot are unavailable' : `Your Claude account ${from.reason}`}. Add an AI API in Administration → AI so TicketForge can switch to it when this happens.`), { status: 503 });
    }
    return runChain(chain, opts, from);
  }

/** One try with GitHub Copilot. Returns { ok, text } or { ok: false, from, error } for the next AI to take over. */
async function tryCopilot(opts, from) {
  const c = cooling('copilot');
  if (c) return { ok: false, from: { name: 'GitHub Copilot', reason: `${c.reason} (back ${clock(c.until)})` }, error: new Error(`GitHub Copilot ${c.reason}.`) };
  const s = await getAiSettings().catch(() => ({}));
  if (from) opts.onSwitch?.(`${from.name} ${from.reason}, so TicketForge switched to GitHub Copilot.`);
  try {
    const model = opts.copilotModel || (opts.tier && opts.routing?.copilot?.[opts.tier]) || s.copilotModel || '';
    const text = await askViaCopilot({ ...opts, model });
    H.last = { key: 'copilot', label: `GitHub Copilot${model ? ` (${model})` : ''}`, at: new Date().toISOString() };
    opts.used = { label: 'GitHub Copilot', model: model || 'default' };
    return { ok: true, text };
  } catch (e) {
    if (opts.signal?.aborted || e.message === 'Cancelled') throw e;
    let f = classify(e) || { kind: 'error', reason: 'failed', waitMs: 12e4 };
    if (e.code === 'ENOENT') f = { kind: 'auth', reason: 'isn’t installed on this computer', waitMs: 6e5 };
    else if (e.httpStatus === 401) f = { kind: 'auth', reason: 'isn’t signed in on this computer', waitMs: 6e5 };
    else if (f.kind === 'rate') f.reason = 'hit its usage limit';
    markFailed('copilot', 'GitHub Copilot', f, e.message);
    return { ok: false, from: { name: 'GitHub Copilot', reason: f.reason }, error: e };
  }
}

/**
 * Ask the AI. opts.task names the kind of work (lib/aitasks.js): with model routing on, it picks the model tier
 * for that work on every AI (Claude account, Copilot, each API), and light work skips extended thinking.
 */
export async function askAI(opts) {
  const s0 = await getAiSettings().catch(() => ({}));
  const routing = normalizeRouting(s0.routing);
  const configs = normalizeConfigs(s0.configs).filter((c) => c.enabled);
  // What runs: the person's pick on the AI button (opts.run: a tier or 'cfg:<id>'), else model routing for the task.
  const run = String(opts.run || '');
  let pick = TIERS.includes(run) || /^cfg:/.test(run) ? run : pickFor(routing, opts.task);
  // Monthly budget (API spend): at the limit, High work runs on Standard, or AI pauses, as the owner chose.
  const budget = await budgetState(routing);
  if (budget.over && !currentContext().user?.is_owner) {
    if (routing.budget.action === 'pause') throw Object.assign(new Error(`This month’s AI budget ($${routing.budget.monthlyUsd}) is used up. Ask an owner to raise it in Administration → AI → Model routing.`), { status: 402 });
    if (routing.budget.action === 'downgrade' && (pick === 'high' || (!pick && tierFor(routing, opts.task) === 'high'))) pick = 'standard';
  }
  const config = /^cfg:/.test(pick) ? configs.find((c) => `cfg:${c.id}` === pick) || null : null;
  const tier = TIERS.includes(pick) ? pick : config ? '' : tierFor(routing, opts.task);
  // meter: filled by the call with the real token counts (API), read when the call is recorded (ai_usage).
  const o = { ...opts, routing, tier, config, meter: {} };
  if (tier) {
    o.model = routing.claude[tier] || CLAUDE_TIER_DEFAULTS[tier];
    if (tier === 'light' && routing.lightFast) o.reasoning = 'fast';
  }
  if (config) {
    if (config.reasoning) o.reasoning = config.reasoning;
    if (config.instructions) o.system = `${o.system || ''}\n\nAlways follow these instructions (${config.name}):\n${config.instructions}`;
    if (config.engine === 'claude' && config.model) o.model = config.model;
  }
  // Save usage: an identical request for a cacheable task reuses the stored answer (fresh: true skips it).
  const cacheable = routing.cache && !opts.fresh && routing.cacheTasks.includes(opts.task);
  const key = cacheable ? cacheKey([opts.task, pick || o.model || '', o.reasoning || '', o.system || '', o.prompt || '']) : null;
  if (key) {
    const hit = await cacheGet(key, routing.cacheDays);
    if (hit != null) {
      o.used = { label: 'Cache', model: 'reused answer' };
      noteUsage(o, hit, 0);
      recordUsage(o, { text: hit, cached: true });
      const c = (U.cache ??= { hits: 0, savedChars: 0 });
      c.hits += 1; c.savedChars += String(o.system || '').length + String(o.prompt || '').length + hit.length;
      return hit;
    }
  }
  const started = Date.now();
  let text;
  try { text = await askRouted(o); }
  catch (e) { recordUsage(o, { ms: Date.now() - started, ok: false }); throw e; }
  noteUsage(o, text, Date.now() - started);
  recordUsage(o, { text, ms: Date.now() - started });
  if (key && text) cachePut(key, opts.task, text, routing.cacheDays);
  return text;
}
/**
 * One row per AI call in ai_usage (who, which project, task, engine, model, tokens, time, cost). API calls report
 * their real tokens; the Claude account and Copilot don't, so their tokens are estimated (characters ÷ 4) and the
 * cost of an account run is what the same tokens would cost on the API. Best effort: never fails the AI call.
 */
function recordUsage(o, { text = '', ms = 0, cached = false, ok = true }) {
  const ctx = currentContext();
  const used = o.used || {};
  const engine = cached ? 'cache' : used.label === 'Claude account' ? 'account' : used.label === 'GitHub Copilot' ? 'copilot' : used.label ? 'api' : '';
  const real = o.meter?.tokens;
  const sent = String(o.system || '').length + String(o.prompt || '').length;
  const tok = real || { input: Math.round(sent / 4), output: Math.round(String(text || '').length / 4), cacheRead: 0, cacheWrite: 0 };
  const model = cached ? '' : String(used.model || o.model || '');
  const cost = cached || !ok ? 0 : costOf(model, tok, o.routing?.prices);
  const user = ctx.user || null;
  const projectId = o.projectId || ctx.projectId || null;
  qs(`insert into ai_usage (project_id, user_id, user_name, task, engine, model, tier, input, output, cache_read, cache_write, estimated, chars, ms, cached, escalated, ok, cost)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
  [projectId, user?.id || null, user?.name || '', o.task || 'other', engine, model.slice(0, 80), o.config ? `cfg:${o.config.name}` : o.tier || '',
    tok.input || 0, tok.output || 0, tok.cacheRead || 0, tok.cacheWrite || 0, !real, sent + String(text || '').length, Math.round(ms), cached, Boolean(o.escalated), ok, cost])
    .then(() => { if (engine === 'api' && cost) B.at = 0; }) // refresh the budget total soon
    .catch(() => { /* table not migrated yet: usage still shows in memory */ });
}
/** This month's API spend against the budget (cached for a minute). */
const B = G0.__tfAiBudget ??= { at: 0, spent: 0 };
export async function budgetState(routing) {
  const limit = routing?.budget?.monthlyUsd || 0;
  if (!limit) return { limit: 0, spent: 0, pct: 0, over: false, near: false };
  if (Date.now() - B.at > 60000) {
    try { B.spent = Number((await qs("select coalesce(sum(cost), 0) as s from ai_usage where engine = 'api' and at >= date_trunc('month', now())")).rows[0].s) || 0; } catch { /* keep the last total */ }
    B.at = Date.now();
  }
  const pct = B.spent / limit;
  return { limit, spent: B.spent, pct, over: pct >= 1, near: pct >= 0.8 };
}

/** Usage since this server started, per task and model (Administration → AI → Model routing). */
G0.__tfAiUsage ??= { since: new Date().toISOString(), tasks: {} };
const U = G0.__tfAiUsage;
function noteUsage(o, text, ms) {
  const k = o.task && AI_TASKS.some((t) => t.id === o.task) ? o.task : 'other';
  const u = (U.tasks[k] ??= { calls: 0, chars: 0, ms: 0, models: {} });
  u.calls += 1; u.chars += String(o.system || '').length + String(o.prompt || '').length + String(text || '').length; u.ms += ms;
  const m = o.used ? `${o.used.label}${o.used.model ? ` · ${o.used.model}` : ''}` : 'unknown';
  u.models[m] = (u.models[m] || 0) + 1;
}
export const aiUsage = () => U;
/** Anthropic API token usage, including what prompt caching saved. */
function noteTokens(u) {
  if (!u) return;
  const t = (U.tokens ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  t.input += u.input_tokens || 0; t.output += u.output_tokens || 0; t.cacheRead += u.cache_read_input_tokens || 0; t.cacheWrite += u.cache_creation_input_tokens || 0;
}
/**
 * The Claude model for a Claude Code agent run: a model set on the agent in Administration → Agents wins; otherwise
 * model routing's tier for the agent's task; otherwise the agent's own default.
 */
export async function agentModel(agentId, agent) {
  if (agent?.modelSet) return { model: agent.model, task: AGENT_TASK[agentId] || 'code' };
  const routing = normalizeRouting((await getAiSettings().catch(() => ({}))).routing);
  const task = AGENT_TASK[agentId] || 'code';
  const tier = tierFor(routing, task);
  return { model: (tier && (routing.claude[tier] || CLAUDE_TIER_DEFAULTS[tier])) || agent?.model || DEFAULT_CLI_MODEL, task };
}
/** Usage of one Claude Code agent run (it reports its own cost). */
export function noteAgentUsage({ task, model, ms, costUsd }) {
  const ctx = currentContext();
  qs(`insert into ai_usage (project_id, user_id, user_name, task, engine, model, estimated, ms, cost) values ($1,$2,$3,$4,'account',$5,true,$6,$7)`,
    [ctx.projectId || null, ctx.user?.id || null, ctx.user?.name || '', task || 'code', `Claude Code · ${model}`.slice(0, 80), Math.round(ms || 0), costUsd ?? null]).catch(() => {});
  const u = (U.tasks[task] ??= { calls: 0, chars: 0, ms: 0, models: {} });
  u.calls += 1; u.ms += ms || 0; u.cost = (u.cost || 0) + (costUsd || 0);
  const m = `Claude Code · ${model}`;
  u.models[m] = (u.models[m] || 0) + 1;
}
export function clearAiUsage() { U.since = new Date().toISOString(); U.tasks = {}; U.tokens = undefined; U.cache = undefined; }

async function askRouted(opts) {
  // A custom configuration names its engine: that engine goes first; the usual chain stands in if it's unavailable.
  const f = opts.config;
  if (f?.engine === 'api') {
    const chain = (await apiChain()).filter((c) => c.configured);
    const first = chain.find((c) => c.entryId === f.providerId) || null;
    if (first) return runChain([{ ...first, model: f.model || first.model }, ...chain.filter((c) => c !== first)], opts);
    opts.onSwitch?.(`The “${f.name}” configuration’s AI API isn’t set up, so TicketForge used the usual AI.`);
  } else if (f?.engine === 'copilot' && aiMode() === 'account') {
    opts.copilotModel = f.model; // set on opts itself: the call records which AI answered on this object
    const r = await tryCopilot(opts, null);
    if (r.ok) return r.text;
    if (!(await accountFallbackOn())) throw r.error;
    return askAccount(opts, { useCopilot: false, viaCopilotFirst: r.from });
  } else if (f?.engine === 'claude' && aiMode() === 'account') {
    if (f.model) opts.model = f.model;
    return askAccount(opts, { useCopilot: false, viaCopilotFirst: null });
  }
  if (aiMode() === 'account') {
    const s = await getAiSettings().catch(() => ({}));
    const copilotOn = (await copilotInfo()).available;
    // GitHub Copilot as the local AI: it goes first; your Claude account and then the AI APIs stand in for it.
    if (s.localEngine === 'copilot') {
      const r = await tryCopilot(opts, null);
      if (r.ok) return r.text;
      if (!(await accountFallbackOn())) throw r.error;
      return askAccount(opts, { useCopilot: false, viaCopilotFirst: r.from });
    }
    return askAccount(opts, { useCopilot: Boolean(s.copilotBackup) && copilotOn, viaCopilotFirst: null });
  }
  const all = await apiChain();
  const chain = all.filter((c) => c.configured);
  if (!chain.length) throw notReady(apiSetupMessage(all[0]));
  return runChain(chain, opts);
}
const callApi = (cfg, opts) => (cfg.kind === 'anthropic' ? askViaAnthropic : askViaOpenAICompatible)({ ...opts, model: cfg.model, cfg });
/** Older name, kept for existing callers. */
export const askClaude = askAI;

/** What Claude Code says when it isn't signed in or its sign-in expired. */
const CLI_SIGNIN_RE = /not (logged|signed) in|please run \/login|run `?claude`? (to )?(log|sign) ?in|oauth token (has )?expired|token (has )?expired|invalid api key|authentication_error|authentication failed|unauthorized|\b401\b/i;
/** Runs Claude Code; retries once without --effort on versions that don't know it. */
async function askViaCli(opts) {
  try { return await cliOnce(opts, true); }
  catch (e) { if (/unknown option.*--effort|--effort/i.test(e.message) && !e.httpStatus) return cliOnce(opts, false); throw e; }
}
function cliOnce({ system, prompt, model, onText, signal, reasoning }, withEffort) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--model', model,
      ...(withEffort ? ['--effort', effortOf(reasoning)] : []),
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
        // "Claude AI usage limit reached|1731100000" or "5-hour limit reached ∙ resets 3pm": switch, retry after the reset.
        const limit = errorText.match(/usage limit reached\|(\d{9,})/i);
        if (limit || /usage limit|limit reached|rate.?limit|overloaded/i.test(errorText)) {
          const resetAt = limit ? Number(limit[1]) * 1000 : 0;
          const msg = limit ? `Claude usage limit reached (resets ${clock(resetAt)}).` : errorText;
          return reject(Object.assign(new Error(msg), { httpStatus: /overloaded/i.test(errorText) ? 529 : 429, retryAfterMs: resetAt ? resetAt - Date.now() : 30 * 6e4 }));
        }
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
  if (!anthropicClients.has(k)) anthropicClients.set(k, new Anthropic({ apiKey: cfg.key, authToken: null, ...(cfg.baseUrl ? { baseURL: cfg.baseUrl } : {}) })); // authToken: null: never ANTHROPIC_AUTH_TOKEN from the environment
  return anthropicClients.get(k);
}
async function askViaAnthropic(opts) {
  try { return await anthropicOnce(opts, true); }
  catch (e) {
    // Models that don't take the effort / thinking settings: ask again without them.
    if (e.httpStatus === 400 && /effort|output_config|thinking/i.test(e.message)) return anthropicOnce(opts, false);
    throw e;
  }
}
async function anthropicOnce({ system, prompt, model, onText, signal, cfg, reasoning, task, meter }, tuned) {
  const client = anthropicClient(cfg);
  const level = reasoning || 'fast';
  const params = {
    model,
    // Each task's output limit (lib/aitasks.js), plus room to think when thinking is on.
    max_tokens: Math.min(64000, maxOutFor(task) + (tuned && level !== 'fast' ? 16000 : 0)),
    // Prompt caching: the system prompt (rules, app context, guide) is the same across many calls, so it's cached and
    // re-read at a fraction of the price. Prompts shorter than the model's minimum simply aren't cached.
    system: [{ type: 'text', text: String(system || ''), cache_control: { type: 'ephemeral' } }],
    // Fast: no extended thinking. Balanced / thorough: the model decides how much to think.
    ...(tuned ? { ...(level === 'fast' ? {} : { thinking: { type: 'adaptive' } }), output_config: { effort: effortOf(level) } } : {}),
    messages: [{ role: 'user', content: prompt }],
  };
  // Server-side refusal fallback is supported on the current Opus/Sonnet models.
  const useFallback = /^claude-(opus-5|sonnet-5-5|fable-5-1)/.test(model);
  const stream = useFallback
    ? client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal })
    : client.messages.stream(params, { signal });
  let total = 0;
  stream.on('text', (t) => { total += t.length; onText?.(t.length, total); });
  let msg;
  try { msg = await stream.finalMessage(); }
  catch (e) {
    if (!e?.status) throw e;
    const text = e.error?.error?.message || e.error?.message || e.message;
    throw Object.assign(new Error(`Anthropic API error ${e.status}: ${text}`), { status: 502, httpStatus: e.status, retryAfterMs: retryAfterMs(e.headers) });
  }
  if (msg.stop_reason === 'refusal') {
    throw new Error(`Claude declined this request${msg.stop_details?.category ? ` (${msg.stop_details.category})` : ''}.`);
  }
  noteTokens(msg.usage);
  if (meter && msg.usage) meter.tokens = { input: msg.usage.input_tokens || 0, output: msg.usage.output_tokens || 0, cacheRead: msg.usage.cache_read_input_tokens || 0, cacheWrite: msg.usage.cache_creation_input_tokens || 0 };
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
  return Object.assign(new Error(`${who} error ${res.status}: ${text}.${hint}`), { status: 502, httpStatus: res.status, retryAfterMs: retryAfterMs(res.headers) });
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
async function askViaOpenAICompatible(opts) {
  try { return await openAIOnce(opts, true); }
  catch (e) {
    // Providers or models without reasoning_effort: ask again without it.
    if (e.httpStatus === 400 && /reasoning|unrecognized|unsupported|not supported|unknown (field|parameter)|extra inputs/i.test(e.message)) return openAIOnce(opts, false);
    throw e;
  }
}
async function openAIOnce({ system, prompt, model, onText, signal, cfg, reasoning, task, meter }, tuned) {
  const openai = cfg.id === 'openai';
  const res = await reach(cfg, `${cfg.baseUrl}/chat/completions`, {
    method: 'POST', signal, headers: openAIHeaders(cfg),
    body: JSON.stringify({
      model, stream: true, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      ...(tuned ? { reasoning_effort: effortOf(reasoning) } : {}),
      // OpenAI itself: report token usage and cap the output (other OpenAI-compatible APIs differ, so left alone).
      ...(openai ? { stream_options: { include_usage: true }, max_completion_tokens: maxOutFor(task) + (tuned && reasoning && reasoning !== 'fast' ? 16000 : 0) } : {}),
    }),
  });
  const take = (u) => { if (meter && u) meter.tokens = { input: Math.max(0, (u.prompt_tokens || 0) - (u.prompt_tokens_details?.cached_tokens || 0)), output: u.completion_tokens || 0, cacheRead: u.prompt_tokens_details?.cached_tokens || 0, cacheWrite: 0 }; };
  if (!res.ok) throw await apiError(res, cfg);
  let text = '';
  let finish = null;
  if (!(res.headers.get('content-type') || '').includes('text/event-stream')) {
    const j = await res.json();
    take(j.usage);
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
        if (j.usage) take(j.usage);
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

/** Model IDs a provider offers: { id } a saved one, { draft } unsaved settings, or the active one. */
export async function listModels(target) {
  const cfg = await targetConfig(target);
  if (!cfg?.id || (cfg.error && !cfg.keySet)) throw notReady(apiSetupMessage(cfg));
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

/**
 * Sends a tiny prompt. { id } tests one saved provider, { draft } unsaved settings; nothing = the normal path
 * (with switching). A failed API test also lists the models the key can use.
 */
export async function testConnection(target) {
  const one = Boolean(target?.id || target?.draft);
  const mode = one ? 'api' : aiMode();
  const started = Date.now();
  const req = { system: 'You are a connection test. Follow the instruction exactly.', prompt: 'Reply with exactly: OK' };
  let used = null;
  try {
    let reply;
    if (one) {
      const cfg = await targetConfig(target);
      if (!cfg.configured) throw notReady(apiSetupMessage(cfg));
      reply = await callApi(cfg, req);
      if (target.id) clearCooldown(target.id); // it works again
      used = nameOf(cfg);
    } else {
      reply = await askAI({ ...req, model: mode === 'account' ? 'haiku' : undefined, onSwitch: () => {} });
      used = H.last?.label || null;
    }
    return { ok: true, mode, used, ms: Date.now() - started, reply: reply.trim().slice(0, 80) };
  } catch (e) {
    const out = { ok: false, mode, ms: Date.now() - started, error: e.message };
    if (one || mode === 'api') { try { out.models = (await listModels(one ? target : undefined)).slice(0, 200); } catch { /* can't list either */ } }
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

/** Nothing usable came back: no fields, or only empty ones. */
const looksEmpty = (x) => x == null || (typeof x === 'object' && Object.values(x).every((v) => v == null || v === '' || (Array.isArray(v) && !v.length)));
/**
 * Ask for JSON. Cheap first (Model routing → "Try Standard first"): work routed to High for a task marked escalate
 * runs on Standard, and only when that answer doesn't parse or comes back empty is it asked again on High.
 */
export async function askJson(opts) {
  const task = AI_TASKS.find((t) => t.id === opts.task);
  if (task?.escalate && (!opts.run || opts.run === 'auto')) {
    const routing = normalizeRouting((await getAiSettings().catch(() => ({}))).routing);
    if (routing.escalate && pickFor(routing, opts.task) === 'high') {
      try {
        const r = await askJsonOnce({ ...opts, run: 'standard' });
        if (!looksEmpty(r)) return r;
      } catch (e) { if (opts.signal?.aborted || [400, 401, 402, 403].includes(e.status)) throw e; }
      return askJsonOnce({ ...opts, run: 'high', escalated: true });
    }
  }
  return askJsonOnce(opts);
}
async function askJsonOnce(opts) {
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

/** The Claude Code command and environment, for running it as a coding agent in a repository (local only). */
export async function claudeCodeCommand() {
  const info = await cliInfo();
  if (!info.available) throw Object.assign(new Error('Claude Code isn’t installed on this computer. Install it (npm install -g @anthropic-ai/claude-code) and run `claude` once to sign in.'), { status: 400 });
  if ((await accountStatus()).loggedIn === false) throw Object.assign(new Error('Claude Code isn’t signed in on this computer. Run `claude` in a terminal and sign in.'), { status: 400 });
  return { bin: CLI_BIN, env: cliEnv(), version: info.version };
}
