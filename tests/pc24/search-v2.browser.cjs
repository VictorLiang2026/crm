'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const {Browser}=require('../regression/browser.cjs');

test('Console search uses V2, waits for Person choice, and presents server pagination/evidence',()=>{
  const ui=read('crm/js/modules/console/pages/misc.js');
  const api=read('crm/js/modules/console/data.js');
  const i18n=read('crm/js/modules/console/i18n.js');
  assert.match(ui,/data\.aiSearchV2/);assert.match(ui,/needs_person_selection/);
  assert.match(ui,/selectedPersonId=String\(select\.value\)/);assert.match(ui,/search_v2_next/);
  assert.match(ui,/reason\.records/);assert.match(ui,/search_v2_time_note/);assert.match(api,/action: 'searchV2'/);
  for(const key of ['search_v2_choose_person','search_v2_evidence','search_v2_test_data','search_v2_unverified']) {
    const entry=i18n.match(new RegExp(`'${key}': \\{[^\\n]+`));
    assert.ok(entry,`missing ${key}`);assert.match(entry[0],/'zh-CN'/);assert.match(entry[0],/'en'/);
  }
});

test('PC24 migration is public-only fixed SQL with service-role execution and reversible scope',()=>{
  const sql=read('cloudbase/migrations/20261017123000_pc_combination_search.sql');
  const down=read('cloudbase/migrations/20261017123000_pc_combination_search.rollback.sql');
  assert.match(sql,/CREATE FUNCTION public\.crm_search_people_v2/);
  assert.match(sql,/SECURITY INVOKER/);assert.match(sql,/GRANT EXECUTE[^;]+service_role/s);
  assert.match(sql,/status='confirmed' AND x\.confirmed_at IS NOT NULL/);
  assert.match(sql,/ap\.status='attended'/);assert.match(sql,/p_offset/);
  assert.doesNotMatch(sql,/EXECUTE\s+format|\bpr\.|\bpr_[a-z]/i);
  assert.match(down,/DROP FUNCTION IF EXISTS public\.crm_search_people_v2/);
  assert.doesNotMatch(down,/DROP TABLE|DELETE FROM|TRUNCATE/i);
});

test('search result card shows bilingual sources and time window without evidence JSON on iPad',async()=>{
  const browser=new Browser(root);
  try {
    await browser.start(); await browser.openConsole('#/ai','authCase=1');
    await browser.wait("document.querySelector('.console-main')");
    await browser.evaluate(`(async()=>{
      const {renderAI}=await import('/crm/js/modules/console/pages/misc.js');
      const {data}=await import('/crm/js/modules/console/data.js');
      window.searchI18n=await import('/crm/js/modules/console/i18n.js');
      window.searchCalls=[];
      data.aiSearchV2=async(_ctx,p)=>{
        window.searchCalls.push(p);
        if(!p.selectedPersonId)return {ok:true,status:'needs_person_selection',candidates:[{id:'784',displayName:'【系统测试·勿联系】虚构独立增员甲'}]};
        return {ok:true,status:'complete',page:p.page||1,total:51,hasMore:(p.page||1)===1,
          criteria:{roles:['recruit'],followupState:'recent',followupMonths:3},
          interpretation:'Fictional Person',testData:{status:'verified',containsTestData:true},
          rows:[{person_id:'784',customer_id:'791',display_name:'【系统测试·勿联系】虚构独立增员甲',matchReasons:[
            {condition:'roles',records:[{table:'recruit_candidates',id:'19'}],evidence:[{id:19,stage:'互动暖客'}]},
            {condition:'followupState',windowMonths:3,records:[{table:'followups',id:'261'},{table:'recruit_followups',id:'5'}],evidence:[{id:261,date:'2026-10-19'}]},
            {condition:'followupMonths',records:[],evidence:[]},
          ]}]};
      };
      window.renderSearchAI=()=>renderAI({main:document.querySelector('.console-main'),toast:()=>{}});
      window.renderSearchAI();
    })()`);
    const submit=async()=>{
      await browser.evaluate("(()=>{const panel=document.querySelectorAll('.search-panel')[1];panel.querySelector('textarea').value='查找虚构人物';panel.querySelector('form').requestSubmit()})()");
      await browser.wait("document.querySelectorAll('.search-panel')[1].querySelector('select')");
      await browser.evaluate("(()=>{const panel=document.querySelectorAll('.search-panel')[1];panel.querySelector('select').value='784';[...panel.querySelectorAll('button')].find(b=>b.textContent.trim()==='确认'||b.textContent.trim()==='Confirm').click()})()");
      await browser.wait("document.querySelectorAll('.search-panel')[1].innerText.includes('public.recruit_candidates #19')");
    };
    await submit();
    const zh=await browser.evaluate("({text:document.querySelectorAll('.search-panel')[1].innerText,calls:window.searchCalls})");
    assert.match(zh.text,/有效角色/);assert.match(zh.text,/跟进记录: 近 3 个月/);
    assert.match(zh.text,/public\.followups #261/);assert.match(zh.text,/public\.recruit_followups #5/);
    assert.doesNotMatch(zh.text,/search_v2_condition_followupMonths|\[\{|\{\"id\"/);
    assert.equal(zh.calls[1].selectedPersonId,'784');
    await browser.evaluate("[...document.querySelectorAll('.search-panel')[1].querySelectorAll('button')].find(b=>b.textContent.trim()==='下一页').click()");
    await browser.wait("window.searchCalls.some(c=>c.page===2)");
    await browser.evaluate("window.searchI18n.setLang('en');window.renderSearchAI()");
    await submit();
    const en=await browser.evaluate("document.querySelectorAll('.search-panel')[1].innerText");
    assert.match(en,/Active role/);assert.match(en,/Follow-up status: Last 3 months/);
    assert.match(en,/public\.recruit_candidates #19/);assert.doesNotMatch(en,/search_v2_condition_followupMonths|\[\{/);
    for(const [width,height] of [[1180,820],[820,1180]]){
      await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,`${width}x${height}`);
    }
    await browser.send('Emulation.clearDeviceMetricsOverride');
  }finally{await browser.close();}
});
