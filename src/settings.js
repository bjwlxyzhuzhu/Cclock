import './styles/settings.css';

import { icons } from './lib/icons.js';
import { describe, displayName, searchTimezones } from './lib/timezones.js';
import { configuredYears } from './lib/holidays.js';
import { openCropDialog } from './components/CropDialog.js';
import { openScheduleDialog } from './components/ScheduleDialog.js';

const api = window.clock;

let settings = null;
let systemTimezone = 'UTC';
let dataPath = '';
let hotkeyError = null;
let appVersion = '';

const MAX_EXTRA_ZONES = 5;

/* ------------------------------------------------------------------ */

const root = document.createElement('div');
root.className = 'spane';

const bar = document.createElement('div');
bar.className = 'sbar';
bar.innerHTML = `
  <span class="sbar__title">设置</span>
  <button class="sbar__close" type="button" title="关闭">${icons.close}</button>
`;
bar.querySelector('.sbar__close').addEventListener('click', () => api.closeWindow());

document.body.appendChild(bar);
document.body.appendChild(root);

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function el(tag, className, html) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (html != null) n.innerHTML = html;
  return n;
}

function group(title) {
  const g = el('div', 'group');
  g.appendChild(el('div', 'group__title', title));
  return g;
}

function row(labelHtml, controlNode, hint) {
  const r = el('div', 'row');
  const label = el('div', 'row__label');
  label.innerHTML = labelHtml;
  if (hint) label.appendChild(el('span', 'row__hint', hint));
  r.appendChild(label);
  const c = el('div', 'row__control');
  if (controlNode) c.appendChild(controlNode);
  r.appendChild(c);
  return r;
}

function toggle(key, onChange) {
  const b = el('button', 'switch');
  b.type = 'button';
  b.dataset.key = key;
  b.setAttribute('role', 'switch');
  const sync = () => {
    b.classList.toggle('is-on', !!settings[key]);
    b.setAttribute('aria-checked', String(!!settings[key]));
  };
  b.addEventListener('click', async () => {
    const next = !settings[key];
    await patch({ [key]: next });
    sync();
    onChange?.(next);
  });
  sync();
  return b;
}

function select(key, options, onChange) {
  const s = el('select', 'field');
  for (const [value, label] of options) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    s.appendChild(o);
  }
  s.value = String(settings[key]);
  s.addEventListener('change', async () => {
    await patch({ [key]: s.value });
    onChange?.(s.value);
  });
  return s;
}

async function patch(p) {
  const res = await api.patchSettings(p);
  settings = res.settings;
  hotkeyError = res.hotkeyError;
  applyTheme();
  return res;
}

function applyTheme() {
  document.documentElement.dataset.theme = settings.theme || 'sky';
}

/* ------------------------------------------------------------------ */
/* 时间                                                                */
/* ------------------------------------------------------------------ */

function buildTimeGroup() {
  const g = group('时间');

  /* --- 主时区 --- */
  const current = el('div', 'row');
  const currentLabel = el('div', 'row__label');
  currentLabel.innerHTML = '<b>主时区</b>';
  const hint = el('span', 'row__hint');
  currentLabel.appendChild(hint);
  current.appendChild(currentLabel);
  g.appendChild(current);

  const picker = el('div', 'tzpicker');
  picker.innerHTML = `
    <input class="tzpicker__search" type="text" placeholder="搜索城市 / 拼音 / IANA 标识，如 北京、Tokyo、Asia/" />
    <div class="tzpicker__list"></div>
  `;
  const $search = picker.querySelector('.tzpicker__search');
  const $list = picker.querySelector('.tzpicker__list');

  function renderList() {
    const results = searchTimezones($search.value, settings.primaryTimezone, 80);
    $list.textContent = '';
    for (const r of results) {
      const b = el('button', `tzrow${r.tz === settings.primaryTimezone ? ' is-on' : ''}`);
      b.type = 'button';
      b.innerHTML = `
        <span class="tzrow__name"></span>
        <span class="tzrow__id"></span>
        <span class="tzrow__time"></span>
        <span class="tzrow__off"></span>
      `;
      b.querySelector('.tzrow__name').textContent = r.name;
      b.querySelector('.tzrow__id').textContent = r.tz;
      b.querySelector('.tzrow__time').textContent = r.time;
      b.querySelector('.tzrow__off').textContent = r.offset;
      b.addEventListener('click', () => changePrimary(r.tz));
      $list.appendChild(b);
    }
  }

  async function changePrimary(nextTz) {
    if (nextTz === settings.primaryTimezone) return;
    // §4.3：待办存的是主时区墙钟时间，切换时数字不变，必须先说清楚
    const ok = window.confirm(
      `把主时区切换到「${displayName(nextTz)}」（${nextTz}）？\n\n` +
        '已有待办的日期和时间数字不会改变 —— 原来的 15:00 仍然是 15:00，\n' +
        '只是从现在起按新主时区来理解这个 15:00。\n\n' +
        '日历的"今天"、待办的过期判定也会立刻改按新主时区计算。'
    );
    if (!ok) return;
    await patch({ primaryTimezone: nextTz });
    syncPrimary();
    renderList();
    renderZoneList();
  }

  function syncPrimary() {
    const d = describe(settings.primaryTimezone, settings.primaryTimezone);
    hint.textContent = `当前：${d.name} · ${settings.primaryTimezone} · ${d.date} ${d.time}`;
  }

  $search.addEventListener('input', renderList);
  g.appendChild(picker);
  syncPrimary();
  renderList();

  /* --- 副时区列表 --- */
  const zoneWrap = el('div', 'row row--stack');
  zoneWrap.innerHTML =
    '<div class="row__label"><b>副时区</b><span class="row__hint">只作参考展示，时差以主时区为基准实时计算（自动跟随夏令时）。第一项固定为系统时区，可隐藏但不可删。</span></div>';
  const zlist = el('div', 'zlist');
  zoneWrap.appendChild(zlist);

  const addBar = el('div', 'row');
  const addSearch = el('input', 'field');
  addSearch.type = 'text';
  addSearch.placeholder = '搜索并回车添加副时区…';
  addSearch.style.flex = '1';
  const addResults = el('div', 'tzpicker');
  addResults.hidden = true;
  addResults.innerHTML = '<div class="tzpicker__list"></div>';
  const $addList = addResults.querySelector('.tzpicker__list');

  addSearch.addEventListener('input', () => {
    const q = addSearch.value.trim();
    if (!q) {
      addResults.hidden = true;
      return;
    }
    const results = searchTimezones(q, settings.primaryTimezone, 20);
    $addList.textContent = '';
    for (const r of results) {
      const b = el('button', 'tzrow');
      b.type = 'button';
      b.innerHTML = `<span class="tzrow__name"></span><span class="tzrow__id"></span><span class="tzrow__time"></span><span class="tzrow__off"></span>`;
      b.querySelector('.tzrow__name').textContent = r.name;
      b.querySelector('.tzrow__id').textContent = r.tz;
      b.querySelector('.tzrow__time').textContent = r.time;
      b.querySelector('.tzrow__off').textContent = r.offset;
      b.addEventListener('click', async () => {
        await addZone(r.tz);
        addSearch.value = '';
        addResults.hidden = true;
      });
      $addList.appendChild(b);
    }
    addResults.hidden = results.length === 0;
  });

  const addNote = el('div', 'note');
  addBar.appendChild(addSearch);

  async function addZone(tz) {
    const list = [...settings.secondaryTimezones];
    if (list.includes(tz)) return;
    if (list.length - 1 >= MAX_EXTRA_ZONES) {
      addNote.textContent = `最多只能再添加 ${MAX_EXTRA_ZONES} 个副时区。`;
      addNote.className = 'note is-error';
      addNote.hidden = false;
      return;
    }
    addNote.textContent = '';
    addNote.className = 'note';
    addNote.hidden = true;
    await patch({ secondaryTimezones: [...list, tz] });
    renderZoneList();
  }

  async function removeZone(tz) {
    await patch({ secondaryTimezones: settings.secondaryTimezones.filter((z) => z !== tz) });
    renderZoneList();
  }

  async function moveZone(index, delta) {
    const list = [...settings.secondaryTimezones];
    const to = index + delta;
    if (to < 1 || to >= list.length) return; // 0 号位固定给系统时区
    [list[index], list[to]] = [list[to], list[index]];
    await patch({ secondaryTimezones: list });
    renderZoneList();
  }

  function renderZoneList() {
    zlist.textContent = '';
    settings.secondaryTimezones.forEach((entry, i) => {
      const isSystem = entry === 'system';
      const zone = isSystem ? systemTimezone : entry;
      const d = describe(zone, settings.primaryTimezone);

      const item = el('div', 'zitem');
      const name = el('div', 'zitem__name');
      name.textContent = `${d.name}${isSystem ? '（本机）' : ''}`;
      const idSpan = el('span', 'zitem__id', '');
      idSpan.textContent = ` ${zone} · ${d.time} ${d.offset}`;
      name.appendChild(idSpan);
      item.appendChild(name);

      if (isSystem) {
        const hideBtn = el('button', 'btn');
        hideBtn.type = 'button';
        hideBtn.textContent = settings.hideSystemClock ? '已隐藏' : '隐藏';
        hideBtn.addEventListener('click', async () => {
          await patch({ hideSystemClock: !settings.hideSystemClock });
          renderZoneList();
        });
        item.appendChild(hideBtn);
      } else {
        const up = el('button', 'zitem__btn', icons.chevronLeft);
        up.type = 'button';
        up.title = '上移';
        up.style.transform = 'rotate(90deg)';
        up.disabled = i <= 1;
        up.addEventListener('click', () => moveZone(i, -1));

        const down = el('button', 'zitem__btn', icons.chevronRight);
        down.type = 'button';
        down.title = '下移';
        down.style.transform = 'rotate(90deg)';
        down.disabled = i >= settings.secondaryTimezones.length - 1;
        down.addEventListener('click', () => moveZone(i, 1));

        const del = el('button', 'zitem__btn', icons.trash);
        del.type = 'button';
        del.title = '移除';
        del.addEventListener('click', () => removeZone(entry));

        item.append(up, down, del);
      }
      zlist.appendChild(item);
    });
  }

  renderZoneList();
  addNote.hidden = true;
  g.append(zoneWrap, addBar, addResults, addNote);

  /* --- 时制 / 秒 --- */
  g.appendChild(
    row(
      '<b>时间格式</b>',
      select('hourFormat', [
        ['24h', '24 小时制'],
        ['12h', '12 小时制（AM/PM）']
      ])
    )
  );
  g.appendChild(row('<b>显示秒</b>', toggle('showSeconds'), '关闭后时钟只刷新到分钟，更省电。'));

  return g;
}

/* ------------------------------------------------------------------ */
/* 日历                                                                */
/* ------------------------------------------------------------------ */

function buildCalendarGroup() {
  const g = group('日历');
  g.appendChild(
    row(
      '<b>每周起始日</b>',
      select('weekStart', [
        ['monday', '周一'],
        ['sunday', '周日']
      ])
    )
  );
  g.appendChild(row('<b>显示农历</b>', toggle('showLunar'), '含干支、生肖、节气与传统节日。'));
  const years = configuredYears();
  g.appendChild(
    row(
      '<b>显示节假日「休 / 班」角标</b>',
      toggle('showHolidayBadge'),
      years.length
        ? `已内置节假日数据的年份：${years.join('、')}。数据完全离线，不会联网获取。`
        : '尚未内置任何年份的节假日数据。'
    )
  );
  return g;
}

/* ------------------------------------------------------------------ */
/* 待办                                                                */
/* ------------------------------------------------------------------ */

function buildTodoGroup() {
  const g = group('待办');

  const num = el('input', 'field');
  num.type = 'number';
  num.min = '1';
  num.max = '1440';
  num.step = '5';
  num.style.width = '84px';
  num.value = String(settings.upcomingThresholdMinutes);
  num.addEventListener('change', async () => {
    const v = Math.min(1440, Math.max(1, parseInt(num.value, 10) || 30));
    num.value = String(v);
    await patch({ upcomingThresholdMinutes: v });
  });
  const wrap = el('div', 'row__control');
  wrap.append(num, el('span', null, '分钟'));
  g.appendChild(row('<b>「即将到来」提醒阈值</b>', wrap, '距设定时间不足这个分钟数时，待办变橙色；过时变红色并置顶。'));

  g.appendChild(
    row('<b>显示「已完成」折叠区</b>', toggle('showCompletedSection'), '昨日及更早的已完成项会收进这里，永不自动删除。')
  );
  return g;
}

/* ------------------------------------------------------------------ */
/* 外观                                                                */
/* ------------------------------------------------------------------ */

function buildAppearanceGroup() {
  const g = group('外观');

  const themes = el('div', 'themes');
  const list = [
    ['sky', '天空'],
    ['dusk', '晚霞'],
    ['grass', '草绿'],
    ['huangzhong', '黄忠·战弓'],
    ['dark', '暗色'],
    ['plain', '纯色'],
    ['custom', '自定义图片']
  ];
  for (const [value, label] of list) {
    const b = el('button', `theme${settings.theme === value ? ' is-on' : ''}`);
    b.type = 'button';
    b.dataset.theme = value;
    b.innerHTML = `<div class="theme__swatch"></div><span class="theme__name">${label}</span>`;
    b.addEventListener('click', async () => {
      await patch({ theme: value });
      themes.querySelectorAll('.theme').forEach((n) => n.classList.toggle('is-on', n.dataset.theme === value));
    });
    themes.appendChild(b);
  }
  const themeRow = el('div', 'row row--stack');
  themeRow.innerHTML = '<div class="row__label"><b>主题</b></div>';
  themeRow.appendChild(themes);
  g.appendChild(themeRow);

  const range = document.createElement('input');
  range.type = 'range';
  range.min = '0.3';
  range.max = '1';
  range.step = '0.01';
  range.value = String(settings.opacity);
  const pct = el('span', null, `${Math.round(settings.opacity * 100)}%`);
  range.addEventListener('input', () => {
    pct.textContent = `${Math.round(Number(range.value) * 100)}%`;
  });
  range.addEventListener('change', () => patch({ opacity: Number(range.value) }));
  const opWrap = el('div', 'row__control');
  opWrap.append(range, pct);
  g.appendChild(row('<b>透明度</b>', opWrap, '只影响背景层，文字始终保持清晰。'));

  /* --- 自定义背景图 --- */
  const bgNote = el('div', 'note');
  bgNote.hidden = true;
  const showBgNote = (text, kind) => {
    bgNote.textContent = text;
    bgNote.className = `note${kind ? ` is-${kind}` : ''}`;
    bgNote.hidden = !text;
  };

  const pickBtn = el('button', 'btn btn--primary');
  pickBtn.type = 'button';
  pickBtn.textContent = settings.hasCustomBackground ? '换一张' : '上传图片…';

  const clearBtn = el('button', 'btn');
  clearBtn.type = 'button';
  clearBtn.textContent = '清除';
  clearBtn.hidden = !settings.hasCustomBackground;

  const markTheme = (value) =>
    themes.querySelectorAll('.theme').forEach((n) => n.classList.toggle('is-on', n.dataset.theme === value));

  pickBtn.addEventListener('click', async () => {
    showBgNote('', null);
    const picked = await api.pickBackground();
    if (picked.canceled) return;
    if (!picked.ok) {
      showBgNote(picked.error || '读取图片失败', 'error');
      return;
    }
    // 裁剪框按主窗口卡片的实际长宽比来，裁完刚好铺满不变形
    const cardSize = await api.cardSize();
    const saved = await openCropDialog({
      dataUri: picked.dataUri,
      cardSize,
      onConfirm: (png) => api.saveBackground(png)
    });
    if (!saved) return; // 用户取消了裁剪
    if (!saved.ok) {
      showBgNote(saved.error || '保存失败', 'error');
      return;
    }
    await patch({ theme: 'custom' });
    markTheme('custom');
    pickBtn.textContent = '换一张';
    clearBtn.hidden = false;
    showBgNote('背景已应用。想重新调裁剪范围，再上传一次即可。', 'ok');
  });

  clearBtn.addEventListener('click', async () => {
    await api.clearBackground();
    if (settings.theme === 'custom') {
      await patch({ theme: 'sky' });
      markTheme('sky');
    }
    pickBtn.textContent = '上传图片…';
    clearBtn.hidden = true;
    showBgNote('已清除自定义背景。', null);
  });

  const bgWrap = el('div', 'row__control');
  bgWrap.append(pickBtn, clearBtn);
  g.appendChild(
    row(
      '<b>自定义背景图</b>',
      bgWrap,
      '上传后弹出裁剪框，长宽比锁定为当前窗口尺寸，可拖动、滚轮缩放，实时预览，裁好即应用。'
    )
  );
  g.appendChild(bgNote);

  return g;
}

/* ------------------------------------------------------------------ */
/* 窗口                                                                */
/* ------------------------------------------------------------------ */

function buildWindowGroup() {
  const g = group('窗口');

  g.appendChild(row('<b>锁定位置</b>', toggle('locked'), '锁定后窗口不能被拖动。锁定 ≠ 置顶。'));
  g.appendChild(row('<b>总在最前</b>', toggle('alwaysOnTop'), '默认关闭；靠全局快捷键或托盘图标唤出即可。'));
  g.appendChild(row('<b>开机自启</b>', toggle('autoLaunch')));

  /* --- 全局快捷键录制 --- */
  const kbd = el('kbd');
  kbd.textContent = settings.globalHotkey || '（未设置）';
  kbd.tabIndex = 0;

  const recordBtn = el('button', 'btn');
  recordBtn.type = 'button';
  recordBtn.textContent = '录制';

  const note = el('div', 'note');
  note.hidden = true;

  let recording = false;

  function showNote(text, kind) {
    note.textContent = text;
    note.className = `note${kind ? ` is-${kind}` : ''}`;
    note.hidden = !text;
  }

  function stopRecording() {
    recording = false;
    kbd.classList.remove('is-recording');
    recordBtn.textContent = '录制';
    window.removeEventListener('keydown', onKey, true);
  }

  async function onKey(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      stopRecording();
      kbd.textContent = settings.globalHotkey || '（未设置）';
      return;
    }
    const accel = toAccelerator(e);
    if (!accel) return; // 还只按着修饰键
    kbd.textContent = accel;
    stopRecording();

    const res = await patch({ globalHotkey: accel });
    if (res.hotkeyError) showNote(res.hotkeyError, 'error');
    else showNote(`已生效：${accel}`, 'ok');
  }

  recordBtn.addEventListener('click', () => {
    if (recording) {
      stopRecording();
      return;
    }
    recording = true;
    kbd.classList.add('is-recording');
    kbd.textContent = '请按下组合键…';
    recordBtn.textContent = '取消';
    showNote('', null);
    window.addEventListener('keydown', onKey, true);
  });

  const hkWrap = el('div', 'row__control');
  hkWrap.append(kbd, recordBtn);
  g.appendChild(
    row('<b>全局快捷键</b>', hkWrap, '显示 / 隐藏窗口。别用 Alt+Space —— 那是 Windows 的系统窗口菜单快捷键。')
  );
  g.appendChild(note);

  if (hotkeyError) showNote(hotkeyError, 'error');

  return g;
}

/** 浏览器 KeyboardEvent → Electron Accelerator */
function toAccelerator(e) {
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');

  const code = e.code;
  let key = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^Numpad[0-9]$/.test(code)) key = `num${code.slice(6)}`;
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;
  else {
    const map = {
      Space: 'Space',
      Enter: 'Return',
      Tab: 'Tab',
      Backquote: '`',
      Minus: '-',
      Equal: '=',
      BracketLeft: '[',
      BracketRight: ']',
      Backslash: '\\',
      Semicolon: ';',
      Quote: "'",
      Comma: ',',
      Period: '.',
      Slash: '/',
      ArrowUp: 'Up',
      ArrowDown: 'Down',
      ArrowLeft: 'Left',
      ArrowRight: 'Right',
      Home: 'Home',
      End: 'End',
      PageUp: 'PageUp',
      PageDown: 'PageDown',
      Insert: 'Insert',
      Delete: 'Delete'
    };
    key = map[code] || null;
  }
  if (!key) return null;
  if (mods.length === 0) return null; // 全局快捷键必须带修饰键
  return [...mods, key].join('+');
}

/* ------------------------------------------------------------------ */
/* 数据                                                                */
/* ------------------------------------------------------------------ */

function buildDataGroup() {
  const g = group('数据');

  const pathRow = el('div', 'row');
  const pathLabel = el('div', 'row__label');
  pathLabel.innerHTML = '<b>数据文件</b>';
  const p = el('div', 'path');
  p.textContent = dataPath;
  pathLabel.appendChild(p);
  pathRow.appendChild(pathLabel);
  const openBtn = el('button', 'btn');
  openBtn.type = 'button';
  openBtn.textContent = '在资源管理器中打开';
  openBtn.addEventListener('click', () => api.revealData());
  const ctrl = el('div', 'row__control');
  ctrl.appendChild(openBtn);
  pathRow.appendChild(ctrl);
  g.appendChild(pathRow);

  const note = el('div', 'note');
  note.hidden = true;
  const show = (text, kind) => {
    note.textContent = text;
    note.className = `note${kind ? ` is-${kind}` : ''}`;
    note.hidden = false;
  };

  const exportBtn = el('button', 'btn btn--primary');
  exportBtn.type = 'button';
  exportBtn.textContent = '导出为 JSON';
  exportBtn.addEventListener('click', async () => {
    const res = await api.exportData();
    if (res.canceled) return;
    if (res.ok) show(`已导出到 ${res.path}`, 'ok');
    else show(res.error || '导出失败', 'error');
  });

  const importBtn = el('button', 'btn');
  importBtn.type = 'button';
  importBtn.textContent = '从 JSON 导入';
  importBtn.addEventListener('click', async () => {
    const ok = window.confirm(
      '导入会覆盖当前的全部设置与待办。\n现有数据会先自动备份为同目录下的 data.backup.json。\n\n确定继续吗？'
    );
    if (!ok) return;
    const res = await api.importData();
    if (res.canceled) return;
    if (res.ok) {
      show('导入成功，界面已刷新。', 'ok');
      const info = await api.bootstrap();
      settings = info.data.settings;
      render();
    } else {
      show(res.error || '导入失败', 'error');
    }
  });

  const btns = el('div', 'row__control');
  btns.append(exportBtn, importBtn);
  g.appendChild(row('<b>导入 / 导出</b>', btns, '明文 JSON，可以直接用文本编辑器修改。'));
  g.appendChild(note);

  /* --- 课表导入 --- */
  const schedNote = el('div', 'note');
  schedNote.hidden = true;
  const showSchedNote = (text, kind) => {
    schedNote.textContent = text;
    schedNote.className = `note${kind ? ` is-${kind}` : ''}`;
    schedNote.hidden = !text;
  };

  const schedBtn = el('button', 'btn');
  schedBtn.type = 'button';
  schedBtn.textContent = '导入课表…';
  schedBtn.addEventListener('click', async () => {
    showSchedNote('', null);
    const picked = await api.pickSchedule();
    if (picked.canceled) return;
    if (!picked.ok) {
      showSchedNote(picked.error || '读取失败', 'error');
      return;
    }
    const res = await openScheduleDialog({
      text: picked.text,
      fileName: picked.name,
      tz: settings.primaryTimezone,
      onImport: (todos, replace) =>
        api.appendTodos(
          todos.map((t) => ({ ...t, source: 'schedule' })),
          replace ? 'schedule' : null
        )
    });
    if (!res) return;
    if (res.ok) {
      showSchedNote(
        `已导入 ${res.added} 条课程待办` + (res.removed ? `，替换掉上次的 ${res.removed} 条。` : '。'),
        'ok'
      );
    } else {
      showSchedNote(res.error || '导入失败', 'error');
    }
  });

  const schedWrap = el('div', 'row__control');
  schedWrap.appendChild(schedBtn);
  g.appendChild(
    row(
      '<b>导入课表</b>',
      schedWrap,
      '支持教务系统导出的 .xls / .htm 课表（那种其实是 HTML 表格）。会按「第几周 + 星期几 + 第几节」' +
        '摊平成一条条带时间的待办，导入前可预览并调整节次时间。'
    )
  );
  g.appendChild(schedNote);

  return g;
}

/* ------------------------------------------------------------------ */
/* 关于                                                                */
/* ------------------------------------------------------------------ */

function buildAboutGroup() {
  const g = group('关于');
  const about = el('div', 'row__label');
  about.innerHTML = '<b>Cclock</b>';
  const meta = el('span', 'row__hint');
  meta.textContent = `版本 ${appVersion}　·　开发者：AI创赛贯通社`;
  about.appendChild(meta);
  const r = el('div', 'row');
  r.appendChild(about);
  g.appendChild(r);
  return g;
}

/* ------------------------------------------------------------------ */

function render() {
  applyTheme();
  root.textContent = '';
  root.append(
    buildTimeGroup(),
    buildCalendarGroup(),
    buildTodoGroup(),
    buildAppearanceGroup(),
    buildWindowGroup(),
    buildDataGroup(),
    buildAboutGroup()
  );
}

(async function boot() {
  const info = await api.bootstrap();
  settings = info.data.settings;
  systemTimezone = info.systemTimezone;
  dataPath = info.dataPath;
  hotkeyError = info.hotkeyError;
  appVersion = info.version;
  render();

  // 主窗口那边（托盘菜单、锁定按钮等）改了设置，这里跟着刷新
  api.onSettingsChanged((s) => {
    const themeChanged = s.theme !== settings.theme;
    settings = s;
    if (themeChanged) applyTheme();
    syncToggles();
  });
})();

/** 外部改动后同步开关类控件（不整页重绘，避免正在输入的框被打断） */
function syncToggles() {
  for (const sw of root.querySelectorAll('.switch[data-key]')) {
    const on = !!settings[sw.dataset.key];
    sw.classList.toggle('is-on', on);
    sw.setAttribute('aria-checked', String(on));
  }
}
