'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('Console People directory sorts person-owned priority and follow-up columns', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await b.start();
    await b.openConsole('#/ai');
    await b.evaluate(`(async()=>{
      const {renderPeople}=await import('/crm/js/modules/console/pages/people.js');
      window.peopleRequests=[];
      const ctx={main:(()=>{const e=document.createElement('main');document.body.append(e);return e})(),toast(){},api:{call:async(name,args)=>{
        window.peopleRequests.push({name,args});
        return {rows:[{id:9,display_name:'【系统测试·勿联系】虚构人物',roles:['customer'],
          sales_priority:'A',recruitment_priority:'B',referral_priority:'C',latest_followup_date:'2026-10-01',
          next_followup_date:'2026-10-15',updated_at:'2026-10-12T09:30:00Z',customer_id:13,recruit_id:null}],page:1,pageSize:30,total:1,totalPages:1,hasMore:false};
      }}};
      renderPeople(ctx);
    })()`);
    await b.wait("document.querySelector('.people-table tbody tr')");
    await b.evaluate("document.head.insertAdjacentHTML('beforeend','<link rel=stylesheet href=/crm/css/console.css>')");
    const headers = await b.evaluate("[...document.querySelectorAll('.people-table thead th')].map(x=>x.textContent.trim())");
    for (const expected of ['客户优先级','招募优先级','转介优先级','本次跟进日期','下次跟进日期','最近更新日期','转客户','转招募']) {
      assert.ok(headers.some(header => header.includes(expected)), `missing directory column: ${expected}`);
    }
    const englishLabels = await b.evaluate(`(async()=>{
      const {t,setLang}=await import('/crm/js/modules/console/i18n.js');
      setLang('en');const labels=[t('col_recent_update'),t('col_recent_update_mobile')];setLang('zh-CN');return labels;
    })()`);
    assert.deepEqual(englishLabels, ['Last Updated','Updated']);
    assert.equal(headers.includes('优先级'), false);
    assert.equal(headers.includes('客户经营阶段'), false);
    assert.equal(await b.evaluate("getComputedStyle(document.querySelector('.people-table')).borderCollapse"), 'collapse');
    assert.equal(await b.evaluate("document.querySelector('.people-table tbody .bdg-jade')?.textContent"), '已存在');
    assert.equal(await b.evaluate("[...document.querySelectorAll('.people-table tbody button')].some(x=>x.textContent.trim()==='转招募')"), true);

    const sortable = [
      ['客户优先级','sales_priority'], ['招募优先级','recruitment_priority'],
      ['转介优先级','referral_priority'], ['本次跟进日期','latest_followup_date'],
      ['下次跟进日期','next_followup_date'], ['最近更新日期','updated_at'],
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
    await b.openConsole('#/ai');
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

test('People directory name cells show only names while role filters and global labels remain available', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await b.start();
    await b.openConsole('#/ai');
    await b.evaluate(`(async()=>{
      const {renderPeople}=await import('/crm/js/modules/console/pages/people.js');
      const ctx={main:(()=>{const e=document.createElement('main');document.body.append(e);return e})(),toast(){},api:{call:async()=>({rows:[
        {id:7,display_name:'已转招募',roles:['customer','recruit','participant'],recruit_id:73},
        {id:8,display_name:'招募关联人物',roles:[],recruit_id:74},
      ],page:1,pageSize:30,total:2,totalPages:1,hasMore:false})}};
      renderPeople(ctx);
    })()`);
    await b.wait("document.querySelectorAll('.people-directory-table tbody tr').length===2");
    const names = await b.evaluate("[...document.querySelectorAll('.people-directory-table td.people-col-name')].map(x=>x.textContent.trim())");
    assert.deepEqual(names, ['已转招募', '招募关联人物']);
    assert.equal(await b.evaluate("document.querySelectorAll('.people-directory-table td.people-col-name .badge-stack').length"), 0);
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
    await b.openConsole('#/ai');
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
    await b.openConsole('#/ai');
    await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await b.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await b.evaluate(`(async()=>{
      const {renderPeople}=await import('/crm/js/modules/console/pages/people.js');
      window.peopleRequests=[];
      window.peopleTestCtx={main:(()=>{const e=document.createElement('main');document.body.append(e);return e})(),toast(){},api:{call:async(name,args)=>{
        window.peopleRequests.push({name,args});
        const all=Array.from({length:31},(_,i)=>({id:100+i,display_name:i===17?'这是本页最长姓名用于确认姓名列按照最长内容自然扩展':'人物'+String(i+1).padStart(2,'0'),
          roles:[],sales_priority:'A',recruitment_priority:'B',referral_priority:'C',latest_followup_date:'2026-10-04',next_followup_date:'2026-10-18',updated_at:'2026-10-12T09:30:00Z'}));
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
    assert.equal(await b.evaluate("document.documentElement.classList.contains('crm-iphone-layout')"), false,
      'the generic phone fixture must not activate iPhone-only table sizing');
    assert.equal(await b.evaluate("document.querySelector('.people-directory-table').dataset.iphoneView"), undefined);
    assert.equal(await b.evaluate("document.querySelectorAll('.people-directory-views > .people-directory-view').length"), 6,
      'generic phone keeps all directory views in the original view row');
    assert.equal(await b.evaluate("getComputedStyle(document.querySelector('.people-directory-table tbody td.people-col-name a')).fontWeight"), '400',
      'iPhone name weight matches the standard directory typography');
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
    assert.equal(await b.evaluate("getComputedStyle(document.querySelector('.people-directory-table th.people-col-updated_at .people-header-full'),'::after').content"), '"最近"');
    assert.equal(await b.evaluate("document.querySelector('.people-directory-table td.people-col-updated_at .people-date-mobile').textContent"), '12/10');
    await b.evaluate("document.querySelector('.pager button:last-child').click()");
    await b.wait("window.peopleRequests.at(-1)?.args.page===2 && document.querySelectorAll('.people-directory-table tbody tr').length===1");
    assert.equal(await b.evaluate('window.peopleRequests.at(-1).args.pageSize'), 30);

    await b.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: true });
    await b.evaluate('document.body.replaceChildren();window.renderPeopleForViewport()');
    await b.wait("window.peopleRequests.at(-1)?.args.pageSize===30");
    assert.equal(await b.evaluate("document.documentElement.classList.contains('crm-iphone-layout')"), false,
      'iPad must not activate iPhone-only table sizing');
    assert.equal(await b.evaluate("document.querySelector('.people-directory-table').dataset.iphoneView"), undefined);
    assert.equal(await b.evaluate("document.querySelectorAll('.people-directory-views > .people-directory-view').length"), 6,
      'iPad keeps all directory views in the original view row');
    assert.equal(await b.evaluate("getComputedStyle(document.querySelector('.people-directory-table tbody td.people-col-name a')).fontWeight"), '400',
      'iPad name weight matches the standard directory typography');
    assert.equal(await b.evaluate("getComputedStyle(document.querySelector('.people-date-full')).display"), 'inline');
    assert.equal(await b.evaluate("getComputedStyle(document.querySelector('.people-date-mobile')).display"), 'none');
    assert.equal(await b.evaluate("document.querySelector('.people-directory-table th.people-col-updated_at .people-header-full').textContent"), '最近更新日期');
    assert.equal(await b.evaluate("document.querySelector('.people-directory-table td.people-col-updated_at .people-date-full').textContent"), '2026-10-12');

    await b.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
    await b.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await b.evaluate('document.body.replaceChildren();window.renderPeopleForViewport()');
    await b.wait("window.peopleRequests.at(-1)?.args.pageSize===20");
    assert.equal(await b.evaluate("document.documentElement.classList.contains('crm-iphone-layout')"), false,
      'desktop must not activate iPhone-only table sizing');
    assert.equal(await b.evaluate("document.querySelector('.people-directory-table').dataset.iphoneView"), undefined);
    assert.equal(await b.evaluate("document.querySelectorAll('.people-directory-views > .people-directory-view').length"), 6,
      'desktop keeps all directory views in the original view row');
    assert.equal(await b.evaluate("getComputedStyle(document.querySelector('.people-directory-table tbody td.people-col-name a')).fontWeight"), '400',
      'desktop name weight matches the standard directory typography');
  } finally { await b.close(); }
});

test('iPhone People toolbar keeps import, trash and new-person actions on one row', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await b.start();
    await b.send('Network.setUserAgentOverride', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    });
    await b.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 844, deviceScaleFactor: 3, mobile: true });
    await b.openConsole('#/ai');
    await b.wait("document.documentElement.classList.contains('crm-iphone-layout')");
    await b.evaluate(`(async()=>{
      const {renderPeople}=await import('/crm/js/modules/console/pages/people.js');
      const main=document.createElement('main');document.body.append(main);
      renderPeople({main,toast(){},api:{call:async()=>({rows:[],page:1,pageSize:30,total:0,totalPages:1,hasMore:false})}});
    })()`);
    await b.wait("document.querySelector('.people-directory-toolbar')");
    await b.evaluate("document.head.insertAdjacentHTML('beforeend','<link rel=stylesheet href=/crm/css/console.css>')");
    await b.wait("!!document.querySelector('link[href=\"/crm/css/console.css\"]')?.sheet && getComputedStyle(document.querySelector('.people-directory-toolbar')).gridTemplateColumns.split(' ').length===4");
    const layout = await b.evaluate(`(()=>{
      const toolbar=document.querySelector('.people-directory-toolbar').getBoundingClientRect();
      const buttons=[...document.querySelectorAll('.people-directory-toolbar > .people-directory-view, .people-directory-toolbar > .people-import-link, .people-directory-toolbar > .people-trash-link, .people-directory-toolbar > .people-new-button')];
      const views=[...document.querySelectorAll('.people-directory-views > .people-directory-view')];
      return {iphone:document.documentElement.classList.contains('crm-iphone-layout'),toolbarRight:toolbar.right,
        buttons:buttons.map(button=>{const rect=button.getBoundingClientRect();return {text:button.innerText.trim(),top:rect.top,left:rect.left,right:rect.right,
          width:rect.width,scrollWidth:button.scrollWidth,clientWidth:button.clientWidth};}),
        views:views.map(button=>{const rect=button.getBoundingClientRect();return {text:button.innerText.trim(),top:rect.top,left:rect.left,right:rect.right};})};
    })()`);
    assert.equal(layout.iphone, true, 'the iPhone UA activates the iPhone layout');
    assert.deepEqual(layout.buttons.map(button=>button.text.replace(/\s+/g,'')), ['全部','导入人物','回收站','新建人物']);
    assert.ok(layout.buttons.every(button=>Math.abs(button.top-layout.buttons[0].top)<1), 'all four actions share one row');
    assert.ok(layout.buttons.every((button,index)=>index===0 || layout.buttons[index-1].left<button.left), 'actions stay in requested order');
    assert.ok(layout.buttons.every(button=>button.right<=layout.toolbarRight+1), 'no action extends beyond the toolbar');
    assert.ok(layout.buttons.every(button=>button.scrollWidth<=button.clientWidth+1), 'all four labels fit without clipping');
    assert.deepEqual(layout.views.map(button=>button.text.replace(/\s+/g,'')), ['客户','增员','推荐人','嘉宾','互动参与者']);
    assert.ok(layout.views.every(button=>Math.abs(button.top-layout.views[0].top)<1), 'the five view buttons share one row');
    assert.ok(layout.views.every((button,index)=>index===0 || layout.views[index-1].left<button.left), 'view buttons retain directory order');
    await b.healthy();
  } finally { await b.close(); }
});

test('iPhone 15 people table keeps the toolbar width across pages and truncates long names', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await b.start();
    await b.send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 3, mobile: true });
    await b.send('Network.setUserAgentOverride', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    });
    await b.openConsole('#/ai');
    await b.wait("document.documentElement.classList.contains('crm-iphone-layout')");
    await b.evaluate(`(async()=>{
      const {renderPeople}=await import('/crm/js/modules/console/pages/people.js');
      const all=Array.from({length:31},(_,i)=>({id:100+i,
        display_name:i===0?'【系统测试·勿联系】跟进建议验收甲':'人物'+String(i+1).padStart(2,'0'),
        roles:[],sales_priority:'A',recruitment_priority:'B',referral_priority:'C',
        latest_followup_date:'2026-10-04',next_followup_date:'2026-10-18',updated_at:'2026-10-12T09:30:00Z'}));
      const main=document.createElement('main');main.className='console-main';document.body.append(main);
      window.peopleTestCtx={main,toast(){},api:{call:async(_,args)=>{
        const start=(args.page-1)*args.pageSize,rows=all.slice(start,start+args.pageSize);
        return {rows,page:args.page,pageSize:args.pageSize,total:all.length,totalPages:2,hasMore:args.page<2};
      }}};
      window.renderPeopleForViewport=()=>renderPeople(window.peopleTestCtx);
      window.renderPeopleForViewport();
    })()`);
    await b.wait("document.querySelectorAll('.people-directory-table tbody tr').length===30");
    await b.evaluate("document.head.insertAdjacentHTML('beforeend','<link rel=stylesheet href=/crm/css/console.css>')");
    await b.wait("!!document.querySelector('link[href=\"/crm/css/console.css\"]')?.sheet");
    const first = await b.evaluate(`(()=>{
      const toolbar=document.querySelector('.people-directory-toolbar').getBoundingClientRect();
      const card=document.querySelector('section.card').getBoundingClientRect();
      const scroll=document.querySelector('.people-directory-scroll');
      const scrollRect=scroll.getBoundingClientRect();
      const table=document.querySelector('.people-directory-table');
      const tableRect=table.getBoundingClientRect();
      const name=table.querySelector('tbody td.people-col-name a');
      return {iphone:document.documentElement.classList.contains('crm-iphone-layout'),userAgent:navigator.userAgent,view:table.dataset.iphoneView,
        tableLayout:getComputedStyle(table).tableLayout,toolbarLeft:toolbar.left,toolbarRight:toolbar.right,toolbarWidth:toolbar.width,
        cardLeft:card.left,cardRight:card.right,cardWidth:card.width,scrollLeft:scrollRect.left,scrollRight:scrollRect.right,
        tableLeft:tableRect.left,tableRight:tableRect.right,tableWidth:tableRect.width,
        scrollWidth:scroll.scrollWidth,scrollClientWidth:scroll.clientWidth,pageWidth:document.documentElement.scrollWidth,
        viewportWidth:document.documentElement.clientWidth,nameWidth:name.clientWidth,nameScrollWidth:name.scrollWidth,
        nameOverflow:getComputedStyle(name).textOverflow,nameWhiteSpace:getComputedStyle(name).whiteSpace};
    })()`);
    assert.ok(Math.abs(first.cardWidth-first.toolbarWidth)<=1, `list card must align with toolbar: ${JSON.stringify(first)}`);
    assert.ok(Math.abs(first.tableWidth-first.toolbarWidth)<=1, `table width must equal toolbar width: ${JSON.stringify(first)}`);
    assert.ok(Math.abs(first.tableLeft-first.toolbarLeft)<=1 && Math.abs(first.tableRight-first.toolbarRight)<=1,
      `table edges must align with toolbar edges: ${JSON.stringify(first)}`);
    assert.ok(Math.abs(first.tableWidth-first.scrollClientWidth)<=1, `table must fill its fixed container: ${JSON.stringify(first)}`);
    assert.ok(first.scrollWidth<=first.scrollClientWidth+1, `iPhone list must not scroll beyond its container: ${JSON.stringify(first)}`);
    assert.ok(first.pageWidth<=first.viewportWidth+1, `long name must not widen the page: ${JSON.stringify(first)}`);
    assert.ok(first.nameScrollWidth>first.nameWidth, `long name should be visually truncated: ${JSON.stringify(first)}`);
    assert.equal(first.nameOverflow,'ellipsis');
    assert.equal(first.nameWhiteSpace,'nowrap');
    await b.evaluate("document.querySelector('.pager button:last-child').click()");
    await b.wait("document.querySelectorAll('.people-directory-table tbody tr').length===1");
    const second = await b.evaluate(`(()=>({
      toolbarWidth:document.querySelector('.people-directory-toolbar').getBoundingClientRect().width,
      cardWidth:document.querySelector('section.card').getBoundingClientRect().width,
      tableWidth:document.querySelector('.people-directory-table').getBoundingClientRect().width,
      scrollWidth:document.querySelector('.people-directory-scroll').scrollWidth,
      scrollClientWidth:document.querySelector('.people-directory-scroll').clientWidth
    }))()`);
    assert.ok(Math.abs(second.tableWidth-first.tableWidth)<=1, `table width must remain stable on page two: ${JSON.stringify({first,second})}`);
    assert.ok(Math.abs(second.toolbarWidth-second.cardWidth)<=1);
    assert.ok(Math.abs(second.tableWidth-second.toolbarWidth)<=1);
    assert.ok(Math.abs(second.tableWidth-second.scrollClientWidth)<=1);
    for (const view of ['customer','participant']) {
      await b.evaluate(`document.querySelector('[data-directory-view="${view}"]').click()`);
      await b.wait(`document.querySelector('.people-directory-table')?.dataset.iphoneView==='${view}'`);
      const metrics=await b.evaluate(`(()=>{const scroll=document.querySelector('.people-directory-scroll'),table=document.querySelector('.people-directory-table');return {
        view:table.dataset.iphoneView,tableWidth:table.getBoundingClientRect().width,
        toolbarWidth:document.querySelector('.people-directory-toolbar').getBoundingClientRect().width,clientWidth:scroll.clientWidth,
        scrollWidth:scroll.scrollWidth,pageWidth:document.documentElement.scrollWidth,viewportWidth:document.documentElement.clientWidth
      }})()`);
      assert.ok(Math.abs(metrics.tableWidth-metrics.toolbarWidth)<=1, `${view} view must keep toolbar width: ${JSON.stringify(metrics)}`);
      assert.ok(Math.abs(metrics.tableWidth-metrics.clientWidth)<=1, `${view} view must fill the same fixed width: ${JSON.stringify(metrics)}`);
      assert.ok(metrics.scrollWidth<=metrics.clientWidth+1, `${view} view must not overflow its list container: ${JSON.stringify(metrics)}`);
      assert.ok(metrics.pageWidth<=metrics.viewportWidth+1, `${view} view must not widen the iPhone page: ${JSON.stringify(metrics)}`);
    }
    await b.healthy();
  } finally { await b.close(); }
});
