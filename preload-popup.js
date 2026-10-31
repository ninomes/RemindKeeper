'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const params = new URLSearchParams(window.location.search);
const ID = params.get('id') || '';

contextBridge.exposeInMainWorld('popupApi', {
  id: ID,
  onData: (cb) => ipcRenderer.on('popup:data', (_e, payload) => cb(payload)),
  onEnter: (cb) => ipcRenderer.on('popup:enter', () => cb()),
  onLeave: (cb) => ipcRenderer.on('popup:leave', () => cb()),
  complete: (date) => ipcRenderer.invoke('popup:complete', { id: ID, date }),
  snooze: (date, minutes) => ipcRenderer.invoke('popup:snooze', { id: ID, date, minutes }),
  openMain: () => ipcRenderer.invoke('popup:open', { id: ID }),
  dismiss: () => ipcRenderer.invoke('popup:dismiss', { id: ID })
});
