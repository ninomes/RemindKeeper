'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  /* 数据 */
  snapshot: () => ipcRenderer.invoke('app:snapshot'),
  saveSchedule: (data) => ipcRenderer.invoke('app:saveSchedule', data),
  deleteSchedule: (id) => ipcRenderer.invoke('app:deleteSchedule', id),
  setDone: (id, date, done) => ipcRenderer.invoke('app:setDone', { id, date, done }),
  setEnabled: (id, enabled) => ipcRenderer.invoke('app:setEnabled', { id, enabled }),
  saveSettings: (patch) => ipcRenderer.invoke('app:saveSettings', patch),
  testPopup: () => ipcRenderer.invoke('app:testPopup'),
  openDataFolder: () => ipcRenderer.invoke('app:openDataFolder'),
  quit: () => ipcRenderer.invoke('app:quit'),

  /* 事件 */
  onDataChanged: (cb) => ipcRenderer.on('data:changed', () => cb()),
  onFocusSchedule: (cb) => ipcRenderer.on('focus:schedule', (_e, id) => cb(id)),
  onReminderFired: (cb) => ipcRenderer.on('reminder:fired', (_e, p) => cb(p)),

  /* 窗口 */
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    maximize: () => ipcRenderer.send('win:maximize'),
    hide: () => ipcRenderer.send('win:hide'),
    isMaximized: () => ipcRenderer.sendSync('win:isMax')
  },

  platform: process.platform
});
