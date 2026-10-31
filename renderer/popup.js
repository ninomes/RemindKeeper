'use strict';

const api = window.popupApi;
const el = {
  card: document.getElementById('card'),
  accent: document.getElementById('accent'),
  meta: document.getElementById('metaText'),
  title: document.getElementById('title'),
  sub: document.getElementById('sub'),
  badge: document.getElementById('badge'),
  dot: document.getElementById('dot'),
  done: document.getElementById('btnDone'),
  snooze: document.getElementById('btnSnooze'),
  open: document.getElementById('btnOpen')
};

const ACCENTS = [
  ['#7c5cff', '#5b8cff'],  // 0 靛紫
  ['#3b82f6', '#22d3ee'],  // 1 蓝
  ['#06b6d4', '#14b8a6'],  // 2 青
  ['#10b981', '#84cc16'],  // 3 绿
  ['#f59e0b', '#f97316'],  // 4 琥珀
  ['#ef4444', '#f43f5e'],  // 5 红
  ['#ec4899', '#a855f7']   // 6 粉
];

let payload = null;
let entered = false;

function pad(n) { return String(n).padStart(2, '0'); }

function hhmm(ts) {
  const d = new Date(ts);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
}

function render(p) {
  payload = p;
  applyTheme(p.theme);

  const c = ACCENTS[(p.color || 0) % ACCENTS.length];
  el.accent.style.background = 'linear-gradient(180deg,' + c[0] + ',' + c[1] + ')';
  el.dot.style.background = c[0];
  el.dot.style.animation = 'none';
  void el.dot.offsetWidth;
  el.dot.style.animation = '';
  el.done.style.background = 'linear-gradient(135deg,' + c[0] + ',' + c[1] + ')';
  el.done.style.boxShadow = '0 5px 14px -6px ' + c[0];

  const time = p.dueAt ? hhmm(p.dueAt) : '';
  const idx = p.index || 1;
  const total = p.total || 1;
  el.meta.textContent = time + ' · 第 ' + idx + ' / ' + total + ' 次提醒';

  el.title.textContent = p.title || '日程提醒';
  el.title.title = p.title || '';

  const parts = [];
  if (p.startAt && p.endAt) parts.push(hhmm(p.startAt) + ' - ' + hhmm(p.endAt));
  if (p.intervalMin) parts.push('每 ' + p.intervalMin + ' 分钟');
  if (p.note) parts.push(p.note);
  el.sub.textContent = parts.join(' · ');

  const remain = p.endAt ? Math.max(0, p.endAt - Date.now()) : 0;
  const m = Math.round(remain / 60000);
  let badgeText = p.isTest ? '测试' : '区间已结束';
  if (!p.isTest && m > 0) {
    if (m >= 60) {
      const h = Math.floor(m / 60);
      const r = m % 60;
      badgeText = '还剩 ' + h + ' 小时' + (r ? ' ' + r + ' 分' : '');
    } else {
      badgeText = '还剩 ' + m + ' 分钟';
    }
  }
  el.badge.textContent = badgeText;

  el.snooze.textContent = '稍后 ' + (p.snoozeMin || 20) + ' 分';
}

function playChime() {
  if (payload && payload.sound === false) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const t0 = ctx.currentTime + 0.02;
    const notes = [
      [880.0, 0.0, 0.16],
      [1174.66, 0.13, 0.20]
    ];
    for (const [freq, delay, peak] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t0 + delay);
      gain.gain.setValueAtTime(0.0001, t0 + delay);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + delay + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + 0.75);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0 + delay);
      osc.stop(t0 + delay + 0.8);
    }
    setTimeout(() => { try { ctx.close(); } catch (_) {} }, 1500);
  } catch (_) {}
}

function enter() {
  requestAnimationFrame(() => {
    el.card.classList.remove('leave');
    el.card.classList.add('enter');
  });
  if (!entered) {
    entered = true;
    setTimeout(playChime, 120);
  }
}

function leave() {
  el.card.classList.add('leave');
  el.card.classList.remove('enter');
}

/* 事件 */
api.onData((p) => {
  render(p);
  if (!entered) enter();
});

api.onEnter(() => enter());
api.onLeave(() => leave());

el.done.addEventListener('click', () => {
  if (!payload) return;
  el.done.disabled = true;
  api.complete(payload.baseDate);
});

el.snooze.addEventListener('click', () => {
  if (!payload) return;
  api.snooze(payload.baseDate, payload.snoozeMin || 20);
});

el.open.addEventListener('click', () => {
  if (!payload) return;
  api.openMain();
});

/* 双击卡片任意空白处 = 打开主界面 */
el.card.addEventListener('dblclick', (e) => {
  if (e.target.closest('button')) return;
  if (payload) api.openMain();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && payload) api.dismiss();
});
