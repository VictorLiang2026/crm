'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {Browser}=require('../regression/browser.cjs');

test('PC29 AI Experience hub route and iPad workspace record decisions, Outcomes, and confirmed Learning',async()=>{
  const browser=new Browser(path.resolve(__dirname,'../..'));
  try{
    await browser.start();await browser.openConsole('#/ai','authCase=1');
    await browser.wait("document.querySelector('.console-main')");
    await browser.wait("document.querySelector('a[href=\"#/ai/experience\"]')");
    const result=await browser.evaluate(`(async()=>{
      const {setLang}=await import('/crm/js/modules/console/i18n.js');
      const {dispatch}=await import('/crm/js/modules/console/router.js');
      const result={id:701,task_id:601,result_json:{summary:'[CRM_TEST_ONLY] Fictional AI suggestion',nextStep:'Ask what matters most'},
        final_result_json:null,user_selected:true,user_edited:true,feedback:'PC20:modified',created_at:'2026-10-17T09:00:00Z'};
      const task={id:601,task_type:'[CRM_TEST_ONLY] fictional_task',subject_type:'person',subject_id:'701',status:'completed',created_at:'2026-10-17T09:00:00Z'};
      window.pc29={decisions:[],outcomes:[],learnings:[],calls:[]};
      window.pc29Call=async(name,p)=>{window.pc29.calls.push({name,p});if(name!=='assistant')return {error:'unexpected'};
        if(p.operation==='list')return {ok:true,tasks:[task],results:[result],decisions:window.pc29.decisions,
          outcomes:window.pc29.outcomes,learnings:window.pc29.learnings,metrics:{windowDays:30,numerator:1,denominator:1,pending:0}};
        if(p.operation==='targets')return {ok:true,actions:[{id:801,title:'[CRM_TEST_ONLY] Fictional completed Action',status:'completed'}],
          opportunities:[{id:802,opportunity_type:'insurance',status:'关闭'}],activities:[{id:803,name:'[CRM_TEST_ONLY] Fictional ended Activity',status:'ended'}],
          recruitFollowups:[{id:804,candidate_id:805,followup_date:'2026-10-17'}]};
        if(p.operation==='decide'){window.pc29.decisions.unshift({id:p.eventId,ai_result_id:p.aiResultId,decision:p.decision,reason:p.reason,edit_delta:p.editDelta,created_at:new Date().toISOString()});return {ok:true,eventId:p.eventId,replayed:false};}
        if(p.operation==='outcome'){window.pc29.outcomes.unshift({id:901,ai_result_id:p.aiResultId,action_id:p.targetId,result:p.result,occurred_at:p.occurredAt,evidence:p.evidence});return {ok:true,outcomeId:901,replayed:false};}
        if(p.operation==='learning'){window.pc29.learnings.unshift({id:902,source_id:p.payload.primaryResultId,learning:p.payload.learning,scope:p.payload.scope,
          sample_size:p.payload.sourceResultIds.length,counterexamples:p.payload.counterexampleIds,provenance:{sources:[701]},confirmed:false,candidate_key:p.candidateKey});return {ok:true,learningId:902,replayed:false};}
        if(p.operation==='confirmLearning'){const row=window.pc29.learnings.find(x=>x.id===p.learningId);row.confirmed=true;row.confirmed_by_uid='fictional-human';row.user_decision=p.decision;return {ok:true,learningId:row.id,confirmed:true,replayed:false};}
        return {error:'unsupported'};};
      setLang('zh-CN');const ctx={main:document.querySelector('.console-main'),callFn:window.pc29Call,api:{},toast:()=>{}};
      dispatch('#/ai',ctx);history.replaceState(null,'',location.pathname+location.search+'#/ai/experience');dispatch('#/ai/experience',ctx);
      return true;
    })()`);
    assert.equal(result,true);
    await browser.wait("document.querySelector('.crm-ai-exp-page h2')?.innerText.includes('实际结果')");
    await browser.wait("document.querySelector('.crm-ai-exp-result-pick')");
    assert.match(await browser.evaluate("document.querySelector('.crm-ai-exp-state').innerText"),/旧记录|Legacy/);
    await browser.evaluate(`(()=>{const d=document.querySelector('.crm-ai-exp-detail');const f=d.querySelector('form');
      const s=f.querySelector('select');s.value='modified';s.dispatchEvent(new Event('change',{bubbles:true}));
      const areas=f.querySelectorAll('textarea');areas[0].value='[CRM_TEST_ONLY] adjusted for fictional test';areas[1].value='{"before":"[CRM_TEST_ONLY] old","after":"[CRM_TEST_ONLY] new"}';f.requestSubmit()})()`);
    await browser.wait("window.pc29.calls.some(x=>x.p.operation==='decide')");
    const decision=await browser.evaluate("window.pc29.calls.find(x=>x.p.operation==='decide').p");
    assert.equal(decision.decision,'modified');assert.deepEqual(decision.editDelta,{before:'[CRM_TEST_ONLY] old',after:'[CRM_TEST_ONLY] new'});
    await browser.evaluate(`(()=>{const section=document.querySelectorAll('.crm-ai-exp-section')[0];const f=section.querySelector('form');
      const selects=f.querySelectorAll('select');selects[0].value='action';selects[0].dispatchEvent(new Event('change',{bubbles:true}));
      selects[1].value='801';selects[2].value='701';const areas=f.querySelectorAll('textarea');areas[0].value='[CRM_TEST_ONLY] actual fictional result';
      f.querySelector('input[type="datetime-local"]').value='2026-10-17T10:30';areas[1].value='[CRM_TEST_ONLY] evidence from fictional follow-up';f.requestSubmit()})()`);
    await browser.wait("window.pc29.calls.some(x=>x.p.operation==='outcome')");
    const outcome=await browser.evaluate("window.pc29.calls.find(x=>x.p.operation==='outcome').p");
    assert.equal(outcome.targetType,'action');assert.equal(outcome.targetId,801);assert.equal(outcome.aiResultId,'701');
    assert.match(outcome.evidence,/CRM_TEST_ONLY/);
    await browser.evaluate(`(()=>{const check=document.querySelector('.crm-ai-exp-result input[type="checkbox"]');check.checked=true;check.dispatchEvent(new Event('change',{bubbles:true}));
      const s=document.querySelectorAll('.crm-ai-exp-section')[1];const f=s.querySelector('form');const fields=f.querySelectorAll('input,textarea');
      fields[1].value='[CRM_TEST_ONLY] fictional selling situation';fields[2].value='[CRM_TEST_ONLY] verified suggestion';
      fields[3].value='[CRM_TEST_ONLY] advisor asked a clarifying question';fields[4].value='[CRM_TEST_ONLY] confirm understanding before next action';
      fields[5].value='fictional test scope';fields[6].value='';f.requestSubmit()})()`);
    await browser.wait("window.pc29.calls.some(x=>x.p.operation==='learning')");
    const learning=await browser.evaluate("window.pc29.calls.find(x=>x.p.operation==='learning').p.payload");
    assert.deepEqual(learning.sourceResultIds,[701]);assert.equal(learning.primaryResultId,701);
    await browser.wait("document.querySelector('.crm-ai-exp-candidate button')");
    await browser.evaluate(`(()=>{const c=document.querySelector('.crm-ai-exp-candidate');c.querySelector('input').value='[CRM_TEST_ONLY] reviewed candidate';c.querySelector('button').click()})()`);
    await browser.wait("window.pc29.calls.some(x=>x.p.operation==='confirmLearning')");
    const review=await browser.evaluate("window.pc29.calls.find(x=>x.p.operation==='confirmLearning').p");
    assert.equal(review.learningId,902);assert.match(review.decision,/CRM_TEST_ONLY/);
    for(const [width,height] of [[1180,820],[820,1180]]){
      await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,`${width}x${height}`);
    }
    await browser.evaluate(`(async()=>{const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang('en');
      const {dispatch}=await import('/crm/js/modules/console/router.js');dispatch('#/ai/experience',
        {main:document.querySelector('.console-main'),callFn:window.pc29Call,api:{},toast:()=>{}})})()`);
    await browser.wait("document.querySelector('.crm-ai-exp-page h2')?.innerText==='AI Results & Outcomes'");
    await browser.healthy();
  }finally{await browser.close();}
});
