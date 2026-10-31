'use strict';
/* 仅用于截图预览的假数据，不参与打包运行 */
const { contextBridge } = require('electron');

const now = Date.now();
const DAY = 86400000;
const t = (h, m) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.getTime();
};
const today = (() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
})();

const schedules = [
  {
    id: 'a1', title: '给张总打电话', note: '确认合同细节', startDate: today, endDate: '',
    startTime: '12:00', endTime: '16:00', intervalMin: 20, repeat: 'daily', weekdays: [], color: 0,
    enabled: true, done: {}, lastFire: {},
    status: { state: 'active', startAt: t(12, 0), endAt: t(16, 0), nextAt: t(13, 20), index: 5, total: 13, doneAt: 0, baseDate: today }
  },
  {
    id: 'a2', title: '提交周报给李经理', note: '', startDate: today, endDate: '',
    startTime: '15:00', endTime: '18:00', intervalMin: 30, repeat: 'weekdays', weekdays: [1, 2, 3, 4, 5], color: 1,
    enabled: true, done: {}, lastFire: {},
    status: { state: 'idle', startAt: t(15, 0), endAt: t(18, 0), nextAt: t(15, 0), index: 0, total: 7, doneAt: 0, baseDate: today }
  },
  {
    id: 'a3', title: '吃降压药', note: '', startDate: today, endDate: '',
    startTime: '08:00', endTime: '09:00', intervalMin: 10, repeat: 'daily', weekdays: [], color: 3,
    enabled: true, done: { [today]: t(8, 12) }, lastFire: {},
    status: { state: 'done', startAt: t(8, 0), endAt: t(9, 0), nextAt: 0, index: 7, total: 7, doneAt: t(8, 12), baseDate: today }
  },
  {
    id: 'a4', title: '整理报销单据', note: '财务下午 5 点前收', startDate: today, endDate: '',
    startTime: '09:00', endTime: '10:00', intervalMin: 20, repeat: 'none', weekdays: [], color: 4,
    enabled: true, done: {}, lastFire: {},
    status: { state: 'missed', startAt: t(9, 0), endAt: t(10, 0), nextAt: 0, index: 4, total: 4, doneAt: 0, baseDate: today }
  },
  {
    id: 'a5', title: '锻炼 30 分钟', note: '', startDate: today, endDate: '',
    startTime: '19:30', endTime: '20:30', intervalMin: 15, repeat: 'custom', weekdays: [1, 3, 5], color: 5,
    enabled: true, done: {}, lastFire: {},
    status: { state: 'idle', startAt: t(19, 30), endAt: t(20, 30), nextAt: t(19, 30), index: 0, total: 5, doneAt: 0, baseDate: today }
  }
];

const snapshot = {
  today,
  now,
  settings: {
    theme: 'dark', defaultStart: '06:00', defaultEnd: '10:00', defaultInterval: 20,
    defaultRepeat: 'daily', defaultColor: 0, sound: true, autoLaunch: false,
    popupTimeout: 45, snoozeMin: 20
  },
  schedules
};

const noop = () => Promise.resolve(true);

contextBridge.exposeInMainWorld('api', {
  snapshot: () => Promise.resolve(JSON.parse(JSON.stringify(snapshot))),
  saveSchedule: noop,
  deleteSchedule: noop,
  setDone: noop,
  setEnabled: noop,
  saveSettings: noop,
  testPopup: noop,
  openDataFolder: noop,
  quit: noop,
  onDataChanged: () => {},
  onFocusSchedule: () => {},
  onReminderFired: () => {},
  win: { minimize: () => {}, maximize: () => {}, hide: () => {}, isMaximized: () => false },
  platform: 'win32'
});
