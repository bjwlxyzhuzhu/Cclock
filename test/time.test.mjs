import test from 'node:test';
import assert from 'node:assert/strict';
import { DateTime, Settings } from 'luxon';

import {
  addDays,
  fromYmd,
  formatClock,
  offsetHours,
  offsetLabel,
  todayInTZ,
  wallClock,
  weekdayCN,
  ymd
} from '../src/lib/time.js';
import { todoStatus, sortForDay, isArchived, dayDotState } from '../src/lib/todos.js';
import { lunarOf, calendarSubLabel } from '../src/lib/lunar.js';
import { quickParse } from '../src/lib/quickParse.js';

const SHANGHAI = 'Asia/Shanghai';
const PHOENIX = 'America/Phoenix';

/** UTC 时刻字符串 → 毫秒 */
const ms = (iso) => DateTime.fromISO(iso, { zone: 'utc' }).toMillis();

/** 把"现在"钉死在某个 UTC 时刻，用来复现 PRD 里的验收场景 */
function at(iso, fn) {
  const fixed = ms(iso); // 先算好，否则 Settings.now 里再调 luxon 会无限递归
  const prev = Settings.now;
  Settings.now = () => fixed;
  try {
    return fn();
  } finally {
    Settings.now = prev;
  }
}

/* ================================================================== */
/* §4 时区                                                            */
/* ================================================================== */

test('主时区决定"今天"：北京已过零点、凤凰城还是前一天', () => {
  // UTC 2026-08-29 17:09 → 北京 08-30 01:09；凤凰城 08-29 10:09
  at('2026-08-29T17:09:36Z', () => {
    assert.equal(todayInTZ(SHANGHAI), '2026-08-30');
    assert.equal(todayInTZ(PHOENIX), '2026-08-29');
  });
});

test('时差以主时区为基准，符号与数值正确', () => {
  const t = ms('2026-08-29T17:09:36Z');
  // 凤凰城不实行夏令时，常年 UTC-7；上海 UTC+8
  assert.equal(offsetHours(PHOENIX, SHANGHAI, t), -15);
  assert.equal(offsetLabel(PHOENIX, SHANGHAI, t), '−15h');
  assert.equal(offsetLabel('Asia/Tokyo', SHANGHAI, t), '+1h');
  assert.equal(offsetLabel(SHANGHAI, SHANGHAI, t), '同区');
});

test('半小时/三刻钟时区的时差标注', () => {
  const t = ms('2026-08-29T17:09:36Z');
  assert.equal(offsetLabel('Asia/Kolkata', SHANGHAI, t), '−2.5h');
  assert.equal(offsetLabel('Asia/Kathmandu', SHANGHAI, t), '−2.25h');
});

test('跨夏令时切换日，时差自动变化（不是硬编码）', () => {
  // 纽约 2026 年 3 月 8 日进入夏令时
  const before = offsetHours('America/New_York', SHANGHAI, ms('2026-03-07T12:00:00Z'));
  const after = offsetHours('America/New_York', SHANGHAI, ms('2026-03-09T12:00:00Z'));
  assert.equal(before, -13); // EST = UTC-5，上海 +8
  assert.equal(after, -12); // EDT = UTC-4
});

test('待办时间是主时区墙钟时间，切换主时区后数字不变、绝对时刻改变', () => {
  const a = wallClock('2026-08-30', '15:00', SHANGHAI);
  const b = wallClock('2026-08-30', '15:00', PHOENIX);
  assert.equal(a.toFormat('HH:mm'), '15:00');
  assert.equal(b.toFormat('HH:mm'), '15:00');
  assert.notEqual(a.toMillis(), b.toMillis()); // 同样的 15:00，不同的绝对时刻
});

test('日期加减在主时区内按自然日走', () => {
  assert.equal(addDays('2026-08-30', 1, SHANGHAI), '2026-08-31');
  assert.equal(addDays('2026-03-01', -1, SHANGHAI), '2026-02-28');
  assert.equal(ymd(fromYmd('2026-12-31', SHANGHAI)), '2026-12-31');
});

test('12/24 小时制与秒的显示', () => {
  const dt = DateTime.fromISO('2026-08-30T15:04:05', { zone: SHANGHAI });
  assert.deepEqual(formatClock(dt, { hourFormat: '24h', showSeconds: true }), {
    text: '15:04:05',
    suffix: ''
  });
  assert.deepEqual(formatClock(dt, { hourFormat: '12h', showSeconds: false }), {
    text: '03:04',
    suffix: 'PM'
  });
  const midnight = DateTime.fromISO('2026-08-30T00:30:00', { zone: SHANGHAI });
  const m = formatClock(midnight, { hourFormat: '12h', showSeconds: false });
  assert.equal(m.text, '12:30'); // 0 点在 12 小时制下是 12
  assert.equal(m.suffix, 'AM');
  assert.equal(weekdayCN(dt), '星期日');
});

/* ================================================================== */
/* §5.5 待办状态                                                      */
/* ================================================================== */

test('待办的普通/即将到来/已过期/已完成', () => {
  const now = DateTime.fromISO('2026-08-30T14:40:00', { zone: SHANGHAI });
  const mk = (time, done = false) => ({ date: '2026-08-30', time, done });

  assert.equal(todoStatus(mk('15:00'), now, SHANGHAI, 30), 'upcoming'); // 还剩 20 分钟
  assert.equal(todoStatus(mk('16:00'), now, SHANGHAI, 30), 'normal'); // 还剩 80 分钟
  assert.equal(todoStatus(mk('14:00'), now, SHANGHAI, 30), 'overdue');
  assert.equal(todoStatus(mk('14:00', true), now, SHANGHAI, 30), 'done');
  // 阈值可调
  assert.equal(todoStatus(mk('16:00'), now, SHANGHAI, 120), 'upcoming');
});

test('全天事项过完当天午夜才算逾期；无日期的"随时"事项永不逾期', () => {
  const sameDay = DateTime.fromISO('2026-08-30T23:59:00', { zone: SHANGHAI });
  const nextDay = DateTime.fromISO('2026-08-31T00:01:00', { zone: SHANGHAI });
  const allDay = { date: '2026-08-30', time: null, done: false };
  assert.equal(todoStatus(allDay, sameDay, SHANGHAI, 30), 'normal');
  assert.equal(todoStatus(allDay, nextDay, SHANGHAI, 30), 'overdue');
  assert.equal(todoStatus({ date: null, time: null, done: false }, nextDay, SHANGHAI, 30), 'normal');
});

test('逾期项置顶，其余有时间的按时间升序、全天事项在后', () => {
  const now = DateTime.fromISO('2026-08-30T14:00:00', { zone: SHANGHAI });
  const list = [
    { id: 'allday', date: '2026-08-30', time: null, done: false, createdAt: '1' },
    { id: 'late', date: '2026-08-30', time: '18:00', done: false, createdAt: '2' },
    { id: 'overdue', date: '2026-08-30', time: '09:00', done: false, createdAt: '3' },
    { id: 'soon', date: '2026-08-30', time: '15:00', done: false, createdAt: '4' }
  ];
  const sorted = sortForDay(list, now, SHANGHAI, 30).map((t) => t.id);
  assert.deepEqual(sorted, ['overdue', 'soon', 'late', 'allday']);
});

test('跨日归档：昨日及更早的已完成项才进"已完成"折叠区', () => {
  const today = '2026-08-30';
  assert.equal(isArchived({ done: true, date: '2026-08-29' }, today), true);
  assert.equal(isArchived({ done: true, date: today }, today), false); // 当天保留划线态
  assert.equal(isArchived({ done: false, date: '2026-08-01' }, today), false);
});

test('日历圆点：有未完成实心、全部完成空心、无待办不显示', () => {
  const todos = [
    { date: '2026-08-30', done: false },
    { date: '2026-08-30', done: true },
    { date: '2026-08-31', done: true }
  ];
  assert.equal(dayDotState(todos, '2026-08-30'), 'solid');
  assert.equal(dayDotState(todos, '2026-08-31'), 'hollow');
  assert.equal(dayDotState(todos, '2026-09-01'), 'none');
});

/* ================================================================== */
/* 农历                                                               */
/* ================================================================== */

test('农历与干支生肖（与参考图交叉核对：2026-08-29 = 丙午·马·七月十七）', () => {
  const l = lunarOf('2026-08-29');
  assert.equal(l.ganZhiYear, '丙午');
  assert.equal(l.shengXiao, '马');
  assert.equal(l.monthDayCN, '七月十七');
  assert.equal(l.fullCN, '丙午·马·七月十七');
});

test('节气按日命中', () => {
  assert.equal(lunarOf('2026-08-23').jieQi, '处暑');
  assert.equal(lunarOf('2026-04-05').jieQi, '清明');
  assert.equal(lunarOf('2026-08-29').jieQi, '');
});

test('月历小字优先级：法定节日 > 节气 > 农历初一 > 农历日', () => {
  assert.deepEqual(calendarSubLabel('2026-08-23', null), { text: '处暑', kind: 'jieqi' });
  assert.deepEqual(calendarSubLabel('2026-08-29', null), { text: '十七', kind: 'day' });
  assert.equal(
    calendarSubLabel('2026-10-01', { type: 'holiday', name: '国庆节' }).kind,
    'festival'
  );
  // 农历初一显示 "X月"
  assert.equal(calendarSubLabel('2026-08-13', null).kind, 'month');
});

/* ================================================================== */
/* 快捷解析                                                           */
/* ================================================================== */

test('快捷输入解析出日期与时间', () => {
  const today = '2026-08-30';
  assert.deepEqual(quickParse('明天 15:00 开会', today, today, SHANGHAI), {
    title: '开会',
    date: '2026-08-31',
    time: '15:00'
  });
  assert.deepEqual(quickParse('今天下午3点半 打电话', today, today, SHANGHAI), {
    title: '打电话',
    date: '2026-08-30',
    time: '15:30'
  });
  assert.deepEqual(quickParse('9月3日 体检', today, today, SHANGHAI), {
    title: '体检',
    date: '2026-09-03',
    time: null
  });
  // 认不出就原样当标题，不瞎猜
  assert.deepEqual(quickParse('买牛奶', today, today, SHANGHAI), {
    title: '买牛奶',
    date: today,
    time: null
  });
});
