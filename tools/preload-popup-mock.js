'use strict';
/* 弹窗截图用的假 preload */
const { contextBridge } = require('electron');

const now = Date.now();
let dataCb = null;
let enterCb = null;

const payload = {
  id: 'a1',
  title: '给张总打电话',
  note: '确认合同细节',
  color: 0,
  baseDate: '2026-10-31',
  dueAt: now - 1000,
  startAt: now - 3600000,
  endAt: now + 10800000,
  intervalMin: 20,
  index: 5,
  total: 13,
  theme: 'dark',
  sound: true,
  snoozeMin: 20
};

contextBridge.exposeInMainWorld('popupApi', {
  id: 'a1',
  onData: (cb) => { dataCb = cb; },
  onEnter: (cb) => { enterCb = cb; },
  onLeave: () => {},
  complete: () => Promise.resolve(true),
  snooze: () => Promise.resolve(true),
  openMain: () => Promise.resolve(true),
  dismiss: () => Promise.resolve(true)
});

window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    if (dataCb) dataCb(payload);
    if (enterCb) enterCb();
  }, 300);
});

// 供截图脚本切换主题
window.__setTheme = (t) => {
  payload.theme = t;
  if (dataCb) dataCb(Object.assign({}, payload));
};
