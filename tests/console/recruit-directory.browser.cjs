'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('Recruit directory renders sortable 30-row pages and applies name, stage, and priority search filters', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await b.start();
    await b.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await b.open('#/more');
    await b.evaluate(`(async()=>{
      const {renderRecruit}=await import('/crm/js/modules/console/pages/recruit.js');
      window.recruitRequests=[];
      const fixtures=Array.from({length:30},(_,i)=>({candidate_id:String(900+i),customer_name:'虚构候选人'+i,
        stage:i%2?'新增人才':'初次面谈',recruitment_priority:i%2?'A':'B',potential_score:60+i,
        next_action_date:'2026-10-20',idle_days:i,updated_at:'2026-10-18T08:00:00Z',
        person_id:String(1200+i),occupation:'顾问',next_action:'补充沟通'}));
      const ctx={main:(()=>{const e=document.createElement('main');document.body.append(e);return e})(),toast(){},api:{call:async(name,args)=>{
        window.recruitRequests.push({name,args});
        if(name==='person_360'&&args.action==='listRecruitDirectory')return {rows:fixtures,page:args.page,pageSize:30,total:61,totalPages:3,hasMore:args.page<3};
        if(name==='recruit_candidates'&&args.action==='funnel')return {funnel:{'新增人才':10},total:10};
        if(name==='recruit_goals')return {rows:[]};
        return {};
      }}};
      renderRecruit(ctx);
    })()`);
    await b.wait("document.querySelector('.recruit-directory-table tbody tr')");
    await b.wait("document.querySelector('.funnel-row')");
    await b.evaluate("document.head.insertAdjacentHTML('beforeend','<link rel=stylesheet href=/crm/css/console.css>')");
    const headers = await b.evaluate("[...document.querySelectorAll('.recruit-directory-table thead th')].map(x=>x.textContent.trim())");
    for (const label of ['姓名', '招募阶段', '招募优先级', '潜力评分', '下次跟进日期', '阶段停留天数', '最近更新日期', '编号']) {
      assert.ok(headers.some(value => value.includes(label)), `missing recruit column: ${label}`);
    }
    assert.equal(await b.evaluate("document.querySelectorAll('.recruit-directory-table tbody tr').length"), 30);
    assert.equal(await b.evaluate("document.querySelector('.recruit-directory-table tbody tr td.recruit-col-recruitment_priority .bdg').textContent"), 'B');
    assert.equal(await b.evaluate("document.querySelector('.recruit-directory-table tbody tr td.recruit-col-next_action_date').textContent.includes('10月20日')"), true);
    assert.equal(await b.evaluate("document.querySelector('.recruit-directory-table tbody tr td.recruit-col-name').textContent.includes('补充沟通')"), true);
    assert.equal(await b.evaluate("document.querySelector('.recruit-layout').textContent.includes('八阶段漏斗')"), true);
    assert.equal(await b.evaluate("document.querySelector('.recruit-layout').textContent.includes('月度目标')"), true);
    const initial = await b.evaluate('window.recruitRequests.filter(x=>x.name===\'person_360\'&&x.args.action===\'listRecruitDirectory\').length');

    await b.evaluate("document.querySelector('.recruit-directory-table thead th.recruit-col-potential_score').click()");
    await b.wait(`window.recruitRequests.filter(x=>x.name==='person_360'&&x.args.action==='listRecruitDirectory').length>${initial}`);
    let last = await b.evaluate("window.recruitRequests.filter(x=>x.args.action==='listRecruitDirectory').at(-1).args");
    assert.equal(last.sortField, 'potential_score');
    assert.equal(last.sortDir, 'asc');
    for (const [column, field] of [
      ['name', 'name'], ['stage', 'stage'], ['recruitment_priority', 'recruitment_priority'],
      ['next_action_date', 'next_action_date'], ['idle_days', 'idle_days'],
      ['updated_at', 'updated_at'], ['candidate_id', 'candidate_id'],
    ]) {
      const before = await b.evaluate("window.recruitRequests.filter(x=>x.args.action==='listRecruitDirectory').length");
      await b.evaluate(`document.querySelector('.recruit-directory-table thead th.recruit-col-${column}').click()`);
      await b.wait(`window.recruitRequests.filter(x=>x.args.action==='listRecruitDirectory').length>${before}`);
      last = await b.evaluate("window.recruitRequests.filter(x=>x.args.action==='listRecruitDirectory').at(-1).args");
      assert.equal(last.sortField, field, `${column} sort field`);
      assert.ok(['asc', 'desc'].includes(last.sortDir), `${column} sort direction`);
    }

    await b.evaluate(`(()=>{const input=document.querySelector('.recruit-directory-toolbar .searchbox input');input.value='林';document.querySelector('.recruit-directory-toolbar .searchbox button').click()})()`);
    await b.wait("window.recruitRequests.filter(x=>x.args.action==='listRecruitDirectory').at(-1).args.search==='林'");
    last = await b.evaluate("window.recruitRequests.filter(x=>x.args.action==='listRecruitDirectory').at(-1).args");
    assert.equal(last.page, 1);
    assert.equal(last.pageSize, 30);

    await b.evaluate("document.querySelector('.people-filter-trigger').click()");
    await b.evaluate("document.querySelector('.people-filter-check[data-filter-value=\"初次面谈\"] input').click()");
    await b.evaluate("document.querySelector('.people-filter-check[data-filter-value=\"A\"] input').click()");
    await b.evaluate("[...document.querySelectorAll('.people-filter-panel button')].find(x=>x.textContent.trim()==='搜索').click()");
    await b.wait("window.recruitRequests.filter(x=>x.args.action==='listRecruitDirectory').at(-1).args.priorities?.includes('A')");
    last = await b.evaluate("window.recruitRequests.filter(x=>x.args.action==='listRecruitDirectory').at(-1).args");
    assert.deepEqual(last.stages, ['初次面谈']);
    assert.deepEqual(last.priorities, ['A']);
    assert.equal(last.search, '林');

    await b.evaluate("document.querySelector('.recruit-directory .pager button:last-child').click()");
    await b.wait("window.recruitRequests.filter(x=>x.args.action==='listRecruitDirectory').at(-1).args.page===2");
    last = await b.evaluate("window.recruitRequests.filter(x=>x.args.action==='listRecruitDirectory').at(-1).args");
    assert.equal(last.page, 2);
    assert.equal(last.pageSize, 30);
    await b.evaluate("document.querySelector('.recruit-directory .pager button:first-child').click()");
    await b.wait("window.recruitRequests.filter(x=>x.args.action==='listRecruitDirectory').at(-1).args.page===1");

    const english = await b.evaluate(`(async()=>{const {t,setLang}=await import('/crm/js/modules/console/i18n.js');setLang('en');
      const result=[t('recruit_search_name'),t('recruit_stage_column'),t('potential_score_column'),t('recruit_idle_days')];setLang('zh-CN');return result})()`);
    assert.deepEqual(english, ['Search names', 'Recruit Stage', 'Potential Score', 'Days in Stage']);
    assert.equal(await b.evaluate("getComputedStyle(document.querySelector('.recruit-layout')).gridTemplateColumns.split(' ').at(-1)"), '250px');
    await b.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
    assert.equal(await b.evaluate("getComputedStyle(document.querySelector('.recruit-layout')).gridTemplateColumns.split(' ').at(-1)"), '250px');
    await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    assert.equal(await b.evaluate("document.querySelector('.recruit-directory-scroll').scrollWidth > document.querySelector('.recruit-directory-scroll').clientWidth"), true);
    assert.deepEqual(b.runtimeErrors, []);
  } finally { await b.close(); }
});
