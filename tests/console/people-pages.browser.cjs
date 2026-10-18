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
      const ctx={main:(()=>{const e=document.createElement('main');document.body.append(e);return e})(),toast(){},api:{call:async(name,args)=>{
        window.peopleRequests.push({name,args});
        return {rows:[{id:9,display_name:'【系统测试·勿联系】虚构人物',roles:['customer'],
          sales_priority:'A',recruitment_priority:'B',referral_priority:'C',latest_followup_date:'2026-10-01',
          next_followup_date:'2026-10-15',customer_id:13,recruit_id:null}],page:1,pageSize:30,total:1,totalPages:1,hasMore:false};
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
      const ctx={main:(()=>{const e=document.createElement('main');document.body.append(e);return e})(),toast(){},api:{call:async(name,args)=>{
        window.peopleRequests.push({name,args});
        return {rows:[],page:1,pageSize:30,total:0,totalPages:1,hasMore:false};
      }}};
      renderPeople(ctx);
    })()`);
    await b.wait("document.querySelector('.people-filter-trigger')");
    assert.equal(await b.evaluate("document.querySelector('.people-filter-trigger').textContent.trim()"), '筛选 无');
    await b.evaluate("document.head.insertAdjacentHTML('beforeend','<link rel=stylesheet href=/crm/css/console.css>')");
    assert.equal(await b.evaluate("document.querySelector('.toolbar a[href=\"#/people-trash\"]')?.getAttribute('href')"), '#/people-trash');
    const sizes = await b.evaluate(`(()=>{
      const filter=document.querySelector('.people-filter-trigger');
      const create=[...document.querySelectorAll('.toolbar button')].find(x=>x.textContent.includes('新建人物'));
      return {filterHeight:getComputedStyle(filter).height,createHeight:getComputedStyle(create).height,
        filterBackground:getComputedStyle(filter).backgroundColor,createBackground:getComputedStyle(create).backgroundColor};
    })()`);
    assert.equal(sizes.filterHeight, sizes.createHeight, 'filter control must match the create-person control size');
    assert.notEqual(sizes.filterBackground, sizes.createBackground, 'filter control has a distinct background');
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
    assert.equal(await b.evaluate("document.querySelector('.people-filter-count').textContent"), '5');
  } finally { await b.close(); }
});

test('People directory shows one 招募 badge for converted recruits without changing global labels', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await b.start();
    await b.open('#/more');
    await b.evaluate(`(async()=>{
      const {renderPeople}=await import('/crm/js/modules/console/pages/people.js');
      const ctx={main:(()=>{const e=document.createElement('main');document.body.append(e);return e})(),toast(){},api:{call:async()=>({rows:[
        {id:7,display_name:'已转招募',roles:['recruit'],recruit_id:73},
        {id:8,display_name:'招募关联人物',roles:[],recruit_id:74},
      ],page:1,pageSize:30,total:2,totalPages:1,hasMore:false})}};
      renderPeople(ctx);
    })()`);
    await b.wait("document.querySelectorAll('.people-table .badge-stack').length===2");
    const badges = await b.evaluate("[...document.querySelectorAll('.people-table .badge-stack')].map(x=>[...x.children].map(b=>b.textContent.trim()))");
    assert.deepEqual(badges, [['招募'], ['招募']]);
    const sharedLabels = await b.evaluate(`(async()=>{
      const {t}=await import('/crm/js/modules/console/i18n.js');
      return [t('recruit'),t('badge_recruiting')];
    })()`);
    assert.deepEqual(sharedLabels, ['增员', '在增员']);
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
      const ctx={main:(()=>{const e=document.createElement('main');document.body.append(e);return e})(),toast(){},api:{call:async(name,args)=>{
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

test('People directory uses 30-row pages on phone and iPad with an unlocked content-width name column', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await b.start();
    await b.open('#/more');
    await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await b.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await b.evaluate(`(async()=>{
      const {renderPeople}=await import('/crm/js/modules/console/pages/people.js');
      window.peopleRequests=[];
      window.peopleTestCtx={main:(()=>{const e=document.createElement('main');document.body.append(e);return e})(),toast(){},api:{call:async(name,args)=>{
        window.peopleRequests.push({name,args});
        const all=Array.from({length:31},(_,i)=>({id:100+i,display_name:i===17?'这是本页最长姓名用于确认姓名列按照最长内容自然扩展':'人物'+String(i+1).padStart(2,'0'),
          roles:[],sales_priority:'A',recruitment_priority:'B',referral_priority:'C',latest_followup_date:'2026-10-04',next_followup_date:'2026-10-18'}));
        const start=(args.page-1)*args.pageSize;
        const rows=all.slice(start,start+args.pageSize);
        return {rows,page:args.page,pageSize:args.pageSize,total:all.length,totalPages:Math.ceil(all.length/args.pageSize),hasMore:start+rows.length<all.length};
      }}};
      window.renderPeopleForViewport=()=>{const main=document.createElement('main');document.body.append(main);window.peopleTestCtx.main=main;renderPeople(window.peopleTestCtx)};
      window.renderPeopleForViewport();
    })()`);
    await b.wait("document.querySelectorAll('.people-directory-table tbody tr').length===30");
    await b.evaluate("document.head.insertAdjacentHTML('beforeend','<link rel=stylesheet href=/crm/css/console.css>')");
    await b.wait("!!document.querySelector('link[href=\"/crm/css/console.css\"]')?.sheet && getComputedStyle(document.querySelector('.people-directory-table')).minWidth==='0px'");
    assert.equal(await b.evaluate('window.peopleRequests[0].args.pageSize'), 30);
    const mobile = await b.evaluate(`(async()=>{
      const scroller=document.querySelector('.people-directory-scroll');
      const table=document.querySelector('.people-directory-table');
      const nameHead=table.querySelector('th.people-col-name');
      const nameCell=table.querySelector('tbody td.people-col-name');
      const before=nameCell.getBoundingClientRect().left;
      scroller.scrollLeft=60;
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const after=nameCell.getBoundingClientRect().left;
      return {overflow:scroller.scrollWidth>scroller.clientWidth,scrollLeft:scroller.scrollLeft,scrollWidth:scroller.scrollWidth,clientWidth:scroller.clientWidth,overflowX:getComputedStyle(scroller).overflowX,position:getComputedStyle(nameHead).position,
        nameWidth:nameHead.getBoundingClientRect().width,cellWidth:nameCell.getBoundingClientRect().width,
        wholeTableMoves:after<before-50, minWidth:getComputedStyle(table).minWidth};
    })()`);
    assert.equal(mobile.overflow, true, 'phone table must be horizontally scrollable');
    assert.equal(mobile.position, 'static', 'name column must not be sticky');
    assert.equal(mobile.wholeTableMoves, true, `name column moves with the table (${JSON.stringify(mobile)})`);
    assert.ok(mobile.nameWidth > 160, 'name column expands to fit the longest row');
    assert.equal(mobile.cellWidth, mobile.nameWidth);
    assert.equal(mobile.minWidth, '0px');
    await b.evaluate("document.querySelector('.pager button:last-child').click()");
    await b.wait("window.peopleRequests.at(-1)?.args.page===2 && document.querySelectorAll('.people-directory-table tbody tr').length===1");
    assert.equal(await b.evaluate('window.peopleRequests.at(-1).args.pageSize'), 30);

    await b.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: true });
    await b.evaluate('document.body.replaceChildren();window.renderPeopleForViewport()');
    await b.wait("window.peopleRequests.at(-1)?.args.pageSize===30");
    assert.equal(await b.evaluate("getComputedStyle(document.querySelector('.people-date-full')).display"), 'inline');
    assert.equal(await b.evaluate("getComputedStyle(document.querySelector('.people-date-mobile')).display"), 'none');

    await b.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
    await b.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await b.evaluate('document.body.replaceChildren();window.renderPeopleForViewport()');
    await b.wait("window.peopleRequests.at(-1)?.args.pageSize===20");
  } finally { await b.close(); }
});
