'use strict';
/**
 * 调度引擎
 * -----------------------------------------------------------
 * 规则：把一个日程拆成「时间区间 + 间隔」的一串时间点。
 *   06:00 - 10:00，每 20 分钟  =>  06:00 / 06:20 / 06:40 ... 10:00
 * 每个时间点到达时，如果这一天还没点「完成」，就弹一次提醒。
 * 睡过头 / 关机错过若干时间点时，只补弹一次，不会连炸一堆窗口。
 */
const store = require('./store');

let tickTimer = null;
let onFire = null;
let lastTickAt = 0;

const p2 = (n) => String(n).padStart(2, '0');

function dateKey(d) {
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
}

function parseAt(dateStr, timeStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const [hh, mm] = String(timeStr || '00:00').split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
}

function shiftDate(dateStr, days) {
  const d = parseAt(dateStr, '00:00');
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

function dowOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay(); // 0 = 周日
}

/** 这一天是否属于该日程的重复规则 */
function isActiveOn(sch, dateStr) {
  if (!sch.enabled) return false;
  if (!sch.startDate) return false;
  if (sch.repeat === 'none') return dateStr === sch.startDate;
  if (dateStr < sch.startDate) return false;
  if (sch.endDate && dateStr > sch.endDate) return false;
  if (sch.repeat === 'daily') return true;
  if (sch.repeat === 'weekdays') { const d = dowOf(dateStr); return d >= 1 && d <= 5; }
  if (sch.repeat === 'custom') return (sch.weekdays || []).includes(dowOf(dateStr));
  return false;
}

/** 返回 [startTs, endTs]（毫秒）。endTime <= startTime 视为跨夜。 */
function windowOf(sch, baseDate) {
  const start = parseAt(baseDate, sch.startTime).getTime();
  let end = parseAt(baseDate, sch.endTime).getTime();
  if (sch.endTime === sch.startTime) {
    end = start + 60 * 1000;              // 起止相同 = 单点提醒
  } else if (end <= start) {
    end += 86400000;                      // 跨夜
  }
  return [start, end];
}

function stepMs(sch) {
  return Math.max(1, Math.round(Number(sch.intervalMin) || 20)) * 60000;
}

/** 落在 (now 之前最近的) 提醒点；不在窗口内返回 0 */
function dueSlot(start, end, step, now) {
  if (now < start || now > end) return 0;
  const k = Math.floor((now - start) / step);
  const t = start + k * step;
  return t <= end ? t : 0;
}

function slotCount(start, end, step) {
  return Math.floor((end - start) / step) + 1;
}

/**
 * 给界面用的实时状态
 * state: idle(未开始) / active(区间内待办) / done(已完成) / missed(已错过) / off(已关闭)
 */
function statusOf(sch, now, todayKey) {
  const base = { state: 'off', nextAt: 0, index: 0, total: 0, startAt: 0, endAt: 0, doneAt: 0, baseDate: todayKey };

  // 今天 / 昨天（跨夜）两个窗口
  for (const baseDate of [todayKey, shiftDate(todayKey, -1)]) {
    if (!isActiveOn(sch, baseDate)) continue;
    const [start, end] = windowOf(sch, baseDate);
    if (now > end) continue;                 // 这个窗口已经过去了
    const step = stepMs(sch);
    const total = slotCount(start, end, step);
    const doneAt = (sch.done || {})[baseDate] || 0;
    const info = { startAt: start, endAt: end, total, baseDate };

    if (doneAt) {
      return Object.assign(base, info, { state: 'done', doneAt, index: total });
    }
    if (now < start) {
      return Object.assign(base, info, { state: 'idle', nextAt: start, index: 0 });
    }
    // 区间内
    const fired = (sch.lastFire || {})[baseDate] || 0;
    const due = dueSlot(start, end, step, now);
    let next = fired > 0 ? Math.max(due, fired) + step : due || start;
    const snoozeUntil = (sch.snoozeUntil || {})[baseDate] || 0;
    if (snoozeUntil > next) next = snoozeUntil;
    const idx = Math.min(total, Math.floor((Math.min(next, end) - start) / step) + 1);
    return Object.assign(base, info, { state: 'active', nextAt: next, index: idx });
  }

  // 今天没有窗口：看看是不是今天已过，还是压根不适用
  if (isActiveOn(sch, todayKey)) {
    const [start, end] = windowOf(sch, todayKey);
    if (now > end) {
      const doneAt = (sch.done || {})[todayKey] || 0;
      return Object.assign(base, {
        state: doneAt ? 'done' : 'missed',
        baseDate: todayKey,
        doneAt, startAt: start, endAt: end, total: slotCount(start, end, stepMs(sch))
      });
    }
  }
  // 未来最早的一次
  for (let i = 1; i <= 14; i++) {
    const d = shiftDate(todayKey, i);
    if (!isActiveOn(sch, d)) continue;
    const [start, end] = windowOf(sch, d);
    return Object.assign(base, {
      state: 'idle', startAt: start, endAt: end, baseDate: d,
      nextAt: start, total: slotCount(start, end, stepMs(sch))
    });
  }
  return base;
}

function tick() {
  const now = Date.now();
  const todayKey = dateKey(new Date(now));
  const state = store.get();
  let fired = 0;

  for (const sch of state.schedules) {
    if (!sch.enabled) continue;
    const bases = [todayKey, shiftDate(todayKey, -1)];
    for (const baseDate of bases) {
      if (fired > 6) break;                       // 极端情况下别一次性炸满屏幕
      if (!isActiveOn(sch, baseDate)) continue;
      const [start, end] = windowOf(sch, baseDate);
      if (now < start || now > end) continue;
      if ((sch.done || {})[baseDate]) continue;

      const step = stepMs(sch);
      const due = dueSlot(start, end, step, now);
      if (!due) continue;

      // 用户点了「稍后」，在推迟时间点之前不再打扰
      const snoozeUntil = (sch.snoozeUntil || {})[baseDate] || 0;
      if (snoozeUntil && now < snoozeUntil) continue;

      const firedTs = (sch.lastFire || {})[baseDate] || 0;
      if (due <= firedTs) continue;               // 这个时间点已经提醒过

      sch.lastFire = sch.lastFire || {};
      sch.lastFire[baseDate] = due;
      if (sch.snoozeUntil && sch.snoozeUntil[baseDate]) delete sch.snoozeUntil[baseDate];
      fired++;

      const total = slotCount(start, end, step);
      const index = Math.round((due - start) / step) + 1;
      if (typeof onFire === 'function') {
        try {
          onFire({
            id: sch.id,
            title: sch.title,
            note: sch.note || '',
            color: sch.color || 0,
            baseDate,
            dueAt: due,
            endAt: end,
            startAt: start,
            intervalMin: step / 60000,
            index,
            total
          });
        } catch (_) {}
      }
    }
  }

  if (fired) store.saveSoon();
  lastTickAt = now;
}

function start(cb) {
  onFire = cb;
  if (tickTimer) return;
  tick();                          // 启动瞬间先补一次
  tickTimer = setInterval(tick, 5000);
  if (tickTimer.unref) tickTimer.unref();
}

function stop() {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
}

/** 供界面查询：把所有日程算上实时状态后返回 */
function snapshot() {
  const now = Date.now();
  const todayKey = dateKey(new Date(now));
  const st = store.get();
  return {
    today: todayKey,
    now,
    settings: st.settings,
    schedules: st.schedules.map((s) => {
      const stt = statusOf(s, now, todayKey);
      return Object.assign({}, s, { status: stt });
    })
  };
}

module.exports = {
  start, stop, tick, snapshot, statusOf,
  isActiveOn, windowOf, dateKey, parseAt, shiftDate, stepMs, slotCount, dowOf
};
