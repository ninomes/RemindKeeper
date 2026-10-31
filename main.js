'use strict';
/**
 * RemindKeeper 主进程
 * 常驻托盘 / 右下角弹窗 / 单实例 / 开机自启
 */
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage, dialog, screen } = require('electron');

const store = require('./lib/store');
const scheduler = require('./lib/scheduler');
const popup = require('./lib/popup');

const ROOT = __dirname;
const ASSETS = path.join(ROOT, 'assets');
const HIDDEN_START = process.argv.includes('--hidden');

let mainWindow = null;
let tray = null;
let quitting = false;
let trayTip = '日程提醒';
let firstHideTipShown = false;

/* ---------------- 单实例 ---------------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });
}

/* ---------------- 图标 ---------------- */
function loadIcon(name) {
  const p = path.join(ASSETS, name);
  try {
    if (fs.existsSync(p)) return nativeImage.createFromPath(p);
  } catch (_) {}
  return nativeImage.createEmpty();
}

/* ---------------- 主窗口 ---------------- */
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: '#0a0c13',
    icon: loadIcon('icon.png'),
    title: '日程提醒',
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  mainWindow.loadFile(path.join(ROOT, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (!HIDDEN_START) mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    mainWindow.hide();
    if (!firstHideTipShown) {
      firstHideTipShown = true;
      notifyTrayHint();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    mainWindow.once('ready-to-show', () => mainWindow.show());
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function notifyTrayHint() {
  if (!tray) return;
  try {
    tray.displayBalloon({
      iconType: 'info',
      title: '日程提醒还在运行',
      content: '窗口已收进右下角托盘，到点仍会弹窗提醒。'
    });
  } catch (_) {}
}

/* ---------------- 数据变更广播 ---------------- */
function broadcast() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send('data:changed'); } catch (_) {}
  }
  updateTray();
}

/* ---------------- 托盘 ---------------- */
function buildTrayMenu() {
  const snap = scheduler.snapshot();
  const today = snap.today;
  const todays = snap.schedules.filter((s) => {
    const st = s.status || {};
    return ['active', 'idle', 'done', 'missed'].includes(st.state) &&
      (st.baseDate === today || (st.startAt && scheduler.dateKey(new Date(st.startAt)) === today));
  });

  const items = todays.slice(0, 8).map((s) => {
    const st = s.status;
    const mark = st.state === 'done' ? '✓ ' : st.state === 'active' ? '● ' : st.state === 'missed' ? '! ' : '○ ';
    return {
      label: mark + s.title + '  ' + s.startTime + '-' + s.endTime,
      click: () => {
        showMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('focus:schedule', s.id);
        }
      }
    };
  });

  if (items.length === 0) items.push({ label: '今天没有日程', enabled: false });

  const settings = store.get().settings;

  return Menu.buildFromTemplate([
    { label: '打开主界面', click: showMainWindow },
    { type: 'separator' },
    ...items,
    { type: 'separator' },
    {
      label: settings.paused ? '继续提醒' : '暂停提醒',
      type: 'checkbox',
      checked: !!settings.paused,
      click: (mi) => {
        store.updateSettings({ paused: mi.checked });
        broadcast();
      }
    },
    {
      label: '开机自动启动',
      type: 'checkbox',
      checked: !!settings.autoLaunch,
      click: (mi) => {
        applyAutoLaunch(mi.checked);
        store.updateSettings({ autoLaunch: mi.checked });
        broadcast();
      }
    },
    { label: '打个测试弹窗', click: () => fireTestPopup() },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        quitting = true;
        popup.closeAll();
        try { store.flush(); } catch (_) {}
        app.quit();
      }
    }
  ]);
}

function refreshTrayMenu() {
  if (!tray) return;
  try { tray.setContextMenu(buildTrayMenu()); } catch (_) {}
}

function updateTray() {
  if (!tray) return;
  try {
    const snap = scheduler.snapshot();
    const active = snap.schedules.filter((s) => s.status && s.status.state === 'active');
    const pending = snap.schedules.filter((s) => s.status && s.status.state === 'idle' && s.status.baseDate === snap.today);
    const tip = active.length
      ? '进行中 ' + active.length + ' 项 · ' + active[0].title
      : pending.length
        ? '今天还有 ' + pending.length + ' 项待开始'
        : '日程提醒 · 一切正常';
    tray.setToolTip(tip);
    refreshTrayMenu();
  } catch (_) {}
}

function createTray() {
  const img = loadIcon('tray.png');
  tray = new Tray(img.isEmpty() ? loadIcon('icon.png') : img);
  tray.setToolTip('日程提醒');
  tray.on('click', () => showMainWindow());
  tray.on('double-click', () => showMainWindow());
  updateTray();
}

/* ---------------- 开机自启 ---------------- */
function applyAutoLaunch(enabled) {
  if (!app.isPackaged) return; // 开发模式不写注册表
  try {
    app.setLoginItemSettings({
      openAtLogin: !!enabled,
      openAsHidden: true,
      path: process.execPath,
      args: ['--hidden']
    });
  } catch (_) {}
}

/* ---------------- 提醒触发 ---------------- */
function handleFire(payload) {
  const st = store.get().settings;
  popup.show(Object.assign({}, payload, {
    theme: st.theme,
    sound: st.sound !== false,
    snoozeMin: st.snoozeMin || 20
  }), { timeout: st.popupTimeout });
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send('reminder:fired', payload); } catch (_) {}
  }
  updateTray();
}

function fireTestPopup() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const st = store.get().settings;
  popup.show({
    id: '__test__',
    title: '这是一条测试提醒',
    note: '点「完成」或「稍后」试试效果',
    color: 0,
    baseDate: scheduler.dateKey(now),
    dueAt: now.getTime(),
    endAt: now.getTime() + 3600000,
    startAt: now.getTime(),
    intervalMin: 20,
    index: 1,
    total: 12,
    timeLabel: hh + ':' + mm,
    isTest: true,
    theme: st.theme,
    sound: st.sound !== false,
    snoozeMin: st.snoozeMin || 20
  }, { timeout: st.popupTimeout });
}

/* ---------------- IPC ---------------- */
function registerIpc() {
  ipcMain.handle('app:snapshot', () => scheduler.snapshot());

  ipcMain.handle('app:saveSchedule', (_e, data) => {
    const s = store.upsertSchedule(data || {});
    broadcast();
    return s;
  });

  ipcMain.handle('app:deleteSchedule', (_e, id) => {
    const ok = store.deleteSchedule(id);
    popup.close(id);
    broadcast();
    return ok;
  });

  ipcMain.handle('app:setDone', (_e, { id, date, done }) => {
    const s = store.setDone(id, date, done);
    if (done) popup.close(id);
    broadcast();
    return s;
  });

  ipcMain.handle('app:setEnabled', (_e, { id, enabled }) => {
    const s = store.setEnabled(id, enabled);
    if (!enabled) popup.close(id);
    broadcast();
    return s;
  });

  ipcMain.handle('app:saveSettings', (_e, patch) => {
    const s = store.updateSettings(patch || {});
    if (patch && patch.autoLaunch !== undefined) applyAutoLaunch(patch.autoLaunch);
    broadcast();
    return s;
  });

  ipcMain.handle('app:testPopup', () => { fireTestPopup(); return true; });

  ipcMain.handle('app:openDataFolder', () => {
    try { shell.openPath(app.getPath('userData')); } catch (_) {}
    return true;
  });

  ipcMain.handle('app:quit', () => {
    quitting = true;
    popup.closeAll();
    store.flush();
    app.quit();
  });

  ipcMain.handle('app:todayCount', () => {
    const snap = scheduler.snapshot();
    return snap.schedules.filter((s) => s.status && s.status.baseDate === snap.today).length;
  });

  /* 弹窗动作 */
  ipcMain.handle('popup:complete', (_e, { id, date }) => {
    if (id === '__test__') { popup.close(id); return true; }
    store.setDone(id, date, true);
    popup.close(id);
    broadcast();
    return true;
  });

  ipcMain.handle('popup:snooze', (_e, { id, date, minutes }) => {
    if (id === '__test__') { popup.close(id); return true; }
    store.snooze(id, date, minutes || store.get().settings.snoozeMin || 20);
    popup.close(id);
    broadcast();
    return true;
  });

  ipcMain.handle('popup:open', (_e, { id }) => {
    showMainWindow();
    popup.close(id);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('focus:schedule', id);
    }
    return true;
  });

  ipcMain.handle('popup:dismiss', (_e, { id }) => {
    popup.close(id);
    return true;
  });

  ipcMain.handle('popup:get', (_e, id) => {
    const snap = scheduler.snapshot();
    const s = snap.schedules.find((x) => x.id === id);
    return s || null;
  });

  /* 窗口控制 */
  ipcMain.on('win:minimize', () => { if (mainWindow) mainWindow.minimize(); });
  ipcMain.on('win:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('win:hide', () => { if (mainWindow) mainWindow.hide(); });
  ipcMain.on('win:isMax', (e) => {
    e.returnValue = mainWindow ? mainWindow.isMaximized() : false;
  });
}

/* ---------------- 生命周期 ---------------- */
app.whenReady().then(() => {
  app.setAppUserModelId('com.remindkeeper.app');
  store.init(app.getPath('userData'));

  // 首次启动：如果一条日程都没有，给一条示例（默认 6-10 点每 20 分钟）
  const st = store.get();
  if (st.schedules.length === 0 && !st.seedDone) {
    const today = scheduler.dateKey(new Date());
    const tomorrow = scheduler.shiftDate(today, 1);
    store.upsertSchedule({
      title: '给某某某打电话',
      note: '示例日程：时间区间内每 20 分钟提醒一次，点「完成」才会停。',
      startDate: tomorrow,
      startTime: '06:00',
      endTime: '10:00',
      intervalMin: 20,
      repeat: 'none',
      color: 0
    });
    st.seedDone = true;
    store.saveNow();
  }

  popup.setPreload(path.join(ROOT, 'preload-popup.js'));
  registerIpc();
  createMainWindow();
  createTray();

  scheduler.start(handleFire);

  if (st.settings.autoLaunch) applyAutoLaunch(true);

  app.on('activate', () => showMainWindow());

  // 每 10 分钟收拾一次过期记录
  setInterval(() => {
    try { store.prune(); } catch (_) {}
    updateTray();
  }, 10 * 60 * 1000);

  store.on(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try { mainWindow.webContents.send('data:changed'); } catch (_) {}
    }
    updateTray();
  });
});

app.on('window-all-closed', () => {
  // 托盘常驻，不退出（不调用 app.quit 即为保留）
});

app.on('before-quit', () => {
  quitting = true;
  try { store.flush(); } catch (_) {}
});

app.on('will-quit', () => {
  try { popup.closeAll(); } catch (_) {}
});

process.on('uncaughtException', (e) => {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'error.log'),
      '[' + new Date().toISOString() + '] ' + (e.stack || e.message) + '\n');
  } catch (_) {}
});

/* ---------------- 自检模式（仅开发用） ---------------- */
if (process.argv.includes('--selftest') || process.env.RK_SELFTEST === '1') {
  app.whenReady().then(() => {
    const out = path.join(app.getPath('userData'), 'selftest.txt');
    const shotPath = path.join(app.getPath('userData'), 'selftest-main.png');
    const shotPopup = path.join(app.getPath('userData'), 'selftest-popup.png');
    const lines = [];
    const rec = (s) => lines.push(s);

    setTimeout(() => {
      fireTestPopup();
      setTimeout(async () => {
        rec('workArea=' + JSON.stringify(screen.getPrimaryDisplay().workArea));
        rec('popup.count=' + popup.count());
        BrowserWindow.getAllWindows().forEach((w) => {
          rec('window title="' + w.getTitle() + '" bounds=' + JSON.stringify(w.getBounds()) +
            ' visible=' + w.isVisible() + ' alwaysOnTop=' + w.isAlwaysOnTop());
        });
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            const img = await mainWindow.capturePage();
            fs.writeFileSync(shotPath, img.toPNG());
            rec('main shot ok ' + JSON.stringify(img.getSize()));
          }
          for (const w of BrowserWindow.getAllWindows()) {
            if (w.getTitle() === '提醒' && !w.isDestroyed()) {
              const img2 = await w.capturePage();
              fs.writeFileSync(shotPopup, img2.toPNG());
              rec('popup shot ok ' + JSON.stringify(img2.getSize()));
            }
          }
        } catch (e) {
          rec('shot error ' + (e && e.message));
        }
        fs.writeFileSync(out, lines.join('\n'), 'utf8');
        app.quit();
      }, 2400);
    }, 2600);
  });
}
