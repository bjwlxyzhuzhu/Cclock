import { DateTime } from 'luxon';

/**
 * 全项目唯一的"时间真理"层。
 *
 * 铁律：
 *  1. 任何"今天/日期"的判断都必须经过这里，禁止在别处调用
 *     new Date().getDate() / getMonth() 等依赖系统时区的方法。
 *  2. 主时区由用户指定，系统时区只是副时区里的一条参考信息。
 *  3. 待办的 date/time 是"主时区的墙钟时间"，不做 UTC 转换。
 */

/** 当前时刻在指定时区下的 DateTime */
export function nowIn(tz) {
  return DateTime.now().setZone(tz);
}

/** 'YYYY-MM-DD' —— 指定时区下的今天。这是全项目"今天"的唯一来源。 */
export function todayInTZ(tz) {
  return nowIn(tz).toFormat('yyyy-MM-dd');
}

/** DateTime → 'YYYY-MM-DD' */
export function ymd(dt) {
  return dt.toFormat('yyyy-MM-dd');
}

/** 'YYYY-MM-DD' → 该时区当天 00:00 的 DateTime */
export function fromYmd(dateStr, tz) {
  return DateTime.fromFormat(dateStr, 'yyyy-MM-dd', { zone: tz }).startOf('day');
}

/** { y, m, d } → 'YYYY-MM-DD'（m 为 1-12） */
export function toYmd(y, m, d) {
  return `${pad4(y)}-${pad2(m)}-${pad2(d)}`;
}

/** 拆出年月日数字，供农历库使用 */
export function partsOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return { y, m, d };
}

/**
 * 待办的墙钟时间 → 该时区下的绝对时刻。
 * time 为 null 时视为当天 00:00（全天事项）。
 */
export function wallClock(dateStr, timeStr, tz) {
  const t = timeStr || '00:00';
  return DateTime.fromFormat(`${dateStr} ${t}`, 'yyyy-MM-dd HH:mm', { zone: tz });
}

/** 日期加减天数（在指定时区内按自然日计算） */
export function addDays(dateStr, days, tz) {
  return ymd(fromYmd(dateStr, tz).plus({ days }));
}

/** 两个 'YYYY-MM-DD' 的先后比较：a<b → -1 */
export function compareYmd(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/* ------------------------------------------------------------------ */
/* 时差                                                                */
/* ------------------------------------------------------------------ */

/**
 * tz 相对 primaryTz 的时差（小时，可为 .5 / .75）。
 * 用当前时刻实时计算，因此自动跟随夏令时，不存在硬编码。
 */
export function offsetHours(tz, primaryTz, at = Date.now()) {
  const a = DateTime.fromMillis(at, { zone: tz }).offset;
  const b = DateTime.fromMillis(at, { zone: primaryTz }).offset;
  return (a - b) / 60;
}

/** '−15h' / '+1h' / '+5.5h' / '同区' */
export function offsetLabel(tz, primaryTz, at = Date.now()) {
  const h = offsetHours(tz, primaryTz, at);
  if (Math.abs(h) < 1e-9) return '同区';
  const sign = h > 0 ? '+' : '−'; // U+2212 真减号，比连字符好看
  const abs = Math.abs(h);
  const num = Number.isInteger(abs) ? String(abs) : String(Number(abs.toFixed(2)));
  return `${sign}${num}h`;
}

/* ------------------------------------------------------------------ */
/* 格式化                                                              */
/* ------------------------------------------------------------------ */

const WEEKDAY_CN = ['一', '二', '三', '四', '五', '六', '日'];

/** '星期日'（luxon weekday: 1=周一 … 7=周日） */
export function weekdayCN(dt) {
  return `星期${WEEKDAY_CN[dt.weekday - 1]}`;
}

export function weekdayShortCN(weekdayIso) {
  return WEEKDAY_CN[weekdayIso - 1];
}

/**
 * 大时钟的时间串。
 * @returns {{ text: string, suffix: string }} suffix 为 12 小时制下的 AM/PM
 */
export function formatClock(dt, { hourFormat = '24h', showSeconds = true } = {}) {
  const h24 = hourFormat !== '12h';
  const hh = h24 ? dt.toFormat('HH') : String(dt.hour % 12 === 0 ? 12 : dt.hour % 12).padStart(2, '0');
  const parts = [hh, dt.toFormat('mm')];
  if (showSeconds) parts.push(dt.toFormat('ss'));
  return {
    text: parts.join(':'),
    suffix: h24 ? '' : dt.hour < 12 ? 'AM' : 'PM'
  };
}

/** '08月30日' */
export function formatDateCN(dt) {
  return `${dt.toFormat('MM')}月${dt.toFormat('dd')}日`;
}

/* ------------------------------------------------------------------ */
/* 对齐整秒的心跳                                                      */
/* ------------------------------------------------------------------ */

/**
 * 不用 setInterval —— 它会累积漂移，且休眠唤醒后可能错乱。
 * 每次都根据当前墙钟时间重新算到下一个边界的延迟。
 *
 * @param {() => number} getIntervalMs 返回 1000（显示秒）或 60000（只到分钟）
 * @param {() => void} onTick
 */
export function createTicker(getIntervalMs, onTick) {
  let timer = null;
  let stopped = false;

  function schedule() {
    if (stopped) return;
    const interval = Math.max(200, getIntervalMs());
    // IANA 时区的偏移都是整分钟，所以按 UTC 边界对齐等价于按本地边界对齐
    const delay = interval - (Date.now() % interval);
    timer = setTimeout(() => {
      if (stopped) return;
      onTick();
      schedule();
    }, delay + 8); // +8ms 保险，避免因为提前触发而在同一秒里空转两次
  }

  onTick();
  schedule();

  return {
    /** 休眠唤醒 / 设置变更后强制立刻刷新并重新对齐 */
    refresh() {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      onTick();
      schedule();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    }
  };
}

/* ------------------------------------------------------------------ */

function pad2(n) {
  return String(n).padStart(2, '0');
}
function pad4(n) {
  return String(n).padStart(4, '0');
}

export { DateTime };
