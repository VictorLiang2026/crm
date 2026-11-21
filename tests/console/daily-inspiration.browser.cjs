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
    assert.equal(await browser.evaluate("document.querySelector('.daily-inspiration-menu-period').textContent"),'时段二');
    await browser.wait("document.querySelector('.daily-inspiration-heading')?.innerText.includes('持续培养团队')");
    assert.equal(await browser.evaluate("document.querySelector('.daily-inspiration-menu-period').textContent"),'时段一');
    const reads="window.__crmTest.calls.filter(call=>call.operation==='current'&&call.action==='dailyInspiration').length";
    assert.equal(await browser.evaluate(reads),2);
    await browser.evaluate("location.hash='#/more'");
    await browser.wait("!document.querySelector('.daily-inspiration-header')");
    await browser.evaluate("new Promise(resolve=>setTimeout(resolve,1100))");
    assert.equal(await browser.evaluate(reads),2);
    await browser.healthy();
  } finally {await browser.close();}
});

for (const { device, width, height, phone } of [
  { device: 'iPad portrait', width: 820, height: 1180, phone: false },
  { device: 'iPad landscape', width: 1180, height: 820, phone: false },
  { device: 'iPhone portrait', width: 390, height: 844, phone: true },
  { device: 'iPhone landscape', width: 844, height: 390, phone: true },
]) {
  test(`${device} Today header wraps both languages and keeps the quote menu beside the theme and the report to the right`, async () => {
    const browser = new Browser(path.resolve(__dirname, '../..'));
    try {
      await browser.start();
      await browser.send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: phone ? 3 : 2, mobile: true,
      });
      await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true });
      await browser.send('Emulation.setUserAgentOverride', {
        userAgent: phone ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' :
          'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
      });
      await browser.openConsole('#/today', 'authCase=1&diLongQuote=1');
      const assertHeader = async (quoteStart, theme, fullReport, shortReport) => {
        await browser.wait(`document.querySelector('.daily-inspiration-quote')?.textContent.startsWith(${JSON.stringify(quoteStart)})`);
        const head = await browser.evaluate(`(() => {
          const header = document.querySelector('.daily-inspiration-header');
          const text = header.querySelector('.daily-inspiration-quote');
          const label = header.querySelector('.daily-inspiration-theme');
          const trigger = header.querySelector('.daily-inspiration-menu-trigger');
          const copy = header.querySelector('.daily-inspiration-copy').getBoundingClientRect();
          const report = header.querySelector('.daily-inspiration-report');
          const reportRect = report.getBoundingClientRect();
          const triggerRect = trigger.getBoundingClientRect();
          const labelRect = label.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(text);
          const lines = [...range.getClientRects()];
          return {
            kicker: header.querySelector('h1').textContent, visible: header.innerText, label: label.textContent,
            hasSubtitle: Boolean(header.querySelector('.page-sub')), menuClosed: !trigger.parentElement.open,
            tailJoined: label.nextElementSibling === trigger.parentElement && triggerRect.left >= labelRect.right &&
              triggerRect.left <= labelRect.right + 6 && triggerRect.top < labelRect.bottom,
            tailAfterQuote: triggerRect.top >= lines.at(-1).top - 8,
            labelColor: getComputedStyle(label).color, fontSize: parseFloat(getComputedStyle(text).fontSize),
            wraps: lines.length > 1 && lines.every(line => line.right <= copy.right + 1),
            fits: document.documentElement.scrollWidth <= innerWidth,
            report: report.innerText.trim(), reportName: report.getAttribute('aria-label'),
            reportAligned: Math.abs(reportRect.top - copy.top) <= 3 && reportRect.left >= copy.right,
            reportCount: document.querySelectorAll('#console-main a[href="#/activity-report"]').length,
          };
        })()`);
        assert.equal(head.kicker, 'TODAY');
        assert.equal(head.label, theme);
        assert.equal(head.labelColor, 'rgb(121, 95, 48)');
        assert.equal(head.report, phone ? shortReport : fullReport);
        assert.equal(head.reportName, fullReport);
        assert.equal(head.reportCount, 1);
        assert.ok(head.fontSize <= 23, head.fontSize);
        assert.ok(head.menuClosed && !head.hasSubtitle, JSON.stringify(head));
        assert.ok(head.tailJoined && head.tailAfterQuote && head.reportAligned, JSON.stringify(head));
        assert.ok(head.wraps && head.fits, JSON.stringify(head));
        assert.doesNotMatch(head.visible, /先定要事|Priorities first|每日行业激励|LIMRA|时段[一二]|Period [12]/i);
      };
      const verifyMenuAndReport = async (period, keep, fullReport, shortReport, back) => {
        await browser.click('.daily-inspiration-menu-trigger', '⋯');
        await browser.wait(`(() => {
          const menu = document.querySelector('.daily-inspiration-menu[open] .daily-inspiration-menu-list');
          if (!menu?.style.transform) return false;
          const box = menu.getBoundingClientRect();
          return box.left >= 7 && box.right <= innerWidth - 7 && box.top >= 7 && box.bottom <= innerHeight - 7;
        })()`);
        assert.equal(await browser.evaluate("document.querySelector('.daily-inspiration-menu-period').innerText"), period);
        assert.equal(await browser.evaluate("document.querySelector('.daily-inspiration-source').href"), 'https://www.limra.com/');
        await browser.click('.daily-inspiration-menu-item', keep);
        await browser.wait("!document.querySelector('.daily-inspiration-menu').open");
        await browser.click('.daily-inspiration-report', phone ? shortReport : fullReport);
        await browser.wait("location.hash === '#/activity-report/customer' && document.querySelector('[data-report-coverage=customer]')");
        assert.match(await browser.evaluate("document.querySelector('#console-main .page-title').innerText"), new RegExp(fullReport));
        await browser.click('#console-main button', back);
        await browser.wait("location.hash === '#/today' && document.querySelector('.daily-inspiration-report')");
      };
      const switchLanguage = async (option, opposite) => {
        await browser.evaluate("location.hash='#/settings'");
        await browser.wait("document.querySelectorAll('.lang-btn').length === 2");
        await browser.click('.lang-btn', option);
        await browser.wait(`document.querySelector('.lang-toggle')?.innerText.includes(${JSON.stringify(opposite)})`);
        await browser.evaluate("location.hash='#/today'");
      };
      await assertHeader('先听懂客户', '客户信任', '工作量报表', '报表');
      await verifyMenuAndReport('时段一', '不变', '工作量报表', '报表', '返回今日');
      await switchLanguage('English', 'Simplified Chinese');
      await assertHeader('Understand the client', 'Customer trust', 'Workload Reports', 'Report');
      await verifyMenuAndReport('Period 1', 'Keep as is', 'Workload Reports', 'Report', 'Back to Today');
      await switchLanguage('Simplified Chinese', '简体中文');
      await assertHeader('先听懂客户', '客户信任', '工作量报表', '报表');
      assert.equal(await browser.evaluate("window.__crmTest.calls.filter(call => call.operation === 'replace' && call.action === 'dailyInspiration').length"), 0);
      await browser.healthy();
    } finally { await browser.close(); }
  });
}
