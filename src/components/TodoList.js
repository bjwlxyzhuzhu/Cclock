import { icons } from '../lib/icons.js';
import { fromYmd, formatDateCN, weekdayCN } from '../lib/time.js';
import { quickParse } from '../lib/quickParse.js';
import {
  anytimeTodos,
  archivedTodos,
  newTodo,
  overdueTodos,
  sortForDay,
  todoStatus,
  todosForDay
} from '../lib/todos.js';
import { state, tz } from '../state.js';

/**
 * 待办区。日期/时间一律按主时区墙钟时间理解。
 * 颜色状态是唯一的提醒机制 —— 不做系统通知弹窗。
 */
export function createTodoList({ commit, toast, onOverdueCountChange }) {
  const el = document.createElement('div');
  el.className = 'todos';
  el.innerHTML = `
    <button class="overdue-bar" type="button" hidden>
      ${icons.alert}<span class="overdue-bar__count"></span>
      <span class="overdue-bar__chev">${icons.chevronRight}</span>
    </button>
    <div class="todo-list"></div>
    <button class="archive-toggle" type="button" hidden>
      ${icons.chevronRight}<span class="archive-toggle__label"></span>
    </button>
    <div class="archive-list" hidden></div>
    <div class="addrow">
      ${icons.plus}
      <input class="addrow__input" type="text" placeholder="添加待办事项" maxlength="200" />
      <input class="addrow__timeinput" type="time" hidden />
      <button class="addrow__btn" type="button" title="设置时间">${icons.clock}</button>
    </div>
  `;
  el.querySelector('.addrow > svg')?.classList.add('addrow__plus');

  const $overdueBar = el.querySelector('.overdue-bar');
  const $overdueCount = el.querySelector('.overdue-bar__count');
  const $list = el.querySelector('.todo-list');
  const $archiveToggle = el.querySelector('.archive-toggle');
  const $archiveLabel = el.querySelector('.archive-toggle__label');
  const $archiveList = el.querySelector('.archive-list');
  const $input = el.querySelector('.addrow__input');
  const $timeInput = el.querySelector('.addrow__timeinput');
  const $timeBtn = el.querySelector('.addrow__btn');

  let lastSignature = '';
  let lastOverdue = -1;

  /* -------------------------- 事件 -------------------------- */

  $overdueBar.addEventListener('click', () => {
    state.overdueOpen = !state.overdueOpen;
    lastSignature = '';
    update();
  });

  $archiveToggle.addEventListener('click', () => {
    state.archiveOpen = !state.archiveOpen;
    lastSignature = '';
    update();
  });

  $timeBtn.addEventListener('click', () => {
    const showing = !$timeInput.hidden;
    $timeInput.hidden = showing;
    $timeBtn.classList.toggle('is-on', !showing);
    if (!showing) $timeInput.focus();
    else $timeInput.value = '';
  });

  $input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addFromInput();
    } else if (e.key === 'Escape') {
      $input.value = '';
      $input.blur();
    }
  });
  $timeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addFromInput();
    }
  });

  function addFromInput() {
    const raw = $input.value.trim();
    if (!raw) return;

    let date = state.selectedDate;
    let time = $timeInput.hidden ? null : $timeInput.value || null;
    let title = raw;

    // 快捷解析：只有真的解析出日期/时间时才采纳，否则原样当标题
    const parsed = quickParse(raw, state.selectedDate, state.today, tz());
    if (parsed && (parsed.date !== state.selectedDate || parsed.time)) {
      title = parsed.title;
      date = parsed.date;
      if (parsed.time && !time) time = parsed.time;
    }

    commit([...state.todos, newTodo({ title, date, time })]);
    $input.value = '';
    $timeInput.value = '';
    $timeInput.hidden = true;
    $timeBtn.classList.remove('is-on');
    $input.focus();
  }

  /* -------------------------- 渲染 -------------------------- */

  function statusOf(t) {
    return todoStatus(t, state.now, tz(), state.settings.upcomingThresholdMinutes);
  }

  function renderItem(t, { showDate = false } = {}) {
    const status = statusOf(t);
    const row = document.createElement('div');
    row.className = `todo is-${status}`;
    row.dataset.id = t.id;
    row.innerHTML = `
      <button class="todo__check" type="button" title="${t.done ? '标记未完成' : '标记完成'}">${icons.check}</button>
      <div class="todo__body">
        ${t.time ? `<span class="todo__time">${t.time}</span>` : ''}
        <span class="todo__title"></span>
        ${showDate && t.date ? `<span class="todo__date">${t.date.slice(5)}</span>` : ''}
      </div>
      <div class="todo__actions">
        <button class="todo__act" data-act="edit" type="button" title="编辑">${icons.pencil}</button>
        <button class="todo__act" data-act="del" type="button" title="删除">${icons.trash}</button>
      </div>
    `;
    const $title = row.querySelector('.todo__title');
    $title.textContent = t.title;

    row.querySelector('.todo__check').addEventListener('click', () => toggleDone(t.id));
    row.querySelector('[data-act="del"]').addEventListener('click', () => remove(t.id));
    row.querySelector('[data-act="edit"]').addEventListener('click', () => beginEdit(row, t));
    $title.addEventListener('dblclick', () => beginEdit(row, t));

    return row;
  }

  function beginEdit(row, todo) {
    if (state.editingId) return;
    state.editingId = todo.id;

    const $title = row.querySelector('.todo__title');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'todo__edit';
    input.value = todo.title;
    input.maxLength = 200;
    $title.replaceWith(input);
    input.focus();
    input.select();

    let settled = false;
    const finish = (save) => {
      if (settled) return;
      settled = true;
      state.editingId = null;
      const next = input.value.trim();
      if (save && next && next !== todo.title) {
        commit(state.todos.map((t) => (t.id === todo.id ? { ...t, title: next } : t)));
      } else {
        lastSignature = '';
        update();
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  function toggleDone(id) {
    commit(
      state.todos.map((t) =>
        t.id === id
          ? { ...t, done: !t.done, completedAt: !t.done ? new Date().toISOString() : null }
          : t
      )
    );
  }

  function remove(id) {
    const index = state.todos.findIndex((t) => t.id === id);
    if (index < 0) return;
    const removed = state.todos[index];
    commit(state.todos.filter((t) => t.id !== id));
    toast({
      text: `已删除「${truncate(removed.title, 12)}」`,
      action: '撤销',
      duration: 3000,
      onAction: () => {
        const next = [...state.todos];
        next.splice(Math.min(index, next.length), 0, removed);
        commit(next);
      }
    });
  }

  /** 待办分区标题栏的文字 */
  function titleText() {
    if (!state.selectedDate) return '待办';
    const dt = fromYmd(state.selectedDate, tz());
    const count = todosForDay(state.todos, state.selectedDate, state.today).filter((t) => !t.done).length;
    const isToday = state.selectedDate === state.today;
    return `${formatDateCN(dt)} ${weekdayCN(dt)}${isToday ? '（今天）' : ''} · ${count} 项`;
  }

  function update() {
    const s = state.settings;
    if (!s) return;
    if (state.editingId) return; // 行内编辑期间不重建列表

    const overdue = overdueTodos(state.todos, state.now, tz(), s.upcomingThresholdMinutes);
    if (overdue.length !== lastOverdue) {
      lastOverdue = overdue.length;
      onOverdueCountChange(overdue.length);
    }

    const dayList = sortForDay(
      todosForDay(state.todos, state.selectedDate, state.today),
      state.now,
      tz(),
      s.upcomingThresholdMinutes
    );
    const anytime = anytimeTodos(state.todos);
    const archived = s.showCompletedSection ? archivedTodos(state.todos, state.today) : [];

    // 只有真正变化时才重建 DOM —— 秒针跳动不应该让列表闪烁
    const sig = [
      state.selectedDate,
      state.today,
      state.overdueOpen ? 1 : 0,
      state.archiveOpen ? 1 : 0,
      overdue.length,
      dayList.map((t) => `${t.id}:${t.done ? 1 : 0}:${statusOf(t)}:${t.time || ''}:${t.title}`).join(','),
      anytime.map((t) => `${t.id}:${t.done ? 1 : 0}:${t.title}`).join(','),
      archived.length
    ].join('|');
    if (sig === lastSignature) return;
    lastSignature = sig;

    /* 逾期汇总条：只在今日视图顶部出现 */
    const showBar = overdue.length > 0 && state.selectedDate === state.today;
    $overdueBar.hidden = !showBar;
    if (showBar) {
      $overdueCount.textContent = `有 ${overdue.length} 项逾期未完成`;
      $overdueBar.classList.toggle('is-open', state.overdueOpen);
    }

    /* 主列表 */
    $list.textContent = '';
    if (showBar && state.overdueOpen) {
      $list.appendChild(group('逾期清单'));
      for (const t of overdue) $list.appendChild(renderItem(t, { showDate: true }));
    }

    if (dayList.length === 0 && anytime.length === 0 && !(showBar && state.overdueOpen)) {
      const empty = document.createElement('div');
      empty.className = 'todo-empty';
      empty.textContent = '这一天还没有安排';
      $list.appendChild(empty);
    } else {
      if (showBar && state.overdueOpen && dayList.length) $list.appendChild(group('当日'));
      for (const t of dayList) $list.appendChild(renderItem(t));
      if (anytime.length) {
        $list.appendChild(group('随时'));
        for (const t of anytime) $list.appendChild(renderItem(t));
      }
    }

    /* 已完成折叠区 */
    const showArchive = s.showCompletedSection && archived.length > 0;
    $archiveToggle.hidden = !showArchive;
    $archiveList.hidden = !showArchive || !state.archiveOpen;
    if (showArchive) {
      $archiveLabel.textContent = `已完成 (${archived.length})`;
      $archiveToggle.classList.toggle('is-open', state.archiveOpen);
      if (state.archiveOpen) {
        $archiveList.textContent = '';
        for (const t of archived) $archiveList.appendChild(renderItem(t, { showDate: true }));
      }
    }
  }

  function focusInput() {
    $input.focus();
  }

  return { el, update, titleText, focusInput, invalidate: () => (lastSignature = '') };
}

function group(text) {
  const d = document.createElement('div');
  d.className = 'todo-group';
  d.textContent = text;
  return d;
}

function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
