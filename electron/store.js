'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { app } = require('electron');
const { DEFAULT_DATA, DEFAULT_SETTINGS } = require('./defaults');

/**
 * data.json 读写。
 *  - 明文缩进 JSON，作者可手改
 *  - 写临时文件 + 原子重命名，避免写一半崩溃
 *  - 变更后 debounce 500ms 落盘，退出时强制落盘
 *  - 解析失败时备份损坏文件并用默认值重建
 */
class Store {
  constructor() {
    this.dir = app.getPath('userData');
    this.file = path.join(this.dir, 'data.json');
    this.migrateLegacy();
    this.data = null;
    this._timer = null;
    /** 启动时若发生过损坏恢复，渲染进程会来取一次并提示 */
    this.corruptionNotice = null;
  }

  get filePath() {
    return this.file;
  }

  /**
   * 程序早期叫「桌面时钟」，改名 Cclock 后 userData 目录跟着变了。
   * 老目录里有数据、新目录里没有时，把它搬过来，别让用户的待办凭空消失。
   * 只在新目录还是空的时候做一次，之后两边各走各的。
   */
  migrateLegacy() {
    if (fs.existsSync(this.file)) return;
    const legacy = path.join(app.getPath('appData'), '桌面时钟', 'data.json');
    if (!fs.existsSync(legacy)) return;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.copyFileSync(legacy, this.file);
      console.log('[store] 已从旧目录迁移数据:', legacy);
    } catch (err) {
      console.error('[store] 迁移旧数据失败:', err);
    }
  }

  load() {
    let raw = null;
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // 读不出来（权限等）也按缺失处理，但记录一下
        this.corruptionNotice = `无法读取数据文件（${err.code}），已使用默认设置。`;
      }
      this.data = clone(DEFAULT_DATA);
      this.flushSync();
      return this.data;
    }

    try {
      const parsed = JSON.parse(raw);
      this.data = normalize(parsed);
    } catch (err) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const broken = path.join(this.dir, `data.corrupted.${stamp}.json`);
      try {
        fs.renameSync(this.file, broken);
      } catch {
        try {
          fs.writeFileSync(broken, raw, 'utf8');
        } catch {
          /* 尽力而为 */
        }
      }
      this.corruptionNotice = `数据文件损坏，已备份为 ${path.basename(broken)} 并重建。`;
      this.data = clone(DEFAULT_DATA);
      this.flushSync();
    }
    return this.data;
  }

  get() {
    if (!this.data) this.load();
    return this.data;
  }

  /** 局部更新 settings，返回新的完整 settings */
  patchSettings(patch) {
    const s = this.get().settings;
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'sections' && v && typeof v === 'object') {
        s.sections = { ...s.sections, ...v };
      } else {
        s[k] = v;
      }
    }
    this.schedule();
    return s;
  }

  setTodos(todos) {
    this.get().todos = todos;
    this.schedule();
    return todos;
  }

  /** 整体替换（导入用） */
  replace(next) {
    this.data = normalize(next);
    this.schedule();
    return this.data;
  }

  schedule() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._timer = null;
      this.flushSync();
    }, 500);
  }

  flushSync() {
    if (!this.data) return;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    const tmp = `${this.file}.tmp`;
    const text = JSON.stringify(this.data, null, 2);
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(tmp, text, 'utf8');
      fs.renameSync(tmp, this.file); // 同盘 rename 是原子的
    } catch (err) {
      console.error('[store] 落盘失败:', err);
    }
  }

  async exportTo(target) {
    this.flushSync();
    await fsp.copyFile(this.file, target);
  }

  async importFrom(source) {
    const raw = await fsp.readFile(source, 'utf8');
    const parsed = JSON.parse(raw); // 抛错由调用方处理
    // 导入前自动备份现有文件
    this.flushSync();
    try {
      await fsp.copyFile(this.file, path.join(this.dir, 'data.backup.json'));
    } catch {
      /* 原文件不存在时忽略 */
    }
    this.replace(parsed);
    this.flushSync();
    return this.data;
  }
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

/** 逐字段兜底，保证结构完整、类型正确 */
function normalize(input) {
  const out = clone(DEFAULT_DATA);
  if (!input || typeof input !== 'object') return out;

  out.version = 1;

  const s = input.settings && typeof input.settings === 'object' ? input.settings : {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key === 'sections') continue;
    if (s[key] !== undefined) out.settings[key] = s[key];
  }
  if (s.sections && typeof s.sections === 'object') {
    out.settings.sections = { ...DEFAULT_SETTINGS.sections, ...s.sections };
  }
  if (!Array.isArray(out.settings.secondaryTimezones)) {
    out.settings.secondaryTimezones = ['system'];
  }
  // 第一项固定为 system
  out.settings.secondaryTimezones = out.settings.secondaryTimezones.filter(
    (z) => typeof z === 'string' && z
  );
  if (out.settings.secondaryTimezones[0] !== 'system') {
    out.settings.secondaryTimezones = [
      'system',
      ...out.settings.secondaryTimezones.filter((z) => z !== 'system')
    ];
  }
  out.settings.secondaryTimezones = out.settings.secondaryTimezones.slice(0, 6); // system + 最多 5 个
  out.settings.opacity = clamp(Number(out.settings.opacity) || 0.85, 0.3, 1);
  out.settings.upcomingThresholdMinutes = clamp(
    parseInt(out.settings.upcomingThresholdMinutes, 10) || 30,
    1,
    1440
  );

  out.todos = Array.isArray(input.todos)
    ? input.todos.filter((t) => t && typeof t === 'object' && typeof t.title === 'string').map(normalizeTodo)
    : [];

  return out;
}

function normalizeTodo(t) {
  return {
    id: typeof t.id === 'string' && t.id ? t.id : cryptoId(),
    title: String(t.title),
    date: /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : null,
    time: /^\d{2}:\d{2}$/.test(t.time) ? t.time : null,
    done: !!t.done,
    completedAt: typeof t.completedAt === 'string' ? t.completedAt : null,
    createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date().toISOString(),
    // 来源标记：'schedule' = 课表导入生成，重新导入时按它整批替换
    source: typeof t.source === 'string' && t.source ? t.source : null
  };
}

function cryptoId() {
  return require('crypto').randomUUID();
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

module.exports = { Store };
