'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('Knowledge Library supports categories, bilingual search, sorting, status, and CRUD routes', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.openConsole('#/more', 'authCase=1');
    await browser.wait("document.querySelector('.console-main')");
    await browser.evaluate(`(async()=>{
      const {renderKnowledgeGovernance}=await import('/crm/js/modules/console/knowledge-governance.js');
      const {renderKnowledgeEditor}=await import('/crm/js/modules/console/knowledge-pages.js');
      const i18n=await import('/crm/js/modules/console/i18n.js');
      const calls=[];
      const ctx={main:document.querySelector('.console-main'),api:{call:async(name,payload)=>{
        calls.push({name,payload});
        if(name==='assistant'&&payload.action==='knowledgeLibrary'&&payload.operation==='list')return {ok:true,sources:[],knowledge:[
          {id:1,item_type:'evidence',source:'Policy',content:'Reviewed clause',metadata:{categories:['health_wealth_sharing'],summary:'industry summary'},confidence:.9,verified:false,lifecycle_status:'draft',version_no:1,updated_at:'2026-10-16T00:00:00Z'},
          {id:2,item_type:'company',source:'Sales framework',content:'Recruitment notes',metadata:{categories:['recruitment_policy','industry_development'],summary:'needle summary'},confidence:.9,verified:true,lifecycle_status:'verified',version_no:1,updated_at:'2026-10-17T00:00:00Z'}
        ],playbooks:[]};
        return {ok:true};
      }}};
      window.kgCalls=calls;window.kgRender=()=>renderKnowledgeGovernance(ctx);window.kgEditor=(mode,table)=>renderKnowledgeEditor(ctx,{mode,table});window.kgI18n=i18n;
      window.confirm=()=>true;window.kgRender();
    })()`);
    await browser.wait("document.querySelector('.kg-table tbody tr[data-kg-id=\"1\"]')");
    const layout=await browser.evaluate(`(()=>{
      const headers=[...document.querySelectorAll('.kg-table thead th')];
      const row=document.querySelector('.kg-table tbody tr[data-kg-id="2"]');
      const cells=[...row.querySelectorAll('td')];
      const chips=[...cells[2].querySelectorAll('.kg-category-chip')].map(node=>node.getBoundingClientRect().top);
      const buttons=[...document.querySelector('.kg-table tbody tr[data-kg-id="1"] .kg-table-actions').querySelectorAll('.btn')]
        .map(node=>node.getBoundingClientRect().top);
      return {headers:headers.map(node=>node.innerText.trim().replace(/[ ↑↓]/g,'')),
        summaryWidth:headers[3].getBoundingClientRect().width,titleWidth:headers[1].getBoundingClientRect().width,
        date:cells[6].innerText,categoryTops:chips,buttonTops:buttons,
        actionColors:[...document.querySelectorAll('.kg-table tbody tr[data-kg-id="1"] .kg-table-actions .btn')].map(node=>getComputedStyle(node).backgroundColor),
        actionFontSizes:[...document.querySelectorAll('.kg-table tbody tr[data-kg-id="1"] .kg-table-actions .btn')].map(node=>getComputedStyle(node).fontSize),
        categoryFontSize:getComputedStyle(document.querySelector('.kg-table tbody tr[data-kg-id="1"] .kg-category-chip')).fontSize,
        columnWidths:headers.map(node=>node.getBoundingClientRect().width),
        searchWidth:document.querySelector('.kg-search input[type="search"]').getBoundingClientRect().width,
        categoryTop:document.querySelector('.kg-category-filter').getBoundingClientRect().top,
        statusTop:document.querySelector('.kg-status-filter').getBoundingClientRect().top,
        statusDefault:document.querySelector('.kg-status-filter option').innerText};
    })()`);
    assert.deepEqual(layout.headers,['编号','标题','知识类别','系统内容','GPT内容','状态','更新时间','操作']);
    assert.ok(layout.summaryWidth>layout.titleWidth,'summary column gets more width than title');
    assert.ok(layout.titleWidth>Math.max(...layout.columnWidths.filter((_,index)=>![1,3,4].includes(index))),'title follows the two content columns');
    assert.equal(layout.date,'2026-10-17','updated time only shows the date');
    assert.ok(layout.categoryTops[1]>layout.categoryTops[0],'category chips stack vertically');
    assert.ok(layout.buttonTops[1]>layout.buttonTops[0]&&layout.buttonTops[2]>layout.buttonTops[1],'row actions stack vertically');
    assert.equal(new Set(layout.actionColors).size,3,'edit, status, and delete actions have distinct background colors');
    assert.ok(layout.actionFontSizes.every(size=>size===layout.categoryFontSize),'action text matches category chip size');
    assert.ok(layout.searchWidth>=380,'search input is slightly wider');
    assert.equal(layout.categoryTop,layout.statusTop,'category and status filters align');
    assert.equal(layout.statusDefault,'状态筛选','status label is inside the select');
    await browser.evaluate(`(()=>[...document.querySelectorAll('.kg-table th.kg-sortable')]
      .find(node=>node.innerText.includes('编号')).click())()`);
    assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('.kg-table tbody tr[data-kg-id]')].map(row=>row.dataset.kgId)"),['1','2'],
      'number header sorts ascending by record ID');
    const first = await browser.evaluate(`({text:document.querySelector('.console-main').innerText,
      writes:window.kgCalls.filter(x=>x.payload.operation!=='list').length,
      types:document.querySelectorAll('.kg-type-filter').length})`);
    assert.equal(first.writes, 0, 'opening the page does not write business data');
    assert.match(first.text, /知识与策略/);
    assert.equal(first.types,0,'the type filter is removed');
    await browser.evaluate(`(()=>{const q=document.querySelector('.kg-search input[type="search"]');q.value='needle';document.querySelector('.kg-search').requestSubmit()})()`);
    await browser.wait("document.querySelector('.kg-table tbody tr')");
    assert.equal(await browser.evaluate("document.querySelectorAll('.kg-table tbody tr[data-kg-id]').length"),0,'default search uses titles only');
    await browser.evaluate(`(()=>{document.querySelector('.kg-full-search input').checked=true;document.querySelector('.kg-search').requestSubmit()})()`);
    await browser.wait("document.querySelector('.kg-table tbody tr[data-kg-id=\"2\"]')");
    await browser.evaluate("document.querySelector('.kg-table th.kg-sortable').click()");
    await browser.evaluate("window.kgI18n.setLang('en');window.kgRender()");
    await browser.wait("document.querySelector('.console-main').innerText.includes('Knowledge & Strategies')");
    assert.match(await browser.evaluate("document.querySelector('.console-main').innerText"), /Upload and Create Knowledge/);
    await browser.evaluate("window.kgI18n.setLang('zh-CN');window.kgRender()");
    await browser.wait("document.querySelector('.console-main').innerText.includes('知识与策略')");
    assert.equal(await browser.evaluate("[...document.querySelectorAll('.head-actions a')].filter(a=>['#/knowledge/upload','#/knowledge/new','#/knowledge/playbook'].includes(a.getAttribute('href'))).length"),3);
    await browser.evaluate("window.kgEditor('upload')");
    const uploadFields=await browser.evaluate("[...document.querySelectorAll('.kg-page-form [name]')].map(x=>x.name)");
    const uploadInput=await browser.evaluate("({accept:document.querySelector('.kg-page-form [name=file]').accept,label:document.querySelector('.kg-page-form').innerText})");
    assert.match(uploadInput.accept,/\.png/);assert.match(uploadInput.accept,/\.pptx/);assert.match(uploadInput.accept,/\.xlsx/);
    assert.match(uploadInput.label,/100 MB/);
    for(const removed of ['jurisdiction','validFrom','validTo','sharingAuthorized','anonymized'])assert.equal(uploadFields.includes(removed),false,`upload excludes ${removed}`);
    assert.equal(uploadFields.includes('publishedAt'),true);
    await browser.evaluate("window.kgEditor('new','knowledge_items')");
    const knowledgeFields=await browser.evaluate("[...document.querySelectorAll('.kg-page-form [name]')].map(x=>x.name)");
    for(const removed of ['jurisdiction','sourceDate','validFrom','validTo','sharingAuthorized','anonymized'])assert.equal(knowledgeFields.includes(removed),false,`knowledge excludes ${removed}`);
    assert.equal(knowledgeFields.includes('publishedAt'),true);
    await browser.evaluate("window.kgEditor('playbook','playbooks')");
    const playbookFields=await browser.evaluate("[...document.querySelectorAll('.kg-page-form [name]')].map(x=>x.name)");
    for(const removed of ['evidence_refs','case_refs','story_refs','source','valid_to'])assert.equal(playbookFields.includes(removed),false,`strategy excludes ${removed}`);
    await browser.evaluate('window.kgRender()');
    await browser.wait("document.querySelector('.kg-table tbody tr[data-kg-id=\"1\"]')");
    for (const [width,height] of [[820,1180],[1180,820]]) {
      await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,`${width}x${height} overflow`);
      const tableFit=await browser.evaluate(`(()=>{const wrap=document.querySelector('.kg-table-wrap');const table=wrap.querySelector('.kg-table');
        const actionCell=table.querySelector('tbody tr[data-kg-id="1"] .kg-table-actions');
        const healthChip=table.querySelector('tbody tr[data-kg-id="1"] .kg-category-chip');const range=document.createRange();range.selectNodeContents(healthChip);
        return {wrap:wrap.clientWidth,table:table.getBoundingClientRect().width,scroll:table.scrollWidth,
          columns:[...table.querySelectorAll('thead th')].map(cell=>cell.getBoundingClientRect().width),
          healthText:healthChip.innerText,healthLineCount:range.getClientRects().length,
          searchWidth:document.querySelector('.kg-search input[type="search"]').getBoundingClientRect().width,
          actionButtons:[...actionCell.querySelectorAll('.btn')].map(button=>({top:button.getBoundingClientRect().top,right:button.getBoundingClientRect().right,cellRight:actionCell.getBoundingClientRect().right}))};})()`);
      assert.ok(tableFit.table<=tableFit.wrap+1&&tableFit.scroll<=tableFit.wrap+1,`${width}x${height} knowledge columns fit without horizontal scrolling: ${JSON.stringify(tableFit)}`);
      assert.ok(tableFit.columns[3]>tableFit.columns[1]&&tableFit.columns[4]>tableFit.columns[1]&&tableFit.columns[1]>Math.max(...tableFit.columns.filter((_,index)=>![1,3,4].includes(index))),
        `${width}x${height} content columns are widest, followed by title: ${JSON.stringify(tableFit.columns)}`);
      assert.equal(tableFit.healthText,'健康财富分享',`${width}x${height} category label remains complete`);
      assert.ok(tableFit.healthLineCount<=2,`${width}x${height} category label remains readable within two lines with eight columns`);
      assert.ok(tableFit.searchWidth>=360,`${width}x${height} title search remains slightly wider`);
      assert.ok(tableFit.actionButtons[1].top>tableFit.actionButtons[0].top&&tableFit.actionButtons[2].top>tableFit.actionButtons[1].top,
        `${width}x${height} row actions remain vertically stacked`);
      assert.ok(tableFit.actionButtons.every(button=>button.right<=button.cellRight+1),`${width}x${height} action buttons stay inside the column: ${JSON.stringify(tableFit)}`);
    }
    await browser.send('Emulation.clearDeviceMetricsOverride');
  } finally { await browser.close(); }
});

test('Knowledge Library refreshes failed PDF retry state and handles stale delete without weakening the guard', async () => {
  const browser=new Browser(path.resolve(__dirname,'../..'));
  try{
    await browser.start();await browser.openConsole('#/more','authCase=1');await browser.wait("document.querySelector('.console-main')");
    await browser.evaluate(`(async()=>{
      const {renderKnowledgeGovernance}=await import('/crm/js/modules/console/knowledge-governance.js');
      const calls=[],toasts=[];let listCount=0;
      const source=updatedAt=>({id:55,title:'Scanned source',fileName:'scan.pdf',table:'knowledge_sources',
        extractionStatus:'failed',lifecycle_status:'draft',updated_at:updatedAt,metadata:{categories:['other']}});
      const ctx={main:document.querySelector('.console-main'),toast:(...args)=>toasts.push(args),api:{call:async(name,payload)=>{
        calls.push({name,payload});
        if(payload.operation==='list'){
          listCount++;
          const timestamp=['2026-10-28T10:00:00.000Z','2026-10-28T10:01:00.000Z','2026-10-28T10:02:00.000Z'][Math.min(listCount-1,2)];
          return {ok:true,sources:[source(timestamp)],knowledge:[],playbooks:[]};
        }
        if(payload.operation==='retry')throw new Error('PDF_NO_TEXT: Knowledge library operation could not be completed');
        if(payload.operation==='delete')throw new Error('STALE_SOURCE: Knowledge library operation could not be completed');
        throw new Error('unexpected operation');
      }}};
      window.kgFailure={calls,toasts,get listCount(){return listCount;}};window.confirm=()=>true;renderKnowledgeGovernance(ctx);
    })()`);
    await browser.wait("document.querySelector('.kg-table tbody tr[data-kg-id=\"55\"] .kg-action-retry')");
    await browser.evaluate("document.querySelector('.kg-action-retry').click()");
    await browser.wait("window.kgFailure.listCount===2 && window.kgFailure.toasts.length===1 && document.querySelector('.kg-action-retry')");
    assert.match(await browser.evaluate("window.kgFailure.toasts[0][0]"),/OCR也未能识别文字/);
    await browser.evaluate("document.querySelector('.kg-action-delete').click()");
    await browser.wait("window.kgFailure.listCount===3 && window.kgFailure.toasts.length>0");
    const state=await browser.evaluate(`({lists:window.kgFailure.listCount,
      retryCalls:window.kgFailure.calls.filter(call=>call.payload.operation==='retry').length,
      deletes:window.kgFailure.calls.filter(call=>call.payload.operation==='delete').map(call=>call.payload.data.expectedUpdatedAt),
      toast:window.kgFailure.toasts.at(-1)[0],rowDate:document.querySelector('.kg-table tbody tr[data-kg-id="55"] td:nth-child(7)').innerText})`);
    assert.equal(state.lists,3,'retry failure and stale delete each reload source metadata');
    assert.equal(state.retryCalls,1);
    assert.deepEqual(state.deletes,['2026-10-28T10:01:00.000Z'],'delete keeps sending the row timestamp and does not bypass optimistic concurrency');
    assert.match(state.toast,/资料刚刚更新/);
    assert.equal(state.rowDate,'2026-10-28');
  }finally{await browser.close();}
});
