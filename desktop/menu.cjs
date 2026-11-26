// The application menu.
'use strict';

const { Menu, shell } = require('electron');
const { APP_NAME } = require('./paths.cjs');

/**
 * `o`: { appView(), serverUrl(), restartServer, changeDatabase, toggleTerminal, setUpClaude, newShell,
 * paths }.
 */
function buildMenu(o) {
  const isMac = process.platform === 'darwin';
  const wc = () => o.appView()?.webContents;
  const history = () => wc()?.navigationHistory;
  const appItems = [
    { label: 'Open settings file', click: () => shell.openPath(o.paths.ENV_FILE) },
    { label: 'Open data folder', click: () => shell.openPath(o.paths.DATA_DIR) },
    { label: 'Show server log', click: () => shell.showItemInFolder(o.paths.LOG_FILE) },
    {
      label: 'Open in browser',
      click: () => o.serverUrl() && shell.openExternal(o.serverUrl() + '/projects'),
    },
    { type: 'separator' },
    { label: 'Change database…', click: () => o.changeDatabase() },
    { label: 'Restart server', click: () => o.restartServer() },
  ];
  const template = [
    ...(isMac
      ? [
          {
            label: APP_NAME,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              ...appItems,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : [{ label: 'File', submenu: [...appItems, { type: 'separator' }, { role: 'quit' }] }]),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => wc()?.reload() },
        {
          label: 'Developer tools',
          accelerator: 'Alt+CmdOrCtrl+I',
          click: () => wc()?.toggleDevTools(),
        },
        { type: 'separator' },
        { label: 'Actual size', accelerator: 'CmdOrCtrl+0', click: () => wc()?.setZoomLevel(0) },
        {
          label: 'Zoom in',
          accelerator: 'CmdOrCtrl+=',
          click: () => wc() && wc().setZoomLevel(wc().getZoomLevel() + 0.5),
        },
        {
          label: 'Zoom out',
          accelerator: 'CmdOrCtrl+-',
          click: () => wc() && wc().setZoomLevel(wc().getZoomLevel() - 0.5),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Go',
      submenu: [
        {
          label: 'Back',
          accelerator: isMac ? 'Cmd+[' : 'Alt+Left',
          click: () => history()?.canGoBack() && history().goBack(),
        },
        {
          label: 'Forward',
          accelerator: isMac ? 'Cmd+]' : 'Alt+Right',
          click: () => history()?.canGoForward() && history().goForward(),
        },
        { type: 'separator' },
        {
          label: 'Projects',
          click: () => o.serverUrl() && wc()?.loadURL(o.serverUrl() + '/projects'),
        },
      ],
    },
    {
      label: 'Terminal',
      submenu: [
        { label: 'Show or hide terminal', accelerator: 'Ctrl+`', click: () => o.toggleTerminal() },
        { label: 'New shell', click: () => o.newShell() },
        { type: 'separator' },
        { label: 'Set up Claude account…', click: () => o.setUpClaude() },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildMenu };
