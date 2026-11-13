// Your Claude plan's usage limits (the 5-hour session limit and the weekly limits), the same numbers Claude Code's
// /usage and the Claude app show. Read on this computer only, with the sign-in Claude Code already keeps (macOS
// Keychain "Claude Code-credentials", or ~/.claude/.credentials.json elsewhere). The token is sent only to Anthropic
// and never leaves this module: callers get percentages and reset times.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const G = globalThis;
G.__tfPlanUsage ??= { data: null, at: 0, pending: null, error: null };
const C = G.__tfPlanUsage;
const FRESH_MS = 60_000;

const keychain = () => new Promise((resolve) => {
  execFile('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { timeout: 5000 }, (err, out) => resolve(err ? '' : String(out || '').trim()));
});

/** Claude Code's OAuth sign-in: { accessToken, expiresAt } or null. */
async function credentials() {
  let raw = '';
  if (process.platform === 'darwin') raw = await keychain();
  if (!raw) {
    const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    try { raw = fs.readFileSync(path.join(dir, '.credentials.json'), 'utf8'); } catch { /* not signed in here */ }
  }
  try {
    const o = JSON.parse(raw)?.claudeAiOauth;
    return o?.accessToken ? { accessToken: o.accessToken, expiresAt: Number(o.expiresAt) || 0 } : null;
  } catch { return null; }
}

const limit = (x) => (x && typeof x.utilization === 'number' ? { pct: Math.max(0, Math.min(100, x.utilization)), resetsAt: x.resets_at || null } : null);

async function fetchUsage() {
  const cred = await credentials();
  if (!cred) return { error: 'Sign in to Claude Code to see your plan limits.' };
  // Claude Code refreshes an expired sign-in the next time it runs; until then keep the last numbers.
  if (cred.expiresAt && cred.expiresAt < Date.now()) return { error: 'Claude Code’s sign-in needs a refresh (it renews the next time Claude runs).' };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: `Bearer ${cred.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20', 'Content-Type': 'application/json' },
      signal: ctl.signal,
    });
    if (!r.ok) return { error: r.status === 401 ? 'Claude Code’s sign-in expired. Run Claude once to renew it.' : `Couldn’t read your plan limits (HTTP ${r.status}).` };
    const j = await r.json();
    return { data: { fiveHour: limit(j.five_hour), weekly: limit(j.seven_day), weeklyOpus: limit(j.seven_day_opus), weeklySonnet: limit(j.seven_day_sonnet) } };
  } catch (e) {
    return { error: e?.name === 'AbortError' ? 'Anthropic didn’t answer in time.' : 'Couldn’t reach Anthropic to read your plan limits.' };
  } finally { clearTimeout(t); }
}

/** Refresh now (one request at a time). */
function refresh() {
  C.pending ??= (async () => {
    try {
      const r = await fetchUsage();
      if (r.data) { C.data = r.data; C.error = null; } else C.error = r.error;
      C.at = Date.now();
    } finally { C.pending = null; }
  })();
  return C.pending;
}

/**
 * { fiveHour, weekly, weeklyOpus, weeklySonnet, checkedAt, error } — each limit { pct, resetsAt }. Cached for a minute;
 * an older answer comes back at once while a new one loads, so the status call never waits on Anthropic for long.
 * wait: wait for a fresh reading (the "Check again" button).
 */
export async function planUsage({ fresh = false, wait = false } = {}) {
  if (/^(off|0|false|no)$/i.test(process.env.CLAUDE_PLAN_USAGE || '')) return null;
  const age = Date.now() - C.at;
  if (fresh || age > FRESH_MS) {
    const p = refresh();
    if (wait || !C.at) await Promise.race([p, new Promise((r) => setTimeout(r, wait ? 8000 : 2500))]);
  }
  if (!C.data && !C.error) return null;
  return { ...(C.data || {}), checkedAt: C.at ? new Date(C.at).toISOString() : null, error: C.error };
}
