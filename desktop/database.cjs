// Which database the desktop app uses: a shared PostgreSQL server (e.g. Railway) or the built-in one
// on this computer. Chosen on first launch (desktop/setup/) and saved in ticketforge.env.
'use strict';

const fs = require('node:fs');
const { ENV_FILE } = require('./paths.cjs');
const { readEnvFile, ensureEnvFile, readState, writeState } = require('./env.cjs');

/** True until a database has been chosen (a connection string, or "this computer only"). */
function needsDatabaseChoice() {
  const env = readEnvFile();
  return !env.DATABASE_URL && !env.SUPABASE_DB_URL && !readState().databaseChoice;
}

/** A short, password-free description: "PostgreSQL at host:port/db" or "this computer". */
function describe(url = readEnvFile().DATABASE_URL) {
  if (!url) return 'Built-in database on this computer';
  try {
    const u = new URL(url);
    return `PostgreSQL at ${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`;
  } catch {
    return 'PostgreSQL';
  }
}

function checkUrl(url) {
  let u;
  try {
    u = new URL(String(url || '').trim());
  } catch {
    return 'That isn’t a connection string. It starts with postgresql:// or postgres://';
  }
  if (!/^postgres(ql)?:$/.test(u.protocol))
    return 'Use a PostgreSQL connection string (postgresql://…).';
  if (/\.railway\.internal$/i.test(u.hostname))
    return 'That is Railway’s private address, which only works inside Railway. Use DATABASE_PUBLIC_URL instead (host …proxy.rlwy.net).';
  if (!u.password) return 'The connection string has no password in it.';
  return null;
}

async function tryConnect(url, ssl) {
  const { Client } = require('pg');
  const client = new Client({
    connectionString: url,
    ssl: ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 12000,
  });
  await client.connect();
  try {
    const v = await client.query('select version() as v');
    const t = await client.query("select to_regclass('public.users') is not null as has");
    let users = 0;
    if (t.rows[0].has)
      users = Number((await client.query('select count(*)::int as n from users')).rows[0].n);
    return {
      version: String(v.rows[0].v).split(' ').slice(0, 2).join(' '),
      hasTables: t.rows[0].has,
      users,
    };
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Connects once to check the string. Tries an encrypted connection first, then a plain one for
 * servers without SSL. { ok, ssl, version, hasTables, users } or { ok: false, error }.
 */
async function testConnection(url) {
  const bad = checkUrl(url);
  if (bad) return { ok: false, error: bad };
  url = url.trim();
  try {
    return { ok: true, ssl: true, ...(await tryConnect(url, true)) };
  } catch (e) {
    if (!/does not support SSL|SSL off|no pg_hba.conf entry.*no encryption/i.test(e.message))
      return { ok: false, error: friendly(e) };
  }
  try {
    return { ok: true, ssl: false, ...(await tryConnect(url, false)) };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

function friendly(e) {
  const m = String(e?.message || e);
  if (/password authentication failed/i.test(m)) return 'The user name or password is wrong.';
  if (/ENOTFOUND|getaddrinfo/i.test(m)) return 'The server name wasn’t found. Check the host.';
  if (/ECONNREFUSED/i.test(m)) return 'The server refused the connection. Check the host and port.';
  if (/timeout|ETIMEDOUT/i.test(m))
    return 'The server didn’t answer. Check the host and port, and your internet connection.';
  if (/database .* does not exist/i.test(m)) return 'That database doesn’t exist on the server.';
  return m;
}

/** Sets KEY=value lines in ticketforge.env (replacing existing ones), readable by this user only. */
function setEnv(values) {
  ensureEnvFile();
  let text = fs.readFileSync(ENV_FILE, 'utf8');
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^#?\\s*${key}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
  }
  fs.writeFileSync(ENV_FILE, text, { mode: 0o600 });
  fs.chmodSync(ENV_FILE, 0o600);
}

/** Saves a tested connection string. */
function useServer(url, ssl) {
  setEnv({ DATABASE_URL: url.trim(), PGSSL: ssl ? '' : 'disable' });
  writeState({ databaseChoice: 'server' });
}

/** Keeps the built-in database on this computer. */
function useLocal() {
  setEnv({ DATABASE_URL: '', PGSSL: '' });
  writeState({ databaseChoice: 'local' });
}

module.exports = { needsDatabaseChoice, describe, testConnection, useServer, useLocal };
