// The built-in terminal: a real shell (zsh/bash on macOS, PowerShell on Windows) in a pseudo-terminal,
// shown by desktop/terminal/index.html. It is there so you can install Claude Code and sign in to
// your Claude account without leaving TicketForge, and for anything else you'd use a terminal for.
'use strict';

const { app, ipcMain, clipboard, shell } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { IS_WIN, baseEnv } = require('./env.cjs');

const T = {
  pty: null,
  proc: null,
  view: null,
  cols: 100,
  rows: 24,
  onAction: () => {},
  registered: false,
};

function loadPty() {
  if (!T.pty && !app.isPackaged && !IS_WIN) {
    // In a dev checkout npm leaves node-pty's helper without the execute permission (the packaged
    // app gets it from desktop/build/after-pack.cjs).
    const helper = path.join(
      path.dirname(require.resolve('node-pty/package.json')),
      'prebuilds',
      `${process.platform}-${process.arch}`,
      'spawn-helper',
    );
    try {
      fs.chmodSync(helper, 0o755);
    } catch {
      /* built from source instead */
    }
  }
  T.pty ??= require('node-pty');
  return T.pty;
}

function findOnPath(env, names) {
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH');
  for (const dir of String(env[key] || '').split(IS_WIN ? ';' : ':')) {
    for (const n of names) if (dir && fs.existsSync(path.join(dir, n))) return path.join(dir, n);
  }
  return null;
}

function shellFor(env) {
  if (IS_WIN) {
    const pwsh = findOnPath(env, ['pwsh.exe']);
    return { file: pwsh || 'powershell.exe', args: ['-NoLogo'] };
  }
  return { file: process.env.SHELL || '/bin/zsh', args: ['-l'] };
}

function send(channel, ...args) {
  const wc = T.view?.webContents;
  if (wc && !wc.isDestroyed()) wc.send(channel, ...args);
}

function start() {
  if (T.proc) return T.proc;
  const env = {
    ...baseEnv(),
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'TicketForge',
  };
  const { file, args } = shellFor(env);
  const proc = loadPty().spawn(file, args, {
    name: 'xterm-256color',
    cols: T.cols,
    rows: T.rows,
    cwd: os.homedir(),
    env,
    useConpty: true,
  });
  proc.onData((d) => send('term:data', d));
  proc.onExit(({ exitCode }) => {
    if (T.proc === proc) T.proc = null;
    send('term:exit', exitCode);
  });
  T.proc = proc;
  return proc;
}

/** Types a command into the shell and presses Enter (clearing anything half-typed first). */
function run(command) {
  const proc = start();
  proc.write(IS_WIN ? '\x1b' : '\x15'); // Esc (PowerShell) / Ctrl+U (zsh, bash): clear the line
  proc.write(command + '\r');
}

function restart() {
  stop();
  send('term:clear');
  start();
}

function stop() {
  const proc = T.proc;
  T.proc = null;
  try {
    proc?.kill();
  } catch {
    /* already gone */
  }
}

const fromPanel = (e) => e.sender === T.view?.webContents;

/**
 * Connects the terminal to its view. `onAction(name, arg)` gets the panel's buttons: install,
 * login, check, hide, expand.
 */
function initTerminal(view, onAction) {
  T.view = view;
  T.onAction = onAction;
  if (T.registered) return; // a new window reuses the handlers
  T.registered = true;
  ipcMain.handle('term:start', (e, size) => {
    if (!fromPanel(e)) return null;
    if (size?.cols && size?.rows) Object.assign(T, { cols: size.cols, rows: size.rows });
    start();
    return { platform: process.platform };
  });
  ipcMain.on('term:input', (e, data) => fromPanel(e) && start().write(String(data)));
  ipcMain.on('term:resize', (e, size) => {
    if (!fromPanel(e) || !(size?.cols > 0 && size?.rows > 0)) return;
    Object.assign(T, { cols: size.cols, rows: size.rows });
    try {
      T.proc?.resize(size.cols, size.rows);
    } catch {
      /* exited meanwhile */
    }
  });
  ipcMain.on('term:restart', (e) => fromPanel(e) && restart());
  ipcMain.on('term:copy', (e, text) => fromPanel(e) && clipboard.writeText(String(text || '')));
  ipcMain.handle('term:paste', (e) => (fromPanel(e) ? clipboard.readText() : ''));
  ipcMain.on('term:open', (e, url) => {
    if (fromPanel(e) && /^https?:\/\//i.test(String(url))) shell.openExternal(String(url));
  });
  ipcMain.on('panel:action', (e, name, arg) => fromPanel(e) && T.onAction(String(name), arg));
}

module.exports = { initTerminal, run, restart, stop, send };
