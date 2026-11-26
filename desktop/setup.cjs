// The database setup screen (desktop/setup/): shown over the app on first launch, or from
// TicketForge → Change database…. Resolves once a database is chosen and saved.
'use strict';

const { ipcMain, shell, WebContentsView } = require('electron');
const path = require('node:path');
const database = require('./database.cjs');

const S = { view: null, done: null, bounds: null, registered: false };
const fromSetup = (e) => e.sender === S.view?.webContents;

function finish() {
  const { view, done } = S;
  S.view = null;
  S.done = null;
  if (view) {
    view.removeFromParent?.();
    view.webContents.close();
  }
  done?.();
}

function register() {
  if (S.registered) return;
  S.registered = true;
  ipcMain.handle('db:current', (e) => (fromSetup(e) ? { label: database.describe() } : null));
  ipcMain.handle('db:test', (e, url) =>
    fromSetup(e) ? database.testConnection(String(url || '')) : null,
  );
  ipcMain.handle('db:connect', async (e, url) => {
    if (!fromSetup(e)) return null;
    const r = await database.testConnection(String(url || ''));
    if (r.ok) {
      database.useServer(String(url), r.ssl);
      setTimeout(finish, 900); // let the page show "Connected"
    }
    return r;
  });
  ipcMain.handle('db:local', (e) => {
    if (!fromSetup(e)) return null;
    database.useLocal();
    setTimeout(finish, 300);
    return { ok: true };
  });
  ipcMain.on('db:open', (e, url) => {
    if (fromSetup(e) && /^https:\/\//i.test(String(url))) shell.openExternal(String(url));
  });
}

/** Where the screen goes (the app's area of the window). */
function placeSetup(bounds) {
  S.bounds = bounds;
  S.view?.setBounds(bounds);
}

/** Shows the setup screen in `win` and resolves when a database has been chosen. */
function chooseDatabase(win) {
  register();
  if (S.view) return new Promise((resolve) => (S.done = chain(S.done, resolve)));
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'setup', 'preload.cjs'),
    },
  });
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  view.webContents.on('will-navigate', (e) => e.preventDefault());
  win.contentView.addChildView(view);
  S.view = view;
  if (S.bounds) view.setBounds(S.bounds);
  view.webContents.loadFile(path.join(__dirname, 'setup', 'index.html'));
  view.webContents.focus();
  return new Promise((resolve) => (S.done = resolve));
}

const chain = (a, b) => () => {
  a?.();
  b();
};

/** Closes the screen without a choice (the window is closing). */
function cancelSetup() {
  S.view = null;
  S.done = null;
}

module.exports = { chooseDatabase, placeSetup, cancelSetup, isOpen: () => Boolean(S.view) };
