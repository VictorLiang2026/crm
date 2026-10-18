'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

const routes = ['#/people', '#/opportunities', '#/activities', '#/recruit', '#/ai', '#/more', '#/people-trash'];
const viewports = [{ width: 820, height: 1180 }, { width: 1180, height: 820 }];

test('PC34 Console modules render in both languages across iPad orientations', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.openConsole('#/more', 'authCase=1');
    for (const lang of ['zh-CN', 'en']) {
      await browser.evaluate(`localStorage.setItem('crm_lang', ${JSON.stringify(lang)})`);
      for (const route of routes) {
        await browser.openConsole(route, 'authCase=1');
        await browser.wait("document.querySelector('#console-main')?.innerText.trim().length > 0", 20000);
        for (const viewport of viewports) {
          await browser.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 2, mobile: false });
          const state = await browser.evaluate(`(() => {
            const main = document.querySelector('#console-main');
            const bounds = main.getBoundingClientRect();
            return { lang: localStorage.getItem('crm_lang'), width: innerWidth,
              scrollWidth: document.documentElement.scrollWidth, left: bounds.left, right: bounds.right,
              text: main.innerText.slice(0, 400), navCount: document.querySelectorAll('.console-nav .nav-item').length };
          })()`);
          assert.equal(state.lang, lang);
          assert.equal(state.width, viewport.width);
          assert.ok(state.scrollWidth <= state.width + 1, `${lang} ${route} ${viewport.width}: document overflow ${state.scrollWidth}`);
          assert.ok(state.left >= -1 && state.right <= state.width + 1, `${lang} ${route}: main outside viewport`);
          assert.equal(state.navCount, 7, `${lang} ${route}: navigation incomplete`);
          assert.ok(!/加载失败|Failed to load|Error loading/.test(state.text), `${lang} ${route}: ${state.text}`);
        }
      }
    }
    await browser.send('Emulation.clearDeviceMetricsOverride');
    await browser.healthy();
  } finally { await browser.close(); }
});

test('PC34 People filter is usable by iPad touch and keyboard with accessible control names', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.openConsole('#/people', 'authCase=1');
    await browser.wait("Boolean(document.querySelector('#console-main .people-filter-trigger'))", 20000);
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 820, height: 1180, deviceScaleFactor: 2, mobile: false });
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const point = await browser.evaluate(`(() => { const r=document.querySelector('.people-filter-trigger').getBoundingClientRect();
      return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; })()`);
    await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await browser.wait("document.querySelector('.people-filter-panel')?.hidden === false", 15000);
    const panel = await browser.evaluate(`(() => {
      const panel=document.querySelector('.people-filter-panel');
      const r=panel.getBoundingClientRect();
      const controls=[...panel.querySelectorAll('button,input,select')].filter(e=>e.getClientRects().length);
      return {left:r.left,right:r.right,top:r.top,controlNames:controls.map(e=>({
        tag:e.tagName,name:(e.getAttribute('aria-label')||e.getAttribute('title')||e.labels?.[0]?.innerText||e.innerText||e.getAttribute('placeholder')||'').trim()
      }))}; })()`);
    assert.ok(panel.left >= -1 && panel.right <= 821, 'filter panel fits iPad portrait');
    assert.ok(panel.controlNames.length > 0, 'filter panel has visible controls');
    assert.ok(panel.controlNames.every(x => x.name), `unnamed controls: ${JSON.stringify(panel.controlNames)}`);
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await browser.evaluate("document.querySelector('.people-filter-trigger').focus()");
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    assert.equal(await browser.evaluate("document.activeElement !== document.querySelector('.people-filter-trigger') && document.activeElement !== document.body"), true);
    await browser.healthy();
  } finally { await browser.close(); }
});

test('PC34 empty and retry states stay bilingual and reachable on iPad', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.openConsole('#/more', 'authCase=1');
    for (const [lang, emptyText, errorText, retryText] of [
      ['zh-CN', '回收站为空', '数据加载失败', '重试'],
      ['en', 'Trash is empty', 'Data Load Failed', 'Retry'],
    ]) {
      await browser.evaluate(`localStorage.setItem('crm_lang', ${JSON.stringify(lang)})`);
      await browser.openConsole('#/people-trash', 'authCase=1');
      await browser.wait(`document.querySelector('#console-main')?.innerText.includes(${JSON.stringify(emptyText)})`, 15000);
      await browser.openConsole('#/people', 'authCase=1&mode=error&fail=person_360%3AlistPeople');
      await browser.wait("Boolean(document.querySelector('#console-main .error-box'))", 15000);
      const state = await browser.evaluate(`(() => {
        const box=document.querySelector('#console-main .error-box');
        const button=box.querySelector('button');
        const r=button.getBoundingClientRect();
        return {title:box.querySelector('b')?.textContent, retry:button.textContent.trim(),
          width:r.width,height:r.height,scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth};
      })()`);
      assert.equal(state.title, errorText);
      assert.equal(state.retry, retryText);
      assert.ok(state.width >= 24 && state.height >= 24, `${lang} retry touch target`);
      assert.ok(state.scrollWidth <= state.viewport + 1, `${lang} error page overflow`);
      const before = await browser.evaluate("window.__crmTest.calls.filter(c=>c.name==='person_360'&&c.action==='listPeople').length");
      await browser.click('#console-main .error-box button', retryText);
      await browser.wait(`window.__crmTest.calls.filter(c=>c.name==='person_360'&&c.action==='listPeople').length > ${before}`, 15000);
    }
    await browser.healthy();
  } finally { await browser.close(); }
});

test('PC34 Quick Capture dialog fits both iPad orientations with bilingual names', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.openConsole('#/more', 'authCase=1');
    for (const [lang, title] of [['zh-CN', '快速记录'], ['en', 'Quick Record']]) {
      await browser.evaluate(`localStorage.setItem('crm_lang', ${JSON.stringify(lang)})`);
      await browser.openConsole('#/more', 'authCase=1');
      await browser.wait("Boolean(document.querySelector('#console-main .more-section'))", 15000);
      for (const viewport of viewports) {
        await browser.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 2, mobile: false });
        await browser.evaluate("document.querySelector('.fab').click()");
        await browser.wait("Boolean(document.querySelector('.sheet[role=dialog]'))");
        const state = await browser.evaluate(`(() => {
          const dialog=document.querySelector('.sheet[role=dialog]');
          const r=dialog.getBoundingClientRect();
          const input=dialog.querySelector('textarea');
          return {label:dialog.getAttribute('aria-label'),title:dialog.querySelector('.sheet-title')?.textContent,
            left:r.left,right:r.right,top:r.top,bottom:r.bottom,
            inputName:input?.getAttribute('aria-label')||input?.getAttribute('placeholder'),
            closeName:dialog.querySelector('.sheet-head button')?.getAttribute('aria-label'),
            actionName:dialog.querySelector('.sheet-actions button')?.textContent?.trim()};
        })()`);
        assert.equal(state.label, title);
        assert.equal(state.title, title);
        assert.ok(state.left >= -1 && state.right <= viewport.width + 1, `${lang} dialog horizontal overflow`);
        assert.ok(state.top >= -1 && state.bottom <= viewport.height + 1, `${lang} dialog vertical overflow`);
        assert.ok(state.inputName && state.closeName && state.actionName, `${lang} dialog control name missing`);
        await browser.evaluate("document.querySelector('.sheet-head button').click()");
        await browser.wait("document.querySelector('.sheet-overlay') === null");
      }
    }
    await browser.send('Emulation.clearDeviceMetricsOverride');
    await browser.healthy();
  } finally { await browser.close(); }
});
