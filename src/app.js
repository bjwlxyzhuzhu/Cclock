import './styles/app.css';

import { createClock } from './components/Clock.js';
import { createWorldClocks } from './components/WorldClocks.js';
import { createCalendar, monthOf } from './components/Calendar.js';
import { createTodoList } from './components/TodoList.js';
import { createTzPopover } from './components/TzPopover.js';
import { icons } from './lib/icons.js';
import { createTicker } from './lib/time.js';
import { displayName } from './lib/timezones.js';
import { refreshClock, state, tz } from './state.js';

const api = window.clock;

/* ------------------------------------------------------------------ */
/* 骨架                                                                */
/* ------------------------------------------------------------------ */

const card = document.createElement('div');
card.className = 'card';
card.innerHTML = `
  <div class="card__bg"></div>
  <div class="titlebar">
    <span class="titlebar__title">Cclock</span>
    <button class="iconbtn" data-act="lock" type="button"></button>
    <button class="iconbtn" data-act="settings" type="button" title="设置">${icons.gear}</button>
    <button class="iconbtn" data-act="hide" type="button" title="隐藏到托盘">${icons.minus}</button>
  </div>
  <div class="toasts"></div>
`;
document.body.appendChild(card);

const $toasts = card.querySelector('.toasts');
const $lockBtn = card.querySelector('[data-act="lock"]');

card.querySelector('[data-act="settings"]').addEventListener('click', () => api.openSettings());
card.querySelector('[data-act="hide"]').addEventListener('click', () => api.hideWindow());
$lockBtn.addEventListener('click', () => patch({ locked: !state.settings.locked }));

/* ------------------------------------------------------------------ */
/* 组件                                                                */
/* ------------------------------------------------------------------ */

const clock = createClock({ onPickTimezone: () => tzPopover.toggle() });

const worldClocks = createWorldClocks();
const secondarySection = createSection({
  key: 'secondaryClocks',
  title: () => '世界时间',
  body: worldClocks.el
});

const calendar = createCalendar({
  onSelectDate: (date) => {
    state.selectedDate = date;
    const m = monthOf(date, tz());
    state.viewYear = m.year;
    state.viewMonth = m.month;
    state.overdueOpen = false;
    fullUpdate();
  },
  onGoToday: () => {
    state.selectedDate = state.today;
    const m = monthOf(state.today, tz());
    state.viewYear = m.year;
    state.viewMonth = m.month;
    fullUpdate();
  },
  onToggle: () => calendarSection.toggle(),
  onChangeMonth: (delta) => {
    let y = state.viewYear;
    let m = state.viewMonth + delta;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    state.viewYear = y;
    state.viewMonth = m;
    fullUpdate();
  }
});
const calendarSection = createSection({
  key: 'calendar',
  head: calendar.head,
  body: calendar.el
});

const todos = createTodoList({
  commit: commitTodos,
  toast: showToast,
  onOverdueCountChange: (n) => api.setOverdue(n)
});
const todoSection = createSection({
  key: 'todos',
  title: () => todos.titleText(),
  body: todos.el
});

const tzPopover = createTzPopover({ onPick: changePrimaryTimezone });

card.appendChild(clock.el);
card.appendChild(secondarySection.el);
card.appendChild(calendarSection.el);
card.appendChild(todoSection.el);
card.appendChild(tzPopover.el);

/* 点击空白处收起弹层 / 右键呼出上下文菜单 */
document.addEventListener('click', () => tzPopover.close());
document.addEventListener('contextmenu', (e) => {
  if (e.target.closest('input')) return; // 输入框保留系统菜单
  e.preventDefault();
  api.contextMenu();
});

/* ------------------------------------------------------------------ */
/* 分区外壳                                                            */
/* ------------------------------------------------------------------ */

function createSection({ key, title, body, head }) {
  const el = document.createElement('div');
  el.className = 'section';

  let $title = null;
  if (head) {
    // 自定义标题栏（月历用它自己的月份导航条），折叠后仍然可见
    el.appendChild(head);
  } else {
    el.innerHTML = `
      <button class="section__head" type="button">
        <span class="section__title"></span>
        <span class="section__chevron">${icons.chevronDown}</span>
      </button>
    `;
    $title = el.querySelector('.section__title');
    el.querySelector('.section__head').addEventListener('click', toggle);
  }

  const wrap = document.createElement('div');
  wrap.className = 'section__body';
  wrap.appendChild(body);
  el.appendChild(wrap);

  function toggle() {
    const next = state.settings.sections[key] === 'expanded' ? 'collapsed' : 'expanded';
    patch({ sections: { [key]: next } });
  }

  return {
    el,
    toggle,
    update() {
      el.classList.toggle('is-collapsed', state.settings.sections[key] !== 'expanded');
      if ($title) $title.textContent = title();
    }
  };
}

/* ------------------------------------------------------------------ */
/* 状态更新                                                            */
/* ------------------------------------------------------------------ */

/** 每秒（或每分钟）跳一次：只动时间相关的部分 */
function tickUpdate() {
  const rolled = refreshClock();
  clock.update();
  worldClocks.update();
  todos.update();
  todoSection.update();
  if (rolled) fullUpdate(); // 跨过主时区午夜 → 今天变了，全量重画
}

/** 数据/设置变化后的全量重画 */
function fullUpdate() {
  if (!state.settings) return;
  applyAppearance();
  refreshClock();
  clock.update();
  worldClocks.update();
  secondarySection.update();
  calendar.update();
  calendarSection.update();
  todos.invalidate();
  todos.update();
  todoSection.update();
  scheduleResize();
}

/** 自定义背景图的 data URI，由主进程提供，只有 custom 主题用得上 */
let customBackground = null;

async function refreshCustomBackground() {
  customBackground = await api.getBackground();
  applyAppearance();
}

function applyAppearance() {
  const s = state.settings;
  document.documentElement.dataset.theme = s.theme || 'sky';
  if (s.theme === 'custom') {
    if (customBackground) {
      document.documentElement.style.setProperty(
        '--bg',
        `url("${customBackground}") center / cover no-repeat`
      );
    } else {
      // 还没取回来，先保持主题自带的渐变兜底，取到后会再画一次
      refreshCustomBackground();
    }
  } else {
    document.documentElement.style.removeProperty('--bg');
  }
  document.documentElement.style.setProperty('--bg-opacity', String(s.opacity ?? 0.85));
  document.body.dataset.locked = String(!!s.locked);
  document.body.dataset.noseconds = String(!s.showSeconds);
  $lockBtn.innerHTML = s.locked ? icons.lock : icons.unlock;
  $lockBtn.classList.toggle('is-on', !!s.locked);
  $lockBtn.title = s.locked ? '已锁定位置，点击解锁' : '未锁定，点击锁定位置';
}

async function patch(p) {
  const res = await api.patchSettings(p);
  state.settings = res.settings;
  fullUpdate();
  retickIfNeeded();
}

async function commitTodos(next) {
  state.todos = next;
  await api.setTodos(next);
  fullUpdate();
}

/** §4.3：切换主时区时，待办的时间数字保持不变，必须先说明清楚 */
async function changePrimaryTimezone(nextTz) {
  const ok = window.confirm(
    `切换主时区到「${displayName(nextTz)}」？\n\n` +
      '已有待办的日期和时间数字不会改变 —— 原来的 15:00 仍然是 15:00，\n' +
      '只是从现在起按新主时区来理解这个 15:00。'
  );
  if (!ok) return;

  const wasToday = state.selectedDate === state.today;
  await patch({ primaryTimezone: nextTz });
  refreshClock();
  if (wasToday) state.selectedDate = state.today;
  const m = monthOf(state.selectedDate, tz());
  state.viewYear = m.year;
  state.viewMonth = m.month;
  fullUpdate();
}

/* ------------------------------------------------------------------ */
/* Toast                                                               */
/* ------------------------------------------------------------------ */

function showToast({ text, action, onAction, duration = 3000, warn = false }) {
  const el = document.createElement('div');
  el.className = `toast${warn ? ' is-warn' : ''}`;
  el.innerHTML = `<span class="toast__text"></span>`;
  el.querySelector('.toast__text').textContent = text;

  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast__action';
    b.textContent = action;
    b.addEventListener('click', () => {
      close();
      onAction?.();
    });
    el.appendChild(b);
  }
  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast__action';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', close);
  el.appendChild(closeBtn);

  $toasts.appendChild(el);
  const timer = setTimeout(close, duration);

  function close() {
    clearTimeout(timer);
    el.remove();
    scheduleResize();
  }
}

/* ------------------------------------------------------------------ */
/* 窗口高度自适应                                                      */
/* ------------------------------------------------------------------ */

let resizeRaf = null;
let lastHeight = 0;

function scheduleResize() {
  if (resizeRaf) cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = null;
    const h = Math.ceil(card.getBoundingClientRect().height) + 20; // 上下各 10px 阴影留白
    if (Math.abs(h - lastHeight) < 1) return;
    lastHeight = h;
    api.setContentHeight(h);
  });
}

new ResizeObserver(scheduleResize).observe(card);

/* ------------------------------------------------------------------ */
/* 心跳                                                                */
/* ------------------------------------------------------------------ */

let ticker = null;
let tickerSeconds = null;

function retickIfNeeded() {
  const wantSeconds = !!state.settings.showSeconds;
  if (tickerSeconds === wantSeconds) return;
  tickerSeconds = wantSeconds;
  ticker?.stop();
  ticker = createTicker(() => (wantSeconds ? 1000 : 60000), tickUpdate);
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

(async function boot() {
  const info = await api.bootstrap();
  state.settings = info.data.settings;
  state.todos = info.data.todos;
  state.systemTimezone = info.systemTimezone;
  state.dataPath = info.dataPath;
  state.version = info.version;
  state.isDev = info.isDev;

  refreshClock();
  state.selectedDate = state.today;
  const m = monthOf(state.today, tz());
  state.viewYear = m.year;
  state.viewMonth = m.month;
  state.ready = true;

  fullUpdate();
  retickIfNeeded();

  if (info.corruptionNotice) {
    showToast({ text: info.corruptionNotice, duration: 12000, warn: true });
  }
  if (info.hotkeyError) {
    showToast({ text: info.hotkeyError, duration: 12000, warn: true });
  }

  api.onSettingsChanged((s) => {
    state.settings = s;
    fullUpdate();
    retickIfNeeded();
  });
  api.onTodosChanged((list) => {
    state.todos = list;
    fullUpdate();
  });
  api.onBackgroundChanged(() => {
    customBackground = null;
    refreshCustomBackground();
  });
  api.onPowerResume(() => {
    // 休眠唤醒后立刻强制刷新一次，不等下一个心跳
    refreshClock();
    ticker?.refresh();
    fullUpdate();
  });
})();
