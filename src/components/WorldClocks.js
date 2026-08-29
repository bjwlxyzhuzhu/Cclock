import { DateTime } from 'luxon';
import { offsetLabel } from '../lib/time.js';
import { displayName } from '../lib/timezones.js';
import { state, tz } from '../state.js';

/**
 * 副时区区：跟随系统时区的那条标"（本机）"，
 * 时差一律以主时区为基准实时计算（自动跟随夏令时）。
 */
export function createWorldClocks() {
  const el = document.createElement('div');
  el.className = 'worldclocks';

  /** 已渲染的行，按 key 复用 DOM */
  let rows = new Map();
  let lastKeys = '';

  function resolve(entry) {
    return entry === 'system' ? state.systemTimezone : entry;
  }

  function update() {
    const s = state.settings;
    if (!s) return;

    const list = (s.secondaryTimezones || [])
      .filter(Boolean)
      .filter((z) => !(z === 'system' && s.hideSystemClock));
    const keys = `${list.join('|')}|${state.systemTimezone}`;
    if (keys !== lastKeys) {
      lastKeys = keys;
      el.textContent = '';
      rows = new Map();
      for (const entry of list) {
        const row = buildRow(entry);
        rows.set(entry, row);
        el.appendChild(row.el);
      }
    }

    const primary = tz();
    const at = state.now.toMillis();
    const primaryDate = state.now.toFormat('MM-dd');

    for (const [entry, row] of rows) {
      const zone = resolve(entry);
      const dt = DateTime.fromMillis(at, { zone });
      if (!dt.isValid) {
        row.name.textContent = zone;
        row.date.textContent = '--';
        row.time.textContent = '--:--';
        row.offset.textContent = '';
        continue;
      }
      row.name.textContent = displayName(zone);
      row.local.textContent = entry === 'system' ? '（本机）' : '';
      const d = dt.toFormat('MM-dd');
      row.date.textContent = d;
      // 与主时区不是同一天的行，日期用不同颜色提示
      row.date.classList.toggle('is-otherday', d !== primaryDate);
      row.time.textContent = dt.toFormat('HH:mm');
      row.offset.textContent = offsetLabel(zone, primary, at);
    }
  }

  return { el, update };
}

function buildRow() {
  const el = document.createElement('div');
  el.className = 'wc';
  el.innerHTML = `
    <span class="wc__name"></span>
    <span class="wc__local"></span>
    <span class="wc__date"></span>
    <span class="wc__time"></span>
    <span class="wc__offset"></span>
  `;
  return {
    el,
    name: el.querySelector('.wc__name'),
    local: el.querySelector('.wc__local'),
    date: el.querySelector('.wc__date'),
    time: el.querySelector('.wc__time'),
    offset: el.querySelector('.wc__offset')
  };
}
