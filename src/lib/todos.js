import { fromYmd, wallClock } from './time.js';

/**
 * 待办的状态计算与排序。
 * 所有日期/时间都按"主时区墙钟时间"理解，不做 UTC 转换。
 */

/**
 * @returns {'done'|'overdue'|'upcoming'|'normal'}
 */
export function todoStatus(todo, nowDt, tz, thresholdMin) {
  if (todo.done) return 'done';
  if (!todo.date) return 'normal'; // 无日期的"随时"事项永不过期

  if (!todo.time) {
    // 全天事项：过完当天午夜才算逾期
    const endOfDay = fromYmd(todo.date, tz).plus({ days: 1 });
    return nowDt >= endOfDay ? 'overdue' : 'normal';
  }

  const at = wallClock(todo.date, todo.time, tz);
  const diffMin = at.diff(nowDt, 'minutes').minutes;
  if (diffMin < 0) return 'overdue';
  if (diffMin <= thresholdMin) return 'upcoming';
  return 'normal';
}

/** 逾期未完成的全部待办（跨日期），用于汇总条与托盘红点 */
export function overdueTodos(todos, nowDt, tz, thresholdMin) {
  return todos
    .filter((t) => !t.done && t.date && todoStatus(t, nowDt, tz, thresholdMin) === 'overdue')
    .sort((a, b) => (a.date === b.date ? cmpTime(a, b) : a.date < b.date ? -1 : 1));
}

/**
 * 某一天的列表排序：
 *   逾期未完成置顶 → 有时间的按时间升序 → 全天事项 → 创建时间
 */
export function sortForDay(list, nowDt, tz, thresholdMin) {
  return [...list].sort((a, b) => {
    const oa = !a.done && todoStatus(a, nowDt, tz, thresholdMin) === 'overdue' ? 0 : 1;
    const ob = !b.done && todoStatus(b, nowDt, tz, thresholdMin) === 'overdue' ? 0 : 1;
    if (oa !== ob) return oa - ob;
    const t = cmpTime(a, b);
    if (t !== 0) return t;
    return String(a.createdAt).localeCompare(String(b.createdAt));
  });
}

function cmpTime(a, b) {
  if (a.time && b.time) return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
  if (a.time) return -1; // 有时间的在前
  if (b.time) return 1;
  return 0;
}

/**
 * 归档判定：过了主时区的午夜后，昨日及更早的已完成项收进"已完成"折叠区。
 */
export function isArchived(todo, today) {
  return !!(todo.done && todo.date && todo.date < today);
}

/** 某日在主列表中要显示的项（已归档的不在这里） */
export function todosForDay(todos, dateStr, today) {
  return todos.filter((t) => t.date === dateStr && !isArchived(t, today));
}

/** "随时"分组：没有日期的项 */
export function anytimeTodos(todos) {
  return todos
    .filter((t) => !t.date)
    .sort((a, b) => Number(a.done) - Number(b.done) || String(a.createdAt).localeCompare(String(b.createdAt)));
}

/** 已完成折叠区的内容：昨日及更早的已完成项，按日期倒序 */
export function archivedTodos(todos, today) {
  return todos
    .filter((t) => isArchived(t, today))
    .sort((a, b) => (a.date === b.date ? cmpTime(b, a) : a.date < b.date ? 1 : -1));
}

/** 日历格子的圆点：有未完成 → 实心；全部完成 → 空心；无 → 不显示 */
export function dayDotState(todos, dateStr) {
  let any = false;
  let undone = false;
  for (const t of todos) {
    if (t.date !== dateStr) continue;
    any = true;
    if (!t.done) {
      undone = true;
      break;
    }
  }
  if (!any) return 'none';
  return undone ? 'solid' : 'hollow';
}

export function newTodo({ title, date = null, time = null }) {
  return {
    id: crypto.randomUUID(),
    title: String(title).trim(),
    date,
    time,
    done: false,
    completedAt: null,
    createdAt: new Date().toISOString()
  };
}
