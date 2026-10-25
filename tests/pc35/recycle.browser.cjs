'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

const ROOT = path.resolve(__dirname, '../..');
const MARKER = '[CRM_TEST_ONLY]';

test('nonempty Person trash renders roles and historical restore scope', async () => {
  const browser = new Browser(ROOT);
  try {
    await browser.start();
    await browser.openConsole('#/people-trash', 'authCase=1');
    await browser.evaluate(`(async()=>{
      const {renderPeopleTrash}=await import('/crm/js/modules/console/pages/people-trash.js');
      const main=document.createElement('main');document.body.append(main);
      renderPeopleTrash({main,toast(){},api:{call:async()=>({rows:[
        {id:987601,display_name:'${MARKER}虚构已删除人物',roles:['customer','recruit'],
          deleted_at:'2026-10-18T01:00:00Z',batch_scoped:false,customer_id:null}
      ],page:1,pageSize:20,hasMore:false})}});
      window.pc35Main=main;
    })()`);
    await browser.wait("window.pc35Main?.querySelector('tbody tr')", 6000);
    assert.match(await browser.evaluate('window.pc35Main.innerText'), /客户.*增员/);
    await browser.healthy();
  } finally { await browser.close(); }
});

test('More opens the unified hub with three native recycle bins and preserves old links in both languages', async () => {
  const browser = new Browser(ROOT);
  try {
    await browser.start();
    await browser.openConsole('#/more', 'authCase=1&mode=pc35');
    await browser.wait("document.querySelector('#console-main .more-section')");
    const legacy = ['/crm/admin.html#/customers/trash','/crm/admin.html#/recruit/trash'];
    for (const lang of ['zh-CN', 'en']) {
      await browser.evaluate(`localStorage.setItem('crm_lang',${JSON.stringify(lang)})`);
      await browser.openConsole('#/more', 'authCase=1&mode=pc35');
      await browser.wait("document.querySelector('.more-primary a[href=\"#/recycle\"]')");
      for (const href of legacy) {
        assert.equal(await browser.evaluate(`document.querySelector('#console-main a[href="${href}"]')===null`), true, href);
      }
      await browser.evaluate("document.querySelector('.more-primary a[href=\"#/recycle\"]').click()");
      await browser.wait("location.hash==='#/recycle' && document.querySelector('.recycle-hub')");
      const links = await browser.evaluate("[...document.querySelectorAll('#console-main a')].map(a=>a.getAttribute('href'))");
      for (const href of ['#/people-trash','#/recycle/customers','#/recycle/recruit',...legacy]) assert.ok(links.includes(href), href);
      await browser.evaluate("document.querySelector('.recycle-legacy summary').click()");
      const labels = lang==='en'
        ? ['Person Recycle Bin','Customer Recycle Bin','Recruit Recycle Bin','Legacy Batch Restore']
        : ['Person 回收站','客户回收站','增员回收站','旧版批量恢复'];
      const content = await browser.evaluate("document.querySelector('#console-main').innerText");
      for (const word of labels) assert.ok(content.includes(word), word);
      for (const route of ['#/people-trash','#/recycle/customers','#/recycle/recruit']) {
        await browser.evaluate(`document.querySelector('.recycle-hub a[href="${route}"]').click()`);
        await browser.wait(`location.hash===${JSON.stringify(route)} && document.querySelector('#console-main a[href="#/recycle"]')`);
        await browser.evaluate("document.querySelector('#console-main a[href=\"#/recycle\"]').click()");
        await browser.wait("document.querySelector('.recycle-hub')");
      }
      assert.equal(await browser.evaluate("window.__crmTest.calls.some(x=>/restore|remove|delete|execute/i.test(x.action))"), false);
    }
    for (const size of [{width:820,height:1180},{width:1180,height:820}]) {
      await browser.send('Emulation.setDeviceMetricsOverride',{...size,deviceScaleFactor:2,mobile:false});
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), true);
      for (const [route,title] of [['#/recycle/customers','Customer Recycle Bin'],
        ['#/recycle/recruit','Recruit Recycle Bin']]) {
        await browser.openConsole(route, 'authCase=1&mode=pc35');
        await browser.wait("document.querySelector('#console-main tbody tr')");
        assert.ok((await browser.evaluate("document.querySelector('#console-main').innerText")).includes(title));
        assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), true);
      }
    }
    await browser.send('Emulation.clearDeviceMetricsOverride');
    await browser.healthy();
  } finally { await browser.close(); }
});

test('customer and recruit restore remain scoped to their original service actions', async () => {
  const browser = new Browser(ROOT);
  try {
    await browser.start();
    await browser.openConsole('#/recycle/customers', 'authCase=1&mode=pc35');
    await browser.wait("document.querySelector('#console-main tbody tr')");
    assert.match(await browser.evaluate("document.querySelector('#console-main').innerText"), /历史无批次：仅恢复本体/);
    await browser.evaluate("document.querySelector('#console-main tbody button').click()");
    await browser.wait("document.querySelector('.sheet-overlay')");
    assert.equal(await browser.evaluate("window.__crmTest.calls.some(x=>x.action==='restore')"), false);
    await browser.evaluate("document.querySelector('.sheet-overlay .sheet-actions .btn-primary').click()");
    await browser.wait("window.__crmTest.calls.some(x=>x.name==='customers'&&x.action==='restore')");
    assert.deepEqual(await browser.evaluate("window.__crmTest.calls.find(x=>x.name==='customers'&&x.action==='restore').ids"), [910099]);

    await browser.openConsole('#/recycle/recruit', 'authCase=1&mode=pc35');
    await browser.wait("document.querySelectorAll('#console-main tbody tr').length===2");
    const names = await browser.evaluate("[...document.querySelectorAll('#console-main tbody tr')].map(x=>x.innerText)");
    assert.ok(names.some(x=>x.includes('独立增员')&&x.includes('本次批次')));
    await browser.evaluate("[...document.querySelectorAll('#console-main tbody tr')].find(x=>x.innerText.includes('独立增员')).querySelector('button').click()");
    await browser.wait("document.querySelector('.sheet-overlay')");
    assert.match(await browser.evaluate("document.querySelector('.sheet-overlay').innerText"), /关联人物已恢复/);
    await browser.evaluate("document.querySelector('.sheet-overlay .sheet-actions .btn-primary').click()");
    await browser.wait("window.__crmTest.calls.some(x=>x.action==='restorePersonOnlyRecruit')");
    assert.deepEqual(await browser.evaluate("window.__crmTest.calls.find(x=>x.action==='restorePersonOnlyRecruit').ids"), [930100]);
    await browser.healthy();
  } finally { await browser.close(); }
});

test('recycle restore failure stays in confirmation sheet and can be retried', async () => {
  const browser = new Browser(ROOT);
  try {
    await browser.start();
    await browser.openConsole('#/recycle/customers', 'authCase=1&mode=pc35&failRestore=customers:restore');
    await browser.wait("document.querySelector('#console-main tbody tr')");
    await browser.evaluate("document.querySelector('#console-main tbody button').click()");
    await browser.evaluate("document.querySelector('.sheet-overlay .sheet-actions .btn-primary').click()");
    await browser.wait("document.querySelector('.sheet-overlay .sheet-err')?.innerText.includes('TEST_RESTORE_FAILURE')");
    assert.equal(await browser.evaluate("document.querySelector('.sheet-overlay .sheet-actions .btn-primary').disabled"), false);
    await browser.healthy();
  } finally { await browser.close(); }
});
