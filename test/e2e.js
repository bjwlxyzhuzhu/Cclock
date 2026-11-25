'use strict';
const { launch, check, finish, sleep } = require('./cdp');
const fs = require('fs'), path = require('path');
(async () => {
  let app = await launch();
  try {
    let p = await app.page('index.html'); await sleep(2500);
    const t1 = await p.ev(`document.body.innerText`); await sleep(1600);
    const t2 = await p.ev(`document.body.innerText`);
    check('时钟显示时间', /\d{1,2}:\d{2}/.test(t1));
    check('时钟在走', t1 !== t2);
    check('月历渲染', /[一二三四五六日]/.test(t1) && (t1.match(/\b\d{1,2}\b/g) || []).length > 28);
    await p.ev(`clock.patchSettings({sections:{secondaryClocks:'expanded',calendar:'expanded',todos:'expanded'}})`); await sleep(1500);
    const add = async (txt) => {
      await p.ev(`document.querySelector('.addrow__input').focus()`);
      await p.send('Input.insertText', { text: txt });
      for (const type of ['keyDown', 'keyUp']) await p.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: type === 'keyDown' ? '\r' : undefined });
      await sleep(1200);
    };
    await add('端到端测试待办');
    check('待办出现在界面', await p.ev(`document.body.innerText.includes('端到端测试待办')`));
    const f = path.join(app.dir, 'data.json');
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    check('待办落盘', d.todos.length === 1 && d.todos[0].title.includes('端到端测试'), d.todos[0]);
    await p.ev(`clock.patchSettings({theme:'dark', showSeconds:false})`); await sleep(1500);
    check('切换主题', await p.ev(`document.documentElement.dataset.theme==='dark'`), await p.ev(`document.documentElement.dataset.theme`));
    await p.shot('cclock');
    await p.ev(`clock.openSettings()`);
    const s = await app.page('settings.html'); await sleep(1500);
    check('设置窗口有内容', (await s.ev(`document.body.innerText.length`)) > 100);
    await s.shot('cclock-settings');
    check('无未捕获异常', !p.errors.length && !s.errors.length, [...p.errors, ...s.errors]);
    await app.kill();
    app = await launch([], app.dir); p = await app.page('index.html'); await sleep(2500);
    check('重启后待办和主题还在', await p.ev(`document.body.innerText.includes('端到端测试待办') && document.documentElement.dataset.theme==='dark'`));
  } catch (e) { check('测试过程异常', false, e.message); }
  await app.kill();
  finish();
})();
