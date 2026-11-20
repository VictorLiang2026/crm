'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('iPad landscape keeps opportunity, recruit, knowledge and reference toolbars compact', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.openComponent();
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: 1366, height: 1024, deviceScaleFactor: 2, mobile: true,
    });
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await browser.evaluate(`(() => document.head.insertAdjacentHTML('beforeend',
      '<link rel="stylesheet" href="/crm/css/console.css">'))()`);
    await browser.evaluate(`(async () => {
      const main=document.createElement('main');main.className='console-main';document.body.append(main);
      const knowledge={id:'CRM_LAYOUT_FIXTURE_1',source:'[Fixture] Knowledge',content:'Fixture content',
        lifecycle_status:'verified',updated_at:'2026-11-20T00:00:00Z',metadata:{categories:['other'],summary:'Fixture summary'}};
      const reference={id:'CRM_LAYOUT_FIXTURE_2',scenario:'[Fixture] Reference',response_logic:'Fixture response',
        metadata:{kind:'wording',enabled:true,keywords:[]}};
      const ctx={main,toast(){},api:{call:async(name,args={})=>{
        if(name==='person_360'){
          if(args.action==='listPendingOpportunityCandidates')return {rows:[]};
          if(args.action==='listOpportunityDirectory')return {rows:[],total:0,page:1};
          if(args.action==='listRecruitDirectory')return {rows:[{candidate_id:'CRM_LAYOUT_FIXTURE_3',customer_name:'[Fixture] Recruit',
            stage:'新增人才',recruitment_priority:'A',potential_score:75,next_action_date:'2026-11-21',idle_days:0,
            updated_at:'2026-11-20T00:00:00Z',person_id:'CRM_LAYOUT_FIXTURE_4'}],page:1,total:1,totalPages:1,hasMore:false};
          return {candidates:[]};
        }
        if(name==='recruit_candidates'&&args.action==='funnel')return {funnel:{'新增人才':1},total:1};
        if(name==='recruit_goals')return {rows:[]};
        if(name==='assistant'&&args.action==='knowledgeLibrary'){
          if(args.operation==='list')return {knowledge:[knowledge],playbooks:[],sources:[]};
          if(args.operation==='referenceMaintenance')return {rows:[reference]};
          if(args.operation==='referenceOptimization')return {rows:[]};
        }
        return {};
      }}};
      window.ipadLayoutFixture={ctx,main};
      const {renderOpportunities}=await import('/crm/js/modules/console/pages/opportunities.js');
      renderOpportunities(ctx);
    })()`);
    await browser.wait("document.querySelector('.opp-filter-bar .opp-text-filter')");
    const opportunityRows = await browser.evaluate(`(() => {
      const bar=document.querySelector('.opp-filter-bar');
      return {coarse:matchMedia('(any-pointer: coarse)').matches,grid:getComputedStyle(bar).gridTemplateColumns,
        children:[...bar.children].map(node=>({top:Math.round(node.getBoundingClientRect().top),bottom:Math.round(node.getBoundingClientRect().bottom),width:Math.round(node.getBoundingClientRect().width),
          className:node.className,display:getComputedStyle(node).display,minWidth:getComputedStyle(node).minWidth})),
        rows:[...bar.children].map(node=>Math.round(node.getBoundingClientRect().bottom)),
        width:document.documentElement.scrollWidth,inner:innerWidth};
    })()`);
    assert.equal(opportunityRows.coarse, true, 'iPad touch breakpoint should be active');
    assert.equal(new Set(opportunityRows.rows).size, 1, 'opportunity filters should share one row: ' + JSON.stringify(opportunityRows));
    assert.ok(opportunityRows.width <= opportunityRows.inner + 1, 'opportunity page should not overflow horizontally');

    await browser.evaluate(`(async()=>{const {renderRecruit}=await import('/crm/js/modules/console/pages/recruit.js');renderRecruit(window.ipadLayoutFixture.ctx)})()`);
    await browser.wait("document.querySelector('.recruit-directory-table tbody tr')&&document.querySelector('.funnel-row')");
    const recruit = await browser.evaluate(`(() => {
      const toolbar=document.querySelector('.recruit-directory-toolbar');
      const controls=[...toolbar.querySelectorAll('.searchbox input,.searchbox button,.people-filter-trigger,.recruit-landscape-action')]
        .filter(node=>getComputedStyle(node).display!=='none');
      const tops=controls.map(node=>Math.round(node.getBoundingClientRect().top));
      const table=document.querySelector('.recruit-directory-table').getBoundingClientRect();
      const funnel=document.querySelector('.recruit-layout .card-head').getBoundingClientRect();
      return {rowDelta:Math.max(...tops)-Math.min(...tops),controlCount:controls.length,tableTop:table.top,funnelTop:funnel.top,
        controlTops:controls.map(node=>({name:node.tagName+':'+node.className,top:Math.round(node.getBoundingClientRect().top),width:Math.round(node.getBoundingClientRect().width)})),
        headActions:getComputedStyle(document.querySelector('.recruit-page-head .head-actions')).display,
        width:document.documentElement.scrollWidth,inner:innerWidth};
    })()`);
    assert.ok(recruit.rowDelta <= 2, 'recruit search, filters and actions should share one row: ' + JSON.stringify(recruit));
    assert.equal(recruit.controlCount, 5);
    assert.equal(recruit.headActions, 'none', 'the duplicate heading actions should be hidden on iPad');
    assert.ok(Math.abs(recruit.tableTop - recruit.funnelTop) < 28, 'recruit results and funnel should start level');
    assert.ok(recruit.width <= recruit.inner + 1, 'recruit page should not overflow horizontally');

    await browser.evaluate(`(async()=>{const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang('en')})()`);
    await browser.evaluate(`(async()=>{const {renderKnowledgeGovernance}=await import('/crm/js/modules/console/knowledge-governance.js');
      renderKnowledgeGovernance(window.ipadLayoutFixture.ctx)})()`);
    await browser.wait("document.querySelector('.kg-home-card .kg-table-actions .btn')");
    const knowledge = await browser.evaluate(`(() => {
      const search=document.querySelector('.kg-home-card .kg-search').getBoundingClientRect();
      const filters=document.querySelector('.kg-home-card .kg-filters').getBoundingClientRect();
      const actions=[...document.querySelectorAll('.kg-home-card .kg-table-actions .btn')];
      return {rowDelta:Math.abs(search.top-filters.top),actionCount:actions.length,
        actionRows:new Set(actions.map(node=>Math.round(node.getBoundingClientRect().top))).size,
        width:document.documentElement.scrollWidth,inner:innerWidth};
    })()`);
    assert.ok(knowledge.rowDelta < 2, 'knowledge search and filters should share one row');
    assert.equal(knowledge.actionCount, 6);
    assert.equal(knowledge.actionRows, 3, 'six knowledge actions should occupy three rows');
    assert.ok(knowledge.width <= knowledge.inner + 1, 'knowledge page should not overflow horizontally');

    await browser.evaluate(`(async()=>{const {renderKnowledgeEditor}=await import('/crm/js/modules/console/knowledge-pages.js');
      renderKnowledgeEditor(window.ipadLayoutFixture.ctx,{mode:'upload'})})()`);
    await browser.wait("document.querySelector('.kg-page-form [name=publisher]')");
    assert.equal(await browser.evaluate("document.querySelector('.kg-page-form [name=publisher]')!==null"), true,
      'the existing publisher field should remain unchanged');

    await browser.evaluate(`(async()=>{const {renderCommunicationReferences}=await import('/crm/js/modules/console/communication-references.js');
      renderCommunicationReferences(window.ipadLayoutFixture.ctx)})()`);
    await browser.wait("document.querySelector('.kr-page .kr-table tbody tr')");
    const references = await browser.evaluate(`(() => {
      const controls=document.querySelector('.kr-control-area');
      const items=[...controls.querySelector('.kr-primary-tools').children,...controls.querySelector('.kg-list-tools').children];
      const firstRow=new Set(items.map(node=>Math.round(node.getBoundingClientRect().top)));
      const optimize=document.querySelector('.kr-page .ro-tools').getBoundingClientRect();
      const list=document.querySelector('.kr-page .kr-table').getBoundingClientRect();
      return {controlRows:firstRow.size,optimizationTop:optimize.top,listTop:list.top,
        width:document.documentElement.scrollWidth,inner:innerWidth};
    })()`);
    assert.equal(references.controlRows, 1, 'reference search, filters and primary actions should share one row');
    assert.ok(references.optimizationTop > 0 && references.optimizationTop < references.listTop,
      'reference maintenance controls should form the second row before the list');
    assert.ok(references.width <= references.inner + 1, 'reference page should not overflow horizontally');
    await browser.healthy();
  } finally { await browser.close(); }
});
