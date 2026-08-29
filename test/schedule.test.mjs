import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  parseScheduleHtml,
  parseWeeks,
  buildScheduleTodos,
  DEFAULT_PERIOD_TIMES
} from '../src/lib/schedule.js';

const TZ = 'Asia/Shanghai';
const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'schedule.html');

test('周次描述解析', () => {
  assert.deepEqual(parseWeeks('1-4'), [1, 2, 3, 4]);
  assert.deepEqual(parseWeeks('4-11').length, 8);
  assert.deepEqual(parseWeeks('3,5,7'), [3, 5, 7]);
  assert.deepEqual(parseWeeks('1-8(单)'), [1, 3, 5, 7]);
  assert.deepEqual(parseWeeks('1-8双'), [2, 4, 6, 8]);
  assert.deepEqual(parseWeeks('1-4,9-10'), [1, 2, 3, 4, 9, 10]);
  assert.deepEqual(parseWeeks('乱七八糟'), []);
});

test('课表格子按 id 定位，跨行合并能还原成第 N-M 节', () => {
  // 周二第三节，rowspan=2 → 第 3-4 节
  const html = `<table><tr>
    <td id="TD12_0" rowspan="2">前沿技术与学科发展讲座(1996091320.01) (2023级物联网工程1班 2023级物联网工程2班) (1-4,综合楼1楼学术报告厅(石鼓校区))</td>
  </tr></table>`;
  const { entries, warnings } = parseScheduleHtml(html);
  assert.equal(warnings.length, 0);
  assert.equal(entries.length, 1);
  const e = entries[0];
  assert.equal(e.name, '前沿技术与学科发展讲座');
  assert.equal(e.code, '1996091320.01');
  assert.equal(e.weekday, 2); // TD1x → 星期二
  assert.equal(e.startPeriod, 3);
  assert.equal(e.endPeriod, 4);
  assert.equal(e.place, '综合楼1楼学术报告厅(石鼓校区)');
  assert.deepEqual(e.weeks, [1, 2, 3, 4]);
});

test('星期索引：TD{n}x 的 0=周一、6=周日，前导 0 会被省略', () => {
  const cell = (id) =>
    `<td id="${id}">课(1.1) (班) (1-1,地点)</td>`;
  assert.equal(parseScheduleHtml(cell('TD0_0')).entries[0].weekday, 1); // 周一第一节
  assert.equal(parseScheduleHtml(cell('TD2_0')).entries[0].weekday, 1); // 周一第三节
  assert.equal(parseScheduleHtml(cell('TD50_0')).entries[0].weekday, 6); // 周六
  assert.equal(parseScheduleHtml(cell('TD60_0')).entries[0].weekday, 7); // 周日
});

test('课程名里自带括号也能剥对', () => {
  const html = `<td id="TD10_0">数据结构(实验)(A001.01) (2024级软工1班) (1-16,教1-203)</td>`;
  const e = parseScheduleHtml(html).entries[0];
  assert.equal(e.name, '数据结构(实验)');
  assert.equal(e.code, 'A001.01');
  assert.equal(e.place, '教1-203');
});

test('格式对不上时给警告，不瞎猜', () => {
  const { entries, warnings } = parseScheduleHtml('<td id="TD10_0">随便写点什么</td>');
  assert.equal(entries.length, 0);
  assert.equal(warnings.length, 1);
});

test('按第 1 周周一摊平成待办，日期与节次时间正确', () => {
  const html = `<td id="TD12_0" rowspan="2">高等数学(M1.01) (班) (2-3,教101)</td>`;
  const { entries } = parseScheduleHtml(html);
  // 2026-09-07 是周一
  const { todos } = buildScheduleTodos(entries, {
    firstMonday: '2026-09-07',
    periodTimes: DEFAULT_PERIOD_TIMES,
    tz: TZ
  });
  assert.equal(todos.length, 2); // 第 2、3 周各一次
  // 第 2 周周二 = 9/7 + 7 + 1 = 9/15
  assert.equal(todos[0].date, '2026-09-15');
  assert.equal(todos[1].date, '2026-09-22');
  assert.equal(todos[0].time, DEFAULT_PERIOD_TIMES[2]); // 第三节
  assert.match(todos[0].title, /^高等数学 · 第3-4节 · 教101$/);
});

test('起始日期选成非周一时，自动往前对齐到当周周一', () => {
  const html = `<td id="TD0_0">课(1.1) (班) (1-1,地点)</td>`;
  const { entries } = parseScheduleHtml(html);
  const a = buildScheduleTodos(entries, { firstMonday: '2026-09-07', periodTimes: DEFAULT_PERIOD_TIMES, tz: TZ });
  const b = buildScheduleTodos(entries, { firstMonday: '2026-09-10', periodTimes: DEFAULT_PERIOD_TIMES, tz: TZ });
  assert.equal(a.todos[0].date, '2026-09-07');
  assert.deepEqual(b.todos[0].date, a.todos[0].date);
});

test('真实课表文件端到端', { skip: !fs.existsSync(FIXTURE) }, () => {
  const html = fs.readFileSync(FIXTURE, 'utf8');
  const { entries, warnings } = parseScheduleHtml(html);
  assert.equal(warnings.length, 0);
  assert.equal(entries.length, 10);
  const { todos } = buildScheduleTodos(entries, {
    firstMonday: '2026-09-07',
    periodTimes: DEFAULT_PERIOD_TIMES,
    tz: TZ
  });
  assert.equal(todos.length, 64);
  // 每条都得有合法日期和时间
  for (const t of todos) {
    assert.match(t.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(t.time, /^\d{2}:\d{2}$/);
    assert.ok(t.title.length > 0);
  }
});
