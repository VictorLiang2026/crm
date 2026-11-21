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
    assert.equal(await browser.evaluate("document.querySelector('[name=\"minRecommendationScore\"]').value"),'0');
    assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('.di-settings-import-grid')).gridTemplateColumns.split(' ').length"),2);
    await browser.evaluate(`(()=>{
      const bundle={formatVersion:1,quotes:[
        {quoteZh:'先听懂客户，再讨论方案。',quoteEn:'Understand the client before discussing a solution.',theme:'customer_trust',sourceOrg:'LIMRA',sourceTitle:'Test fixture',sourceUrl:'https://www.limra.com/',editorialRewrite:true,recommendationScore:8},
        {sourceEntryId:'Q002',attribution:'Test author',quoteZh:'帮助客户一步步实现目标。',quoteEn:'Help clients make progress toward their goals.',theme:'customer_service',sourceOrg:'LIMRA',sourceTitle:'Test import',sourceUrl:'https://www.limra.com/research',editorialRewrite:true}
      ],fillMissingScores:[{id:'991001',recommendationScore:8}],skippedDuplicates:[]};
      const transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify(bundle)],'quotes.json',{type:'application/json'}));
      const input=document.querySelector('.di-import-preview')?.parentElement?.querySelector('input[type=file]')||document.querySelector('input[type=file]');
      input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await browser.wait("document.querySelector('.di-import-preview')?.innerText.includes('跳过重复')");
    assert.equal(await browser.evaluate("Object.hasOwn(window.__crmTest.calls.find(call=>call.operation==='quoteBatchPreview').payload.quotes[1],'sourceEntryId')"),false);
    assert.match(await browser.evaluate("document.querySelector('.di-import-preview').innerText"),/自动评分/);
    await browser.evaluate("document.querySelector('.di-import-preview').parentElement.querySelector('button[type=button]').click()");
    await browser.wait("window.__crmTest.calls.some(call=>call.name==='assistant'&&call.operation==='quoteBatchImport')");
    assert.equal(await browser.evaluate("window.__crmTest.calls.filter(call=>call.name==='assistant'&&call.operation==='quoteBatchImport').length"),1);

    await browser.evaluate(`(()=>{
      const tsv='中文语录\\t英文语录\\t主题\\t来源组织\\t来源材料\\t出处链接\\t编辑改写\\t推荐值\\n先听懂客户，再讨论方案前先听需求。\\tUnderstand the client before discussing a solution, and listen first.\\tcustomer_trust\\tLIMRA\\tTSV test\\thttps://www.limra.com/\\ttrue\\t8';
      const transfer=new DataTransfer();transfer.items.add(new File([tsv],'near.tsv',{type:'text/tab-separated-values'}));
      const input=document.querySelector('input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await browser.wait("document.querySelector('.di-import-near-row')");
    assert.match(await browser.evaluate("document.querySelector('.di-import-near-row').innerText"),/先听懂客户/);
    await browser.evaluate("document.querySelector('input[name=\"near-0\"][value=\"keep_existing\"]').click()");
    await browser.evaluate("document.querySelector('.di-import-preview').parentElement.querySelector('button[type=button]').click()");
    await browser.wait("window.__crmTest.calls.filter(call=>call.name==='assistant'&&call.operation==='quoteBatchImport').length===2");
    assert.equal(await browser.evaluate("window.__crmTest.calls.filter(call=>call.operation==='quoteBatchImport')[1].payload.decisions[0].choice"),'keep_existing');

    await browser.evaluate("new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/crm/js/vendor/sheetjs-0.20.3.full.min.js';script.onload=resolve;script.onerror=reject;document.head.appendChild(script)})");
    await browser.evaluate(`(()=>{
      const rows=[['编号','English Quote','中文译文','讲者/归属','平台/组织','主题','来源标题','来源链接','推荐值（0–10）','引述类型'],
        ['Q001','Keep understanding clients’ long-term needs.','持续理解客户的长期需要。','Test author','LIMRA','客户沟通','XLSX test','https://www.limra.com/research',9,'转述语录']];
      const sheet=XLSX.utils.aoa_to_sheet(rows),book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'Quotes');
      const bytes=XLSX.write(book,{bookType:'xlsx',type:'array'}),transfer=new DataTransfer();
      transfer.items.add(new File([bytes],'quotes.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
      const input=document.querySelector('input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await browser.wait("document.querySelector('.di-import-preview')?.innerText.includes('持续理解客户')");
    assert.deepEqual(await browser.evaluate("window.__crmTest.calls.filter(call=>call.operation==='quoteBatchPreview').at(-1).payload.quotes[0]"),{
      quoteZh:'持续理解客户的长期需要。',quoteEn:'Keep understanding clients’ long-term needs.',theme:'customer_service',
      sourceOrg:'LIMRA',sourceTitle:'XLSX test（引述：Test author）',sourceUrl:'https://www.limra.com/research',
      editorialRewrite:true,recommendationScore:9,
    });
    assert.equal(await browser.evaluate("document.querySelector('.di-import-preview').parentElement.querySelector('button[type=button]').disabled"),false);
    await browser.evaluate("document.querySelector('.di-import-preview').parentElement.querySelector('button[type=button]').click()");
    await browser.wait("window.__crmTest.calls.filter(call=>call.name==='assistant'&&call.operation==='quoteBatchImport').length===3");

    await browser.evaluate(`(()=>{
      const csv='quoteZh,quoteEn,theme,sourceOrg,sourceTitle,sourceUrl,editorialRewrite,recommendationScore\\r\\n"以清晰的计划支持团队成长。","Support team growth with a clear plan.",team_growth,GAMA,CSV test,https://gamaglobal.org/,false,7';
      const transfer=new DataTransfer();transfer.items.add(new File([csv],'quotes.csv',{type:'text/csv'}));
      const input=document.querySelector('input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await browser.wait("document.querySelector('.di-import-preview')?.innerText.includes('以清晰的计划')");
    await browser.evaluate("document.querySelector('.di-import-preview').parentElement.querySelector('button[type=button]').click()");
    await browser.wait("window.__crmTest.calls.filter(call=>call.name==='assistant'&&call.operation==='quoteBatchImport').length===4");

    await browser.evaluate(`(()=>{
      const first=document.querySelector('[name="firstPeriodStart"]');first.value='02:00';first.dispatchEvent(new Event('input',{bubbles:true}));
      const second=document.querySelector('[name="secondPeriodStart"]');second.value='11:00';second.dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('.di-settings-form [type="submit"]').click();
    })()`);
    await browser.wait("window.__crmTest.calls.some(call=>call.name==='assistant'&&call.operation==='settingsSave')");
    assert.equal(await browser.evaluate("window.__crmTest.calls.find(call=>call.operation==='settingsSave').payload.minRecommendationScore"),0);
    assert.equal(await browser.evaluate("window.__crmTest.calls.find(call=>call.operation==='settingsSave').payload.allowRepeatBeforeAllUsed"),false);
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
    await browser.evaluate("localStorage.setItem('crm_lang','en');location.reload()");
    await browser.wait("location.hash==='#/daily-inspiration'&&document.querySelector('.di-settings-import-grid')?.innerText.includes('Display settings')");
    assert.match(await browser.evaluate("document.querySelector('.di-settings-import-grid').innerText"),/Import quote library/);
    await browser.healthy();
  } finally {await browser.close();}
});

test('home reloads the quote at the scheduled boundary and cancels its refresh on navigation',async()=>{
  const browser=new Browser(path.resolve(__dirname,'../..'));
  try {
    await browser.start();
    await browser.openConsole('#/today','authCase=1&diBoundary=1');
    await browser.wait("document.querySelector('.daily-inspiration-heading')?.innerText.includes('先听懂客户')");
    assert.match(await browser.evaluate("document.querySelector('.daily-inspiration-strip').innerText"),/时段二/);
    await browser.wait("document.querySelector('.daily-inspiration-heading')?.innerText.includes('持续培养团队')");
    assert.match(await browser.evaluate("document.querySelector('.daily-inspiration-strip').innerText"),/时段一/);
    const reads="window.__crmTest.calls.filter(call=>call.operation==='current'&&call.action==='dailyInspiration').length";
    assert.equal(await browser.evaluate(reads),2);
    await browser.evaluate("location.hash='#/more'");
    await browser.wait("!document.querySelector('.daily-inspiration-strip')");
    await browser.evaluate("new Promise(resolve=>setTimeout(resolve,1100))");
    assert.equal(await browser.evaluate(reads),2);
    await browser.healthy();
  } finally {await browser.close();}
});
