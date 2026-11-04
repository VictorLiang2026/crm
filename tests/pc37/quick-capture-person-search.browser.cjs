'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('legacy Quick Capture search opens exact Person capture preview before writing', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await b.start();
    await b.open('#/more', 'mode=quick-capture-search');
    await b.click('#qc-entry-btn', '快速记录');
    await b.evaluate(`(()=>{
      document.querySelector('.modal-overlay textarea').value='【CRM_TEST_ONLY】虚构原话';
      [...document.querySelectorAll('.modal-overlay button')].find(x=>x.textContent.includes('AI 理解')).click();
    })()`);
    await b.wait("document.querySelector('.modal-overlay input[type=search]')");
    await b.evaluate(`(()=>{
      const input=document.querySelector('.modal-overlay input[type=search]');input.value='客户甲';
      input.dispatchEvent(new Event('input',{bubbles:true}));
      [...document.querySelectorAll('.modal-overlay button')].find(x=>x.textContent.includes('搜索人物')).click();
    })()`);
    await b.wait("[...document.querySelectorAll('.modal-overlay button')].some(x=>x.textContent.includes('客户甲'))");
    await b.evaluate("[...document.querySelectorAll('.modal-overlay button')].find(x=>x.textContent.includes('客户甲')&&x.textContent.includes('#980001')).click()");
    await b.evaluate("[...document.querySelectorAll('.modal-overlay .btn-primary')].at(-1).click()");
    await b.wait("document.querySelector('.phase14-command')?.innerText.includes('Person #980001')");
    await b.evaluate("[...document.querySelectorAll('.phase14-command button')].find(x=>x.textContent.includes('生成服务端预览')).click()");
    await b.wait("window.__crmTest.calls.some(c=>c.name==='person_360'&&c.action==='previewIdentity')");
    const preview = await b.evaluate("window.__crmTest.calls.find(c=>c.name==='person_360'&&c.action==='previewIdentity').payload");
    assert.equal(preview.kind, 'capture');
    assert.equal(preview.personId, '980001');
    assert.equal(preview.displayName, '[CRM_TEST_ONLY]客户甲');
    assert.equal(preview.note, '【CRM_TEST_ONLY】虚构原话');
    assert.equal(preview.summary, '【CRM_TEST_ONLY】人工核实摘要');
    assert.equal(await b.evaluate("window.__crmTest.calls.some(c=>c.name==='person_360'&&c.action==='executeIdentity')"), false);
    await b.evaluate("[...document.querySelectorAll('.phase14-command button')].find(x=>x.textContent.includes('确认以上内容并执行')).click()");
    await b.wait("window.__crmTest.calls.some(c=>c.name==='person_360'&&c.action==='executeIdentity')");
    assert.equal(await b.evaluate("window.__crmTest.calls.filter(c=>c.name==='person_360'&&c.action==='executeIdentity').length"), 1);
    await b.healthy();
  } finally { await b.close(); }
});
