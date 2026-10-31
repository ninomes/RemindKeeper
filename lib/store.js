'use strict';
/**
 * 数据层：所有日程与设置都落在 userData/data.json。
 * 原子写入 + 防抖，避免频繁弹窗时反复刷盘。
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  theme: 'dark',            // dark | light
  defaultStart: '06:00',
  defaultEnd: '10:00',
  defaultInterval: 20,
  defaultRepeat: 'daily',
  defaultColor: 0,
  sound: true,
  autoLaunch: false,
  popupTimeout: 45,         // 弹窗自动收起秒数，0 = 一直停留
  snoozeMin: 20             // "稍后"按钮的分钟数
};

let DATA_DIR = '';
let DATA_FILE = '';
let state = null;
let saveTimer = null;
let listeners = [];

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function defaults() {
  return { version: 1, schedules: [], settings: Object.assign({}, DEFAULT_SETTINGS) };
}

function normalize(raw) {
  const s = defaults();
  if (!raw || typeof raw !== 'object') return s;
  if (Array.isArray(raw.schedules)) s.schedules = raw.schedules;
  if (raw.settings && typeof raw.settings === 'object') {
    s.settings = Object.assign({}, DEFAULT_SETTINGS, raw.settings);
  }
  return s;
}

function init(dir) {
  DATA_DIR = dir;
  DATA_FILE = path.join(dir, 'data.json');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  let raw = null;
  try {
    if (fs.existsSync(DATA_FILE)) raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    // 备份坏文件，不要让用户数据凭空消失
    try { fs.copyFileSync(DATA_FILE, DATA_FILE + '.broken-' + Date.now()); } catch (_) {}
  }
  state = normalize(raw);
  return state;
}

function get() { return state; }

function saveNow() {
  const tmp = DATA_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) {
    // 忽略瞬时写入失败，下次 tick 会重试
  }
}

function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, 300);
}

function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  saveNow();
}

/* ---------------- 日程 CRUD ---------------- */

function makeSchedule(input) {
  const now = Date.now();
  const st = state.settings;
  const s = {
    id: uid(),
    title: (input.title || '').trim() || '未命名日程',
    note: (input.note || '').trim(),
    startDate: input.startDate || new Date().toISOString().slice(0, 10),
    endDate: input.endDate || '',           // 一次性任务可留空
    startTime: input.startTime || st.defaultStart,
    endTime: input.endTime || st.defaultEnd,
    intervalMin: Number(input.intervalMin) > 0 ? Number(input.intervalMin) : st.defaultInterval,
    repeat: input.repeat || 'none',
    weekdays: Array.isArray(input.weekdays) ? input.weekdays.slice() : [1, 2, 3, 4, 5],
    color: Number.isInteger(input.color) ? input.color : 0,
    enabled: input.enabled !== false,
    done: {},
    lastFire: {},
    createdAt: now,
    updatedAt: now
  };
  return s;
}

function upsertSchedule(input) {
  if (input && input.id) {
    const idx = state.schedules.findIndex((s) => s.id === input.id);
    if (idx >= 0) {
      const old = state.schedules[idx];
      const next = Object.assign({}, old, {
        title: (input.title || old.title || '').trim() || '未命名日程',
        note: input.note === undefined ? old.note : String(input.note || '').trim(),
        startDate: input.startDate || old.startDate,
        endDate: input.endDate === undefined ? old.endDate : input.endDate,
        startTime: input.startTime || old.startTime,
        endTime: input.endTime || old.endTime,
        intervalMin: Number(input.intervalMin) > 0 ? Number(input.intervalMin) : old.intervalMin,
        repeat: input.repeat || old.repeat,
        weekdays: Array.isArray(input.weekdays) ? input.weekdays.slice() : old.weekdays,
        color: Number.isInteger(input.color) ? input.color : old.color,
        enabled: input.enabled === undefined ? old.enabled : !!input.enabled,
        done: old.done || {},
        lastFire: old.lastFire || {},
        updatedAt: Date.now()
      });
      // 时间规则变了就清掉今天的触发记录，让新一轮立刻生效
      const ruleChanged = next.startTime !== old.startTime || next.endTime !== old.endTime ||
        next.intervalMin !== old.intervalMin || next.startDate !== old.startDate ||
        next.repeat !== old.repeat;
      if (ruleChanged) next.lastFire = {};
      state.schedules[idx] = next;
      saveSoon();
      emit('schedules');
      return next;
    }
  }
  const s = makeSchedule(input || {});
  state.schedules.unshift(s);
  saveSoon();
  emit('schedules');
  return s;
}

function deleteSchedule(id) {
  const before = state.schedules.length;
  state.schedules = state.schedules.filter((s) => s.id !== id);
  if (state.schedules.length !== before) {
    saveSoon();
    emit('schedules');
    return true;
  }
  return false;
}

/** 标记某个日期实例为已完成 / 取消完成 */
function setDone(id, dateKey, done) {
  const s = state.schedules.find((x) => x.id === id);
  if (!s) return null;
  s.done = s.done || {};
  if (done) s.done[dateKey] = Date.now();
  else delete s.done[dateKey];
  s.updatedAt = Date.now();
  saveSoon();
  emit('schedules');
  return s;
}

function setEnabled(id, enabled) {
  const s = state.schedules.find((x) => x.id === id);
  if (!s) return null;
  s.enabled = !!enabled;
  s.updatedAt = Date.now();
  saveSoon();
  emit('schedules');
  return s;
}

function touchLastFire(id, baseDate, slotTs) {
  const s = state.schedules.find((x) => x.id === id);
  if (!s) return;
  s.lastFire = s.lastFire || {};
  s.lastFire[baseDate] = slotTs;
  saveSoon();
}

/** 稍后提醒：这一天的下一次提醒推迟到 N 分钟后（精确计时，不跟着时间点走） */
function snooze(id, baseDate, minutes) {
  const s = state.schedules.find((x) => x.id === id);
  if (!s) return;
  s.snoozeUntil = s.snoozeUntil || {};
  s.snoozeUntil[baseDate] = Date.now() + Math.max(1, minutes) * 60000;
  s.updatedAt = Date.now();
  saveSoon();
  emit('schedules');
}

function updateSettings(patch) {
  state.settings = Object.assign({}, state.settings, patch || {});
  saveSoon();
  emit('settings');
  return state.settings;
}

/* ---------------- 事件 ---------------- */

function on(fn) { listeners.push(fn); }
function emit(type) { listeners.forEach((fn) => { try { fn(type); } catch (_) {} }); }

/* ---------------- 清理 ---------------- */

/** 删除 60 天前的完成记录，防止 json 无限膨胀 */
function prune() {
  const cutoff = new Date(Date.now() - 60 * 86400000);
  const p = (n) => String(n).padStart(2, '0');
  const cutoffKey = cutoff.getFullYear() + '-' + p(cutoff.getMonth() + 1) + '-' + p(cutoff.getDate());
  let changed = false;
  for (const s of state.schedules) {
    for (const k of Object.keys(s.done || {})) {
      if (k < cutoffKey) { delete s.done[k]; changed = true; }
    }
    for (const k of Object.keys(s.lastFire || {})) {
      if (k < cutoffKey) { delete s.lastFire[k]; changed = true; }
    }
    for (const k of Object.keys(s.snoozeUntil || {})) {
      if (k < cutoffKey || s.snoozeUntil[k] < Date.now() - 86400000) {
        delete s.snoozeUntil[k]; changed = true;
      }
    }
  }
  if (changed) saveSoon();
}

module.exports = {
  init, get, saveNow, saveSoon, flush, defaults,
  uid, makeSchedule, upsertSchedule, deleteSchedule, setDone, setEnabled,
  touchLastFire, snooze, updateSettings, on, prune,
  DEFAULT_SETTINGS
};
