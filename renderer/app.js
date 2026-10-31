'use strict';

const bridge = window.api;

const ACCENTS = [
  ['#7c5cff', '#5b8cff'],
  ['#3b82f6', '#22d3ee'],
  ['#06b6d4', '#14b8a6'],
  ['#10b981', '#84cc16'],
  ['#f59e0b', '#f97316'],
  ['#ef4444', '#f43f5e'],
  ['#ec4899', '#a855f7']
];

const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];

const S = {
  snap: null,
  view: 'today',
  editing: null,       // 正在编辑的日程 id，null = 新建
  form: {
    repeat: 'daily',
    weekdays: [1, 2, 3, 4, 5],
    interval: 20,
    color: 0
  }
};

/* ---------------- 工具 ---------------- */
const $ = (id) => document.getElementById(id);
const p2 = (n) => String(n).padStart(2, '0');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function hhmm(ts) {
  const d = new Date(ts);
  return p2(d.getHours()) + ':' + p2(d.getMinutes());
}

function fmtDay(ts) {
  const d = new Date(ts);
  return d.getMonth() + 1 + '月' + d.getDate() + '日';
}

function dayKeyOf(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
}

function fmtDateLong(ts) {
  const d = new Date(ts);
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 星期' + WEEK_CN[d.getDay()];
}

function relDay(dayKey, todayKey) {
  if (dayKey === todayKey) return '今天';
  const t = new Date(todayKey + 'T00:00:00');
  const d = new Date(dayKey + 'T00:00:00');
  const diff = Math.round((d - t) / 86400000);
  if (diff === 1) return '明天';
  if (diff === -1) return '昨天';
  if (diff > 1 && diff < 7) return diff + ' 天后';
  return (d.getMonth() + 1) + '/' + d.getDate();
}

function slotsOf(startTime, endTime, intervalMin) {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let s = sh * 60 + sm;
  let e = eh * 60 + em;
  if (e < s) e += 1440;
  if (e === s) return 1;
  const step = Math.max(1, intervalMin);
  return Math.floor((e - s) / step) + 1;
}

function repeatLabel(s) {
  if (s.repeat === 'none') return '仅一次';
  if (s.repeat === 'daily') return '每天';
  if (s.repeat === 'weekdays') return '每个工作日';
  if (s.repeat === 'custom') {
    const days = (s.weekdays || []).slice().sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b));
    if (days.length === 7) return '每天';
    if (!days.length) return '未选择日期';
    return '每' + days.map((d) => '周' + WEEK_CN[d]).join('、');
  }
  return '';
}

/* ---------------- 渲染 ---------------- */
function todayKey() {
  return S.snap ? S.snap.today : dayKeyOf(Date.now());
}

function todayBounds() {
  const [y, m, d] = todayKey().split('-').map(Number);
  const start = new Date(y, m - 1, d).getTime();
  return [start, start + 86400000];
}

function inToday(s) {
  const st = s.status || {};
  if (!st.startAt || !st.endAt) return false;
  const [a, b] = todayBounds();
  return st.endAt > a && st.startAt < b;
}

function listFor(view) {
  const all = (S.snap ? S.snap.schedules : []).slice();
  let arr;
  if (view === 'today') arr = all.filter(inToday);
  else if (view === 'done') arr = all.filter((s) => s.status && s.status.state === 'done');
  else arr = all;
  arr.sort((a, b) => {
    const sa = a.status && a.status.startAt ? a.status.startAt : 0;
    const sb = b.status && b.status.startAt ? b.status.startAt : 0;
    if (sa !== sb) return sa - sb;
    return a.startTime.localeCompare(b.startTime);
  });
  return arr;
}

const STATE_TEXT = {
  active: '进行中',
  idle: '待开始',
  done: '已完成',
  missed: '已错过',
  off: '已暂停'
};

function cardInfoHTML(s, state, total) {
  const st = s.status || {};
  if (state === 'active') {
    return '下次 <b>' + hhmm(st.nextAt) + '</b> · 第 ' + (st.index || 1) + '/' + total + ' 次';
  }
  if (state === 'idle') {
    return '将在 <b>' + hhmm(st.startAt) + '</b> 开始 · 共 ' + total + ' 次';
  }
  if (state === 'done') {
    return '<b style="color:#4ade80">' + hhmm(st.doneAt) + '</b> 已完成 · 共 ' + total + ' 次';
  }
  if (state === 'missed') {
    return '未完成 · 区间已于 ' + hhmm(st.endAt) + ' 结束';
  }
  return '已暂停，不会提醒';
}

function progressPct(s, state) {
  const st = s.status || {};
  if (state === 'done' || state === 'missed') return 100;
  if (state === 'active' && st.startAt && st.endAt && st.endAt > st.startAt) {
    return Math.min(100, Math.max(0, ((Date.now() - st.startAt) / (st.endAt - st.startAt)) * 100));
  }
  return 0;
}

function cardHTML(s) {
  const st = s.status || {};
  const c = ACCENTS[(s.color || 0) % ACCENTS.length];
  const state = s.enabled === false ? 'off' : (st.state || 'idle');
  const cls = ['card'];
  if (state === 'done') cls.push('is-done');

  const total = st.total || slotsOf(s.startTime, s.endTime, s.intervalMin);
  const width = progressPct(s, state);
  const info = cardInfoHTML(s, state, total);

  const dayTip = (s.repeat === 'none')
    ? relDay(s.startDate, todayKey())
    : '';

  return '' +
  '<article class="' + cls.join(' ') + '" data-id="' + s.id + '" data-state="' + state + '" style="--c1:' + c[0] + ';--c2:' + c[1] + '">' +
    '<div class="card-time">' +
      '<span class="t1">' + s.startTime + '</span>' +
      '<span class="tline"></span>' +
      '<span class="t2">' + s.endTime + '</span>' +
    '</div>' +
    '<div class="card-main">' +
      '<div class="card-top">' +
        '<h3>' + esc(s.title) + '</h3>' +
        '<span class="badge ' + state + '">' + (STATE_TEXT[state] || '') + '</span>' +
        (dayTip ? '<span class="badge idle">' + dayTip + '</span>' : '') +
      '</div>' +
      '<div class="card-sub">' + esc(repeatLabel(s)) + ' · 每 ' + s.intervalMin + ' 分钟提醒 · 共 ' + total + ' 次' +
        (s.note ? ' · ' + esc(s.note) : '') + '</div>' +
      '<div class="card-bar">' +
        '<div class="bar"><i style="width:' + width.toFixed(1) + '%"></i></div>' +
        '<span class="bar-info" data-k="' + esc(info) + '">' + info + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="card-ops">' +
      '<button class="op-done' + (state === 'done' ? ' undo' : '') + '" data-act="done">' +
        (state === 'done' ? '撤销' : '完成') + '</button>' +
      '<button class="op-more" data-act="more" title="更多">' +
        '<svg viewBox="0 0 18 18" width="15" height="15" fill="currentColor"><circle cx="4" cy="9" r="1.5"/><circle cx="9" cy="9" r="1.5"/><circle cx="14" cy="9" r="1.5"/></svg>' +
      '</button>' +
    '</div>' +
  '</article>';
}

function renderHeader() {
  const t = todayKey();
  const today = Date.now();
  if (S.view === 'today') {
    $('pageTitle').textContent = '今天';
    $('pageSub').textContent = fmtDateLong(today);
  } else if (S.view === 'all') {
    $('pageTitle').textContent = '全部日程';
    $('pageSub').textContent = '共 ' + S.snap.schedules.length + ' 个日程，按今天的进度显示';
  } else {
    $('pageTitle').textContent = '已完成';
    $('pageSub').textContent = '今天完成的事情';
  }
}

function renderStats() {
  const all = S.snap.schedules;
  const todays = all.filter(inToday);
  const active = todays.filter((s) => s.enabled !== false && s.status.state === 'active');
  const done = todays.filter((s) => s.status.state === 'done');
  const nexts = active
    .map((s) => s.status.nextAt)
    .filter((n) => n && n > Date.now())
    .sort((a, b) => a - b);

  const nextS = nexts.length
    ? todays.find((s) => s.status.nextAt === nexts[0])
    : null;

  $('stTotal').textContent = todays.length;
  $('stActive').textContent = active.length;
  $('stDone').textContent = done.length;
  $('stNext').textContent = nextS
    ? hhmm(nextS.status.nextAt) + ' · ' + nextS.title
    : (todays.length ? '今天已无提醒' : '暂无日程');

  $('cntToday').textContent = todays.length;
  $('cntAll').textContent = all.length;
  $('cntDone').textContent = done.length;
}

function renderList() {
  const items = listFor(S.view);
  const list = $('list');
  const empty = $('empty');

  if (!items.length) {
    list.innerHTML = '';
    empty.hidden = false;
    if (S.view === 'today') {
      $('emptyTitle').textContent = '今天还没有日程';
      $('emptyDesc').textContent = '新建一个，到点它会从右下角弹出来提醒你';
    } else if (S.view === 'all') {
      $('emptyTitle').textContent = '还没有任何日程';
      $('emptyDesc').textContent = '点右上角「新建日程」，时间区间内会循环提醒';
    } else {
      $('emptyTitle').textContent = '还没有完成的日程';
      $('emptyDesc').textContent = '进行中的日程点「完成」后会出现在这里';
    }
    return;
  }
  empty.hidden = true;
  list.innerHTML = items.map(cardHTML).join('');
}

function renderAll() {
  if (!S.snap) return;
  document.documentElement.setAttribute('data-theme', S.snap.settings.theme === 'light' ? 'light' : 'dark');
  renderHeader();
  renderStats();
  renderList();
  renderSettingsForm();
  S._sig = sigOf(S.snap);
}

function sigOf(snap) {
  return snap.schedules
    .map((s) => s.id + (s.enabled === false ? '0' : '1') + ((s.status && s.status.state) || ''))
    .join('|') + '#' + S.view;
}

async function refresh() {
  S.snap = await bridge.snapshot();
  S._sig = null;
  renderAll();
}

/** 轮询：数据结构没变就只做局部更新，避免卡片重新冒出来的动画 */
async function poll() {
  if (!S.snap) return;
  const snap = await bridge.snapshot();
  const sig = sigOf(snap);
  S.snap = snap;
  if (sig !== S._sig) {
    S._sig = sig;
    renderHeader();
    renderStats();
    renderList();
  } else {
    renderStats();
    updateCards();
  }
}

function updateCards() {
  const map = new Map(S.snap.schedules.map((s) => [s.id, s]));
  document.querySelectorAll('.card').forEach((card) => {
    const s = map.get(card.dataset.id);
    if (!s) return;
    const st = s.status || {};
    const state = s.enabled === false ? 'off' : (st.state || 'idle');

    if (card.dataset.state !== state) {
      card.dataset.state = state;
      const badge = card.querySelector('.badge');
      if (badge) { badge.className = 'badge ' + state; badge.textContent = STATE_TEXT[state] || ''; }
      card.classList.toggle('is-done', state === 'done');
      const btn = card.querySelector('.op-done');
      if (btn) {
        btn.textContent = state === 'done' ? '撤销' : '完成';
        btn.classList.toggle('undo', state === 'done');
      }
    }

    const total = st.total || slotsOf(s.startTime, s.endTime, s.intervalMin);
    const bar = card.querySelector('.bar i');
    if (bar) bar.style.width = progressPct(s, state).toFixed(1) + '%';

    const infoEl = card.querySelector('.bar-info');
    if (infoEl) {
      const html = cardInfoHTML(s, state, total);
      if (infoEl.dataset.k !== html) { infoEl.innerHTML = html; infoEl.dataset.k = html; }
    }
  });
}

/* 每秒：只更新时钟，其它交给 poll */
function tick() {
  const now = new Date();
  $('clock').textContent = p2(now.getHours()) + ':' + p2(now.getMinutes()) + ':' + p2(now.getSeconds());
}

/* ---------------- 视图切换 ---------------- */
$('nav').addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-item[data-view]');
  if (!btn) return;
  S.view = btn.dataset.view;
  document.querySelectorAll('.nav-item[data-view]').forEach((b) => b.classList.toggle('active', b === btn));
  renderHeader();
  renderList();
  S._sig = S.snap ? sigOf(S.snap) : null;
});

/* ---------------- 列表交互 ---------------- */
$('list').addEventListener('click', async (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  const act = e.target.closest('[data-act]');

  if (act && act.dataset.act === 'done') {
    const s = S.snap.schedules.find((x) => x.id === id);
    if (!s) return;
    const st = s.status || {};
    const base = st.baseDate || todayKey();
    const isDone = st.state === 'done';
    await bridge.setDone(id, base, !isDone);
    await refresh();
    return;
  }

  if (act && act.dataset.act === 'more') {
    const r = act.getBoundingClientRect();
    openContextMenu(id, r.left - 130, r.bottom + 6);
    return;
  }

  // 点卡片其它区域 = 编辑
  openDrawer(id);
});

/* ---------------- 右键菜单 ---------------- */
let ctxEl = null;
function closeCtx() {
  if (ctxEl) { ctxEl.remove(); ctxEl = null; }
}

function openContextMenu(id, x, y) {
  closeCtx();
  const s = S.snap.schedules.find((v) => v.id === id);
  if (!s) return;
  const st = s.status || {};
  const isDone = st.state === 'done';

  const el = document.createElement('div');
  el.className = 'ctx';
  el.innerHTML = '' +
    '<button data-c="edit">编辑日程</button>' +
    '<button data-c="toggleDone">' + (isDone ? '撤销完成' : '标记完成') + '</button>' +
    '<button data-c="toggleOn">' + (s.enabled === false ? '恢复提醒' : '暂停提醒') + '</button>' +
    '<button data-c="dup">复制一个</button>' +
    '<div class="sep"></div>' +
    '<button data-c="del" class="danger">删除</button>';
  document.body.appendChild(el);
  const rect = el.getBoundingClientRect();
  const px = Math.min(x, window.innerWidth - rect.width - 10);
  const py = Math.min(y, window.innerHeight - rect.height - 10);
  el.style.left = Math.max(8, px) + 'px';
  el.style.top = Math.max(8, py) + 'px';
  ctxEl = el;

  el.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-c]');
    if (!b) return;
    const c = b.dataset.c;
    closeCtx();
    if (c === 'edit') openDrawer(id);
    else if (c === 'toggleDone') {
      const base = st.baseDate || todayKey();
      await bridge.setDone(id, base, !isDone);
      await refresh();
    } else if (c === 'toggleOn') {
      await bridge.setEnabled(id, s.enabled === false);
      await refresh();
    } else if (c === 'dup') {
      const copy = Object.assign({}, s);
      delete copy.id;
      copy.title = s.title + '（副本）';
      await bridge.saveSchedule(copy);
      await refresh();
    } else if (c === 'del') {
      if (confirm('确定删除「' + s.title + '」？')) {
        await bridge.deleteSchedule(id);
        await refresh();
      }
    }
  });
}

document.addEventListener('click', (e) => {
  if (ctxEl && !e.target.closest('.ctx')) closeCtx();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeCtx(); closeDrawer(); closeSettings(); }
});

/* ---------------- 抽屉表单 ---------------- */
function openDrawer(id) {
  S.editing = id || null;
  const st = S.snap.settings;

  if (id) {
    const s = S.snap.schedules.find((x) => x.id === id);
    if (!s) return;
    $('drTitle').textContent = '编辑日程';
    $('fTitle').value = s.title;
    $('fNote').value = s.note || '';
    $('fDate').value = s.startDate;
    $('fEndDate').value = s.endDate || '';
    $('fStart').value = s.startTime;
    $('fEnd').value = s.endTime;
    S.form.repeat = s.repeat || 'none';
    S.form.weekdays = (s.weekdays || [1, 2, 3, 4, 5]).slice();
    S.form.interval = s.intervalMin;
    S.form.color = s.color || 0;
    $('fDelete').hidden = false;
  } else {
    $('drTitle').textContent = '新建日程';
    $('fTitle').value = '';
    $('fNote').value = '';
    // 智能默认日期：如果今天的默认区间已经过去，就从明天开始
    const now = new Date();
    const [eh, em] = (st.defaultEnd || '10:00').split(':').map(Number);
    const passed = now.getHours() * 60 + now.getMinutes() >= eh * 60 + em;
    const d = new Date();
    if (passed) d.setDate(d.getDate() + 1);
    $('fDate').value = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    $('fEndDate').value = '';
    $('fStart').value = st.defaultStart || '06:00';
    $('fEnd').value = st.defaultEnd || '10:00';
    S.form.repeat = st.defaultRepeat || 'daily';
    S.form.weekdays = [1, 2, 3, 4, 5];
    S.form.interval = st.defaultInterval || 20;
    S.form.color = st.defaultColor || 0;
    $('fDelete').hidden = true;
  }

  syncFormUI();
  $('drawer').classList.add('open');
  $('mask').classList.add('show');
  setTimeout(() => $('fTitle').focus(), 260);
}

function closeDrawer() {
  $('drawer').classList.remove('open');
  $('mask').classList.remove('show');
  S.editing = null;
}

function syncFormUI() {
  // 重复
  $('segRepeat').querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', b.dataset.v === S.form.repeat);
  });
  const custom = S.form.repeat === 'custom';
  $('weekdays').hidden = !custom;
  $('weekdays').querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', S.form.weekdays.includes(Number(b.dataset.d)));
  });
  const isOnce = S.form.repeat === 'none';
  $('dateLabel').textContent = isOnce ? '日期' : '开始日期';
  $('endDateWrap').hidden = isOnce;

  // 间隔
  const hasPreset = [5, 10, 15, 20, 30, 60].includes(S.form.interval);
  $('chipsInterval').querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.v) === S.form.interval);
  });
  let customChip = $('chipsInterval').querySelector('[data-custom]');
  if (!hasPreset) {
    if (!customChip) {
      customChip = document.createElement('button');
      customChip.dataset.custom = '1';
      customChip.addEventListener('click', () => {
        const v = prompt('每隔多少分钟提醒一次？（1-720）', S.form.interval);
        if (v) {
          const n = Math.max(1, Math.min(720, parseInt(v, 10) || 20));
          S.form.interval = n;
          syncFormUI();
        }
      });
      $('chipsInterval').appendChild(customChip);
    }
    customChip.textContent = S.form.interval + ' 分钟';
    customChip.classList.add('on');
  } else if (customChip) {
    customChip.remove();
  }

  // 颜色
  $('colors').querySelectorAll('button').forEach((b, i) => {
    b.classList.toggle('on', i === S.form.color);
  });

  updatePreview();
}

function updatePreview() {
  const startTime = $('fStart').value || '06:00';
  const endTime = $('fEnd').value || '10:00';
  const n = slotsOf(startTime, endTime, S.form.interval);
  const rep = repeatLabel({ repeat: S.form.repeat, weekdays: S.form.weekdays });

  let prefix;
  if (S.form.repeat === 'none') {
    const dv = $('fDate').value;
    prefix = dv ? relDay(dv, todayKey()) : '某天';
  } else {
    prefix = rep;
  }

  let text = prefix + ' ' + startTime + ' - ' + endTime + '，共提醒 ' + n + ' 次';
  if (n > 1) {
    text += '（间隔 ' + S.form.interval + ' 分钟）';
  }
  if (endTime < startTime) text += ' · 跨夜';
  $('pvText').textContent = text;
}

// 绑定表单交互
$('segRepeat').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-v]');
  if (!b) return;
  S.form.repeat = b.dataset.v;
  syncFormUI();
});

$('weekdays').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-d]');
  if (!b) return;
  const d = Number(b.dataset.d);
  const i = S.form.weekdays.indexOf(d);
  if (i >= 0) S.form.weekdays.splice(i, 1);
  else S.form.weekdays.push(d);
  syncFormUI();
});

$('chipsInterval').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-v]');
  if (!b) return;
  S.form.interval = Number(b.dataset.v);
  syncFormUI();
});

$('colors').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  S.form.color = Number(b.dataset.i);
  syncFormUI();
});

['fStart', 'fEnd', 'fDate', 'fEndDate'].forEach((id) => {
  $(id).addEventListener('input', updatePreview);
  $(id).addEventListener('change', updatePreview);
});

$('drClose').addEventListener('click', closeDrawer);
$('fCancel').addEventListener('click', closeDrawer);
$('mask').addEventListener('click', closeDrawer);

$('fSave').addEventListener('click', async () => {
  const title = $('fTitle').value.trim();
  if (!title) { $('fTitle').focus(); return; }
  const startTime = $('fStart').value;
  const endTime = $('fEnd').value;
  if (!startTime || !endTime) return;
  if (startTime === endTime) {
    alert('开始和结束时间不能相同。只想提醒一次的话，把结束时间往后调 1 分钟即可。');
    return;
  }
  if (S.form.repeat === 'custom' && !S.form.weekdays.length) {
    alert('请至少选择一天。');
    return;
  }

  const payload = {
    id: S.editing || undefined,
    title,
    note: $('fNote').value,
    startDate: $('fDate').value || todayKey(),
    endDate: S.form.repeat === 'none' ? '' : ($('fEndDate').value || ''),
    startTime,
    endTime,
    intervalMin: S.form.interval,
    repeat: S.form.repeat,
    weekdays: S.form.weekdays,
    color: S.form.color
  };

  await bridge.saveSchedule(payload);
  closeDrawer();
  await refresh();
});

$('fDelete').addEventListener('click', async () => {
  const id = S.editing;
  if (!id) return;
  const s = S.snap.schedules.find((x) => x.id === id);
  if (!confirm('确定删除「' + (s ? s.title : '') + '」？')) return;
  await bridge.deleteSchedule(id);
  closeDrawer();
  await refresh();
});

/* ---------------- 设置 ---------------- */
function openSettings() {
  renderSettingsForm();
  $('settings').hidden = false;
}
function closeSettings() {
  $('settings').hidden = true;
}

function renderSettingsForm() {
  if (!S.snap) return;
  const st = S.snap.settings;
  $('setAutoLaunch').checked = !!st.autoLaunch;
  $('setSound').checked = st.sound !== false;
  $('setStart').value = st.defaultStart || '06:00';
  $('setEnd').value = st.defaultEnd || '10:00';

  const mark = (containerId, v) => {
    $(containerId).querySelectorAll('button').forEach((b) => {
      b.classList.toggle('on', String(b.dataset.v) === String(v));
    });
  };
  mark('segTheme', st.theme === 'light' ? 'light' : 'dark');
  mark('segTimeout', st.popupTimeout);
  mark('segSnooze', st.snoozeMin);
}

$('btnSettings').addEventListener('click', openSettings);
$('setClose').addEventListener('click', closeSettings);
$('settings').addEventListener('click', (e) => {
  if (e.target.id === 'settings') closeSettings();
});

$('segTheme').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-v]');
  if (!b) return;
  await bridge.saveSettings({ theme: b.dataset.v });
  await refresh();
});

$('segTimeout').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-v]');
  if (!b) return;
  await bridge.saveSettings({ popupTimeout: Number(b.dataset.v) });
  await refresh();
});

$('segSnooze').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-v]');
  if (!b) return;
  await bridge.saveSettings({ snoozeMin: Number(b.dataset.v) });
  await refresh();
});

$('setAutoLaunch').addEventListener('change', async (e) => {
  await bridge.saveSettings({ autoLaunch: e.target.checked });
});
$('setSound').addEventListener('change', async (e) => {
  await bridge.saveSettings({ sound: e.target.checked });
});
['setStart', 'setEnd'].forEach((id) => {
  $(id).addEventListener('change', async () => {
    await bridge.saveSettings({
      defaultStart: $('setStart').value || '06:00',
      defaultEnd: $('setEnd').value || '10:00'
    });
  });
});

$('setOpenData').addEventListener('click', () => bridge.openDataFolder());
$('setTest').addEventListener('click', () => bridge.testPopup());
$('setQuit').addEventListener('click', () => {
  if (confirm('退出后就不再提醒了，确定吗？')) bridge.quit();
});
$('setDone').addEventListener('click', closeSettings);

$('btnTestPopup').addEventListener('click', () => bridge.testPopup());

/* ---------------- 窗口按钮 ---------------- */
$('wcMin').addEventListener('click', () => bridge.win.minimize());
$('wcMax').addEventListener('click', () => bridge.win.maximize());
$('wcClose').addEventListener('click', () => bridge.win.hide());

/* ---------------- 新建入口 ---------------- */
$('btnNew').addEventListener('click', () => openDrawer(null));
$('btnNew2').addEventListener('click', () => openDrawer(null));

/* ---------------- 初始化 ---------------- */
async function boot() {
  // 颜色选择器
  const colorsEl = $('colors');
  ACCENTS.forEach((c, i) => {
    const b = document.createElement('button');
    b.dataset.i = i;
    b.style.background = 'linear-gradient(135deg,' + c[0] + ',' + c[1] + ')';
    b.style.color = c[0];
    colorsEl.appendChild(b);
  });

  S.snap = await bridge.snapshot();
  renderAll();

  bridge.onDataChanged(async () => { await refresh(); });

  bridge.onFocusSchedule((id) => {
    if (!id) return;
    openDrawer(id);
  });

  bridge.onReminderFired(() => { refresh(); });

  setInterval(tick, 1000);
  setInterval(poll, 3000);
  tick();
}

boot();
