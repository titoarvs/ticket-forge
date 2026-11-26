// Bridge between the terminal panel page and the main process. The page gets only these calls, not
// Node.js or Electron.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = [
  'term:data',
  'term:exit',
  'term:clear',
  'term:focus',
  'panel:shown',
  'claude:status',
];

contextBridge.exposeInMainWorld('tf', {
  platform: process.platform,
  start: (size) => ipcRenderer.invoke('term:start', size),
  input: (data) => ipcRenderer.send('term:input', data),
  resize: (size) => ipcRenderer.send('term:resize', size),
  restart: () => ipcRenderer.send('term:restart'),
  copy: (text) => ipcRenderer.send('term:copy', text),
  paste: () => ipcRenderer.invoke('term:paste'),
  open: (url) => ipcRenderer.send('term:open', url),
  action: (name, arg) => ipcRenderer.send('panel:action', name, arg),
  on: (event, fn) => {
    if (EVENTS.includes(event)) ipcRenderer.on(event, (_e, ...args) => fn(...args));
  },
});
