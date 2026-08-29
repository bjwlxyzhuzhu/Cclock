import { Solar } from 'lunar-javascript';

/**
 * lunar-javascript 的薄封装。纯离线算法，无网络请求。
 * 输入一律是"主时区下的年月日"，由调用方保证。
 */

const cache = new Map();

/**
 * @param {string} dateStr 'YYYY-MM-DD'（主时区墙钟日期）
 */
export function lunarOf(dateStr) {
  const hit = cache.get(dateStr);
  if (hit) return hit;

  const [y, m, d] = dateStr.split('-').map(Number);
  const solar = Solar.fromYmd(y, m, d);
  const lunar = solar.getLunar();

  const info = {
    /** 干支年，如 '丙午' */
    ganZhiYear: lunar.getYearInGanZhi(),
    /** 生肖，如 '马' */
    shengXiao: lunar.getYearShengXiao(),
    /** 农历月中文，如 '七'；闰月前面带 '闰' */
    monthCN: (lunar.getMonth() < 0 ? '闰' : '') + lunar.getMonthInChinese(),
    /** 农历日中文，如 '十七' */
    dayCN: lunar.getDayInChinese(),
    /** 是否农历初一 */
    isMonthStart: lunar.getDay() === 1,
    /** 当天恰好是节气时返回节气名，否则为空串 */
    jieQi: lunar.getJieQi() || '',
    /** 农历节日，如 ['春节'] */
    lunarFestivals: safeList(lunar.getFestivals()),
    /** 公历节日，如 ['元旦'] */
    solarFestivals: safeList(solar.getFestivals())
  };

  /** '七月十七' */
  info.monthDayCN = `${info.monthCN}月${info.dayCN}`;
  /** '丙午·马·七月十七' */
  info.fullCN = `${info.ganZhiYear}·${info.shengXiao}·${info.monthDayCN}`;

  cache.set(dateStr, info);
  return info;
}

/**
 * 月历格子里那行小字。优先级：法定节日 > 节气 > 农历初一显示 'X月' > 农历日。
 * @param {string} dateStr
 * @param {{type:string,name:string}|null} holiday 来自 holidays.js
 * @returns {{ text: string, kind: 'festival'|'jieqi'|'month'|'day' }}
 */
export function calendarSubLabel(dateStr, holiday) {
  const l = lunarOf(dateStr);

  // 1) 法定节日：优先用节假日数据里的名字，其次用库内置的节日名
  if (holiday && holiday.type === 'holiday' && holiday.name) {
    return { text: shorten(holiday.name), kind: 'festival' };
  }
  const fest = l.lunarFestivals[0] || l.solarFestivals[0];
  if (fest) return { text: shorten(fest), kind: 'festival' };

  // 2) 节气
  if (l.jieQi) return { text: l.jieQi, kind: 'jieqi' };

  // 3) 农历初一显示月份
  if (l.isMonthStart) return { text: `${l.monthCN}月`, kind: 'month' };

  // 4) 农历日
  return { text: l.dayCN, kind: 'day' };
}

function shorten(name) {
  // 格子只有 ~44px 宽，节日名超过 3 字会撑破布局
  const map = {
    国际劳动节: '劳动节',
    中华人民共和国国庆节: '国庆',
    国庆节: '国庆',
    中秋节: '中秋',
    端午节: '端午',
    清明节: '清明',
    春节: '春节',
    元旦节: '元旦'
  };
  const mapped = map[name] || name;
  return mapped.length > 3 ? mapped.slice(0, 3) : mapped;
}

function safeList(v) {
  return Array.isArray(v) ? v.filter(Boolean).map(String) : [];
}
