'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('PC31 activities use valid pages, retry without skipping, reveal older records, and disclose caps in both languages', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.openConsole('#/more');
    await browser.wait("document.getElementById('console-main')");
    await browser.evaluate(`(async () => {
      const {renderPerson} = await import('/crm/js/modules/console/pages/person.js');
      const i18n = await import('/crm/js/modules/console/i18n.js');
      window.pc31 = {calls:[], fail:true, i18n};
      const ctx = {main:document.getElementById('console-main'),toast(){},api:{call:async (name,args) => {
        window.pc31.calls.push(args);
        if (args.action === 'get') return {person:{id:71,display_name:'Fictional PC31'}};
        if (args.action === 'getTimelinePage') {
          if (args.pageSize !== 20) throw Error('Invalid timeline page size');
          if (args.page === 2 && window.pc31.fail) {window.pc31.fail=false;throw Error('Temporary failure');}
          return {rows:args.page === 1 ? [] : [{id:'entry-'+args.page,source:'public.interactions#'+args.page,
            activityId:args.page,summary:'Fictional activity '+args.page,at:'2026-10-18'}],hasMore:true};
        }
        return {rows:[]};
      }}};
      window.pc31.render = () => renderPerson(ctx,'71');
      i18n.setLang('zh-CN'); window.pc31.render();
    })()`);
    await browser.click('.tab', '活动');
    await browser.wait("document.querySelector('.person-activities-more')");
    assert.match(await browser.evaluate("document.querySelector('.person-activity-list').textContent"), /已加载/);
    await browser.click('.person-activities-more', '');
    await browser.wait("document.querySelector('.person-activities-more').parentElement.querySelector('[role=alert]').textContent.length>0");
    await browser.click('.person-activities-more', '');
    await browser.wait("document.querySelector('.person-activity-list a[href=\"#/activity/2\"]')");
    assert.deepEqual(await browser.evaluate("window.pc31.calls.filter(x=>x.action==='getTimelinePage').map(x=>x.page)"), [1,2,2]);
    await browser.click('.person-activities-more', '');
    await browser.wait("document.querySelector('.person-activity-list a[href=\"#/activity/3\"]')");
    for (let page = 4; page <= 20; page++) {
      await browser.click('.person-activities-more', '');
      await browser.wait(`document.querySelector('.person-activity-list a[href="#/activity/${page}"]')`);
    }
    assert.equal(await browser.evaluate("document.querySelector('.person-activities-more').hidden"), true);
    assert.match(await browser.evaluate("document.querySelector('.person-activities-more').parentElement.textContent"), /400 条/);
    assert.equal(await browser.evaluate("document.querySelectorAll('.person-activity-list a').length"), 19);
    await browser.evaluate("window.pc31.i18n.setLang('en');window.pc31.render()");
    await browser.click('.tab', 'Activities');
    await browser.wait("document.querySelector('.person-activities-more')");
    assert.match(await browser.evaluate("document.querySelector('.person-activities-more').parentElement.textContent"), /20 at a time/);
    for (const [width,height] of [[820,1180],[1180,820]]) {
      await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      assert.ok(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));
    }
    await browser.healthy();
  } finally { await browser.close(); }
});
