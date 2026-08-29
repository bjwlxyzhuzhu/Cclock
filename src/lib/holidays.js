/**
 * 法定节假日 / 调休数据。
 * 完全离线：src/data/holidays/*.json 在构建时被打进包里，不做任何网络请求。
 * 每年年底由作者手动放一个新年份的 JSON 进去即可。
 */

const modules = import.meta.glob('../data/holidays/*.json', { eager: true });

/** @type {Map<number, Record<string, {type:string,name:string}>>} */
const byYear = new Map();
/** @type {Map<number, {source?:string, updatedAt?:string}>} */
const metaByYear = new Map();

for (const [path, mod] of Object.entries(modules)) {
  const data = mod.default || mod;
  const year = Number(data?.year) || Number(path.match(/(\d{4})\.json$/)?.[1]);
  if (!year || !data?.days) continue;
  byYear.set(year, data.days);
  metaByYear.set(year, { source: data.source, updatedAt: data.updatedAt });
}

/** 该年份是否配置了节假日数据 */
export function hasYear(year) {
  return byYear.has(Number(year));
}

/**
 * @param {string} dateStr 'YYYY-MM-DD'
 * @returns {{type:'holiday'|'workday', name:string}|null}
 */
export function holidayOf(dateStr) {
  const year = Number(dateStr.slice(0, 4));
  const days = byYear.get(year);
  if (!days) return null;
  const hit = days[dateStr];
  if (!hit || (hit.type !== 'holiday' && hit.type !== 'workday')) return null;
  return { type: hit.type, name: hit.name || '' };
}

export function yearMeta(year) {
  return metaByYear.get(Number(year)) || null;
}

export function configuredYears() {
  return [...byYear.keys()].sort();
}
