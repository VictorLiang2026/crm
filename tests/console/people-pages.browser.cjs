'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('Console People directory sorts person-owned priority and follow-up columns', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await b.start();
    await b.open('#/more');
    await b.evaluate(`(async()=>{
      const {renderPeople}=await import('/crm/js/modules/console/pages/people.js');
      window.peopleRequests=[];
      const ctx={main:document.getElementById('view'),toast(){},api:{call:async(name,args)=>{
        window.peopleRequests.push({name,args});
        return {rows:[{id:9,display_name:'【系统测试·勿联系】虚构人物',roles:['customer'],
          sales_priority:'A',recruitment_priority:'B',referral_priority:'C',latest_followup_date:'2026-10-01',
          next_followup_date:'2026-10-15',customer_id:13,recruit_id:null}],page:1,pageSize:20,total:1,totalPages:1,hasMore:false};
      }}};
      renderPeople(ctx);
    })()`);
    await b.wait("document.querySelector('.people-table tbody tr')");
    await b.evaluate("document.head.insertAdjacentHTML('beforeend','<link rel=stylesheet href=/crm/css/console.css>')");
    const headers = await b.evaluate("[...document.querySelectorAll('.people-table thead th')].map(x=>x.textContent.trim())");
    for (const expected of ['客户优先级','招募优先级','转介优先级','本次跟进日期','下次跟进日期','转客户','转招募']) {
      assert.ok(headers.some(header => header.includes(expected)), `missing directory column: ${expected}`);
    }
    assert.equal(headers.includes('优先级'), false);
    assert.equal(headers.includes('客户经营阶段'), false);
    assert.equal(await b.evaluate("getComputedStyle(document.querySelector('.people-table')).borderCollapse"), 'collapse');
    assert.equal(await b.evaluate("document.querySelector('.people-table tbody .bdg-jade')?.textContent"), '已存在');
    assert.equal(await b.evaluate("[...document.querySelectorAll('.people-table tbody button')].some(x=>x.textContent.trim()==='转招募')"), true);

    const sortable = [
      ['客户优先级','sales_priority'], ['招募优先级','recruitment_priority'],
      ['转介优先级','referral_priority'], ['本次跟进日期','latest_followup_date'],
      ['下次跟进日期','next_followup_date'],
    ];
    for (const [label, field] of sortable) {
      const nextCount = await b.evaluate('window.peopleRequests.length+1');
      await b.evaluate(`(()=>[...document.querySelectorAll('.people-table thead th')].find(x=>x.textContent.includes(${JSON.stringify(label)})).click())()`);
      await b.wait(`window.peopleRequests.length>=${nextCount}`);
      const last = await b.evaluate('window.peopleRequests.at(-1).args');
      assert.equal(last.sortField, field, `${label} sort field`);
      assert.equal(last.sortDir, 'asc', `${label} first sort direction`);
    }
  } finally { await b.close(); }
});

test('People directory reveals role priorities and applies multi-select only on Search', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await b.start();
    await b.open('#/more');
    await b.evaluate(`(async()=>{
      const {renderPeople}=await import('/crm/js/modules/console/pages/people.js');
      window.peopleRequests=[];
      const ctx={main:document.getElementById('view'),toast(){},api:{call:async(name,args)=>{
        window.peopleRequests.push({name,args});
        return {rows:[],page:1,pageSize:20,total:0,totalPages:1,hasMore:false};
      }}};
      renderPeople(ctx);
    })()`);
    await b.wait("document.querySelector('.people-filter-trigger')");
    await b.evaluate("document.head.insertAdjacentHTML('beforeend','<link rel=stylesheet href=/crm/css/console.css>')");
    assert.equal(await b.evaluate("document.querySelector('.people-filter-anchor').nextElementSibling.getAttribute('href')"), '#/people-trash');
    const initialCount = await b.evaluate('window.peopleRequests.length');
    await b.evaluate("document.querySelector('.people-filter-trigger').click()");
    await b.evaluate(`document.querySelector('.people-filter-check[data-filter-value="recruit"] input').click()`);
    assert.equal(await b.evaluate("document.querySelectorAll('.people-filter-priorities section').length"), 1);
    await b.evaluate(`(()=>{const s=document.querySelector('.people-filter-priorities section');const c=s.querySelectorAll('input');c[0].click();c[2].click()})()`);
    await b.evaluate(`document.querySelector('.people-filter-check[data-filter-value="customer"] input').click()`);
    await b.evaluate(`(()=>{const s=[...document.querySelectorAll('.people-filter-priorities section')].find(x=>x.textContent.includes('客户'));s.querySelectorAll('input')[1].click()})()`);
    assert.equal(await b.evaluate('window.peopleRequests.length'), initialCount, 'pending filters must not query before Search');
    await b.evaluate(`(()=>[...document.querySelectorAll('.people-filter-panel button')].find(x=>x.textContent.trim()==='搜索').click())()`);
    await b.wait(`window.peopleRequests.length>${initialCount}`);
    const request = await b.evaluate('window.peopleRequests.at(-1)');
    assert.equal(request.name, 'person_360');
    assert.deepEqual(request.args.roles, ['recruit','customer']);
    assert.deepEqual(request.args.recruitPriorities, ['A','C']);
    assert.deepEqual(request.args.customerPriorities, ['B']);
    assert.deepEqual(request.args.referralPriorities, []);
  } finally { await b.close(); }
});

test('Recycle bin remains simple and has no directory filters', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await b.start();
    await b.open('#/more');
    await b.evaluate(`(async()=>{
      const {renderPeopleTrash}=await import('/crm/js/modules/console/pages/people-trash.js');
      window.trashRequests=[];
      const ctx={main:document.getElementById('view'),toast(){},api:{call:async(name,args)=>{
        window.trashRequests.push({name,args});
        return {rows:[],page:1,pageSize:20,total:0,totalPages:1,hasMore:false};
      }}};
      renderPeopleTrash(ctx);
    })()`);
    await b.wait("document.querySelector('.people-trash-layout .card-body') || document.querySelector('section.card .card-body')");
    assert.equal(await b.evaluate("document.querySelector('.people-filter-trigger')"), null);
    assert.equal(await b.evaluate("document.querySelector('.people-trash-layout')"), null);
    assert.deepEqual(await b.evaluate('window.trashRequests[0].args'), { action: 'listPersonTrash', page: 1, pageSize: 20 });
  } finally { await b.close(); }
});
