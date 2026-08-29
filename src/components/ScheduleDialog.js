import {
  parseScheduleHtml,
  summarize,
  buildScheduleTodos,
  DEFAULT_PERIOD_TIMES
} from '../lib/schedule.js';
import { fromYmd, todayInTZ, ymd } from '../lib/time.js';

/**
 * 课表导入对话框。
 *
 * 课表文件里只有「第几周」，没有这一周对应哪天，也没有节次的具体时间 ——
 * 这两件事只能由用户给，所以都做成表单项（带合理默认值），不猜。
 */
export function openScheduleDialog({ text, fileName, tz, onImport }) {
  return new Promise((resolve) => {
    const { entries, warnings } = parseScheduleHtml(text);

    const mask = document.createElement('div');
    mask.className = 'cropmask';
    mask.innerHTML = `
      <div class="crop crop--wide">
        <div class="crop__head">
          <span class="crop__title">导入课表</span>
          <span class="crop__hint"></span>
        </div>
        <div class="sched__body">
          <div class="sched__note note"></div>
          <div class="sched__list"></div>

          <div class="row">
            <div class="row__label">
              <b>第 1 周的周一是哪天</b>
              <span class="row__hint">课表里只写「第几周」，需要你指定学期第 1 周的周一，才能算出具体日期。选了非周一会自动往前对齐。</span>
            </div>
            <div class="row__control">
              <input class="field sched__monday" type="date" />
            </div>
          </div>

          <div class="row">
            <div class="row__label">
              <b>标题里带上教室</b>
              <span class="row__hint">关掉后待办只显示「课程名 · 第N-M节」。</span>
            </div>
            <div class="row__control">
              <button class="switch is-on sched__place" type="button"></button>
            </div>
          </div>

          <div class="row">
            <div class="row__label">
              <b>重新导入时替换旧课表</b>
              <span class="row__hint">开启后会先删掉上次导入的全部课程待办，再写入新的，避免重复。手动添加的待办不受影响。</span>
            </div>
            <div class="row__control">
              <button class="switch is-on sched__replace" type="button"></button>
            </div>
          </div>

          <button class="sched__toggle" type="button">节次时间表 ▾</button>
          <div class="sched__times" hidden></div>
        </div>
        <div class="crop__actions">
          <span class="sched__count"></span>
          <button class="btn sched__cancel" type="button">取消</button>
          <button class="btn btn--primary sched__ok" type="button">导入</button>
        </div>
      </div>
    `;

    const $hint = mask.querySelector('.crop__hint');
    const $note = mask.querySelector('.sched__note');
    const $list = mask.querySelector('.sched__list');
    const $monday = mask.querySelector('.sched__monday');
    const $place = mask.querySelector('.sched__place');
    const $replace = mask.querySelector('.sched__replace');
    const $toggle = mask.querySelector('.sched__toggle');
    const $times = mask.querySelector('.sched__times');
    const $count = mask.querySelector('.sched__count');
    const $ok = mask.querySelector('.sched__ok');

    $hint.textContent = fileName || '';

    /* ---------------- 解析结果 ---------------- */

    if (!entries.length) {
      $note.className = 'note is-error sched__note';
      $note.textContent =
        '没能从这个文件里认出任何课程。请确认导出的是教务系统的课表页面（.xls / .htm），' +
        '而不是成绩单或其它表格。';
      $ok.disabled = true;
    } else {
      $note.className = 'note is-ok sched__note';
      $note.textContent = `识别到 ${entries.length} 条上课安排。`;
      if (warnings.length) {
        $note.textContent += ` 有 ${warnings.length} 个格子格式不认识，已跳过。`;
      }
    }

    for (const s of summarize(entries)) {
      const row = document.createElement('div');
      row.className = 'sched__item';
      row.innerHTML = `
        <span class="sched__when"></span>
        <span class="sched__name"></span>
        <span class="sched__weeks"></span>
        <span class="sched__place-text"></span>
      `;
      row.querySelector('.sched__when').textContent = s.when;
      row.querySelector('.sched__name').textContent = s.name;
      row.querySelector('.sched__weeks').textContent = `${s.weeks}（${s.count} 次）`;
      row.querySelector('.sched__place-text').textContent = s.place;
      $list.appendChild(row);
    }

    /* ---------------- 表单 ---------------- */

    // 默认给本周周一，用户多半要往前改到开学那周
    const today = todayInTZ(tz);
    const base = fromYmd(today, tz);
    $monday.value = ymd(base.minus({ days: base.weekday - 1 }));

    const timeInputs = [];
    for (let i = 0; i < DEFAULT_PERIOD_TIMES.length; i++) {
      const wrap = document.createElement('label');
      wrap.className = 'sched__time';
      const span = document.createElement('span');
      span.textContent = `第${i + 1}节`;
      const input = document.createElement('input');
      input.type = 'time';
      input.className = 'field';
      input.value = DEFAULT_PERIOD_TIMES[i];
      input.addEventListener('change', updateCount);
      wrap.append(span, input);
      $times.appendChild(wrap);
      timeInputs.push(input);
    }

    $toggle.addEventListener('click', () => {
      $times.hidden = !$times.hidden;
      $toggle.textContent = $times.hidden ? '节次时间表 ▾' : '节次时间表 ▴';
    });

    for (const sw of [$place, $replace]) {
      sw.addEventListener('click', () => {
        sw.classList.toggle('is-on');
        updateCount();
      });
    }
    $monday.addEventListener('change', updateCount);

    function currentOptions() {
      return {
        firstMonday: $monday.value,
        periodTimes: timeInputs.map((i) => i.value || null),
        tz,
        withPlace: $place.classList.contains('is-on')
      };
    }

    function preview() {
      if (!entries.length || !$monday.value) return null;
      try {
        return buildScheduleTodos(entries, currentOptions());
      } catch {
        return null;
      }
    }

    function updateCount() {
      const p = preview();
      if (!p) {
        $count.textContent = '请先选好第 1 周的周一';
        $ok.disabled = true;
        return;
      }
      const first = p.todos.reduce((a, t) => (a && a < t.date ? a : t.date), null);
      const last = p.todos.reduce((a, t) => (a && a > t.date ? a : t.date), null);
      $count.textContent = `将生成 ${p.todos.length} 条待办（${first} ~ ${last}）`;
      $ok.disabled = p.todos.length === 0;
    }

    updateCount();

    /* ---------------- 收尾 ---------------- */

    function close(result) {
      mask.remove();
      resolve(result);
    }

    mask.querySelector('.sched__cancel').addEventListener('click', () => close(null));
    mask.addEventListener('mousedown', (e) => {
      if (e.target === mask) close(null);
    });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape' && document.body.contains(mask)) {
        document.removeEventListener('keydown', esc);
        close(null);
      }
    });

    $ok.addEventListener('click', async () => {
      const p = preview();
      if (!p) return;
      $ok.disabled = true;
      $ok.textContent = '导入中…';
      const res = await onImport(p.todos, $replace.classList.contains('is-on'));
      close(res);
    });

    document.body.appendChild(mask);
  });
}
