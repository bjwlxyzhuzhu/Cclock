import { searchTimezones } from '../lib/timezones.js';
import { state, tz } from '../state.js';

/**
 * 主时区快速切换弹层（点大时钟右上角的时区标签唤出）。
 * 完整的可搜索选择器在设置窗口里，这里是常用城市的快捷入口。
 */
export function createTzPopover({ onPick }) {
  const el = document.createElement('div');
  el.className = 'popover';
  el.hidden = true;
  el.innerHTML = `
    <input class="popover__search" type="text" placeholder="搜索城市或时区…" />
    <div class="popover__list"></div>
  `;

  const $search = el.querySelector('.popover__search');
  const $list = el.querySelector('.popover__list');

  $search.addEventListener('input', render);
  $search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter') {
      const first = $list.querySelector('.tzitem');
      if (first) first.click();
    }
  });
  el.addEventListener('click', (e) => e.stopPropagation());

  function render() {
    const primary = tz();
    const results = searchTimezones($search.value, primary, 40);
    $list.textContent = '';
    for (const r of results) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `tzitem${r.tz === primary ? ' is-current' : ''}`;
      b.innerHTML = `
        <span class="tzitem__name"></span>
        <span class="tzitem__id"></span>
        <span class="tzitem__time"></span>
        <span class="tzitem__off"></span>
      `;
      b.querySelector('.tzitem__name').textContent = r.name;
      b.querySelector('.tzitem__id').textContent = r.tz;
      b.querySelector('.tzitem__time').textContent = r.time;
      b.querySelector('.tzitem__off').textContent = r.offset;
      b.addEventListener('click', () => {
        close();
        if (r.tz !== primary) onPick(r.tz);
      });
      $list.appendChild(b);
    }
  }

  function open() {
    $search.value = '';
    render();
    el.hidden = false;
    $search.focus();
  }

  function close() {
    el.hidden = true;
  }

  function toggle() {
    if (el.hidden) open();
    else close();
  }

  return { el, open, close, toggle, isOpen: () => !el.hidden };
}
