'use strict';
/**
 * 离屏截图，用来肉眼检查 UI。
 * 用法：electron tools/shot.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'preview');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function snap(win, name) {
  const img = await win.capturePage();
  const p = path.join(OUT, name);
  fs.writeFileSync(p, img.toPNG());
  console.log('saved', p, img.getSize());
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    frame: false,
    backgroundColor: '#0a0c13',
    webPreferences: {
      preload: path.join(__dirname, 'preload-mock.js'),
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: false
    }
  });

  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await wait(1600);

  // 隐藏窗口里过渡动画不会推进，截图前先关掉，保证拍到的是最终状态
  await win.webContents.executeJavaScript(`
    (() => {
      const s = document.createElement('style');
      s.id = '__noanim';
      s.textContent = '*,*::before,*::after{transition:none !important;animation:none !important}';
      document.head.appendChild(s);
    })()
  `);
  await wait(300);

  await snap(win, 'main-dark.png');

  // 打开新建抽屉
  await win.webContents.executeJavaScript("document.getElementById('btnNew').click()");
  await wait(800);
  await snap(win, 'drawer.png');

  // 关闭抽屉，切到浅色
  await win.webContents.executeJavaScript("document.getElementById('drClose').click()");
  await wait(500);
  await win.webContents.executeJavaScript("document.documentElement.setAttribute('data-theme','light')");
  await wait(400);
  await snap(win, 'main-light.png');

  // 设置弹层
  await win.webContents.executeJavaScript("document.getElementById('btnSettings').click()");
  await wait(600);
  await snap(win, 'settings.png');

  app.quit();
}).catch((e) => {
  console.error(e);
  app.quit();
});
