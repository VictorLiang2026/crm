'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {Browser}=require('../regression/browser.cjs');

test('Daily inspiration renders, swaps and keeps a stable home quote, then manages library and periods',async()=>{
  const browser=new Browser(path.resolve(__dirname,'../..'));
  try {
    await browser.start();
    await browser.send('Emulation.setDeviceMetricsOverride',{width:1180,height:820,deviceScaleFactor:1,mobile:false});
    await browser.openConsole('#/today','authCase=1');
    await browser.wait("document.querySelector('.daily-inspiration-heading')?.innerText.includes('先听懂客户')");
    assert.match(await browser.evaluate("document.querySelector('.daily-inspiration-heading').innerText"),/先听懂客户/);

    await browser.evaluate("document.querySelector('.daily-inspiration-menu-trigger').click()");
    await browser.click('.daily-inspiration-menu-item','更换一条');
    await browser.wait("document.querySelector('.daily-inspiration-heading')?.innerText.includes('持续培养团队')");
    assert.equal(await browser.evaluate("window.__crmTest.calls.filter(call=>call.name==='assistant'&&call.operation==='replace').length"),1);
    await browser.evaluate("document.querySelector('.daily-inspiration-menu-trigger').click()");
    const beforeKeep=await browser.evaluate("window.__crmTest.calls.filter(call=>call.name==='assistant'&&call.action==='dailyInspiration').length");
    await browser.click('.daily-inspiration-menu-item','不变');
    assert.equal(await browser.evaluate("window.__crmTest.calls.filter(call=>call.name==='assistant'&&call.action==='dailyInspiration').length"),beforeKeep);

    await browser.evaluate("location.hash='#/more'");
    await browser.wait("document.querySelector('.more-primary a[href=\"#/daily-inspiration\"]')");
    await browser.evaluate("document.querySelector('.more-primary a[href=\"#/daily-inspiration\"]').click()");
    await browser.wait("location.hash==='#/daily-inspiration'&&document.querySelectorAll('.di-library-row').length===2");
    await browser.evaluate(`(()=>{
      const bundle={formatVersion:1,quotes:[
        {quoteZh:'先听懂客户，再讨论方案。',quoteEn:'Understand the client before discussing a solution.',theme:'customer_trust',sourceOrg:'LIMRA',sourceTitle:'Test fixture',sourceUrl:'https://www.limra.com/',editorialRewrite:true,recommendationScore:8},
        {quoteZh:'帮助客户一步步实现目标。',quoteEn:'Help clients make progress toward their goals.',theme:'customer_service',sourceOrg:'LIMRA',sourceTitle:'Test import',sourceUrl:'https://www.limra.com/research',editorialRewrite:true}
      ],fillMissingScores:[{id:'991001',recommendationScore:8}],skippedDuplicates:[]};
      const transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify(bundle)],'quotes.json',{type:'application/json'}));
      const input=document.querySelector('.di-import-preview')?.parentElement?.querySelector('input[type=file]')||document.querySelector('input[type=file]');
      input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await browser.wait("document.querySelector('.di-import-preview')?.innerText.includes('跳过重复')");
    assert.match(await browser.evaluate("document.querySelector('.di-import-preview').innerText"),/自动评分/);
    await browser.evaluate("document.querySelector('.di-import-preview').parentElement.querySelector('button[type=button]').click()");
    await browser.wait("window.__crmTest.calls.some(call=>call.name==='assistant'&&call.operation==='quoteBatchImport')");
    assert.equal(await browser.evaluate("window.__crmTest.calls.filter(call=>call.name==='assistant'&&call.operation==='quoteBatchImport').length"),1);

    await browser.evaluate(`(()=>{
      const first=document.querySelector('[name="firstPeriodStart"]');first.value='02:00';first.dispatchEvent(new Event('input',{bubbles:true}));
      const second=document.querySelector('[name="secondPeriodStart"]');second.value='11:00';second.dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('.di-settings-form [type="submit"]').click();
    })()`);
    await browser.wait("window.__crmTest.calls.some(call=>call.name==='assistant'&&call.operation==='settingsSave')");
    await browser.click('.page-head .btn','新增语录');
    await browser.wait("document.querySelector('.di-quote-form input[name="+'"quoteZh"'+"]')");
    await browser.evaluate(`(()=>{
      document.querySelector('[name="quoteZh"]').value='持续了解客户的真实需要。';
      document.querySelector('[name="quoteEn"]').value='Keep learning what clients really need.';
      document.querySelector('[name="sourceOrg"]').value='GAMA Global';
      document.querySelector('[name="sourceTitle"]').value='Field Leadership Series';
      document.querySelector('[name="sourceUrl"]').value='https://gamaglobal.org/training/';
      document.querySelector('.di-quote-form [type="submit"]').click();
    })()`);
    await browser.wait("window.__crmTest.calls.some(call=>call.name==='assistant'&&call.operation==='quoteSave')");
    await browser.evaluate("document.querySelector('.di-library-row .di-library-actions button').click()");
    await browser.wait("document.querySelector('.di-quote-form input[name=\"quoteZh\"]')");
    assert.equal(await browser.evaluate("document.querySelector('.di-quote-form input[name=\"quoteZh\"]').value"),'先听懂客户，再讨论方案。');
    await browser.evaluate("document.querySelector('.di-quote-form button[type=\"button\"]').click()");
    await browser.evaluate("document.querySelector('.di-library-row .di-library-actions button:nth-child(2)').click()");
    await browser.wait("window.__crmTest.calls.some(call=>call.name==='assistant'&&call.operation==='quoteToggle')");
    await browser.healthy();
  } finally {await browser.close();}
});
