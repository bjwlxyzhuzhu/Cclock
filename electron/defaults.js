'use strict';

/**
 * 默认设置。任何新增设置项都必须在这里补默认值，
 * store.js 会用它对读入的 data.json 做逐字段兜底。
 */
const DEFAULT_SETTINGS = {
  // 主时区默认北京：作者的作息挂在中国时区，系统时区只作参考
  primaryTimezone: 'Asia/Shanghai',
  // 副时区默认只有一条系统时区，界面上标「（本机）」
  secondaryTimezones: ['system'],
  hideSystemClock: false, // 系统时区那一条可隐藏，但不可从列表里删掉
  hourFormat: '24h', // '24h' | '12h'
  showSeconds: true,
  weekStart: 'monday', // 'monday' | 'sunday'
  showLunar: true,
  showHolidayBadge: true,
  upcomingThresholdMinutes: 30,
  showCompletedSection: true,
  theme: 'sky', // sky | dusk | grass | huangzhong | dark | plain | custom
  // 自定义背景：图片存在 userData/background.png，这里只记开关与裁剪参数
  hasCustomBackground: false,
  opacity: 0.85,
  locked: false,
  alwaysOnTop: false,
  autoLaunch: true,
  globalHotkey: 'Alt+B', // 显示 / 隐藏窗口；别用 Alt+Space，那是系统窗口菜单
  trayTipShown: false,
  sections: {
    secondaryClocks: 'expanded',
    calendar: 'expanded',
    todos: 'expanded'
  },
  bounds: null // { x, y, width, height }
};

const DEFAULT_DATA = {
  version: 1,
  settings: DEFAULT_SETTINGS,
  todos: []
};

module.exports = { DEFAULT_SETTINGS, DEFAULT_DATA };
