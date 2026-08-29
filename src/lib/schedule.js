import { addDays, fromYmd, ymd } from './time.js';

/**
 * 课表解析。
 *
 * 支持教务系统导出的那种 .xls —— 它其实是一张 HTML 表格（常见 GBK 编码，
 * 解码在主进程做，这里只吃已经解好的 HTML 字符串）。
 *
 * 关键点：课表格子有跨行合并（一门课占「第三-四节」两行），
 * 所以**不能按位置数格子**，必须用单元格自带的 id 定位：
 *
 *     id="TD{星期}{节次}_0"      星期 0=周一 … 5=周六, 6=周日；节次 0=第一节 … 9=第十节
 *
 * 格子文本形如：
 *     人工智能概论(25114917.55) (2026级智能制造工程1班 2026级智能制造工程2班) (4-11,综合楼406(石鼓校区))
 *     └─ 课程名 ──┘└─ 课程号 ─┘  └────── 教学班 ──────┘  └─周次─┘└─── 地点 ───┘
 */

const CELL_RE = /<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
const ID_RE = /id\s*=\s*["']TD(\d+)_0["']/i;
const ROWSPAN_RE = /rowspan\s*=\s*["']?(\d+)/i;

/** 周次 + 地点：先完整吃掉一段周次描述，再吃逗号后面的地点 */
const WEEK_PLACE_RE =
  /^\s*((?:\d+(?:-\d+)?(?:\s*\(?[单双]\)?)?)(?:\s*[,，、]\s*\d+(?:-\d+)?(?:\s*\(?[单双]\)?)?)*)\s*[,，]\s*([\s\S]+?)\s*$/;

/**
 * @param {string} html 已解码为 UTF-16 字符串的课表 HTML
 * @returns {{ entries: ScheduleEntry[], warnings: string[] }}
 */
export function parseScheduleHtml(html) {
  const entries = [];
  const warnings = [];
  if (typeof html !== 'string' || !html.trim()) {
    return { entries, warnings: ['文件内容为空。'] };
  }

  CELL_RE.lastIndex = 0;
  let m;
  while ((m = CELL_RE.exec(html)) !== null) {
    const attrs = m[1] || '';
    const idMatch = attrs.match(ID_RE);
    if (!idMatch) continue; // 不是课表格子（表头、明细表等）

    // id 里的数字末位是节次，前面是星期；星期为 0 时前缀会被省略（TD2_0 = 周一第三节）
    const digits = idMatch[1];
    const period = Number(digits.slice(-1));
    const dayIndex = digits.length > 1 ? Number(digits.slice(0, -1)) : 0;
    if (!Number.isInteger(period) || !Number.isInteger(dayIndex)) continue;
    if (dayIndex > 6 || period > 9) continue;

    const text = stripHtml(m[2]);
    if (!text) continue;

    const span = Number(attrs.match(ROWSPAN_RE)?.[1] || 1) || 1;

    // 一个格子里可能挤了不止一门课
    for (const chunk of splitCourses(m[2])) {
      const parsed = parseCourseText(chunk);
      if (!parsed) {
        warnings.push(`无法识别的课程格式：${chunk.slice(0, 60)}`);
        continue;
      }
      entries.push({
        ...parsed,
        /** ISO 星期：1=周一 … 7=周日 */
        weekday: dayIndex === 6 ? 7 : dayIndex + 1,
        startPeriod: period + 1,
        endPeriod: period + span
      });
    }
  }

  return { entries: dedupe(entries), warnings };
}

/** 一个格子里用 <br> 分隔的多门课 */
function splitCourses(innerHtml) {
  return innerHtml
    .split(/<br\s*\/?>/i)
    .map(stripHtml)
    .filter(Boolean);
}

function stripHtml(s) {
  return String(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * `课程名(课程号) (教学班) (周次,地点)`
 * 从右往左剥括号，课程名里本身可能带括号，所以不能从左边贪婪匹配。
 */
function parseCourseText(text) {
  const groups = [];
  let rest = text.trim();

  // 从末尾连续摘掉 3 个括号组（周次+地点 / 教学班 / 课程号）
  for (let i = 0; i < 3; i++) {
    const g = takeTrailingParen(rest);
    if (!g) break;
    groups.unshift(g.inner);
    rest = g.head.trim();
  }
  if (groups.length < 1) return null;

  const name = rest || text.trim();
  if (!name) return null;

  const weekPlace = groups[groups.length - 1];
  const wp = weekPlace.match(WEEK_PLACE_RE);
  if (!wp) return null; // 最后一组不是「周次,地点」，说明格式对不上，不猜

  const weeks = parseWeeks(wp[1]);
  if (!weeks.length) return null;

  return {
    name,
    code: groups.length >= 3 ? groups[0] : '',
    classes: groups.length >= 2 ? groups[groups.length - 2] : '',
    weeksText: wp[1].replace(/\s+/g, ''),
    weeks,
    place: wp[2]
  };
}

/** 摘掉字符串末尾配对的一组括号，返回 { head, inner } */
function takeTrailingParen(s) {
  const str = s.trimEnd();
  if (!str.endsWith(')') && !str.endsWith('）')) return null;
  let depth = 0;
  for (let i = str.length - 1; i >= 0; i--) {
    const c = str[i];
    if (c === ')' || c === '）') depth++;
    else if (c === '(' || c === '（') {
      depth--;
      if (depth === 0) return { head: str.slice(0, i), inner: str.slice(i + 1, -1) };
    }
  }
  return null;
}

/** '1-4' / '4-11' / '1-16(单)' / '3,5,7' → [周次数字] */
export function parseWeeks(spec) {
  const out = new Set();
  for (const part of String(spec).split(/[,，、]/)) {
    const t = part.trim();
    if (!t) continue;
    const parity = /单/.test(t) ? 'odd' : /双/.test(t) ? 'even' : null;
    const m = t.match(/^(\d+)(?:\s*-\s*(\d+))?/);
    if (!m) continue;
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    if (!from || to < from || to > 60) continue;
    for (let w = from; w <= to; w++) {
      if (parity === 'odd' && w % 2 === 0) continue;
      if (parity === 'even' && w % 2 === 1) continue;
      out.add(w);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** 同一门课在同一天同一节次可能被导出重复，去掉 */
function dedupe(entries) {
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    const key = [e.code, e.name, e.weekday, e.startPeriod, e.endPeriod, e.weeksText, e.place].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out.sort(
    (a, b) => a.weekday - b.weekday || a.startPeriod - b.startPeriod || a.name.localeCompare(b.name)
  );
}

/* ------------------------------------------------------------------ */
/* 生成待办                                                            */
/* ------------------------------------------------------------------ */

/** 常见的十节课作息，用户可在导入界面里改 */
export const DEFAULT_PERIOD_TIMES = [
  '08:00',
  '08:55',
  '10:00',
  '10:55',
  '14:00',
  '14:55',
  '16:00',
  '16:55',
  '19:00',
  '19:55'
];

/**
 * 把解析出来的课程摊平成一条条待办。
 *
 * @param {ScheduleEntry[]} entries
 * @param {object} opts
 * @param {string} opts.firstMonday 第 1 周周一的日期 'YYYY-MM-DD'（主时区墙钟日期）
 * @param {string[]} opts.periodTimes 十个节次的开始时间
 * @param {string} opts.tz 主时区
 * @param {boolean} [opts.withPlace] 标题里带上地点
 * @returns {{ todos: {title,date,time}[], skipped: number }}
 */
export function buildScheduleTodos(entries, { firstMonday, periodTimes, tz, withPlace = true }) {
  const base = fromYmd(firstMonday, tz);
  if (!base.isValid) throw new Error('第 1 周周一的日期不合法');

  // 用户可能选了非周一的日期，往前对齐到当周周一，避免整体错位
  const mondayStr = ymd(base.minus({ days: base.weekday - 1 }));

  const times = Array.isArray(periodTimes) && periodTimes.length ? periodTimes : DEFAULT_PERIOD_TIMES;
  const todos = [];
  let skipped = 0;

  for (const e of entries) {
    const time = times[e.startPeriod - 1] || null;
    for (const week of e.weeks) {
      const offset = (week - 1) * 7 + (e.weekday - 1);
      if (offset < 0) {
        skipped++;
        continue;
      }
      const date = addDays(mondayStr, offset, tz);
      const periodText =
        e.startPeriod === e.endPeriod ? `第${e.startPeriod}节` : `第${e.startPeriod}-${e.endPeriod}节`;
      const title = [e.name, periodText, withPlace && e.place ? e.place : '']
        .filter(Boolean)
        .join(' · ');
      todos.push({ title, date, time });
    }
  }

  return { todos, skipped };
}

/** 导入前给用户看的摘要：一门课一行 */
export function summarize(entries) {
  const WD = ['一', '二', '三', '四', '五', '六', '日'];
  return entries.map((e) => ({
    name: e.name,
    when: `周${WD[e.weekday - 1]} 第${e.startPeriod}${
      e.endPeriod !== e.startPeriod ? `-${e.endPeriod}` : ''
    }节`,
    weeks: `${e.weeksText} 周`,
    count: e.weeks.length,
    place: e.place
  }));
}
