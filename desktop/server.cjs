// The TicketForge server: `next start`, run by Electron's own Node.js on 127.0.0.1 only.
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { ROOT, DATA_DIR, LOG_DIR, LOG_FILE } = require('./paths.cjs');
const { IS_WIN, readEnvFile, baseEnv } = require('./env.cjs');

const HOST = '127.0.0.1';
// A fixed port keeps the address (and so the sign-in cookie) the same between launches. It is not
// 5173, so the desktop app and a `npm start` copy can run side by side.
const PREFERRED_PORT = Number(process.env.TICKETFORGE_DESKTOP_PORT) || 51730;
const START_TIMEOUT_MS = 120_000;

const S = { child: null, url: null, stopping: false, onCrash: () => {} };

function serverEnv(port) {
  const user = readEnvFile();
  return {
    ...baseEnv(),
    ...user,
    NODE_ENV: 'production',
    // Run Electron's binary as plain Node.js. Children inherit it, so the server's own
    // `spawn(process.execPath, …)` calls (Playwright runner, browser install) also run as Node.
    ELECTRON_RUN_AS_NODE: '1',
    TICKETFORGE_ROOT: ROOT,
    TICKETFORGE_DATA: user.TICKETFORGE_DATA || DATA_DIR,
    TICKETFORGE_DESKTOP: '1',
    APP_URL: user.APP_URL || `http://localhost:${port}`,
    PORT: String(port),
    NEXT_TELEMETRY_DISABLED: '1',
  };
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, HOST);
  });
}

async function pickPort() {
  for (let p = PREFERRED_PORT; p < PREFERRED_PORT + 20; p++) if (await portFree(p)) return p;
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, HOST, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function waitForServer(url, child) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (child.exitCode !== null)
        return reject(new Error(`The server stopped (exit code ${child.exitCode}).`));
      if (Date.now() > deadline) return reject(new Error('The server did not start in time.'));
      const req = http.get(url + '/robots.txt', { timeout: 2000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => setTimeout(tick, 300));
      req.on('timeout', () => req.destroy());
    };
    tick();
  });
}

function logTail(lines = 25) {
  try {
    return fs.readFileSync(LOG_FILE, 'utf8').trimEnd().split(/\r?\n/).slice(-lines).join('\n');
  } catch {
    return '';
  }
}

/** Starts the server and resolves with its address once it answers. */
async function startServer() {
  const port = await pickPort();
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const log = fs.createWriteStream(LOG_FILE, { flags: 'w' });
  log.write(`[desktop] ${new Date().toISOString()} starting on ${HOST}:${port}\n`);

  const nextBin = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  const child = spawn(process.execPath, [nextBin, 'start', '-p', String(port), '-H', HOST], {
    cwd: ROOT,
    env: serverEnv(port),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.on('exit', (code, signal) => {
    log.write(`[desktop] server exited (code ${code}, signal ${signal})\n`);
    const wasRunning = S.child === child && S.url;
    if (S.child === child) {
      S.child = null;
      S.url = null;
    }
    if (wasRunning && !S.stopping) S.onCrash(logTail());
  });
  S.child = child;

  const url = `http://${HOST}:${port}`;
  await waitForServer(url, child);
  S.url = url;
  return url;
}

function kill(child) {
  try {
    // On Windows /T also ends what the server started (test runs, Claude Code).
    if (IS_WIN) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    else child.kill('SIGTERM');
  } catch {
    /* already gone */
  }
}

function stopServer() {
  const child = S.child;
  S.child = null;
  S.url = null;
  if (!child || child.exitCode !== null) return Promise.resolve();
  S.stopping = true;
  return new Promise((resolve) => {
    const done = () => {
      S.stopping = false;
      resolve();
    };
    const force = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      done();
    }, 5000);
    child.once('exit', () => {
      clearTimeout(force);
      done();
    });
    kill(child);
  });
}

module.exports = {
  startServer,
  stopServer,
  logTail,
  serverUrl: () => S.url,
  isRunning: () => Boolean(S.child),
  /** Called with the end of the log when the server stops by itself. */
  onCrash: (fn) => {
    S.onCrash = fn;
  },
};
