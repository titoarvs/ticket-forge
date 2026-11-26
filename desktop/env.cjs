// Settings file and environment for the server and the terminal.
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ROOT, USER_DIR, ENV_FILE, STATE_FILE } = require('./paths.cjs');

const IS_WIN = process.platform === 'win32';

/** Reads KEY=value lines (the .env format) into an object. */
function readEnvFile(file = ENV_FILE) {
  const out = {};
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    if (v !== '') out[m[1]] = v;
  }
  return out;
}

/** Creates the settings file from .env.example the first time, so there is something to edit. */
function ensureEnvFile() {
  if (fs.existsSync(ENV_FILE)) return;
  fs.mkdirSync(USER_DIR, { recursive: true });
  let text = '';
  try {
    text = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  } catch {
    /* packaged without it */
  }
  // The desktop app picks its own address; drop the web server's defaults so they don't mislead.
  text = text
    .replace(/^APP_URL=.*$/m, '# APP_URL is set by the desktop app')
    .replace(/^PORT=.*$/m, '');
  const header =
    '# TicketForge desktop settings. Same keys as .env in the web version.\n' +
    '# Edit, save, then choose TicketForge → Restart server (or quit and reopen the app).\n\n';
  fs.writeFileSync(ENV_FILE, header + text);
}

/**
 * Apps opened from the Finder or Dock on macOS get a bare PATH (/usr/bin:/bin:...), so `claude`,
 * `git` from Homebrew, `gh` and the like aren't found. Take PATH from the user's login shell.
 */
function loginShellPath() {
  try {
    const shellBin = process.env.SHELL || '/bin/zsh';
    const out = execFileSync(shellBin, ['-ilc', 'printf "__TFPATH__%s__TFPATH__" "$PATH"'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const m = out.match(/__TFPATH__(.*)__TFPATH__/);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

/**
 * Windows keeps PATH in the registry. A program installed while the app is open (Claude Code, Git)
 * changes it there, not in this process, so read it again.
 */
function registryPath() {
  const read = (key) => {
    try {
      const out = execFileSync('reg', ['query', key, '/v', 'Path'], {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const m = out.match(/Path\s+REG(?:_EXPAND)?_SZ\s+(.*)/i);
      return m ? m[1].trim().replace(/%([^%]+)%/g, (_, n) => process.env[n] ?? `%${n}%`) : '';
    } catch {
      return '';
    }
  };
  return [
    read('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'),
    read('HKCU\\Environment'),
  ].join(';');
}

/** PATH with what the user's shell (or Windows) has now, plus where Claude Code installs itself. */
function userPath() {
  const sep = IS_WIN ? ';' : ':';
  const fresh = IS_WIN ? registryPath() : loginShellPath();
  const extra = [path.join(os.homedir(), '.local', 'bin')];
  if (!IS_WIN) extra.push('/opt/homebrew/bin', '/usr/local/bin');
  const parts = [...fresh.split(sep), ...(process.env.PATH || '').split(sep), ...extra];
  const seen = new Set();
  return parts
    .filter(
      (p) => p && !seen.has(IS_WIN ? p.toLowerCase() : p) && seen.add(IS_WIN ? p.toLowerCase() : p),
    )
    .join(sep);
}

/** This process's environment with a current PATH, for programs the app starts. */
function baseEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const key = IS_WIN ? Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'Path' : 'PATH';
  env[key] = userPath();
  return env;
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

function writeState(patch) {
  try {
    fs.mkdirSync(USER_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...readState(), ...patch }, null, 2));
  } catch {
    /* not important */
  }
}

module.exports = { IS_WIN, readEnvFile, ensureEnvFile, baseEnv, readState, writeState };
