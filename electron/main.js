'use strict';

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  ipcMain,
  nativeImage,
  powerMonitor,
  screen,
  shell,
  dialog
} = require('electron');
const path = require('path');
const fs = require('fs');

const { Store } = require('./store');
const { DEFAULT_SETTINGS } = require('./defaults');
const { restoreBounds, isVisibleEnough, defaultTopRight, fitHeight } = require('./windowState');

const IS_DEV = !app.isPackaged;
const DEV_SERVER = process.env.VITE_DEV_SERVER_URL || null;

/** 卡片 380px + 左右各 10px 阴影留白 */
const WINDOW_WIDTH = 400;
const DEFAULT_HEIGHT = 720;
const MIN_HEIGHT = 140;

let store = null;
let win = null;
let settingsWin = null;
let tray = null;

let hotkeyError = null;
let overdueCount = 0;
let firstHideTipPending = false;
let quitting = false;

/* ------------------------------------------------------------------ */
/* 单实例                                                              */
/* ------------------------------------------------------------------ */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    revealWindow();
  });
  bootstrap();
}

function bootstrap() {
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

  app.whenReady().then(() => {
    // macOS：给一个只含编辑菜单的应用菜单，输入框里的 ⌘C / ⌘V / ⌘A 才能用。
    // Mac 版不进程序坞（LSUIElement），这个菜单栏本身不会显示。
    if (process.platform === 'darwin') {
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        { role: 'appMenu' },
        { role: 'editMenu' },
        { role: 'windowMenu' },
      ]));
    }
    store = new Store();
    store.load();

    // 主时区默认值见 defaults.js（北京）。这里只兜底：万一被手改成空值，
    // 回落到默认值而不是系统时区，保证"今天"永远有一个确定的来源。
    if (!store.get().settings.primaryTimezone) {
      store.patchSettings({ primaryTimezone: DEFAULT_SETTINGS.primaryTimezone });
    }

    createWindow();
    createTray();
    registerHotkey(store.get().settings.globalHotkey);
    applyAutoLaunch(store.get().settings.autoLaunch);

    powerMonitor.on('resume', () => broadcast('power-resume'));
    powerMonitor.on('unlock-screen', () => broadcast('power-resume'));

    screen.on('display-removed', ensureOnScreen);
    screen.on('display-metrics-changed', ensureOnScreen);

    app.on('activate', () => {
      if (!win) createWindow();
      else revealWindow();
    });
  });

  // 关闭窗口不退出，常驻托盘
  app.on('window-all-closed', () => {});

  app.on('before-quit', () => {
    quitting = true;
    saveBounds();
    store?.flushSync();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });
}

/* ------------------------------------------------------------------ */
/* 主窗口                                                              */
/* ------------------------------------------------------------------ */

function createWindow() {
  const s = store.get().settings;
  const saved = s.bounds;
  const height = clamp(saved?.height || DEFAULT_HEIGHT, MIN_HEIGHT, 2000);
  const b = restoreBounds(saved, { width: WINDOW_WIDTH, height });

  win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: WINDOW_WIDTH,
    height: b.height,
    minWidth: WINDOW_WIDTH,
    maxWidth: WINDOW_WIDTH,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false, // 阴影由 CSS 画，避免透明窗口的原生阴影出现方框
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: !!s.alwaysOnTop,
    movable: !s.locked,
    title: 'Cclock',
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  win.setMenu(null);
  if (s.alwaysOnTop) win.setAlwaysOnTop(true, 'floating');

  loadRenderer(win, 'index.html');

  win.once('ready-to-show', () => win.show());

  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      saveBounds();
      hideWindow();
    }
  });

  win.on('moved', saveBounds);
  win.on('closed', () => {
    win = null;
  });

  firstHideTipPending = !store.get().settings.trayTipShown;
}

function loadRenderer(target, page) {
  if (DEV_SERVER) {
    target.loadURL(new URL(page, DEV_SERVER).href);
  } else {
    target.loadFile(path.join(__dirname, '..', 'dist', page));
  }
}

function saveBounds() {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  store.patchSettings({ bounds: { x: b.x, y: b.y, width: b.width, height: b.height } });
}

function hideWindow() {
  if (!win) return;
  win.hide();
  refreshTrayMenu();
  if (firstHideTipPending) {
    firstHideTipPending = false;
    store.patchSettings({ trayTipShown: true });
    balloon(
      'Cclock 仍在运行',
      '窗口已最小化到托盘。点击托盘图标或按全局快捷键可再次唤出；退出请用托盘右键菜单。'
    );
  }
}

// Mac 版不在程序坞里，窗口默认不会跑到最前面，得显式抢一下焦点
function focusApp() {
  if (process.platform === 'darwin') app.focus({ steal: true });
}

function revealWindow() {
  focusApp();
  if (!win) {
    createWindow();
    return;
  }
  ensureOnScreen();
  win.show();
  // 唤出时临时抬到最前，随后按设置恢复
  win.setAlwaysOnTop(true, 'floating');
  win.focus();
  if (!store.get().settings.alwaysOnTop) {
    setTimeout(() => {
      if (win && !win.isDestroyed() && !store.get().settings.alwaysOnTop) {
        win.setAlwaysOnTop(false);
      }
    }, 250);
  }
  refreshTrayMenu();
}

function toggleWindow() {
  if (!win) {
    createWindow();
    return;
  }
  if (win.isVisible() && win.isFocused()) hideWindow();
  else revealWindow();
}

/** 显示器变化后确保窗口仍可见 */
function ensureOnScreen() {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  if (!isVisibleEnough(b)) {
    const fallback = defaultTopRight(b.width, b.height);
    win.setBounds(fallback);
    saveBounds();
  }
}

/* ------------------------------------------------------------------ */
/* 设置窗口                                                            */
/* ------------------------------------------------------------------ */

function openSettings() {
  focusApp();
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 560,
    height: 720,
    minWidth: 480,
    minHeight: 460,
    frame: false,
    transparent: false,
    backgroundColor: '#1b2430',
    resizable: true,
    skipTaskbar: false,
    show: false,
    title: '设置',
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });
  settingsWin.setMenu(null);
  loadRenderer(settingsWin, 'settings.html');
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
}

/* ------------------------------------------------------------------ */
/* 托盘                                                                */
/* ------------------------------------------------------------------ */

function createTray() {
  tray = new Tray(trayImage(false));
  tray.setToolTip('Cclock');
  tray.on('click', toggleWindow);
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  const s = store.get().settings;
  const visible = !!(win && !win.isDestroyed() && win.isVisible());
  const menu = Menu.buildFromTemplate([
    { label: visible ? '隐藏' : '显示', click: toggleWindow },
    { type: 'separator' },
    {
      label: '总在最前',
      type: 'checkbox',
      checked: !!s.alwaysOnTop,
      click: (item) => applyAlwaysOnTop(item.checked)
    },
    {
      label: '锁定位置',
      type: 'checkbox',
      checked: !!s.locked,
      click: (item) => applyLocked(item.checked)
    },
    { type: 'separator' },
    { label: '设置…', click: openSettings },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        quitting = true;
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(menu);
}

function balloon(title, content) {
  if (process.platform !== 'win32' || !tray) return;
  try {
    tray.displayBalloon({ title, content, icon: iconImage() });
  } catch {
    /* 某些系统禁用了气泡通知 */
  }
}

/* ------------------------------------------------------------------ */
/* 设置应用                                                            */
/* ------------------------------------------------------------------ */

function applyAlwaysOnTop(value) {
  store.patchSettings({ alwaysOnTop: !!value });
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(!!value, 'floating');
  refreshTrayMenu();
  broadcastSettings();
}

function applyLocked(value) {
  store.patchSettings({ locked: !!value });
  // ② 原生层面禁止移动
  if (win && !win.isDestroyed()) win.setMovable(!value);
  refreshTrayMenu();
  // ① 渲染层移除 -webkit-app-region: drag
  broadcastSettings();
}

function applyAutoLaunch(value) {
  if (IS_DEV) return; // 开发态不写注册表，避免注册到 electron.exe
  try {
    app.setLoginItemSettings({ openAtLogin: !!value, path: process.execPath, args: [] });
  } catch (err) {
    console.error('[autolaunch]', err);
  }
}

function registerHotkey(accelerator) {
  globalShortcut.unregisterAll();
  hotkeyError = null;
  if (!accelerator) return { ok: true, error: null };

  if (/^alt\+space$/i.test(String(accelerator).replace(/\s/g, ''))) {
    hotkeyError = 'Alt+Space 是 Windows 系统窗口菜单快捷键，会冲突，请换一个组合。';
    balloon('全局快捷键未生效', hotkeyError);
    return { ok: false, error: hotkeyError };
  }

  let ok = false;
  try {
    ok = globalShortcut.register(accelerator, toggleWindow);
  } catch {
    hotkeyError = `快捷键格式无效：${accelerator}`;
    balloon('全局快捷键未生效', hotkeyError);
    return { ok: false, error: hotkeyError };
  }
  if (!ok) {
    hotkeyError = `快捷键 ${accelerator} 已被其他程序占用，注册失败。`;
    balloon('全局快捷键未生效', hotkeyError);
    return { ok: false, error: hotkeyError };
  }
  return { ok: true, error: null };
}

/* ------------------------------------------------------------------ */
/* 图标                                                                */
/* ------------------------------------------------------------------ */

function iconPath() {
  const p = path.join(__dirname, '..', 'build', 'icon.ico');
  return fs.existsSync(p) ? p : undefined;
}

function iconImage() {
  const p = iconPath();
  return p ? nativeImage.createFromPath(p) : nativeImage.createEmpty();
}

function trayImage(withDot) {
  const p = path.join(__dirname, '..', 'build', withDot ? 'tray-alert.png' : 'tray.png');
  if (fs.existsSync(p)) {
    const img = nativeImage.createFromPath(p);
    // 托盘图是 32px；macOS 菜单栏按原尺寸画会很大，缩到 18pt
    if (!img.isEmpty()) return process.platform === 'darwin' ? img.resize({ width: 18, height: 18 }) : img;
  }
  return iconImage();
}

/* ------------------------------------------------------------------ */
/* 广播                                                                */
/* ------------------------------------------------------------------ */

function windows() {
  return [win, settingsWin].filter((w) => w && !w.isDestroyed());
}

function broadcast(channel, payload) {
  for (const w of windows()) w.webContents.send(channel, payload);
}

function broadcastSettings() {
  broadcast('settings-changed', store.get().settings);
}

function systemTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

ipcMain.handle('app:bootstrap', () => {
  const notice = store.corruptionNotice;
  store.corruptionNotice = null; // 只提示一次
  return {
    data: store.get(),
    systemTimezone: systemTimezone(),
    dataPath: store.filePath,
    corruptionNotice: notice,
    hotkeyError,
    version: app.getVersion(),
    isDev: IS_DEV
  };
});

ipcMain.handle('settings:patch', (_e, patch) => {
  patch = patch || {};
  const before = { ...store.get().settings };
  const settings = store.patchSettings(patch);

  if ('alwaysOnTop' in patch && patch.alwaysOnTop !== before.alwaysOnTop) {
    if (win && !win.isDestroyed()) win.setAlwaysOnTop(!!patch.alwaysOnTop, 'floating');
    refreshTrayMenu();
  }
  if ('locked' in patch && patch.locked !== before.locked) {
    if (win && !win.isDestroyed()) win.setMovable(!patch.locked);
    refreshTrayMenu();
  }
  if ('autoLaunch' in patch && patch.autoLaunch !== before.autoLaunch) {
    applyAutoLaunch(patch.autoLaunch);
  }
  if ('globalHotkey' in patch && patch.globalHotkey !== before.globalHotkey) {
    registerHotkey(patch.globalHotkey);
  }
  broadcastSettings();
  return { settings, hotkeyError };
});

ipcMain.handle('todos:set', (_e, todos) => {
  store.setTodos(Array.isArray(todos) ? todos : []);
  broadcast('todos-changed', store.get().todos);
  return true;
});

ipcMain.handle('window:setContentHeight', (_e, h) => {
  if (!win || win.isDestroyed()) return false;
  const next = clamp(Math.ceil(h), MIN_HEIGHT, 2000);
  const cur = win.getContentSize();
  if (Math.abs(cur[1] - next) < 1) return true;

  const b = win.getBounds();
  const pos = fitHeight({ x: b.x, y: b.y, width: b.width }, next);
  win.setContentSize(WINDOW_WIDTH, next);
  win.setPosition(pos.x, pos.y);
  saveBounds();
  return true;
});

ipcMain.handle('window:hide', () => {
  saveBounds();
  hideWindow();
});

ipcMain.handle('window:close', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w === win) {
    saveBounds();
    hideWindow();
  } else if (w) {
    w.close();
  }
});

ipcMain.handle('app:quit', () => {
  quitting = true;
  app.quit();
});

ipcMain.handle('app:openSettings', () => openSettings());

ipcMain.handle('window:contextMenu', () => {
  const s = store.get().settings;
  const menu = Menu.buildFromTemplate([
    { label: '隐藏窗口', click: () => hideWindow() },
    { type: 'separator' },
    {
      label: '总在最前',
      type: 'checkbox',
      checked: !!s.alwaysOnTop,
      click: (i) => applyAlwaysOnTop(i.checked)
    },
    {
      label: '锁定位置',
      type: 'checkbox',
      checked: !!s.locked,
      click: (i) => applyLocked(i.checked)
    },
    { type: 'separator' },
    { label: '设置…', click: openSettings },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        quitting = true;
        app.quit();
      }
    }
  ]);
  menu.popup({ window: win });
});

ipcMain.handle('tray:setOverdue', (_e, count) => {
  const n = Number(count) || 0;
  if (n === overdueCount) return;
  overdueCount = n;
  if (tray) {
    tray.setImage(trayImage(n > 0));
    tray.setToolTip(n > 0 ? `Cclock · ${n} 项逾期未完成` : 'Cclock');
  }
});

ipcMain.handle('hotkey:test', (_e, accelerator) => registerHotkey(accelerator));

ipcMain.handle('data:reveal', () => {
  store.flushSync();
  shell.showItemInFolder(store.filePath);
});

ipcMain.handle('data:export', async (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  const stamp = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(w, {
    title: '导出数据',
    defaultPath: `desktop-clock-${stamp}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try {
    await store.exportTo(filePath);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('data:import', async (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(w, {
    title: '导入数据',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (canceled || !filePaths?.length) return { ok: false, canceled: true };
  try {
    await store.importFrom(filePaths[0]);
    const s = store.get().settings;
    if (win && !win.isDestroyed()) {
      win.setAlwaysOnTop(!!s.alwaysOnTop, 'floating');
      win.setMovable(!s.locked);
    }
    applyAutoLaunch(s.autoLaunch);
    registerHotkey(s.globalHotkey);
    refreshTrayMenu();
    broadcastSettings();
    broadcast('todos-changed', store.get().todos);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `导入失败：${String(err.message || err)}` };
  }
});

/* ------------------------------------------------------------------ */
/* 自定义背景图                                                        */
/* ------------------------------------------------------------------ */

const BG_FILE = () => path.join(app.getPath('userData'), 'background.png');
const MAX_SOURCE_IMAGE = 20 * 1024 * 1024; // 原图上限 20MB，再大裁剪界面会卡

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif'
};

/** 选一张原图，读成 data URI 交给渲染层去裁剪 */
ipcMain.handle('bg:pick', async (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(w, {
    title: '选择背景图片',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }]
  });
  if (canceled || !filePaths?.length) return { ok: false, canceled: true };

  const file = filePaths[0];
  try {
    const stat = fs.statSync(file);
    if (stat.size > MAX_SOURCE_IMAGE) {
      return { ok: false, error: `图片太大（${(stat.size / 1024 / 1024).toFixed(1)} MB），请选 20 MB 以内的。` };
    }
    const ext = path.extname(file).toLowerCase();
    const mime = MIME[ext];
    if (!mime) return { ok: false, error: `不支持的图片格式：${ext}` };
    const buf = fs.readFileSync(file);
    return { ok: true, name: path.basename(file), dataUri: `data:${mime};base64,${buf.toString('base64')}` };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

/** 渲染层裁好之后把 PNG data URI 发回来落盘 */
ipcMain.handle('bg:save', (_e, dataUri) => {
  try {
    const m = /^data:image\/png;base64,([\s\S]+)$/.exec(String(dataUri || ''));
    if (!m) return { ok: false, error: '背景图数据无效' };
    fs.writeFileSync(BG_FILE(), Buffer.from(m[1], 'base64'));
    store.patchSettings({ hasCustomBackground: true });
    broadcastSettings();
    broadcast('background-changed');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

/** 主窗口启动/切主题时来取已保存的背景 */
ipcMain.handle('bg:get', () => {
  try {
    const f = BG_FILE();
    if (!fs.existsSync(f)) return null;
    return `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`;
  } catch {
    return null;
  }
});

ipcMain.handle('bg:clear', () => {
  try {
    fs.rmSync(BG_FILE(), { force: true });
  } catch {
    /* 文件不在就算了 */
  }
  store.patchSettings({ hasCustomBackground: false });
  broadcastSettings();
  broadcast('background-changed');
  return { ok: true };
});

/** 裁剪框要按主窗口卡片的实际长宽比来，这里把当前尺寸报给渲染层 */
ipcMain.handle('window:cardSize', () => {
  const height = win && !win.isDestroyed() ? win.getContentSize()[1] - 20 : DEFAULT_HEIGHT - 20;
  return { width: WINDOW_WIDTH - 20, height: Math.max(120, height) };
});

/* ------------------------------------------------------------------ */
/* 课表导入                                                            */
/* ------------------------------------------------------------------ */

/**
 * 教务系统导出的 .xls 往往是一张 HTML 表格，而且常是 GBK 编码。
 * 这里只负责读字节 + 选对编码，解析逻辑放在渲染层 src/lib/schedule.js（可单测）。
 */
ipcMain.handle('schedule:pick', async (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(w, {
    title: '选择课表文件',
    properties: ['openFile'],
    filters: [{ name: '课表', extensions: ['xls', 'html', 'htm', 'xlsx'] }]
  });
  if (canceled || !filePaths?.length) return { ok: false, canceled: true };

  const file = filePaths[0];
  try {
    const buf = fs.readFileSync(file);
    // 真正的 xlsx 是 zip（PK 0x03 0x04 magic），本程序不带解压库，直接说清楚
    if (buf[0] === 0x50 && buf[1] === 0x4b) {
      return {
        ok: false,
        error:
          '这是真正的 xlsx 压缩格式，本程序读不了。' +
          '请在 Excel 里「另存为 → 网页(.htm)」或「Excel 97-2003 工作簿(.xls)」后重试。'
      };
    }
    return { ok: true, name: path.basename(file), text: decodeText(buf) };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

/** 先按声明的 charset 解，没有就试 UTF-8，乱码太多再退回 GBK */
function decodeText(buf) {
  const head = buf.subarray(0, 2048).toString('latin1');
  const declared = /charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase();
  const tryDecode = (enc) => {
    try {
      return new TextDecoder(enc).decode(buf);
    } catch {
      return null;
    }
  };
  if (declared && declared !== 'utf-8') {
    const t = tryDecode(declared);
    if (t) return t;
  }
  const utf8 = tryDecode('utf-8') || '';
  const bad = (utf8.match(/�/g) || []).length;
  if (bad > 4) {
    const gbk = tryDecode('gbk');
    if (gbk) return gbk;
  }
  return utf8;
}

/** 批量追加待办（课表导入用）；replaceSource 会先清掉同来源的旧数据 */
ipcMain.handle('todos:append', (_e, payload) => {
  const { items, replaceSource } = payload || {};
  if (!Array.isArray(items)) return { ok: false, error: '数据格式不对' };

  let list = store.get().todos;
  let removed = 0;
  if (replaceSource) {
    const before = list.length;
    list = list.filter((t) => t.source !== replaceSource);
    removed = before - list.length;
  }

  const now = new Date().toISOString();
  const added = items
    .filter((t) => t && typeof t.title === 'string' && t.title.trim())
    .map((t) => ({
      id: require('crypto').randomUUID(),
      title: String(t.title).trim(),
      date: /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : null,
      time: /^\d{2}:\d{2}$/.test(t.time) ? t.time : null,
      done: false,
      completedAt: null,
      createdAt: now,
      source: typeof t.source === 'string' ? t.source : null
    }));

  store.setTodos([...list, ...added]);
  broadcast('todos-changed', store.get().todos);
  return { ok: true, added: added.length, removed };
});
