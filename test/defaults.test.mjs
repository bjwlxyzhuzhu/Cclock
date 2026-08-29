import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DEFAULT_SETTINGS } = require('../electron/defaults.js');

/**
 * 这几条是产品明确要求的出厂默认值，改动前先想清楚：
 * 它们只对全新安装（没有 data.json）生效，不会覆盖老用户已有的设置。
 */
test('出厂默认：主时区为北京', () => {
  assert.equal(DEFAULT_SETTINGS.primaryTimezone, 'Asia/Shanghai');
});

test('出厂默认：副时区只有一条系统时区', () => {
  assert.deepEqual(DEFAULT_SETTINGS.secondaryTimezones, ['system']);
  assert.equal(DEFAULT_SETTINGS.hideSystemClock, false);
});

test('出厂默认：全局快捷键为 Alt+B，且不是会与系统冲突的 Alt+Space', () => {
  assert.equal(DEFAULT_SETTINGS.globalHotkey, 'Alt+B');
  assert.notEqual(DEFAULT_SETTINGS.globalHotkey.replace(/\s/g, '').toLowerCase(), 'alt+space');
});
