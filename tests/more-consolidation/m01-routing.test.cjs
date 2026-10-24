'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');
const root = path.resolve(__dirname, '../..');

test('M01 dispatch preserves all deep-link parameters and navigation ownership', () => {
  const raw = fs.readFileSync(path.join(root, 'crm/js/modules/console/router.js'), 'utf8');
  const imports = raw.match(/import\s*\{([\s\S]*?)\}\s*from\s*['"]\.\/views.js['"];?/);
  assert.ok(imports);
  const names = imports[1].split(',').map(x => x.trim()).filter(Boolean);
  let last;
  const views = names.map(name => (...args) => { last = { name, args }; });
  const source = raw.replace(imports[0], '').replace(/export function /g, 'function ');
  const { dispatch, navHashFor } = new Function(...names, source + '\nreturn { dispatch, navHashFor };')(...views);
  const ctx = { test: true };
  for (const section of ['timeline','insurance','opportunities','relationships','recruit','care','ocr']) {
    dispatch('#/person/783/' + section, ctx);
    assert.deepEqual(last, { name:'renderPerson', args:[ctx,'783',section] });
    assert.equal(navHashFor('#/person/783/' + section), '#/people');
  }
  dispatch('#/person/783', ctx);
  assert.deepEqual(last.args, [ctx,'783',undefined]);
  for (const type of ['customer','recruit']) {
    dispatch('#/activity-report/' + type + '?startDate=2026-10-01&endDate=2026-10-23', ctx);
    assert.deepEqual(last, { name:'renderActivityReport', args:[ctx,type,{startDate:'2026-10-01',endDate:'2026-10-23'}] });
    dispatch('#/activity-report/' + type, ctx);
    assert.deepEqual(last.args[2], { startDate:null,endDate:null });
  }
  dispatch('#/knowledge-governance?item=53', ctx);
  assert.deepEqual(last, { name:'renderKnowledgeGovernance', args:[ctx,{focusItemId:'53'}] });
  dispatch('#/activity/11', ctx);
  assert.deepEqual(last, { name:'renderActivity', args:[ctx,'11'] });
  dispatch('#/unknown', ctx);
  assert.equal(last.name, 'renderToday');
});

test('M01 actual Console routing preserves timeline and report dates through back/forward', async () => {
  const browser = new Browser(root);
  try {
    await browser.start();
    await browser.openConsole('#/more', 'authCase=1');
    await browser.wait("document.querySelector('#console-main .more-section')");
    await browser.evaluate(`(async()=>{
      const {data}=await import('/crm/js/modules/console/data.js');
      window.m01Reports=[];
      data.activityReport=async(ctx,type,params)=>{
        window.m01Reports.push({type,...params});
        return {mode:params.mode,range:{start:params.startDate,end:params.endDate,days:23},
          totals:{},daily:[],feed:[],feedTotal:0,testData:{status:'verified',containsTestData:false}};
      };
      location.hash='#/person/980001/timeline';
    })()`);
    await browser.wait("document.querySelector('#console-main .tabs .tab.active')");
    assert.equal(await browser.evaluate("[...document.querySelectorAll('#console-main .tabs .tab')].findIndex(x=>x.classList.contains('active'))"), 1);
    await browser.evaluate("location.hash='#/activity-report/customer?startDate=2026-10-01&endDate=2026-10-23'");
    await browser.wait('window.m01Reports.length>=1');
    assert.deepEqual(await browser.evaluate('window.m01Reports[0]'), {type:'customer',mode:'range',startDate:'2026-10-01',endDate:'2026-10-23'});
    assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('#console-main input[type=date]')].map(x=>x.value)"), ['2026-10-01','2026-10-23']);
    await browser.evaluate('history.back()');
    await browser.wait("location.hash==='#/person/980001/timeline' && document.querySelector('#console-main .tabs .tab.active')");
    assert.equal(await browser.evaluate("[...document.querySelectorAll('#console-main .tabs .tab')].findIndex(x=>x.classList.contains('active'))"), 1);
    await browser.evaluate('window.m01Reports=[];history.forward()');
    await browser.wait("location.hash.startsWith('#/activity-report/customer?') && window.m01Reports.length>=1");
    assert.equal(await browser.evaluate('window.m01Reports.at(-1).startDate'), '2026-10-01');
    await browser.healthy();
  } finally { await browser.close(); }
});

test('M01 legacy opportunity opens its customer detail and rejects malformed IDs', async () => {
  const browser = new Browser(root);
  try {
    await browser.start();
    await browser.openConsole('#/more', 'authCase=1');
    await browser.evaluate(`(async()=>{
      const {renderOpportunities}=await import('/crm/js/modules/console/pages/opportunities.js');
      const host=document.createElement('main');host.id='m01-opps';document.body.appendChild(host);
      window.m01Legacy={id:92,person_id:980001,customer_id:'301',status:'关闭',opportunity_type:'医疗保障',person:{id:980001,display_name:'【系统测试·勿联系】虚构人物'}};
      const ctx={main:host,toast:()=>{},api:{call:async(name,args)=>{
        if(args.action==='listOpportunityDirectory')return {rows:[window.m01Legacy],page:1,pageSize:20,total:1,hasMore:false,countsByStatus:{}};
        if(args.action==='getOpportunityDirectoryDetails')return {opportunity:window.m01Legacy,actions:[],outcomes:[]};
        if(name==='funnel_insight')return {funnels:[]};
        if(args.action==='listPendingOpportunityCandidates')return {rows:[]};
        throw Error('Unexpected '+name+' '+args.action);
      }}};
      renderOpportunities(ctx);
    })()`);
    await browser.wait("document.querySelector('#m01-opps .opp-row-main')");
    await browser.evaluate("document.querySelector('#m01-opps .opp-row-main').click()");
    await browser.wait("document.querySelector('.opp-detail-actions')");
    assert.equal(await browser.evaluate("document.querySelector('.opp-detail-actions a')?.getAttribute('href')"), '/crm/admin.html#/customer/301');
    await browser.evaluate("document.querySelector('.sheet-overlay').remove();window.m01Legacy.customer_id='301/../../account';document.querySelector('#m01-opps .opp-row-main').click()");
    await browser.wait("document.querySelector('.opp-detail-actions')");
    assert.equal(await browser.evaluate("document.querySelector('.opp-detail-actions a')"), null);
    await browser.evaluate("document.querySelector('.sheet-overlay').remove();window.m01Legacy.customer_id=301;document.querySelector('#m01-opps .opp-row-main').click()");
    await browser.wait("document.querySelector('.opp-detail-actions a')");
    await browser.evaluate("document.querySelector('.opp-detail-actions a').click()");
    await browser.wait("location.pathname==='/crm/admin.html' && location.hash==='#/customer/301'");
    await browser.wait("window.__crmTest && document.getElementById('view')?.textContent.includes('[CRM_TEST_ONLY]客户甲')");
    await browser.healthy();
  } finally { await browser.close(); }
});
