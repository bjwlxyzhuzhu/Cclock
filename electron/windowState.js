'use strict';

const { screen } = require('electron');

/**
 * 窗口位置恢复 + 多显示器越界校正。
 *
 * 场景：外接屏被拔掉后，上次保存的坐标可能落在不存在的显示器上，
 * 表现为"程序启动了但看不见"。所以恢复前必须校验。
 */

/**
 * @param {{x:number,y:number,width:number,height:number}|null} saved
 * @param {{width:number,height:number}} size 期望的窗口尺寸
 * @returns {{x:number,y:number,width:number,height:number}}
 */
function restoreBounds(saved, size) {
  const width = size.width;
  const height = size.height;

  if (saved && isFinite(saved.x) && isFinite(saved.y)) {
    const candidate = { x: Math.round(saved.x), y: Math.round(saved.y), width, height };
    if (isVisibleEnough(candidate)) return candidate;
  }
  return defaultTopRight(width, height);
}

/**
 * 判断窗口是否有足够部分落在某个显示器的可见工作区内。
 * 只要标题栏（顶部 40px）与至少 120px 宽度可见就算可接受。
 */
function isVisibleEnough(b) {
  const displays = screen.getAllDisplays();
  const MIN_VISIBLE_W = 120;
  const MIN_VISIBLE_H = 40;

  for (const d of displays) {
    const wa = d.workArea;
    const ix = Math.max(0, Math.min(b.x + b.width, wa.x + wa.width) - Math.max(b.x, wa.x));
    const iy = Math.max(0, Math.min(b.y + b.height, wa.y + wa.height) - Math.max(b.y, wa.y));
    if (ix >= MIN_VISIBLE_W && iy >= MIN_VISIBLE_H) return true;
  }
  return false;
}

/** 回退位置：主显示器右上角 */
function defaultTopRight(width, height) {
  const wa = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.round(wa.x + wa.width - width - 24),
    y: Math.round(wa.y + 24),
    width,
    height
  };
}

/**
 * 高度变化时保持上边缘不动；若底部超出所在显示器工作区，则整体上移保证完整可见。
 * @returns {{x:number,y:number}} 调整后的左上角坐标
 */
function fitHeight(currentBounds, nextHeight) {
  const { x, y, width } = currentBounds;
  const display = screen.getDisplayMatching({ x, y, width, height: nextHeight });
  const wa = display.workArea;

  let ny = y; // 默认：上边缘不动，向下伸缩
  if (ny + nextHeight > wa.y + wa.height) {
    ny = wa.y + wa.height - nextHeight; // 底部超出 → 向上顶
  }
  if (ny < wa.y) ny = wa.y; // 比工作区还高时贴顶

  let nx = x;
  if (nx + width > wa.x + wa.width) nx = wa.x + wa.width - width;
  if (nx < wa.x) nx = wa.x;

  return { x: Math.round(nx), y: Math.round(ny) };
}

module.exports = { restoreBounds, isVisibleEnough, defaultTopRight, fitHeight };
