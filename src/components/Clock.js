import { icons } from '../lib/icons.js';
import { formatClock, formatDateCN, weekdayCN } from '../lib/time.js';
import { lunarOf } from '../lib/lunar.js';
import { displayName } from '../lib/timezones.js';
import { state, tz } from '../state.js';

/**
 * 大时钟区：时间 / 日期 / 农历 / 主时区标签。常驻，不可折叠。
 * 秒级刷新只改文本节点，不重建 DOM。
 */
export function createClock({ onPickTimezone }) {
  const el = document.createElement('div');
  el.className = 'clock';
  el.innerHTML = `
    <div class="clock__row">
      <div class="clock__main">
        <span class="clock__time">--:--:--</span><span class="clock__ampm"></span>
      </div>
      <button class="tzbadge" type="button" title="点击切换主时区">
        ${icons.globe}<span class="tzbadge__name"></span>
      </button>
    </div>
    <div class="clock__date">
      <span class="clock__day"></span>
      <span class="clock__wd"></span>
      <span class="clock__lunar"></span>
    </div>
  `;

  const $time = el.querySelector('.clock__time');
  const $ampm = el.querySelector('.clock__ampm');
  const $badge = el.querySelector('.tzbadge');
  const $badgeName = el.querySelector('.tzbadge__name');
  const $day = el.querySelector('.clock__day');
  const $wd = el.querySelector('.clock__wd');
  const $lunar = el.querySelector('.clock__lunar');

  $badge.addEventListener('click', (e) => {
    e.stopPropagation();
    onPickTimezone($badge);
  });

  function update() {
    const s = state.settings;
    if (!s) return;

    const { text, suffix } = formatClock(state.now, {
      hourFormat: s.hourFormat,
      showSeconds: s.showSeconds
    });
    if ($time.textContent !== text) $time.textContent = text;
    if ($ampm.textContent !== suffix) $ampm.textContent = suffix;

    const name = displayName(tz());
    if ($badgeName.textContent !== name) $badgeName.textContent = name;

    const day = formatDateCN(state.now);
    if ($day.textContent !== day) $day.textContent = day;
    const wd = weekdayCN(state.now);
    if ($wd.textContent !== wd) $wd.textContent = wd;

    if (!s.showLunar) {
      $lunar.textContent = '';
      $lunar.classList.remove('is-jieqi');
      return;
    }
    const l = lunarOf(state.today);
    // 当天是节气时，农历位置改显节气名并高亮
    const lunarText = l.jieQi ? `${l.ganZhiYear}·${l.shengXiao}·${l.jieQi}` : l.fullCN;
    if ($lunar.textContent !== lunarText) $lunar.textContent = lunarText;
    $lunar.classList.toggle('is-jieqi', !!l.jieQi);
  }

  return { el, update };
}
