import { DateTime } from 'luxon';
import { nowIn, todayInTZ } from './lib/time.js';

/**
 * 渲染进程的中心状态。极简发布订阅，不引入状态管理库。
 *
 * 约定：任何组件都不允许自己 new Date() 判断日期，
 * 一律读 state.today / state.now（它们由主时区推导）。
 */

const listeners = new Set();

export const state = {
  ready: false,
  settings: null,
  todos: [],
  systemTimezone: 'UTC',
  dataPath: '',
  version: '',
  isDev: false,

  /** 主时区的"现在"（DateTime） */
  now: DateTime.now(),
  /** 主时区的今天 'YYYY-MM-DD' —— 全项目唯一的"今天" */
  today: '',

  /** 待办区当前查看的日期 */
  selectedDate: '',
  /** 月历当前显示的年月 */
  viewYear: 0,
  viewMonth: 0,

  /** UI 临时状态 */
  overdueOpen: false,
  archiveOpen: false,
  editingId: null,
  toast: null,
  notice: null
};

export function tz() {
  return state.settings?.primaryTimezone || state.systemTimezone || 'UTC';
}

/** 重算 now / today。时钟心跳与休眠唤醒时调用。 */
export function refreshClock() {
  state.now = nowIn(tz());
  const t = todayInTZ(tz());
  const rolled = state.today && state.today !== t;
  state.today = t;
  return rolled; // 跨过主时区的午夜
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 数据/设置变更后调用，触发全量重绘（组件内部各自做局部更新） */
export function notify(reason = 'data') {
  for (const fn of [...listeners]) {
    try {
      fn(reason);
    } catch (err) {
      console.error('[state] listener error', err);
    }
  }
}
