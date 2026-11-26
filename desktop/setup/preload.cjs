// Bridge for the database setup page: three calls, nothing else.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tfdb', {
  current: () => ipcRenderer.invoke('db:current'),
  test: (url) => ipcRenderer.invoke('db:test', url),
  connect: (url) => ipcRenderer.invoke('db:connect', url),
  useLocal: () => ipcRenderer.invoke('db:local'),
  open: (url) => ipcRenderer.send('db:open', url),
});
