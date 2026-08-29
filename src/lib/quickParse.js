import { addDays, fromYmd, ymd } from './time.js';

/**
 * 待办输入的快捷解析（P1）。
 * 例：'明天 15:00 开会' → { title:'开会', date:'2026-08-31', time:'15:00' }
 *
 * 只认少量确定的写法，认不出就原样当标题，绝不猜。
 */

const WEEKDAY_WORDS = {
  一: 1, 1: 1, 二: 2, 2: 2, 三: 3, 3: 3, 四: 4, 4: 4, 五: 5, 5: 5, 六: 6, 6: 6, 日: 7, 天: 7, 7: 7
};

/**
 * @param {string} raw 用户输入
 * @param {string} baseDate 当前选中日期 'YYYY-MM-DD'
 * @param {string} today 主时区今天
 * @param {string} tz 主时区
 */
export function quickParse(raw, baseDate, today, tz) {
  let text = String(raw).trim();
  let date = null;
  let time = null;

  // --- 日期 ---
  const rel = [
    [/^(今天|今日)\s*/, 0],
    [/^(明天|明日)\s*/, 1],
    [/^(后天)\s*/, 2],
    [/^(大后天)\s*/, 3],
    [/^(昨天|昨日)\s*/, -1]
  ];
  for (const [re, delta] of rel) {
    if (re.test(text)) {
      date = addDays(today, delta, tz);
      text = text.replace(re, '');
      break;
    }
  }

  // 下周三 / 周三 / 星期五 / 下周日
  if (!date) {
    const m = text.match(/^(下)?(?:周|星期|礼拜)([一二三四五六日天1-7])\s*/);
    if (m) {
      const target = WEEKDAY_WORDS[m[2]];
      const base = fromYmd(today, tz);
      let delta = target - base.weekday;
      if (delta <= 0) delta += 7; // 本周已过 → 下一个
      if (m[1]) delta += 7; // "下周"
      date = ymd(base.plus({ days: delta }));
      text = text.replace(m[0], '');
    }
  }

  // 8月30日 / 8/30 / 2026-08-30
  if (!date) {
    let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s*/);
    if (m) {
      date = normalize(+m[1], +m[2], +m[3], tz);
      text = text.replace(m[0], '');
    } else if ((m = text.match(/^(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]\s*/))) {
      date = nearestMonthDay(+m[1], +m[2], today, tz);
      text = text.replace(m[0], '');
    } else if ((m = text.match(/^(\d{1,2})\/(\d{1,2})\s*/))) {
      date = nearestMonthDay(+m[1], +m[2], today, tz);
      text = text.replace(m[0], '');
    }
  }

  // --- 时间 ---
  // 15:00 / 15：00 / 下午3点 / 早上8点半 / 晚上9点
  let m = text.match(/^(?:(上午|早上|中午|下午|晚上|傍晚|凌晨)\s*)?(\d{1,2})\s*[:：]\s*(\d{2})\s*/);
  if (m) {
    time = buildTime(+m[2], +m[3], m[1]);
    text = text.replace(m[0], '');
  } else if ((m = text.match(/^(?:(上午|早上|中午|下午|晚上|傍晚|凌晨)\s*)?(\d{1,2})\s*点\s*(半|\d{1,2}\s*分)?\s*/))) {
    let minute = 0;
    if (m[3]) minute = m[3] === '半' ? 30 : parseInt(m[3], 10) || 0;
    time = buildTime(+m[2], minute, m[1]);
    text = text.replace(m[0], '');
  }

  const title = text.trim();
  if (!title) return null; // 只有时间没有内容 → 视为没解析成功
  return { title, date: date ?? (baseDate || null), time };
}

function buildTime(h, min, period) {
  if (period === '下午' || period === '晚上' || period === '傍晚') {
    if (h < 12) h += 12;
  } else if (period === '凌晨' || period === '早上' || period === '上午') {
    if (h === 12) h = 0;
  } else if (period === '中午') {
    if (h < 12) h += 12;
  }
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function normalize(y, m, d, tz) {
  const dt = fromYmd(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, tz);
  return dt.isValid ? ymd(dt) : null;
}

/** 只给了月日 → 取今天之后最近的那一年 */
function nearestMonthDay(m, d, today, tz) {
  const year = Number(today.slice(0, 4));
  const same = normalize(year, m, d, tz);
  if (!same) return null;
  return same >= today ? same : normalize(year + 1, m, d, tz);
}
