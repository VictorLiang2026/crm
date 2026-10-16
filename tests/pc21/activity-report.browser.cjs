'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('PC21 keeps customer and recruit reports separate, filters by date, and links each source to its Person', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.openConsole('#/more');
    await browser.evaluate(`(async()=>{
      const i18n=await import('/crm/js/modules/console/i18n.js');i18n.setLang('zh-CN');
      const {renderActivityReport}=await import('/crm/js/modules/console/activity-report.js');
      window.pc21report={calls:[],async call(name,args){this.calls.push({name,args});
        if(name==='activity_reports'&&args.action==='customer')return {mode:args.mode,range:{start:args.startDate||'2026-10-16',end:args.endDate||'2026-10-16',days:1},
          totals:{newCustomers:1,firstContacts:0,followups:1,customersTouched:1,plannedDue:0,completedPlan:0,completionRate:null,gifts:0,giftItems:0,photos:0,ocrParses:0,aiSuggestions:0,policyReviews:0,productUpdates:0},
          avg:{},daily:[{date:'2026-10-16',newCustomers:1,followups:1}],overdueNow:null,
          feed:[{day:'2026-10-16',type:'跟进',name:'【系统测试·勿联系】周林',detail:'虚构来源',sourceRef:{table:'followups',id:'5001',personId:'7101',section:'timeline'}}],feedTotal:1,
          testData:{status:'verified',containsTestData:true,recordCount:1,sources:[{batchKey:'crm_test_pc21',table:'followups',count:1}]}};
        if(name==='activity_reports'&&args.action==='recruit')return {mode:args.mode,range:{start:'2026-10-16',end:'2026-10-16',days:1},totals:{newCandidates:0,rcFollowups:0,candidatesTouched:0,warm:0,firstInterview:0,event:0,deepInterview:0,apply:0,hired:0},avg:{},daily:[],feed:[],feedTotal:0,testData:{status:'verified',containsTestData:false,recordCount:0,sources:[]}};
        throw Error('Unexpected '+name+' '+JSON.stringify(args));
      }};
      const host=document.createElement('main');host.id='pc21-report-host';document.body.appendChild(host);
      renderActivityReport({main:host,api:{call:(name,args)=>window.pc21report.call(name,args)},operator:{name:'Test'}},'customer',{startDate:'2026-10-16',endDate:'2026-10-16'});
    })()`);
    await browser.wait("document.querySelector('#pc21-report-host a')");
    const first = await browser.evaluate(`({call:window.pc21report.calls[0],href:document.querySelector('#pc21-report-host a').getAttribute('href'),notice:document.querySelector('#pc21-report-host').textContent.includes('测试来源')})`);
    assert.equal(first.call.name, 'activity_reports');
    assert.equal(first.call.args.action, 'customer');
    assert.equal(first.call.args.mode, 'range');
    assert.equal(first.call.args.startDate, '2026-10-16');
    assert.equal(first.href, '#/person/7101/timeline');
    assert.equal(first.notice, true);
    const switchHandler = await browser.evaluate("[...document.querySelectorAll('#pc21-report-host button')].find(button=>button.textContent.includes('组织发展'))?.onclick?.toString()||''");
    assert.match(switchHandler,/switchTo/);
    await browser.healthy();
  } finally { await browser.close(); }
});
