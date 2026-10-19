'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('legacy customer follow-up shows and edits Person summary while preserving note-only rows', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.open('#/customer/910001');
    await browser.wait("document.getElementById('view')?.innerText.includes('[CRM_TEST_ONLY]客户甲')");
    await browser.click('.tab', '跟进记录');
    await browser.wait("document.getElementById('view')?.innerText.includes('[CRM_TEST_ONLY]跟进内容')");
    assert.equal(await browser.evaluate("document.getElementById('view').innerText.includes('[CRM_TEST_ONLY]新页摘要')"), false);

    await browser.click('#view button', '+ 手动写跟进');
    await browser.wait("document.querySelector('.modal [name=interaction_summary]')");
    await browser.evaluate(`(()=>{
      document.querySelector('.modal [name=followup_date]').value='2026-10-19';
      document.querySelector('.modal [name=interaction_summary]').value='[CRM_TEST_ONLY]新页摘要';
      document.querySelector('.modal-footer .btn-primary').click();
    })()`);
    await browser.wait("window.__crmTest.calls.some(call=>call.name==='followups'&&call.action==='create'&&call.payload?.interaction_summary==='[CRM_TEST_ONLY]新页摘要')");
    await browser.wait("document.getElementById('view')?.innerText.includes('[CRM_TEST_ONLY]新页摘要')");
    assert.equal(await browser.evaluate("[...document.querySelectorAll('#view .card')].filter(card=>card.innerText.includes('[CRM_TEST_ONLY]新页摘要')&&[...card.children].some(child=>child.querySelector(':scope > div > a')?.textContent==='编辑')).length"), 1);

    await browser.evaluate(`(()=>{
      const card=[...document.querySelectorAll('#view .card')].findLast(card=>card.innerText.includes('[CRM_TEST_ONLY]新页摘要'));
      [...card.querySelectorAll('a')].find(link=>link.textContent==='编辑').click();
    })()`);
    await browser.wait("document.querySelector('.modal [name=interaction_summary]')");
    assert.equal(await browser.evaluate("document.querySelector('.modal [name=interaction_summary]').value"), '[CRM_TEST_ONLY]新页摘要');
    assert.equal(await browser.evaluate("document.querySelector('.modal').innerText.includes('互动摘要')"), true);
    await browser.evaluate(`(()=>{
      document.querySelector('.modal [name=interaction_summary]').value='[CRM_TEST_ONLY]旧页修订摘要';
      document.querySelector('.modal-footer .btn-primary').click();
    })()`);
    await browser.wait("window.__crmTest.calls.some(call=>call.name==='followups'&&call.action==='update'&&call.payload?.interaction_summary==='[CRM_TEST_ONLY]旧页修订摘要')");
    await browser.wait("document.getElementById('view')?.innerText.includes('[CRM_TEST_ONLY]旧页修订摘要')");

    await browser.evaluate("location.hash='#/person/980001'");
    await browser.wait("document.getElementById('view')?.innerText.includes('Person 360')");
    await browser.wait("document.querySelector('.person360-timeline')?.innerText.includes('[CRM_TEST_ONLY]旧页修订摘要')");
    assert.equal(await browser.evaluate("[...document.querySelectorAll('#view .person360-timeline-item')].filter(row=>row.innerText.includes('public.followups#920002')).length"), 1);

    await browser.evaluate("location.hash='#/customer/910001'");
    await browser.wait("document.getElementById('view')?.innerText.includes('[CRM_TEST_ONLY]旧页修订摘要')");
    await browser.click('.tab', '跟进记录');
    await browser.evaluate("import('/crm/js/modules/console/i18n.js').then(mod=>mod.setLang('en'))");
    await browser.evaluate(`(()=>{
      const card=[...document.querySelectorAll('#view .card')].findLast(card=>card.innerText.includes('[CRM_TEST_ONLY]旧页修订摘要'));
      [...card.querySelectorAll('a')].find(link=>link.textContent==='编辑').click();
    })()`);
    await browser.wait("document.querySelector('.modal [name=interaction_summary]')");
    assert.equal(await browser.evaluate("document.querySelector('.modal').innerText.includes('Interaction Summary')"), true);
    await browser.evaluate("document.querySelector('.modal-footer button').click(); import('/crm/js/modules/console/i18n.js').then(mod=>mod.setLang('zh-CN'))");
    await browser.healthy();
  } finally { await browser.close(); }
});
