'use strict';
/**
 * 右下角提醒弹窗管理器
 * 每个日程一个独立的无边框窗口，多个提醒自动向上堆叠，
 * 关掉（完成 / 稍后）之后下面的自动落回原位。
 */
const path = require('path');
const { BrowserWindow, screen } = require('electron');

const W = 400;
const H = 180;
const GAP = 10;
const MARGIN = 12;

const windows = new Map(); // id -> { win, payload, hideTimer, ready }

let preloadPath = '';

function setPreload(p) { preloadPath = p; }

function workArea() {
  try {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor) || screen.getPrimaryDisplay();
    return display.workArea;
  } catch (_) {
    return screen.getPrimaryDisplay().workArea;
  }
}

function relayout() {
  const wa = workArea();
  const list = Array.from(windows.values()).filter((w) => w.win && !w.win.isDestroyed());
  let bottom = wa.y + wa.height - MARGIN;
  for (let i = list.length - 1; i >= 0; i--) {
    const w = list[i];
    const y = bottom - H;
    try {
      w.win.setBounds({ x: wa.x + wa.width - W - MARGIN, y, width: W, height: H });
    } catch (_) {}
    bottom = y - GAP;
  }
}

function attachActions(win, id) {
  win.webContents.on('did-finish-load', () => {
    const entry = windows.get(id);
    if (!entry) return;
    entry.ready = true;
    try { entry.win.webContents.send('popup:data', entry.payload); } catch (_) {}
  });
}

function create(id) {
  const win = new BrowserWindow({
    width: W,
    height: H,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'popup.html'), { query: { id } });
  attachActions(win, id);
  win.on('closed', () => {
    const e = windows.get(id);
    if (e && e.hideTimer) { clearTimeout(e.hideTimer); }
    windows.delete(id);
    relayout();
  });
  return win;
}

/** 弹出一个提醒（同日程若已存在则复用并刷新） */
function show(payload, opts) {
  const id = payload.id;
  const options = opts || {};
  let entry = windows.get(id);

  if (entry && !entry.win.isDestroyed()) {
    entry.payload = payload;
    if (entry.hideTimer) { clearTimeout(entry.hideTimer); entry.hideTimer = null; }
    if (entry.ready) {
      try { entry.win.webContents.send('popup:data', payload); } catch (_) {}
    }
    try {
      if (!entry.win.isVisible()) entry.win.showInactive();
      entry.win.setAlwaysOnTop(true, 'screen-saver');
    } catch (_) {}
    relayout();
    scheduleAutoHide(id, payload, options);
    return entry.win;
  }

  const win = create(id);
  entry = { win, payload, hideTimer: null, ready: false };
  windows.set(id, entry);
  relayout();

  win.once('ready-to-show', () => {
    try {
      win.showInactive();                 // 不抢焦点，打字不会被打断
      win.setAlwaysOnTop(true, 'screen-saver');
    } catch (_) {}
    // 让渲染端播放入场动画
    try { win.webContents.send('popup:enter'); } catch (_) {}
  });

  scheduleAutoHide(id, payload, options);
  return win;
}

function scheduleAutoHide(id, payload, options) {
  const entry = windows.get(id);
  if (!entry) return;
  if (entry.hideTimer) { clearTimeout(entry.hideTimer); entry.hideTimer = null; }
  const timeout = Number(options.timeout);
  if (!timeout || timeout <= 0) return;   // 0 = 常驻直到用户处理
  entry.hideTimer = setTimeout(() => {
    fadeOutAndClose(id);
  }, timeout * 1000);
}

function fadeOutAndClose(id) {
  const entry = windows.get(id);
  if (!entry || entry.win.isDestroyed()) return;
  try { entry.win.webContents.send('popup:leave'); } catch (_) {}
  setTimeout(() => {
    const e2 = windows.get(id);
    if (e2 && !e2.win.isDestroyed()) { try { e2.win.close(); } catch (_) {} }
  }, 260);
}

function close(id) {
  const entry = windows.get(id);
  if (!entry) return;
  if (entry.hideTimer) { clearTimeout(entry.hideTimer); entry.hideTimer = null; }
  try { if (!entry.win.isDestroyed()) entry.win.close(); } catch (_) {}
}

function closeAll() {
  Array.from(windows.keys()).forEach(close);
}

function has(id) { return windows.has(id); }
function count() { return windows.size; }

module.exports = { setPreload, show, close, closeAll, fadeOutAndClose, has, count, relayout };
