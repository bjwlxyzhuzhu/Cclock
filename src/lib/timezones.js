import { DateTime } from 'luxon';
import { offsetLabel } from './time.js';

/**
 * IANA 时区列表 + 中英对照。
 * 列表来自 Intl.supportedValuesOf('timeZone')，对照表内置常用城市，
 * 搜索时中文名、英文名、IANA 标识三者任一命中即可。
 */

/** IANA → 中文城市名。同一时区可给多个别名，第一个是显示名。 */
const CN_NAMES = {
  'Asia/Shanghai': ['北京', '上海', '中国'],
  'Asia/Chongqing': ['重庆'],
  'Asia/Urumqi': ['乌鲁木齐', '新疆'],
  'Asia/Hong_Kong': ['香港'],
  'Asia/Macau': ['澳门'],
  'Asia/Taipei': ['台北', '台湾'],
  'Asia/Tokyo': ['东京', '日本'],
  'Asia/Seoul': ['首尔', '韩国'],
  'Asia/Singapore': ['新加坡'],
  'Asia/Bangkok': ['曼谷', '泰国'],
  'Asia/Jakarta': ['雅加达', '印尼'],
  'Asia/Kuala_Lumpur': ['吉隆坡', '马来西亚'],
  'Asia/Manila': ['马尼拉', '菲律宾'],
  'Asia/Ho_Chi_Minh': ['胡志明市', '越南'],
  'Asia/Kolkata': ['新德里', '印度', '加尔各答'],
  'Asia/Calcutta': ['新德里', '印度'],
  'Asia/Dubai': ['迪拜', '阿联酋'],
  'Asia/Riyadh': ['利雅得', '沙特'],
  'Asia/Tehran': ['德黑兰', '伊朗'],
  'Asia/Jerusalem': ['耶路撒冷', '以色列'],
  'Asia/Karachi': ['卡拉奇', '巴基斯坦'],
  'Asia/Dhaka': ['达卡', '孟加拉'],
  'Asia/Kathmandu': ['加德满都', '尼泊尔'],
  'Asia/Yangon': ['仰光', '缅甸'],
  'Asia/Almaty': ['阿拉木图', '哈萨克斯坦'],
  'Asia/Tashkent': ['塔什干', '乌兹别克'],
  'Asia/Ulaanbaatar': ['乌兰巴托', '蒙古'],
  'Asia/Vladivostok': ['海参崴'],
  'Asia/Novosibirsk': ['新西伯利亚'],

  'Europe/London': ['伦敦', '英国'],
  'Europe/Dublin': ['都柏林', '爱尔兰'],
  'Europe/Paris': ['巴黎', '法国'],
  'Europe/Berlin': ['柏林', '德国'],
  'Europe/Amsterdam': ['阿姆斯特丹', '荷兰'],
  'Europe/Brussels': ['布鲁塞尔', '比利时'],
  'Europe/Madrid': ['马德里', '西班牙'],
  'Europe/Lisbon': ['里斯本', '葡萄牙'],
  'Europe/Rome': ['罗马', '意大利'],
  'Europe/Zurich': ['苏黎世', '瑞士'],
  'Europe/Vienna': ['维也纳', '奥地利'],
  'Europe/Stockholm': ['斯德哥尔摩', '瑞典'],
  'Europe/Oslo': ['奥斯陆', '挪威'],
  'Europe/Copenhagen': ['哥本哈根', '丹麦'],
  'Europe/Helsinki': ['赫尔辛基', '芬兰'],
  'Europe/Warsaw': ['华沙', '波兰'],
  'Europe/Prague': ['布拉格', '捷克'],
  'Europe/Budapest': ['布达佩斯', '匈牙利'],
  'Europe/Athens': ['雅典', '希腊'],
  'Europe/Istanbul': ['伊斯坦布尔', '土耳其'],
  'Europe/Moscow': ['莫斯科', '俄罗斯'],
  'Europe/Kyiv': ['基辅', '乌克兰'],
  'Europe/Kiev': ['基辅', '乌克兰'],

  'America/New_York': ['纽约', '美东'],
  'America/Chicago': ['芝加哥', '美中'],
  'America/Denver': ['丹佛', '美山区'],
  'America/Phoenix': ['凤凰城', '亚利桑那'],
  'America/Los_Angeles': ['洛杉矶', '美西', '旧金山', '西雅图'],
  'America/Anchorage': ['安克雷奇', '阿拉斯加'],
  'Pacific/Honolulu': ['檀香山', '夏威夷'],
  'America/Toronto': ['多伦多', '加拿大'],
  'America/Vancouver': ['温哥华'],
  'America/Montreal': ['蒙特利尔'],
  'America/Mexico_City': ['墨西哥城', '墨西哥'],
  'America/Bogota': ['波哥大', '哥伦比亚'],
  'America/Lima': ['利马', '秘鲁'],
  'America/Santiago': ['圣地亚哥', '智利'],
  'America/Sao_Paulo': ['圣保罗', '巴西'],
  'America/Buenos_Aires': ['布宜诺斯艾利斯', '阿根廷'],
  'America/Argentina/Buenos_Aires': ['布宜诺斯艾利斯', '阿根廷'],

  'Australia/Sydney': ['悉尼', '澳大利亚'],
  'Australia/Melbourne': ['墨尔本'],
  'Australia/Brisbane': ['布里斯班'],
  'Australia/Perth': ['珀斯'],
  'Australia/Adelaide': ['阿德莱德'],
  'Pacific/Auckland': ['奥克兰', '新西兰'],
  'Pacific/Fiji': ['斐济'],

  'Africa/Cairo': ['开罗', '埃及'],
  'Africa/Johannesburg': ['约翰内斯堡', '南非'],
  'Africa/Lagos': ['拉各斯', '尼日利亚'],
  'Africa/Nairobi': ['内罗毕', '肯尼亚'],
  'Africa/Casablanca': ['卡萨布兰卡', '摩洛哥'],

  UTC: ['协调世界时', 'UTC'],
  'Etc/UTC': ['协调世界时', 'UTC'],
  'Etc/GMT': ['格林尼治', 'GMT']
};

/** 全部可选时区（缓存一次） */
let ALL = null;

export function allTimezones() {
  if (ALL) return ALL;
  let list = [];
  try {
    list = Intl.supportedValuesOf('timeZone');
  } catch {
    list = Object.keys(CN_NAMES);
  }
  // 保证内置对照表里的时区都在（有些运行时的列表缺别名）
  const set = new Set(list);
  for (const k of Object.keys(CN_NAMES)) set.add(k);
  ALL = [...set].sort();
  return ALL;
}

/** 该时区的显示名：有中文名用中文名，否则用 IANA 末段 */
export function displayName(tz) {
  if (!tz) return '';
  const cn = CN_NAMES[tz];
  if (cn) return cn[0];
  const seg = tz.split('/').pop() || tz;
  return seg.replace(/_/g, ' ');
}

/** 搜索用的全部关键词 */
function keywordsOf(tz) {
  const cn = CN_NAMES[tz] || [];
  const segs = tz.split('/');
  return [tz.toLowerCase(), ...segs.map((s) => s.replace(/_/g, ' ').toLowerCase()), ...cn];
}

/**
 * 搜索时区。
 * @param {string} query
 * @param {string} primaryTz 用于算时差
 * @param {number} limit
 */
export function searchTimezones(query, primaryTz, limit = 60) {
  const q = String(query || '').trim().toLowerCase();
  const at = Date.now();
  const all = allTimezones();

  const matched = q
    ? all.filter((tz) => keywordsOf(tz).some((k) => k.includes(q)))
    : // 无搜索词时先给常用城市，再补全量
      [...Object.keys(CN_NAMES).filter((tz) => all.includes(tz)), ...all];

  const seen = new Set();
  const out = [];
  for (const tz of matched) {
    if (seen.has(tz)) continue;
    seen.add(tz);
    out.push(describe(tz, primaryTz, at));
    if (out.length >= limit) break;
  }
  return out;
}

/** 一条时区的展示信息：城市名 · IANA · 当前时间 · 时差 */
export function describe(tz, primaryTz, at = Date.now()) {
  const dt = DateTime.fromMillis(at, { zone: tz });
  return {
    tz,
    name: displayName(tz),
    valid: dt.isValid,
    time: dt.isValid ? dt.toFormat('HH:mm') : '--:--',
    date: dt.isValid ? dt.toFormat('MM-dd') : '--',
    offset: dt.isValid ? offsetLabel(tz, primaryTz, at) : ''
  };
}

export function isValidZone(tz) {
  return DateTime.now().setZone(tz).isValid;
}
