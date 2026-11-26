// TicketForge desktop app (Electron main process).
//
// It runs the same production server as `npm start` (desktop/server.cjs) on 127.0.0.1 and shows it
// in a window. Requests come from this computer, so TicketForge uses your own Claude subscription
// through Claude Code, and local folders and git work as they do on localhost.
//
// The window has two parts: the app, and a terminal panel docked at the bottom (Ctrl+`) that sets
// up Claude Code (install, sign in) and works as an ordinary terminal. See docs/guide/desktop-app.md.
'use strict';

const { APP_NAME, ENV_FILE, DATA_DIR, LOG_FILE } = require('./paths.cjs');
const { app, BaseWindow, WebContentsView, dialog, shell } = require('electron');
const path = require('node:path');
const { ensureEnvFile, readState, writeState } = require('./env.cjs');
const server = require('./server.cjs');
const terminal = require('./terminal.cjs');
const { claudeStatus, loginCommand, ready, INSTALL_COMMAND } = require('./claude.cjs');
const { loadingPage } = require('./loading.cjs');
const setup = require('./setup.cjs');
const database = require('./database.cjs');

const W = { win: null, appView: null, termView: null, panelOpen: false, expanded: false };
const C = { state: 'checking', status: null, poll: null, pollUntil: 0, checking: null };
let quitting = false;

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (!W.win) return createWindow();
    if (W.win.isMinimized()) W.win.restore();
    W.win.focus();
  });
  app.whenReady().then(start);
}

// ---------------------------------------------------------------------------------------------
// Window: the app on top, the terminal panel below

function layout() {
  if (!W.win) return;
  const [w, h] = W.win.getContentSize();
  const panelH = !W.panelOpen
    ? 0
    : Math.max(180, Math.min(h - 160, Math.round(h * (W.expanded ? 0.65 : 0.36))));
  W.appView.setBounds({ x: 0, y: 0, width: w, height: h - panelH });
  setup.placeSetup({ x: 0, y: 0, width: w, height: h - panelH });
  W.termView.setBounds({ x: 0, y: h - panelH, width: w, height: panelH });
  W.termView.setVisible(W.panelOpen);
}

function setPanel(open, { expanded = W.expanded } = {}) {
  W.panelOpen = open;
  W.expanded = expanded;
  layout();
  const wc = W.termView?.webContents;
  if (open) {
    wc?.send('panel:shown', { expanded: W.expanded });
    wc?.focus();
    sendClaude();
  } else {
    W.appView?.webContents.focus();
    checkClaude(); // signed in by hand meanwhile?
  }
}

const isAppUrl = (url) => {
  const base = server.serverUrl();
  return Boolean(base) && (url === base || url.startsWith(base + '/'));
};

function guardNavigation(wc) {
  // Links to other sites open in the default browser; the app's own pop-ups stay in the app.
  wc.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url))
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { width: 1200, height: 800, autoHideMenuBar: true },
      };
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event, url) => {
    if (isAppUrl(url) || url.startsWith('data:')) return;
    event.preventDefault();
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
  });
}

function createWindow() {
  const win = new BaseWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: APP_NAME,
    backgroundColor: '#f6f6f7',
    icon: path.join(__dirname, 'build', 'icon.png'),
  });
  const secure = { contextIsolation: true, sandbox: true, nodeIntegration: false };
  const appView = new WebContentsView({ webPreferences: { ...secure, spellcheck: true } });
  const termView = new WebContentsView({
    webPreferences: { ...secure, preload: path.join(__dirname, 'terminal', 'preload.cjs') },
  });
  termView.setBackgroundColor('#141414');
  win.contentView.addChildView(appView);
  win.contentView.addChildView(termView);
  Object.assign(W, { win, appView, termView });

  guardNavigation(appView.webContents);
  termView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  termView.webContents.on('will-navigate', (e) => e.preventDefault());
  termView.webContents.loadFile(path.join(__dirname, 'terminal', 'index.html'));
  terminal.initTerminal(termView, onPanelAction);

  win.on('resize', layout);
  win.on('closed', () => {
    terminal.stop();
    // Closed before a database was chosen: nothing to come back to.
    if (setup.isOpen()) {
      setup.cancelSetup();
      app.quit();
    }
    Object.assign(W, { win: null, appView: null, termView: null });
  });
  layout();
  win.setTitle(APP_NAME);
  const url = server.serverUrl();
  appView.webContents.loadURL(url ? url + '/projects' : loadingPage());
  appView.webContents.on('page-title-updated', (_e, title) => win.setTitle(title || APP_NAME));
  return win;
}

// ---------------------------------------------------------------------------------------------
// Claude Code: installed and signed in?

function sendClaude() {
  W.termView?.webContents.send('claude:status', {
    state: C.state,
    status: C.status,
    busy: Boolean(C.poll),
  });
}

function stopPolling() {
  clearInterval(C.poll);
  C.poll = null;
}

/** Checks Claude Code; when it has just become ready, restarts the server so it is used. */
function checkClaude() {
  C.checking ??= (async () => {
    try {
      const wasReady = ready(C.status);
      const known = C.status !== null;
      const s = await claudeStatus();
      C.status = s;
      C.state = !s.installed
        ? 'missing'
        : s.outdated
          ? 'outdated'
          : !s.loggedIn
            ? 'signed-out'
            : 'ready';
      if (ready(s)) stopPolling();
      if (ready(s) && known && !wasReady && server.isRunning()) {
        // The server looks for Claude Code once when it starts: start it again to pick it up.
        C.state = 'restarting';
        sendClaude();
        await restartServer();
        C.state = 'ready';
        terminal.send(
          'term:data',
          '\r\n\x1b[32m✓ TicketForge is now using your Claude account.\x1b[0m\r\n',
        );
      }
      sendClaude();
    } finally {
      C.checking = null;
    }
  })();
  return C.checking;
}

/** After Install or Sign in: check every few seconds until it is done (or 10 minutes pass). */
function pollClaude() {
  stopPolling();
  C.pollUntil = Date.now() + 10 * 60_000;
  C.poll = setInterval(() => {
    if (Date.now() > C.pollUntil) stopPolling();
    checkClaude();
  }, 3000);
  sendClaude();
}

function onPanelAction(name) {
  if (name === 'install') {
    terminal.run(INSTALL_COMMAND);
    pollClaude();
  } else if (name === 'login') {
    terminal.run(loginCommand(C.status));
    pollClaude();
  } else if (name === 'check') checkClaude();
  else if (name === 'hide') setPanel(false);
  else if (name === 'expand') setPanel(true, { expanded: !W.expanded });
}

/** Opens the terminal with the setup bar. */
function setUpClaude() {
  setPanel(true);
  checkClaude();
}

// ---------------------------------------------------------------------------------------------
// Server

async function bootServer() {
  try {
    const url = await server.startServer();
    if (!W.win) createWindow();
    else W.appView.webContents.loadURL(url + '/projects');
  } catch (e) {
    await server.stopServer();
    const choice = dialog.showMessageBoxSync({
      type: 'error',
      title: APP_NAME,
      message: `${APP_NAME} could not start.`,
      detail: `${e.message}\n\n${server.logTail()}`,
      buttons: ['Quit', 'Change database…', 'Open settings file', 'Show log'],
      defaultId: 0,
    });
    if (choice === 1 && W.win) {
      await setup.chooseDatabase(W.win);
      return bootServer();
    }
    if (choice === 2) shell.openPath(ENV_FILE);
    if (choice === 3) shell.showItemInFolder(LOG_FILE);
    app.quit();
  }
}

/** TicketForge → Change database…: choose again, then restart the server with it. */
async function changeDatabase() {
  if (!W.win) createWindow();
  await setup.chooseDatabase(W.win);
  await restartServer();
}

async function restartServer() {
  W.appView?.webContents.loadURL(loadingPage());
  await server.stopServer();
  await bootServer();
}

server.onCrash((log) => {
  if (quitting) return;
  dialog.showErrorBox(
    `${APP_NAME} stopped`,
    `The ${APP_NAME} server stopped unexpectedly. Choose ${APP_NAME} → Restart server to start it again.\n\n${log}`,
  );
});

// ---------------------------------------------------------------------------------------------
// Life cycle

async function start() {
  app.setAboutPanelOptions({ applicationName: APP_NAME, applicationVersion: app.getVersion() });
  ensureEnvFile();
  require('./menu.cjs').buildMenu({
    appView: () => W.appView,
    serverUrl: server.serverUrl,
    restartServer,
    changeDatabase,
    toggleTerminal: () => (W.win ? setPanel(!W.panelOpen) : createWindow()),
    setUpClaude,
    newShell: () => {
      setPanel(true);
      terminal.restart();
    },
    paths: { ENV_FILE, DATA_DIR, LOG_FILE },
  });
  createWindow();
  // First launch: which database? (a shared PostgreSQL server such as Railway, or this computer)
  if (database.needsDatabaseChoice()) await setup.chooseDatabase(W.win);
  await bootServer();
  await checkClaude();
  // First launch without a working Claude account: show the terminal with the setup bar once.
  if (!ready(C.status) && !readState().terminalIntroduced) {
    writeState({ terminalIntroduced: true });
    setPanel(true);
  }
}

app.on('activate', () => {
  if (!W.win && app.isReady()) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (quitting) return;
  quitting = true;
  stopPolling();
  terminal.stop();
  if (!server.isRunning()) return;
  event.preventDefault();
  server.stopServer().finally(() => app.quit());
});
