// Connect GitHub (Project settings → Code & GitHub): sign in with your GitHub account through
// GitHub's device flow (a short code you approve at github.com/login/device), so TicketForge can
// list your repositories, clone them, push branches and open pull requests. The access token is
// saved encrypted as the project's GitHub token.
// It needs a GitHub OAuth App's client ID (Device Flow enabled): TICKETFORGE_GITHUB_CLIENT_ID, or
// saved by an administrator from the Connect GitHub dialog. The client ID is public; no client
// secret is used.
import crypto from 'node:crypto';
import { getMeta, setMeta } from './appmeta';
import { githubToken } from './devagent';
import { err } from './errors';

const KEY = 'github_oauth';
const SCOPES = 'repo read:org workflow';
const G = globalThis;
G.__tfGhDevice ??= new Map(); // id → { deviceCode, interval, expiresAt, projectId }
const PENDING = G.__tfGhDevice;

export async function getClientId() {
  if (process.env.TICKETFORGE_GITHUB_CLIENT_ID)
    return { clientId: process.env.TICKETFORGE_GITHUB_CLIENT_ID, source: 'env' };
  try {
    let v = await getMeta(KEY);
    if (typeof v === 'string') v = JSON.parse(v);
    return v?.clientId ? { clientId: v.clientId, source: 'saved' } : { clientId: '', source: '' };
  } catch {
    return { clientId: '', source: '' };
  }
}
export async function saveClientId(clientId) {
  const id = String(clientId || '').trim();
  if (id && !/^(Iv1\.|Ov2|Iv23)?[A-Za-z0-9._-]{10,40}$/.test(id))
    throw err(
      'That doesn’t look like a GitHub OAuth App client ID (for example Ov23li… or Iv1.…).',
    );
  await setMeta(KEY, { clientId: id });
  return getClientId();
}

async function form(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'TicketForge',
    },
    body: new URLSearchParams(params).toString(),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: 'bad_response', error_description: text.slice(0, 200) };
  }
  return { ok: res.ok, data };
}

/** Starts a device sign-in: { id, userCode, verificationUri, interval, expiresIn }. */
export async function startDeviceLogin(projectId) {
  const { clientId } = await getClientId();
  if (!clientId) throw err('Connect GitHub needs a GitHub OAuth App client ID first.');
  const { data } = await form('https://github.com/login/device/code', {
    client_id: clientId,
    scope: SCOPES,
  });
  if (!data.device_code)
    throw err(
      data.error === 'device_flow_disabled'
        ? 'Device Flow is off for that OAuth App. Turn on “Enable Device Flow” in its settings on GitHub.'
        : `GitHub didn’t start the sign-in (${data.error_description || data.error || 'unknown error'}). Check the client ID.`,
    );
  const id = crypto.randomUUID();
  PENDING.set(id, {
    deviceCode: data.device_code,
    interval: Number(data.interval) || 5,
    expiresAt: Date.now() + (Number(data.expires_in) || 900) * 1000,
    projectId,
    clientId,
  });
  return {
    id,
    userCode: data.user_code,
    verificationUri: data.verification_uri || 'https://github.com/login/device',
    interval: Number(data.interval) || 5,
    expiresIn: Number(data.expires_in) || 900,
  };
}
/**
 * One check of a device sign-in: { state: 'pending' | 'slow_down' | 'done' | 'expired' | 'denied',
 * token?, account? }.
 */
export async function pollDeviceLogin(id, projectId) {
  const p = PENDING.get(id);
  if (!p || p.projectId !== projectId) return { state: 'expired' };
  if (Date.now() > p.expiresAt) {
    PENDING.delete(id);
    return { state: 'expired' };
  }
  const { data } = await form('https://github.com/login/oauth/access_token', {
    client_id: p.clientId,
    device_code: p.deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  if (data.access_token) {
    PENDING.delete(id);
    const account = await whoAmI(data.access_token);
    return { state: 'done', token: data.access_token, account, scopes: data.scope || '' };
  }
  if (data.error === 'authorization_pending') return { state: 'pending' };
  if (data.error === 'slow_down') {
    p.interval += 5;
    return { state: 'slow_down', interval: p.interval };
  }
  PENDING.delete(id);
  return {
    state: data.error === 'access_denied' ? 'denied' : 'expired',
    message: data.error_description || data.error,
  };
}

async function gh(path, token) {
  const res = await fetch(`https://api.github.com/${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'TicketForge',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok)
    throw err(
      res.status === 401
        ? 'GitHub rejected the sign-in. Connect GitHub again.'
        : `GitHub said ${res.status}.`,
    );
  return res.json();
}
export async function whoAmI(token) {
  const u = await gh('user', token);
  return { login: u.login, name: u.name || '', avatar: u.avatar_url || '', url: u.html_url || '' };
}
/**
 * The repositories the token can see (owned, collaborator, organisation), most recently updated
 * first.
 */
export async function listRepos(token, { q = '' }: any = {}) {
  const tok = token || (await githubToken('').catch(() => '')) || '';
  if (!tok) throw err('Connect GitHub (or save a GitHub token) to list your repositories.');
  const out: any[] = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await gh(
      `user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
      tok,
    );
    out.push(...batch);
    if (batch.length < 100) break;
  }
  const needle = String(q || '')
    .trim()
    .toLowerCase();
  return out
    .filter(
      (r) => !needle || `${r.full_name} ${r.description || ''}`.toLowerCase().includes(needle),
    )
    .map((r) => ({
      fullName: r.full_name,
      private: r.private,
      description: r.description || '',
      defaultBranch: r.default_branch,
      updatedAt: r.pushed_at || r.updated_at,
      cloneUrl: r.clone_url,
      sshUrl: r.ssh_url,
      url: r.html_url,
      archived: r.archived,
      permissions: r.permissions || {},
      language: r.language || '',
    }));
}
