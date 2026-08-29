import { DateTime } from 'luxon';
import { icons } from '../lib/icons.js';
import { calendarSubLabel } from '../lib/lunar.js';
import { hasYear, holidayOf } from '../lib/holidays.js';
import { dayDotState } from '../lib/todos.js';
import { fromYmd, weekdayShortCN, ymd } from '../lib/time.js';
import { state, tz } from '../state.js';

const CELLS = 42; // 7 列 × 6 行固定，避免月份切换时窗口高度跳动

/**
 * 月历。"今天"永远取 state.today（主时区的今天），
 * 副时区的日期不在日历上做任何标记。
 */
export function createCalendar({ onSelectDate, onGoToday, onChangeMonth, onToggle }) {
  // 月份导航条本身就是这个分区的标题栏（折叠后仍然可见），
  // 所以 head 与 body 分开返回，由 createSection 分别挂载。
  const head = document.createElement('div');
  head.className = 'cal__head';
  head.innerHTML = `
    <button class="cal__nav" data-nav="-1" title="上个月">${icons.chevronLeft}</button>
    <button class="cal__label" type="button" title="点击折叠 / 展开月历"></button>
    <button class="cal__nav" data-nav="1" title="下个月">${icons.chevronRight}</button>
    <div class="cal__spacer"></div>
    <span class="cal__nodata"></span>
    <button class="cal__today" type="button">今天</button>
    <button class="cal__fold" type="button" title="折叠 / 展开月历">
      <span class="section__chevron">${icons.chevronDown}</span>
    </button>
  `;

  const el = document.createElement('div');
  el.className = 'cal';
  el.innerHTML = `
    <div class="cal__weekdays"></div>
    <div class="cal__grid"></div>
  `;

  const $label = head.querySelector('.cal__label');
  const $nodata = head.querySelector('.cal__nodata');
  const $weekdays = el.querySelector('.cal__weekdays');
  const $grid = el.querySelector('.cal__grid');

  head.querySelectorAll('.cal__nav').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onChangeMonth(Number(b.dataset.nav));
    })
  );
  head.querySelector('.cal__today').addEventListener('click', (e) => {
    e.stopPropagation();
    onGoToday();
  });
  // 整条标题栏都是折叠热区，只有翻月和「今天」这几个按钮除外
  head.addEventListener('click', (e) => {
    if (e.target.closest('.cal__nav, .cal__today')) return;
    onToggle();
  });

  /** @type {{el:HTMLElement,num:HTMLElement,sub:HTMLElement,badge:HTMLElement,dot:HTMLElement,date:string}[]} */
  let cells = [];
  let gridKey = '';
  let weekKey = '';

  $grid.addEventListener('click', (e) => {
    const cell = e.target.closest('.day');
    if (cell && cell.dataset.date) onSelectDate(cell.dataset.date);
  });

  function buildWeekdays(weekStart) {
    $weekdays.textContent = '';
    // luxon: 1=周一 … 7=周日
    const order = weekStart === 'sunday' ? [7, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 7];
    for (const w of order) {
      const d = document.createElement('div');
      d.textContent = weekdayShortCN(w);
      if (w === 6 || w === 7) d.className = 'is-weekend';
      $weekdays.appendChild(d);
    }
  }

  function buildGrid(year, month, weekStart) {
    $grid.textContent = '';
    cells = [];

    const first = DateTime.fromObject({ year, month, day: 1 }, { zone: tz() });
    // 周一起始时 offset = weekday-1；周日起始时周日(7)要变成 0
    const offset = weekStart === 'sunday' ? first.weekday % 7 : first.weekday - 1;
    const start = first.minus({ days: offset });

    for (let i = 0; i < CELLS; i++) {
      const dt = start.plus({ days: i });
      const dateStr = ymd(dt);

      const cell = document.createElement('div');
      cell.className = 'day';
      cell.dataset.date = dateStr;
      cell.innerHTML = `
        <span class="day__badge"></span>
        <span class="day__num"></span>
        <span class="day__sub"></span>
        <span class="day__dot"></span>
      `;

      const num = cell.querySelector('.day__num');
      const sub = cell.querySelector('.day__sub');
      const badge = cell.querySelector('.day__badge');
      const dot = cell.querySelector('.day__dot');

      num.textContent = String(dt.day);
      if (dt.month !== month) cell.classList.add('is-out');
      if (dt.weekday === 6 || dt.weekday === 7) cell.classList.add('is-weekend');

      cells.push({ el: cell, num, sub, badge, dot, date: dateStr, weekday: dt.weekday });
      $grid.appendChild(cell);
    }
  }

  function update() {
    const s = state.settings;
    if (!s) return;

    const year = state.viewYear;
    const month = state.viewMonth;

    if (weekKey !== s.weekStart) {
      weekKey = s.weekStart;
      buildWeekdays(s.weekStart);
      gridKey = ''; // 起始日变了，格子要重排
    }

    const key = `${year}-${month}-${s.weekStart}`;
    if (key !== gridKey) {
      gridKey = key;
      buildGrid(year, month, s.weekStart);
    }

    $label.textContent = `${year}年 ${month}月`;
    $nodata.textContent = s.showHolidayBadge && !hasYear(year) ? `${year} 年节假日数据未配置` : '';

    for (const c of cells) {
      const holiday = s.showHolidayBadge ? holidayOf(c.date) : null;

      // 小字：法定节日 > 节气 > 农历初一 'X月' > 农历日
      if (s.showLunar) {
        const label = calendarSubLabel(c.date, holiday);
        c.sub.textContent = label.text;
        c.sub.className = `day__sub is-${label.kind}`;
      } else {
        c.sub.textContent = '';
        c.sub.className = 'day__sub';
      }

      // 休 / 班 角标
      if (holiday) {
        c.badge.textContent = holiday.type === 'holiday' ? '休' : '班';
        c.badge.className = `day__badge is-${holiday.type === 'holiday' ? 'rest' : 'work'}`;
        c.badge.title = holiday.name || '';
      } else {
        c.badge.textContent = '';
        c.badge.className = 'day__badge';
        c.badge.title = '';
      }

      // 待办圆点
      const dot = dayDotState(state.todos, c.date);
      c.dot.className = dot === 'none' ? 'day__dot' : `day__dot is-${dot}`;

      c.el.classList.toggle('is-today', c.date === state.today);
      c.el.classList.toggle('is-selected', c.date === state.selectedDate);
    }
  }

  return { head, el, update };
}

/** 给定日期字符串所属的年月，用于同步月历视图 */
export function monthOf(dateStr, zone) {
  const dt = fromYmd(dateStr, zone);
  return { year: dt.year, month: dt.month };
}
