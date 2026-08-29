'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * 安全基线：contextIsolation + nodeIntegration:false。
 * 渲染进程只能通过下面这张白名单表触碰文件与系统能力。
 */

function on(channel, cb) {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('clock', {
  /* 启动数据 */
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),

  /* 设置与待办 */
  patchSettings: (patch) => ipcRenderer.invoke('settings:patch', patch),
  setTodos: (todos) => ipcRenderer.invoke('todos:set', todos),

  /* 窗口 */
  setContentHeight: (h) => ipcRenderer.invoke('window:setContentHeight', h),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  contextMenu: () => ipcRenderer.invoke('window:contextMenu'),
  openSettings: () => ipcRenderer.invoke('app:openSettings'),
  quit: () => ipcRenderer.invoke('app:quit'),

  /* 托盘角标 */
  setOverdue: (n) => ipcRenderer.invoke('tray:setOverdue', n),

  /* 快捷键 */
  testHotkey: (accelerator) => ipcRenderer.invoke('hotkey:test', accelerator),

  /* 数据文件 */
  revealData: () => ipcRenderer.invoke('data:reveal'),
  exportData: () => ipcRenderer.invoke('data:export'),
  importData: () => ipcRenderer.invoke('data:import'),

  /* 自定义背景图 */
  pickBackground: () => ipcRenderer.invoke('bg:pick'),
  saveBackground: (dataUri) => ipcRenderer.invoke('bg:save', dataUri),
  getBackground: () => ipcRenderer.invoke('bg:get'),
  clearBackground: () => ipcRenderer.invoke('bg:clear'),
  cardSize: () => ipcRenderer.invoke('window:cardSize'),

  /* 课表导入 */
  pickSchedule: () => ipcRenderer.invoke('schedule:pick'),
  appendTodos: (items, replaceSource) =>
    ipcRenderer.invoke('todos:append', { items, replaceSource }),

  /* 事件 */
  onSettingsChanged: (cb) => on('settings-changed', cb),
  onTodosChanged: (cb) => on('todos-changed', cb),
  onPowerResume: (cb) => on('power-resume', cb),
  onBackgroundChanged: (cb) => on('background-changed', cb)
});
