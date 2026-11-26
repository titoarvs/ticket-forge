// Is Claude Code installed on this computer, and signed in to a Claude account?
//
// TicketForge uses your own Claude subscription through Claude Code when it is opened on this
// computer (it is, in the desktop app). These checks drive the setup bar in the terminal panel.
'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { IS_WIN, baseEnv } = require('./env.cjs');

const HOME = os.homedir();

/** Official Claude Code installers (https://docs.anthropic.com/en/docs/claude-code/setup). */
const INSTALL_COMMAND = IS_WIN
  ? 'irm https://claude.ai/install.ps1 | iex'
  : 'curl -fsSL https://claude.ai/install.sh | bash';

function pathDirs(env) {
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH');
  return String((key && env[key]) || '')
    .split(IS_WIN ? ';' : ':')
    .filter(Boolean);
}

/** Every `claude` executable we can find: on PATH first, then the usual install places. */
function candidates(env) {
  const names = IS_WIN ? ['claude.exe', 'claude.cmd'] : ['claude'];
  const out = [];
  for (const dir of pathDirs(env)) for (const n of names) out.push(path.join(dir, n));
  out.push(path.join(HOME, '.local', 'bin', IS_WIN ? 'claude.exe' : 'claude'));
  const versions = path.join(HOME, '.local', 'share', 'claude', 'versions');
  try {
    for (const v of fs.readdirSync(versions).sort().reverse()) out.push(path.join(versions, v));
  } catch {
    /* none */
  }
  if (!IS_WIN) out.push(path.join(HOME, '.claude', 'local', 'claude'));
  else out.push(path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'));
  return [...new Set(out)].filter((f) => {
    try {
      return fs.statSync(f).isFile();
    } catch {
      return false;
    }
  });
}

function run(bin, args, env) {
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      { env, timeout: 20000, windowsHide: true, shell: IS_WIN && bin.endsWith('.cmd') },
      (err, stdout) => resolve({ ok: !err, out: String(stdout || '') }),
    );
  });
}

function hasGit(env) {
  return pathDirs(env).some((d) => fs.existsSync(path.join(d, IS_WIN ? 'git.exe' : 'git')));
}

const parseVersion = (text) => {
  const m = String(text).match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? { text: m[0], n: [Number(m[1]), Number(m[2]), Number(m[3])] } : null;
};
const newer = (a, b) => {
  for (let i = 0; i < 3; i++) if (a.n[i] !== b.n[i]) return a.n[i] > b.n[i];
  return false;
};
// `claude auth status --json`, which TicketForge uses to check the sign-in, arrived in 2.1.
const OUTDATED = (v) => v.n[0] < 2 || (v.n[0] === 2 && v.n[1] < 1);

/**
 * The newest Claude Code on this computer, as TicketForge's server picks it (lib/claude/ask-ai.ts):
 * { installed, path, version, outdated, loggedIn, email, plan, authMethod, onPath, needsGit }.
 * `onPath`: typing `claude` in a terminal runs this one. `needsGit`: Windows without Git for
 * Windows, which Claude Code needs there.
 */
async function claudeStatus() {
  const env = baseEnv();
  const needsGit = IS_WIN && !hasGit(env);
  const all = candidates(env);
  const found = (
    await Promise.all(
      all.map(async (bin) => ({ bin, v: parseVersion((await run(bin, ['--version'], env)).out) })),
    )
  ).filter((c) => c.v);
  if (!found.length) return { installed: false, needsGit };
  const best = found.reduce((a, b) => (newer(b.v, a.v) ? b : a));
  const st = await run(best.bin, ['auth', 'status', '--json'], env);
  let auth = {};
  try {
    auth = JSON.parse(st.out);
  } catch {
    /* older Claude Code without `claude auth`, or not signed in */
  }
  const firstOnPath = all.find((f) => pathDirs(env).includes(path.dirname(f)));
  return {
    installed: true,
    path: best.bin,
    version: best.v.text,
    outdated: OUTDATED(best.v),
    onPath: firstOnPath === best.bin,
    loggedIn: Boolean(auth.loggedIn),
    email: auth.email || null,
    plan: auth.subscriptionType || auth.planTier || null,
    authMethod: auth.authMethod || null,
    needsGit,
  };
}

/** The command a terminal runs to sign in, using the full path when `claude` would run another copy. */
function loginCommand(status) {
  if (!status?.installed || status.onPath) return 'claude auth login';
  return IS_WIN ? `& "${status.path}" auth login` : `"${status.path}" auth login`;
}

/** True when TicketForge can use the Claude account. */
const ready = (s) => Boolean(s?.installed && !s.outdated && s.loggedIn);

module.exports = { claudeStatus, loginCommand, ready, INSTALL_COMMAND };
