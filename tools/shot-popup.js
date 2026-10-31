'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'preview');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function snap(win, name) {
  const img = await win.capturePage();
  fs.writeFileSync(path.join(OUT, name), img.toPNG());
  console.log('saved', name, img.getSize());
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const win = new BrowserWindow({
    width: 400,
    height: 180,
    show: true,
    frame: false,
    transparent: true,
    resizable: false,
    x: 60,
    y: 60,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload-popup-mock.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await win.loadFile(path.join(__dirname, '..', 'renderer', 'popup.html'));
  await wait(900);

  // 模拟一块桌面背景，方便看清圆角和阴影
  await win.webContents.executeJavaScript(`
    (() => {
      const s = document.createElement('style');
      s.textContent = 'html,body{background:#2b3350 !important}' +
        '*,*::before,*::after{transition:none !important;animation:none !important}';
      document.head.appendChild(s);
      document.getElementById('card').classList.add('enter');
    })()
  `);
  await wait(400);
  await snap(win, 'popup-dark.png');

  await win.webContents.executeJavaScript(`
    (() => {
      document.documentElement.setAttribute('data-theme','light');
      document.body.style.background = '#dfe4ef';
    })()
  `);
  await wait(400);
  await snap(win, 'popup-light.png');

  app.quit();
}).catch((e) => { console.error(e); app.quit(); });
