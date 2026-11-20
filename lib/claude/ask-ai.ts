import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { currentContext, SERVERLESS, asSystem, currentWs, DEFAULT_WS } from '../db';
import { orm, aiUsage as aiUsageTable, sql, and, eq, gte } from '../orm';
import { wsCache } from '../wsmeta';
import { isSaas } from '../platform';
import { consume } from '../limits';
import { aiProvidersWithKeys, savedKeyFor, getAiSettings } from '../settings';
import { askViaCopilot, copilotInfo } from '../copilot';
import { cacheKey, cacheGet, cachePut } from '../aicache';
import { myActiveToken } from '../user-ai';
import {
  normalizeRouting,
  normalizeConfigs,
  TIERS,
  pickFor,
  tierFor,
  CLAUDE_TIER_DEFAULTS,
  costOf,
  AI_TASKS,
  AGENT_TASK,
  maxOutFor,
} from '../aitasks';
import { accountFallbackOn, accountStatus, C, apiSetupMessage, cliEnv } from './provider-status';
import { askViaOpenAICompatible } from './test-connection';

const G0 = globalThis;
export let CLI_BIN = process.env.CLAUDE_BIN || 'claude';
export const WORKDIR = path.join(os.tmpdir(), 'ticketforge-claude');
fs.mkdirSync(WORKDIR, { recursive: true });
export const DEFAULT_API_MODEL = 'claude-opus-5-5';
export const DEFAULT_CLI_MODEL = 'opus';
/**
 * Reasoning level (Administration → Generation) → provider effort. Fast is the default: direct and
 * consistent.
 */
const EFFORT = { fast: 'low', balanced: 'medium', thorough: 'high' };
export const effortOf = (reasoning) => EFFORT[reasoning] || EFFORT.fast;
// Candidate Claude Code executables: $CLAUDE_BIN, `claude` on PATH, native installs, and the copy
// bundled with the Claude desktop app. The newest version wins, because old versions can't use
// current models.
function candidateBins() {
  if (process.env.CLAUDE_BIN) return [process.env.CLAUDE_BIN];
  const home = os.homedir();
  const out = ['claude'];
  const globDir = (dir, sub: any[] = []) => {
    try {
      return fs.readdirSync(dir).flatMap((v) => {
        const base = path.join(dir, v);
        if (!sub.length) return [base];
        return globDir(base, sub.slice(1)).map((x) => x);
      });
    } catch {
      return [];
    }
  };
  out.push(...globDir(path.join(home, '.local', 'share', 'claude', 'versions')));
  for (const d of globDir(
    path.join(home, 'Library', 'Application Support', 'Claude', 'claude-code'),
    ['*'],
  )) {
    out.push(path.join(d, 'claude.app', 'Contents', 'MacOS', 'claude'));
  }
  out.push(
    path.join(home, '.claude', 'local', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  );
  return [...new Set(out)];
}
const versionOf = (bin) =>
  new Promise((resolve) => {
    execFile(/*turbopackIgnore: true*/ bin, ['--version'], { timeout: 15000 }, (err, stdout) => {
      const m = !err && String(stdout).match(/(\d+)\.(\d+)\.(\d+)/);
      resolve(m ? { bin, version: m[0], n: [Number(m[1]), Number(m[2]), Number(m[3])] } : null);
    });
  });
const newer = (a, b) => {
  for (let i = 0; i < 3; i++) if (a.n[i] !== b.n[i]) return a.n[i] > b.n[i];
  return false;
};
let cliInfoPromise = null;
export function cliInfo() {
  cliInfoPromise ??= (async () => {
    const found = (await Promise.all(candidateBins().map(versionOf))).filter(Boolean);
    if (!found.length) return { available: false };
    const best: any = found.reduce((a, b) => (newer(b, a) ? b : a));
    CLI_BIN = best.bin;
    const outdated = best.n[0] < 2 || (best.n[0] === 2 && best.n[1] < 1);
    return { available: true, version: `${best.version} (Claude Code)`, path: best.bin, outdated };
  })();
  return cliInfoPromise;
}
// ---------------------------------------------------------------- which mode
const LOCAL_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1|[a-z0-9-]+\.localhost)$/i;
/**
 * True when the app was opened on this computer (localhost). Behind a proxy, X-Forwarded-Host
 * counts.
 */
export function isLocalHost(hostHeader) {
  const h = String(hostHeader || '')
    .split(',')[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '');
  return LOCAL_HOST.test(h);
}
export function isLocalRequest() {
  const c = currentContext();
  if (typeof c.local === 'boolean') return c.local;
  return !SERVERLESS; // scripts run on this computer
}
/** "account" (your Claude account through Claude Code) or "api" (the configured AI API). */
export function aiMode() {
  // The hosted service (SaaS) never answers with the server's own Claude sign-in: each workspace
  // uses its own AI.
  if (isSaas()) return 'api';
  const forced = String(process.env.AI_MODE || '').toLowerCase();
  if (forced === 'account' || forced === 'api') return forced;
  return !SERVERLESS && isLocalRequest() ? 'account' : 'api';
}
// ---------------------------------------------------------------- AI API providers
// Everything except Anthropic speaks the OpenAI chat-completions format.
export const PROVIDERS = {
  // Your Claude Pro/Max plan: runs the real Claude Code here, signed in with a token from `claude
  // setup-token`.
  'claude-sub': {
    label: 'Claude subscription, shared with everyone (Claude Code)',
    kind: 'claude-code',
    keys: ['CLAUDE_CODE_OAUTH_TOKEN'],
    model: 'sonnet',
    site: 'claude setup-token',
    keyLabel: 'Subscription token',
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    kind: 'anthropic',
    keys: ['ANTHROPIC_API_KEY'],
    model: 'claude-opus-5-5',
    site: 'console.anthropic.com',
  },
  openai: {
    label: 'OpenAI',
    base: 'https://api.openai.com/v1',
    keys: ['OPENAI_API_KEY'],
    site: 'platform.openai.com',
  },
  gemini: {
    label: 'Google Gemini',
    base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    site: 'aistudio.google.com',
  },
  openrouter: {
    label: 'OpenRouter',
    base: 'https://openrouter.ai/api/v1',
    keys: ['OPENROUTER_API_KEY'],
    site: 'openrouter.ai',
  },
  groq: {
    label: 'Groq',
    base: 'https://api.groq.com/openai/v1',
    keys: ['GROQ_API_KEY'],
    site: 'console.groq.com',
  },
  deepseek: {
    label: 'DeepSeek',
    base: 'https://api.deepseek.com/v1',
    keys: ['DEEPSEEK_API_KEY'],
    site: 'platform.deepseek.com',
  },
  mistral: {
    label: 'Mistral',
    base: 'https://api.mistral.ai/v1',
    keys: ['MISTRAL_API_KEY'],
    site: 'console.mistral.ai',
  },
  xai: {
    label: 'xAI (Grok)',
    base: 'https://api.x.ai/v1',
    keys: ['XAI_API_KEY'],
    site: 'console.x.ai',
  },
  together: {
    label: 'Together AI',
    base: 'https://api.together.xyz/v1',
    keys: ['TOGETHER_API_KEY'],
    site: 'api.together.ai',
  },
  ollama: {
    label: 'Ollama',
    base: 'http://localhost:11434/v1',
    keys: [],
    keyOptional: true,
    site: 'ollama.com',
  },
  custom: { label: 'OpenAI-compatible API', base: '', keys: [], keyOptional: true },
};
/**
 * A Claude subscription token (from `claude setup-token`) only works inside Claude Code, never as
 * an API key.
 */
export const SUBSCRIPTION_TOKEN_NOTE =
  'This is a Claude subscription token (sk-ant-oat…, from claude setup-token), not an API key. Add it as the “Claude subscription (Claude Code)” provider instead: that runs Claude Code with your plan.';
export const isSubscriptionToken = (k) => /^sk-ant-oat/i.test(String(k || '').trim());
function buildConfig({ id, key = '', model = '', baseUrl = '', source, keyError = null }: any) {
  const p = PROVIDERS[id];
  if (p?.kind === 'anthropic' && isSubscriptionToken(key)) keyError = SUBSCRIPTION_TOKEN_NOTE;
  if (p?.kind === 'claude-code' && key && !isSubscriptionToken(key))
    keyError =
      'That isn’t a Claude subscription token: run claude setup-token and paste the sk-ant-oat01-… token it prints.';
  if (!p)
    return {
      id: id || null,
      label: id || null,
      source,
      configured: false,
      missing: id ? [] : ['provider'],
      error: id
        ? `Unknown AI provider "${id}". Use one of: ${Object.keys(PROVIDERS).join(', ')}.`
        : null,
    };
  const base = String(baseUrl || p.base || '').replace(/\/+$/, '');
  const m = String(model || p.model || '').trim();
  const kind = p.kind || 'openai';
  const missing = [
    !key && !p.keyOptional && 'key',
    kind === 'openai' && !base && 'baseUrl',
    !m && 'model',
  ].filter(Boolean);
  return {
    id,
    label: p.label,
    kind,
    baseUrl: base,
    model: m,
    key,
    keySet: Boolean(key),
    keyNames: p.keys,
    site: p.site || null,
    source,
    missing,
    configured: !missing.length && !keyError,
    error: keyError,
  };
}
/**
 * From AI_PROVIDER / AI_API_KEY / AI_MODEL / AI_BASE_URL, or a provider's own key variable (e.g.
 * OPENAI_API_KEY).
 */
export function envConfig() {
  let id = String(process.env.AI_PROVIDER || '')
    .toLowerCase()
    .trim();
  if (!id)
    id =
      Object.keys(PROVIDERS).find((k) => PROVIDERS[k].keys.some((e) => process.env[e])) ||
      (process.env.AI_BASE_URL ? 'custom' : '');
  if (!id)
    return {
      id: null,
      label: null,
      source: 'env',
      configured: false,
      missing: ['provider'],
      error: null,
    };
  const p: any = PROVIDERS[id];
  const key =
    process.env.AI_API_KEY || (p ? p.keys.map((e) => process.env[e]).find(Boolean) : '') || '';
  return buildConfig({
    id,
    key,
    model: process.env.AI_MODEL,
    baseUrl: process.env.AI_BASE_URL,
    source: 'env',
  });
}
/**
 * Every AI API in priority order: the providers saved in Administration → AI, then the
 * environment's.
 */
export async function apiChain({ all = false }: any = {}) {
  let saved: any[] = [];
  try {
    saved = await aiProvidersWithKeys();
  } catch {
    /* database not ready: environment only */
  }
  const chain = saved
    .filter((e) => all || e.enabled !== false)
    .map((e) => ({
      ...buildConfig({
        id: e.provider,
        key: e.key,
        model: e.model,
        baseUrl: e.baseUrl,
        source: 'panel',
        keyError: e.keyError,
      }),
      entryId: e.id,
      enabled: e.enabled !== false,
    }));
  const env = envConfig();
  if (
    env.id &&
    !chain.some((c) => c.id === env.id && c.key === env.key && c.baseUrl === env.baseUrl)
  )
    chain.push({ ...env, entryId: 'env', enabled: true });
  return chain;
}
/** The provider that would be used right now: the first ready one that isn't cooling down. */
export async function apiConfig() {
  const all = await apiChain();
  const ready = all.filter((c) => c.configured);
  return ready.find((c) => !cooling(c.entryId)) || ready[0] || all[0] || envConfig();
}
/**
 * Settings typed in the panel but not saved yet. A blank key reuses entry `id`'s saved key only for
 * the same provider and endpoint.
 */
async function draftConfig(d) {
  const id = String(d?.provider || '');
  const key = String(d?.apiKey || '').trim() || (await savedKeyFor(d?.id, id, d?.baseUrl));
  return buildConfig({ id, key, model: d?.model, baseUrl: d?.baseUrl, source: 'draft' });
}
/** A saved provider by its entry id ('env' = the environment's), or unsaved draft settings. */
export async function targetConfig(t) {
  if (t?.draft) return draftConfig(t.draft);
  if (t?.id) {
    const c = (await apiChain({ all: true })).find((x) => x.entryId === t.id);
    if (!c)
      throw Object.assign(new Error('That provider was removed. Reload the page.'), {
        status: 404,
      });
    return c;
  }
  return apiConfig();
}
// ---------------------------------------------------------------- switching when a provider is
// limited In-memory per server instance: which providers are cooling down after a limit or failure,
// and which was used last.
G0.__tfAiHealth ??= { cool: new Map(), last: null };
export const H = G0.__tfAiHealth;
export function cooling(key) {
  const c = H.cool.get(key);
  if (c && c.until > Date.now()) return c;
  if (c) H.cool.delete(key);
  return null;
}
function markFailed(key, label, f, message) {
  if (f.waitMs > 0)
    H.cool.set(key, {
      kind: f.kind,
      reason: f.reason,
      label,
      message: String(message || '').slice(0, 300),
      at: Date.now(),
      until: Date.now() + f.waitMs,
    });
}
export function clearCooldown(key) {
  if (key) H.cool.delete(key);
  else H.cool.clear();
}
export const health = (key) => {
  const c = cooling(key);
  return (
    c && {
      kind: c.kind,
      reason: c.reason,
      message: c.message,
      at: new Date(c.at).toISOString(),
      until: new Date(c.until).toISOString(),
    }
  );
};
/** How long a provider asked us to wait: Retry-After, or the rate-limit reset headers. */
export function retryAfterMs(headers) {
  const get = (k) => (typeof headers?.get === 'function' ? headers.get(k) : headers?.[k]);
  const ra = get('retry-after');
  if (ra) {
    const n = Number(ra);
    if (Number.isFinite(n)) return n * 1000;
    const d = Date.parse(ra);
    if (d) return Math.max(0, d - Date.now());
  }
  for (const k of [
    'x-ratelimit-reset-requests',
    'x-ratelimit-reset-tokens',
    'anthropic-ratelimit-requests-reset',
    'anthropic-ratelimit-tokens-reset',
  ]) {
    const v = get(k);
    if (!v) continue;
    const d = /^\d{4}-/.test(v)
      ? Date.parse(v) - Date.now()
      : [...String(v).matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)].reduce(
          (t, [, n, u]) => t + Number(n) * { ms: 1, s: 1e3, m: 6e4, h: 36e5 }[u],
          0,
        );
    if (d > 0) return d;
  }
  return 0;
}
const capWait = (ms, dflt) => Math.min(Math.max(ms || dflt, 5000), 6 * 36e5);
/**
 * Why a provider failed and how long to leave it alone. null: not the provider's fault (cancelled).
 */
function classify(e) {
  if (e?.name === 'AbortError' || e?.message === 'Cancelled') return null;
  const status = e?.httpStatus;
  const msg = String(e?.message || '');
  if (
    status === 402 ||
    /credit balance|insufficient_quota|exceeded your current quota|quota exceeded|billing|payment required|out of credits|insufficient (funds|credit)/i.test(
      msg,
    )
  ) {
    return {
      kind: 'credits',
      reason: 'is out of credits or over its quota',
      waitMs: capWait(e.retryAfterMs, 36e5),
    };
  }
  // Claude subscription limits ("You've hit your weekly limit · resets Nov 13 at 4am", "5-hour
  // limit", "session limit"): the account rests for hours, so move work to the AI APIs and don't
  // retry it every minute.
  if (
    /hit your (weekly|daily|monthly|session|\d+-hour|usage)? ?limit|(weekly|daily|monthly|session|\d+-hour) limit|limit\s*·\s*resets/i.test(
      msg,
    )
  ) {
    const kind = /weekly|monthly/i.test(msg) ? 'weekly' : /daily/i.test(msg) ? 'daily' : 'session';
    return {
      kind: 'rate',
      reason: `hit its ${kind === 'session' ? 'usage' : kind} limit`,
      waitMs: kind === 'weekly' ? 6 * 36e5 : kind === 'daily' ? 2 * 36e5 : 30 * 6e4,
    };
  }
  if (
    status === 429 ||
    /rate.?limit|too many requests|resource.?exhausted|usage limit|limit reached|tokens per min/i.test(
      msg,
    )
  ) {
    return { kind: 'rate', reason: 'hit its rate limit', waitMs: capWait(e.retryAfterMs, 6e4) };
  }
  if (
    status === 529 ||
    status === 503 ||
    /overloaded|temporarily unavailable|over capacity/i.test(msg)
  ) {
    return { kind: 'busy', reason: 'is overloaded', waitMs: capWait(e.retryAfterMs, 3e4) };
  }
  if (status === 401 || status === 403)
    return { kind: 'auth', reason: 'rejected its API key', waitMs: 6e5 };
  if (
    /output limit|context length|context window|maximum context|too many tokens|prompt is too long/i.test(
      msg,
    )
  )
    return { kind: 'size', reason: 'can’t handle a request this large', waitMs: 0 };
  return { kind: 'error', reason: 'failed', waitMs: 12e4 };
}
export const nameOf = (c) => `${c.label}${c.model ? ` (${c.model})` : ''}`;
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
/**
 * Tries each provider in order until one answers. Providers that are cooling down go last. `from`
 * describes why we got here (the Claude account's limit) so the first switch can be reported.
 */
async function runChain(chain, opts, from?) {
  const fresh = chain.filter((c) => !cooling(c.entryId));
  const resting = chain
    .filter((c) => cooling(c.entryId))
    .sort((a, b) => cooling(a.entryId).until - cooling(b.entryId).until);
  const order = [...fresh, ...resting];
  const problems: any[] = [];
  let prev = from;
  for (const base of order) {
    // Model routing: this task's tier may use another model of the same provider.
    const tm = opts.tier && opts.routing?.api?.[base.entryId]?.[opts.tier];
    const cfg = tm ? { ...base, model: tm } : base;
    if (opts.signal?.aborted) throw new Error('Cancelled');
    const c = cooling(cfg.entryId);
    if (prev)
      opts.onSwitch?.(
        `${prev.name} ${prev.reason}, so TicketForge switched to ${nameOf(cfg)}${c ? ` (it ${c.reason} earlier; trying it again)` : ''}.`,
      );
    // The service's own AI (keys from the environment) counts toward the workspace's plan; its own
    // keys don't.
    const giveBack = cfg.source === 'env' ? await consume('aiCalls') : null;
    try {
      const out = await callApi(cfg, opts);
      H.last = { key: cfg.entryId, label: nameOf(cfg), at: new Date().toISOString() };
      opts.used = { label: cfg.label, model: cfg.model };
      if (c) clearCooldown(cfg.entryId);
      return out;
    } catch (e) {
      giveBack?.();
      const f = classify(e);
      if (!f) throw e;
      markFailed(cfg.entryId, nameOf(cfg), f, e.message);
      problems.push(
        `${nameOf(cfg)} ${f.reason}${f.waitMs ? ` (retrying after ${clock(Date.now() + f.waitMs)})` : ''}: ${e.message}`,
      );
      if (order.length === 1 && !from) throw e; // only one provider: its own error says it best
      prev = { name: nameOf(cfg), reason: f.reason };
    }
  }
  throw Object.assign(
    new Error(
      `Every AI provider is unavailable right now. ${problems.join(' · ')} Add another provider in Administration → AI, or try again later.`,
    ),
    { status: 503 },
  );
}
/**
 * Ask the AI once and return the full text reply. Uses your Claude account locally, the AI API
 * elsewhere. opts: { system, prompt, model, onText(chunkLength, totalLength, chunkText), signal }. `model`
 * only applies to the Claude account.
 */
/** AI isn't set up: a 503 the app shows as a message, not a crash. */
export const notReady = (msg) => Object.assign(new Error(msg), { status: 503 });
/** Your Claude account through Claude Code, then (optionally) GitHub Copilot, then the AI APIs. */
async function askAccount(opts, { useCopilot, viaCopilotFirst }: any) {
  const fallback = await accountFallbackOn();
  const resting = cooling('account');
  let from = null;
  if (resting && fallback) {
    from = {
      name: 'Your Claude account',
      reason: `${resting.reason} (resets ${clock(resting.until)})`,
    };
  } else {
    const cli = await cliInfo();
    const unusable = !cli.available
      ? 'isn’t set up (Claude Code isn’t installed)'
      : (await accountStatus()).loggedIn === false
        ? 'isn’t signed in on this computer'
        : null;
    if (unusable) {
      const hasApis = (await apiChain()).some((c) => c.configured);
      if (!fallback || (!hasApis && !useCopilot)) {
        throw notReady(
          !cli.available
            ? 'Claude Code isn’t installed on this computer. Install it (npm install -g @anthropic-ai/claude-code) and run `claude` once to sign in with your Claude account.'
            : 'Claude Code isn’t signed in on this computer. Run `claude` in a terminal and sign in with your Claude account.',
        );
      }
      from = { name: 'Your Claude account', reason: unusable };
    }
  }
  if (!from && viaCopilotFirst)
    opts.onSwitch?.(
      `${viaCopilotFirst.name} ${viaCopilotFirst.reason}, so TicketForge switched to your Claude account.`,
    );
  if (!from) {
    try {
      const model = opts.model || DEFAULT_CLI_MODEL;
      const out = await askViaCli({ ...opts, model });
      H.last = {
        key: 'account',
        label: `Your Claude account (${model})`,
        at: new Date().toISOString(),
      };
      opts.used = { label: 'Claude account', model };
      if (resting) clearCooldown('account');
      return out;
    } catch (e) {
      let f = classify(e);
      // A sign-in that expired or was never finished, or Claude Code that won't start, also moves
      // work to the connected AI APIs (and rests the account for 10 minutes); other errors are
      // shown as they are.
      if (f && (CLI_SIGNIN_RE.test(e.message) || e.code === 'ENOENT')) {
        f = {
          kind: 'auth',
          reason:
            e.code === 'ENOENT'
              ? 'isn’t available (Claude Code didn’t start)'
              : 'isn’t signed in, or its sign-in expired',
          waitMs: 6e5,
        };
        C.status = { loggedIn: false };
        C.statusAt = Date.now();
      }
      if (!f || !['rate', 'credits', 'busy', 'auth'].includes(f.kind)) throw e;
      if (f.kind === 'rate' && !/limit$/.test(f.reason)) f.reason = 'hit its usage limit';
      markFailed('account', 'Your Claude account', f, e.message);
      if (!fallback) throw e;
      from = {
        name: 'Your Claude account',
        reason: `${f.reason} (resets ${clock(Date.now() + f.waitMs)})`,
      };
    }
  }
  // GitHub Copilot as the backup for the Claude account (Administration → AI → Local AI), before
  // the AI APIs.
  if (useCopilot) {
    const r = await tryCopilot(opts, from);
    if (r.ok) return r.text;
    from = r.from;
  }
  const chain = (await apiChain()).filter((c) => c.configured);
  if (!chain.length) {
    throw Object.assign(
      new Error(
        `${from.name === 'GitHub Copilot' ? 'Your Claude account and GitHub Copilot are unavailable' : `Your Claude account ${from.reason}`}. Add an AI API in Administration → AI so TicketForge can switch to it when this happens.`,
      ),
      { status: 503 },
    );
  }
  return runChain(chain, opts, from);
}
/**
 * One try with GitHub Copilot. Returns { ok, text } or { ok: false, from, error } for the next AI
 * to take over.
 */
async function tryCopilot(opts, from) {
  const c = cooling('copilot');
  if (c)
    return {
      ok: false,
      from: { name: 'GitHub Copilot', reason: `${c.reason} (back ${clock(c.until)})` },
      error: new Error(`GitHub Copilot ${c.reason}.`),
    };
  const s = await getAiSettings().catch(() => ({}));
  if (from)
    opts.onSwitch?.(`${from.name} ${from.reason}, so TicketForge switched to GitHub Copilot.`);
  try {
    const model =
      opts.copilotModel ||
      (opts.tier && opts.routing?.copilot?.[opts.tier]) ||
      s.copilotModel ||
      '';
    const text = await askViaCopilot({ ...opts, model });
    H.last = {
      key: 'copilot',
      label: `GitHub Copilot${model ? ` (${model})` : ''}`,
      at: new Date().toISOString(),
    };
    opts.used = { label: 'GitHub Copilot', model: model || 'default' };
    return { ok: true, text };
  } catch (e) {
    if (opts.signal?.aborted || e.message === 'Cancelled') throw e;
    let f = classify(e) || { kind: 'error', reason: 'failed', waitMs: 12e4 };
    if (e.code === 'ENOENT')
      f = { kind: 'auth', reason: 'isn’t installed on this computer', waitMs: 6e5 };
    else if (e.httpStatus === 401)
      f = { kind: 'auth', reason: 'isn’t signed in on this computer', waitMs: 6e5 };
    else if (f.kind === 'rate') f.reason = 'hit its usage limit';
    markFailed('copilot', 'GitHub Copilot', f, e.message);
    return { ok: false, from: { name: 'GitHub Copilot', reason: f.reason }, error: e };
  }
}
/**
 * Ask the AI. opts.task names the kind of work (lib/aitasks.ts): with model routing on, it picks
 * the model tier for that work on every AI (Claude account, Copilot, each API), and light work
 * skips extended thinking.
 */
export async function askAI(opts) {
  // Project brain (lib/brain.ts): the notes linked to this task go at the start of the prompt. The
  // system prompt (with the app context) stays the same text from call to call, so it keeps being
  // cached by the provider.
  if (opts.brain) {
    const { brainBlock } = await import('../brain');
    const block = await brainBlock(opts.brain);
    opts = {
      ...opts,
      brain: undefined,
      prompt: block ? `${block}\n\n${opts.prompt || ''}` : opts.prompt,
    };
  }
  const s0 = await getAiSettings().catch(() => ({}));
  const routing = normalizeRouting(s0.routing);
  const configs = normalizeConfigs(s0.configs).filter((c) => c.enabled);
  // What runs: the person's pick on the AI button (opts.run: a tier or 'cfg:<id>'), else model
  // routing for the task.
  const run = String(opts.run || '');
  let pick = TIERS.includes(run) || /^cfg:/.test(run) ? run : pickFor(routing, opts.task);
  // Monthly budget (API spend): at the limit, High work runs on Standard, or AI pauses, as the
  // owner chose.
  const budget = await budgetState(routing);
  if (budget.over && !currentContext().user?.is_owner) {
    if (routing.budget.action === 'pause')
      throw Object.assign(
        new Error(
          `This month’s AI budget ($${routing.budget.monthlyUsd}) is used up. Ask an owner to raise it in Administration → AI → Model routing.`,
        ),
        { status: 402 },
      );
    if (
      routing.budget.action === 'downgrade' &&
      (pick === 'high' || (!pick && tierFor(routing, opts.task) === 'high'))
    )
      pick = 'standard';
  }
  const config = /^cfg:/.test(pick) ? configs.find((c) => `cfg:${c.id}` === pick) || null : null;
  const tier = TIERS.includes(pick) ? pick : config ? '' : tierFor(routing, opts.task);
  // meter: filled by the call with the real token counts (API), read when the call is recorded
  // (ai_usage).
  const o = { ...opts, routing, tier, config, meter: {} };
  if (tier) {
    o.model = routing.claude[tier] || CLAUDE_TIER_DEFAULTS[tier];
    if (tier === 'light' && routing.lightFast) o.reasoning = 'fast';
  }
  if (config) {
    if (config.reasoning) o.reasoning = config.reasoning;
    if (config.instructions)
      o.system = `${o.system || ''}\n\nAlways follow these instructions (${config.name}):\n${config.instructions}`;
    if (config.engine === 'claude' && config.model) o.model = config.model;
  }
  // Save usage: an identical request for a cacheable task reuses the stored answer (fresh: true
  // skips it).
  const cacheable = routing.cache && !opts.fresh && routing.cacheTasks.includes(opts.task);
  const key = cacheable
    ? cacheKey([
        opts.task,
        pick || o.model || '',
        o.reasoning || '',
        o.system || '',
        o.prompt || '',
      ])
    : null;
  if (key) {
    const hit = await cacheGet(key, routing.cacheDays);
    if (hit != null) {
      o.used = { label: 'Cache', model: 'reused answer' };
      noteUsage(o, hit, 0);
      recordUsage(o, { text: hit, cached: true });
      const c = (U.cache ??= { hits: 0, savedChars: 0 });
      c.hits += 1;
      c.savedChars += String(o.system || '').length + String(o.prompt || '').length + hit.length;
      return hit;
    }
  }
  const started = Date.now();
  let text;
  // My AI: the person's own Claude subscription first (only theirs: it's read with their own
  // access).
  const mine = await myActiveToken().catch(() => null);
  if (mine) {
    const model = o.model && /^(opus|sonnet|haiku)$/.test(o.model) ? o.model : mine.model;
    try {
      text = await askViaSubscription({ ...o, model, cfg: { key: mine.token } });
      o.used = { label: 'Your Claude subscription', model };
      noteUsage(o, text, Date.now() - started);
      recordUsage(o, { text, ms: Date.now() - started });
      if (key && text) cachePut(key, opts.task, text, routing.cacheDays);
      return text;
    } catch (e) {
      if (opts.signal?.aborted || !mine.teamFallback) {
        recordUsage(
          { ...o, used: { label: 'Your Claude subscription', model } },
          { ms: Date.now() - started, ok: false },
        );
        throw Object.assign(
          new Error(
            `Your Claude subscription: ${e.message}${mine.teamFallback ? '' : ' (My AI is set to use only your subscription.)'}`,
          ),
          { status: e.httpStatus === 429 ? 429 : 503 },
        );
      }
      opts.onSwitch?.(
        `Your Claude subscription isn’t available (${String(e.message).split('\n')[0].slice(0, 140)}); using the team’s AI.`,
      );
    }
  }
  try {
    text = await askRouted(o);
  } catch (e) {
    // Stopped by the plan's limit before any AI was asked: nothing to record as an AI call.
    if (e.extra?.code !== 'limit') recordUsage(o, { ms: Date.now() - started, ok: false });
    throw e;
  }
  noteUsage(o, text, Date.now() - started);
  recordUsage(o, { text, ms: Date.now() - started });
  if (key && text) cachePut(key, opts.task, text, routing.cacheDays);
  return text;
}
/**
 * One row per AI call in ai_usage (who, which project, task, engine, model, tokens, time, cost).
 * API calls report their real tokens; the Claude account and Copilot don't, so their tokens are
 * estimated (characters ÷ 4) and the cost of an account run is what the same tokens would cost on
 * the API. Best effort: never fails the AI call.
 */
function recordUsage(o, { text = '', ms = 0, cached = false, ok = true }: any) {
  const ctx = currentContext();
  const used = o.used || {};
  const engine = cached
    ? 'cache'
    : used.label === 'Claude account' || used.label === 'Your Claude subscription'
      ? 'account'
      : used.label === 'GitHub Copilot'
        ? 'copilot'
        : used.label
          ? 'api'
          : '';
  const real = o.meter?.tokens;
  const sent = String(o.system || '').length + String(o.prompt || '').length;
  const tok = real || {
    input: Math.round(sent / 4),
    output: Math.round(String(text || '').length / 4),
    cacheRead: 0,
    cacheWrite: 0,
  };
  const model = cached ? '' : String(used.model || o.model || '');
  const cost = cached || !ok ? 0 : costOf(model, tok, o.routing?.prices);
  const user = ctx.user || null;
  const projectId = o.projectId || ctx.projectId || null;
  asSystem(async () => {
    await orm.insert(aiUsageTable).values({
      projectId,
      userId: user?.id || null,
      userName: user?.name || '',
      task: o.task || 'other',
      engine,
      model: model.slice(0, 80),
      tier: o.config ? `cfg:${o.config.name}` : o.tier || '',
      input: tok.input || 0,
      output: tok.output || 0,
      cacheRead: tok.cacheRead || 0,
      cacheWrite: tok.cacheWrite || 0,
      estimated: !real,
      chars: sent + String(text || '').length,
      ms: Math.round(ms),
      cached,
      escalated: Boolean(o.escalated),
      ok,
      cost,
      workspaceId: currentWs() || DEFAULT_WS,
    });
  })
    .then(() => {
      if (engine === 'api' && cost) B.at = 0;
    }) // refresh the budget total soon
    .catch(() => {
      /* table not migrated yet: usage still shows in memory */
    });
}
/** This month's API spend against the budget (cached for a minute). */
// per workspace
const B: any = wsCache('__tfAiBudgetWs', () => ({ at: 0, spent: 0 }));
export async function budgetState(routing) {
  const limit = routing?.budget?.monthlyUsd || 0;
  if (!limit) return { limit: 0, spent: 0, pct: 0, over: false, near: false };
  if (Date.now() - B.at > 60000) {
    try {
      const [row] = await asSystem(
        async () =>
          await orm
            .select({ s: sql<number>`coalesce(sum(${aiUsageTable.cost}), 0)` })
            .from(aiUsageTable)
            .where(
              and(
                eq(aiUsageTable.workspaceId, currentWs() || DEFAULT_WS),
                eq(aiUsageTable.engine, 'api'),
                gte(aiUsageTable.at, sql`date_trunc('month', now())`),
              ),
            ),
      );
      B.spent = Number(row.s) || 0;
    } catch {
      /* keep the last total */
    }
    B.at = Date.now();
  }
  const pct = B.spent / limit;
  return { limit, spent: B.spent, pct, over: pct >= 1, near: pct >= 0.8 };
}
/** Usage since this server started, per task and model (Administration → AI → Model routing). */
G0.__tfAiUsage ??= { since: new Date().toISOString(), tasks: {} };
export const U = G0.__tfAiUsage;
function noteUsage(o, text, ms) {
  const k = o.task && AI_TASKS.some((t) => t.id === o.task) ? o.task : 'other';
  const u = (U.tasks[k] ??= { calls: 0, chars: 0, ms: 0, models: {} });
  u.calls += 1;
  u.chars +=
    String(o.system || '').length + String(o.prompt || '').length + String(text || '').length;
  u.ms += ms;
  const m = o.used ? `${o.used.label}${o.used.model ? ` · ${o.used.model}` : ''}` : 'unknown';
  u.models[m] = (u.models[m] || 0) + 1;
}
export const aiUsage = () => U;
/** Anthropic API token usage, including what prompt caching saved. */
function noteTokens(u) {
  if (!u) return;
  const t = (U.tokens ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  t.input += u.input_tokens || 0;
  t.output += u.output_tokens || 0;
  t.cacheRead += u.cache_read_input_tokens || 0;
  t.cacheWrite += u.cache_creation_input_tokens || 0;
}
/**
 * The Claude model for a Claude Code agent run: a model set on the agent in Administration → Agents
 * wins; otherwise model routing's tier for the agent's task; otherwise the agent's own default.
 */
export async function agentModel(agentId, agent) {
  if (agent?.modelSet) return { model: agent.model, task: AGENT_TASK[agentId] || 'code' };
  const routing = normalizeRouting((await getAiSettings().catch(() => ({}))).routing);
  const task = AGENT_TASK[agentId] || 'code';
  const tier = tierFor(routing, task);
  return {
    model:
      (tier && (routing.claude[tier] || CLAUDE_TIER_DEFAULTS[tier])) ||
      agent?.model ||
      DEFAULT_CLI_MODEL,
    task,
  };
}
/** Usage of one Claude Code agent run (it reports its own cost). */
export function noteAgentUsage({ task, model, ms, costUsd }: any) {
  const ctx = currentContext();
  asSystem(async () => {
    await orm.insert(aiUsageTable).values({
      projectId: ctx.projectId || null,
      userId: ctx.user?.id || null,
      userName: ctx.user?.name || '',
      task: task || 'code',
      engine: 'account',
      model: `Claude Code · ${model}`.slice(0, 80),
      estimated: true,
      ms: Math.round(ms || 0),
      cost: costUsd ?? null,
      workspaceId: currentWs() || DEFAULT_WS,
    });
  }).catch(() => {});
  const u = (U.tasks[task] ??= { calls: 0, chars: 0, ms: 0, models: {} });
  u.calls += 1;
  u.ms += ms || 0;
  u.cost = (u.cost || 0) + (costUsd || 0);
  const m = `Claude Code · ${model}`;
  u.models[m] = (u.models[m] || 0) + 1;
}
export function clearAiUsage() {
  U.since = new Date().toISOString();
  U.tasks = {};
  U.tokens = undefined;
  U.cache = undefined;
}
async function askRouted(opts) {
  // A custom configuration names its engine: that engine goes first; the usual chain stands in if
  // it's unavailable.
  const f = opts.config;
  if (f?.engine === 'api') {
    const chain = (await apiChain()).filter((c) => c.configured);
    const first = chain.find((c) => c.entryId === f.providerId) || null;
    if (first)
      return runChain(
        [{ ...first, model: f.model || first.model }, ...chain.filter((c) => c !== first)],
        opts,
      );
    opts.onSwitch?.(
      `The “${f.name}” configuration’s AI API isn’t set up, so TicketForge used the usual AI.`,
    );
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
    // GitHub Copilot as the local AI: it goes first; your Claude account and then the AI APIs stand
    // in for it.
    if (s.localEngine === 'copilot') {
      const r = await tryCopilot(opts, null);
      if (r.ok) return r.text;
      if (!(await accountFallbackOn())) throw r.error;
      return askAccount(opts, { useCopilot: false, viaCopilotFirst: r.from });
    }
    return askAccount(opts, {
      useCopilot: Boolean(s.copilotBackup) && copilotOn,
      viaCopilotFirst: null,
    });
  }
  const all = await apiChain();
  const chain = all.filter((c) => c.configured);
  if (!chain.length) throw notReady(apiSetupMessage(all[0]));
  return runChain(chain, opts);
}
export const callApi = (cfg, opts) =>
  (cfg.kind === 'claude-code'
    ? askViaSubscription
    : cfg.kind === 'anthropic'
      ? askViaAnthropic
      : askViaOpenAICompatible)({
    ...opts,
    model: cfg.model,
    cfg,
  });
/**
 * The Claude subscription provider: Claude Code on this server, signed in with the saved
 * subscription token (never an API key, never this computer's own Claude login). Needs Claude Code
 * installed where TicketForge runs.
 */
export async function askViaSubscription(opts) {
  const cli = await cliInfo();
  if (!cli.available)
    throw Object.assign(
      new Error(
        SERVERLESS
          ? 'Claude Code can’t run on this hosting (serverless, e.g. Vercel). Run TicketForge on a server where Claude Code is installed (a VPS, or your computer) to use your Claude subscription.'
          : 'Claude Code isn’t installed on this server. Install it (npm install -g @anthropic-ai/claude-code) to use your Claude subscription.',
      ),
      { httpStatus: 503 },
    );
  const env: any = { ...cliEnv(), CLAUDE_CODE_OAUTH_TOKEN: opts.cfg.key };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  if (SERVERLESS || !env.HOME) env.HOME = os.tmpdir();
  try {
    return await cliOnce({ ...opts, env }, true);
  } catch (e) {
    if (/unknown option.*--effort|--effort/i.test(e.message) && !e.httpStatus)
      return cliOnce({ ...opts, env }, false);
    if (CLI_SIGNIN_RE.test(e.message) && !e.httpStatus) e.httpStatus = 401;
    throw e;
  }
}
/** Older name, kept for existing callers. */
export const askClaude = askAI;
/** What Claude Code says when it isn't signed in or its sign-in expired. */
const CLI_SIGNIN_RE =
  /not (logged|signed) in|please run \/login|run `?claude`? (to )?(log|sign) ?in|oauth token (has )?expired|token (has )?expired|invalid api key|authentication_error|authentication failed|unauthorized|\b401\b/i;
/** Runs Claude Code; retries once without --effort on versions that don't know it. */
async function askViaCli(opts) {
  try {
    return await cliOnce(opts, true);
  } catch (e) {
    if (/unknown option.*--effort|--effort/i.test(e.message) && !e.httpStatus)
      return cliOnce(opts, false);
    throw e;
  }
}
function cliOnce(
  { system, prompt, model, onText, signal, reasoning, env: envIn }: any,
  withEffort,
) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--model',
      model,
      ...(withEffort ? ['--effort', effortOf(reasoning)] : []),
      '--tools',
      '',
      '--strict-mcp-config',
      '--system-prompt',
      system,
    ];
    // Keeps the CLI on the signed-in Claude account unless TICKETFORGE_CLI_USE_API_KEY is set.
    const env = envIn || cliEnv();
    const child = spawn(/*turbopackIgnore: true*/ CLI_BIN, args, {
      cwd: WORKDIR,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
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
        try {
          evt = JSON.parse(line);
        } catch {
          continue;
        }
        if (
          evt.type === 'stream_event' &&
          evt.event?.type === 'content_block_delta' &&
          evt.event.delta?.type === 'text_delta'
        ) {
          streamed += evt.event.delta.text;
          onText?.(evt.event.delta.text.length, streamed.length, evt.event.delta.text);
        } else if (evt.type === 'result') {
          if (evt.is_error || evt.subtype !== 'success')
            errorText = evt.result || evt.subtype || 'Claude CLI returned an error';
          else finalResult = evt.result;
        }
      }
    });
    child.stderr.on('data', (c) => {
      stderr += c.toString('utf8');
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return reject(new Error('Cancelled'));
      if (errorText) {
        // "Claude AI usage limit reached|1731100000" or "5-hour limit reached ∙ resets 3pm":
        // switch, retry after the reset.
        const limit = errorText.match(/usage limit reached\|(\d{9,})/i);
        if (limit || /usage limit|limit reached|rate.?limit|overloaded/i.test(errorText)) {
          const resetAt = limit ? Number(limit[1]) * 1000 : 0;
          const msg = limit ? `Claude usage limit reached (resets ${clock(resetAt)}).` : errorText;
          return reject(
            Object.assign(new Error(msg), {
              httpStatus: /overloaded/i.test(errorText) ? 529 : 429,
              retryAfterMs: resetAt ? resetAt - Date.now() : 30 * 6e4,
            }),
          );
        }
        const hint = /does not support this model|not_found_error|model:/i.test(errorText)
          ? ' Your Claude Code version may be too old for this model: run `claude update`, or pick another model in the connection settings.'
          : '';
        return reject(new Error(errorText + hint));
      }
      const text = finalResult ?? streamed;
      if (!text)
        return reject(
          new Error(`Claude CLI exited with code ${code}. ${stderr.slice(-800)}`.trim()),
        );
      resolve(text);
    });
    child.stdin.end(prompt);
  });
}
const anthropicClients: Map<any, any> = new Map();
export function anthropicClient(cfg) {
  const k = `${cfg.key}|${cfg.baseUrl}`;
  if (!anthropicClients.has(k))
    anthropicClients.set(
      k,
      new Anthropic({
        apiKey: cfg.key,
        authToken: null,
        ...(cfg.baseUrl ? { baseURL: cfg.baseUrl } : {}),
      }),
    ); // authToken: null: never ANTHROPIC_AUTH_TOKEN from the environment
  return anthropicClients.get(k);
}
async function askViaAnthropic(opts) {
  try {
    return await anthropicOnce(opts, true);
  } catch (e) {
    // Models that don't take the effort / thinking settings: ask again without them.
    if (e.httpStatus === 400 && /effort|output_config|thinking/i.test(e.message))
      return anthropicOnce(opts, false);
    throw e;
  }
}
async function anthropicOnce(
  { system, prompt, model, onText, signal, cfg, reasoning, task, meter }: any,
  tuned,
) {
  const client = anthropicClient(cfg);
  const level = reasoning || 'fast';
  const params = {
    model,
    // Each task's output limit (lib/aitasks.ts), plus room to think when thinking is on.
    max_tokens: Math.min(64000, maxOutFor(task) + (tuned && level !== 'fast' ? 16000 : 0)),
    // Prompt caching: the system prompt (rules, app context, guide) is the same across many calls,
    // so it's cached and re-read at a fraction of the price. Prompts shorter than the model's
    // minimum simply aren't cached.
    system: [{ type: 'text', text: String(system || ''), cache_control: { type: 'ephemeral' } }],
    // Fast: no extended thinking. Balanced / thorough: the model decides how much to think.
    ...(tuned
      ? {
          ...(level === 'fast' ? {} : { thinking: { type: 'adaptive' } }),
          output_config: { effort: effortOf(level) },
        }
      : {}),
    messages: [{ role: 'user', content: prompt }],
  };
  // Server-side refusal fallback is supported on the current Opus/Sonnet models.
  const useFallback = /^claude-(opus-5|sonnet-5-5|fable-5-1)/.test(model);
  const stream = useFallback
    ? client.beta.messages.stream(
        { ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
        { signal },
      )
    : client.messages.stream(params, { signal });
  let total = 0;
  stream.on('text', (t) => {
    total += t.length;
    onText?.(t.length, total, t);
  });
  let msg;
  try {
    msg = await stream.finalMessage();
  } catch (e) {
    if (!e?.status) throw e;
    const text = e.error?.error?.message || e.error?.message || e.message;
    throw Object.assign(new Error(`Anthropic API error ${e.status}: ${text}`), {
      status: 502,
      httpStatus: e.status,
      retryAfterMs: retryAfterMs(e.headers),
    });
  }
  if (msg.stop_reason === 'refusal') {
    throw new Error(
      `Claude declined this request${msg.stop_details?.category ? ` (${msg.stop_details.category})` : ''}.`,
    );
  }
  noteTokens(msg.usage);
  if (meter && msg.usage)
    meter.tokens = {
      input: msg.usage.input_tokens || 0,
      output: msg.usage.output_tokens || 0,
      cacheRead: msg.usage.cache_read_input_tokens || 0,
      cacheWrite: msg.usage.cache_creation_input_tokens || 0,
    };
  const text = msg.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (msg.stop_reason === 'max_tokens')
    throw new Error(
      'Response hit the output limit. Try a smaller document or fewer tickets per run.',
    );
  return text;
}
