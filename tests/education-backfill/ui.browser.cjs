'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {Browser}=require('./browser-fixture.cjs');

async function mount(browser,{currentSchool=null,currentMajor=null,oddNames=false}={}){
  await browser.evaluate(`(async()=>{
    const {renderEducationBackfill}=await import('/crm/js/modules/console/education-backfill.js');
    const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang('zh-CN');
    const batch='00000000-0000-4000-8000-000000000001',item='00000000-0000-4000-8000-000000000002';
    window.eduCalls=[];window.eduApplied=false;window.eduPreviewKind=null;window.eduCreated=[];window.eduBatchId=batch;
    const candidate={school:${JSON.stringify(oddNames?'机构毕业于？':'北京大学')},major:${JSON.stringify(oddNames?'并非专业名':'经济学')},
      relationship:'self',educationType:'graduated',ambiguous:false,
      evidence:[{table:'persons',id:'7',field:'notes',quote:'本人毕业于北京大学，经济学专业。'}]};
    const callFn=async(name,request)=>{
      window.eduCalls.push(request);const op=request.operation;
      if(op==='batches')return{ok:true,batches:[{id:window.eduBatchId,status:'completed',created_at:'2026-11-17T15:00:00Z'}]};
      if(op==='people')return{ok:true,people:[
        {person_id:'9',display_name:'[CRM_TEST_ONLY] Recent',created_at:'2026-11-17T15:00:00Z',graduation_school:null,department_or_major:null},
        {person_id:'8',display_name:'[CRM_TEST_ONLY] Earlier',created_at:'2026-11-16T15:00:00Z',graduation_school:'旧校名',department_or_major:null}]};
      if(op==='create'){window.eduCreated.push(request.data);window.eduBatchId='00000000-0000-4000-8000-000000000009';return{ok:true,batchId:window.eduBatchId};}
      if(op==='status')return{ok:true,batch:{status:'completed',calls_used:1,max_calls:50},counts:{ready:1},items:[{
        id:item,person_id:'7',display_name:'[CRM_TEST_ONLY] Sample',created_at:'2021-12-31T00:00:00Z',
        graduation_school:${JSON.stringify(currentSchool)},department_or_major:${JSON.stringify(currentMajor)},
        status:window.eduApplied?'applied':'ready',result:{candidates:[candidate]}}]};
      if(op==='plan')return{ok:true,planId:'00000000-0000-4000-8000-000000000003'};
      if(op==='preview'||op==='undoPreview'){window.eduPreviewKind=op==='preview'?'apply':'undo';return{ok:true,previewId:'00000000-0000-4000-8000-000000000004',expiresAt:'2026-11-17T16:00:00Z',kind:window.eduPreviewKind,rows:[{
        displayName:'[CRM_TEST_ONLY] Sample',before:{graduation_school:${JSON.stringify(currentSchool)},department_or_major:${JSON.stringify(currentMajor)}},
        patch:op==='preview'?{graduation_school:'北京大学',department_or_major:'经济学'}:{graduation_school:${JSON.stringify(currentSchool)},department_or_major:${JSON.stringify(currentMajor)}},
        fieldActions:{school:'candidate',major:'manual'},candidate}]};}
      if(op==='confirm')return{ok:true,confirmationToken:'00000000-0000-4000-8000-000000000005'};
      if(op==='execute'){window.eduApplied=window.eduPreviewKind==='apply';return{ok:true};}
      throw Error('Unexpected operation '+op);
    };
    window.eduRoot=document.createElement('div');window.eduRoot.className='console-main';document.body.replaceChildren(window.eduRoot);
    window.eduRender=()=>renderEducationBackfill({main:window.eduRoot,callFn});await window.eduRender();
  })()`);
}

test('iPad: unique episode and empty fields default selected; preview appears before explicit confirmation in both languages',async()=>{
  const browser=new Browser(path.resolve(__dirname,'../..'));
  try{
    await browser.start();await browser.setViewport(820,1180);await mount(browser);
    assert.match(await browser.evaluate('window.eduRoot.innerText'),/教育资料补全/);
    assert.match(await browser.evaluate('window.eduRoot.innerText'),/AI 尝试额度（已用 \/ 上限）/);
    assert.equal(await browser.evaluate("window.eduRoot.querySelector('input[type=radio]').checked"),true);
    assert.deepEqual(await browser.evaluate("[...window.eduRoot.querySelectorAll('.edu-field select')].map(x=>x.value)"),['candidate','candidate']);
    assert.equal(await browser.evaluate("window.eduRoot.querySelector('button').textContent.includes('确认执行')"),false);
    await browser.evaluate("[...window.eduRoot.querySelectorAll('button')].find(b=>b.textContent.includes('核对所选回填')).click()");
    await browser.wait("window.eduRoot.innerText.includes('回填预览')");
    assert.equal(await browser.evaluate("window.eduCalls.some(r=>r.operation==='execute')"),false);
    assert.deepEqual(await browser.evaluate("window.eduCalls.find(r=>r.operation==='preview').data.rows.map(r=>[r.schoolAction,r.majorAction])"),[['candidate','candidate']]);
    assert.equal(await browser.evaluate("window.eduCalls.some(r=>r.operation==='confirm')"),false);
    await browser.evaluate("[...window.eduRoot.querySelectorAll('button')].find(b=>b.textContent.includes('确认执行')).click()");
    await browser.wait('window.eduApplied===true');
    await browser.evaluate("window.eduRoot.querySelector('.edu-undo-option input').click()");
    await browser.evaluate("[...window.eduRoot.querySelectorAll('button')].find(b=>b.textContent.includes('预览并撤销')).click()");
    await browser.wait("window.eduRoot.innerText.includes('撤销预览')");
    assert.equal(await browser.evaluate("window.eduCalls.some(r=>r.operation==='undoPreview')"),true);
    assert.equal(await browser.evaluate("window.eduCalls.filter(r=>r.operation==='confirm').length"),1);
    await browser.evaluate("[...window.eduRoot.querySelectorAll('button')].find(b=>b.textContent.includes('确认执行')).click()");
    await browser.wait('window.eduApplied===false');
    await browser.evaluate("(async()=>{const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang('en');await window.eduRender();})()");
    assert.match(await browser.evaluate('window.eduRoot.innerText'),/Education enrichment/);
    assert.equal(await browser.evaluate("window.eduRoot.innerText.includes('edu_')"),false);
    for(const [width,height] of [[820,1180],[1180,820]]){
      await browser.setViewport(width,height);assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    }
  }finally{await browser.close();}
});

test('iPad: existing values default to keep; different candidate/manual values can be previewed; weak name warnings do not disable selection',async()=>{
  const browser=new Browser(path.resolve(__dirname,'../..'));
  try{
    await browser.start();await browser.setViewport(1180,820);await mount(browser,{currentSchool:'复旦大学',currentMajor:'统计学',oddNames:true});
    assert.equal(await browser.evaluate("window.eduRoot.querySelector('input[type=radio]').disabled"),false);
    assert.deepEqual(await browser.evaluate("[...window.eduRoot.querySelectorAll('.edu-field select')].map(x=>x.value)"),['keep','keep']);
    assert.equal(await browser.evaluate("window.eduRoot.querySelectorAll('.edu-warning').length"),2);
    await browser.evaluate(`(()=>{const fields=[...window.eduRoot.querySelectorAll('.edu-field select')];
      fields[0].value='candidate';fields[0].dispatchEvent(new Event('change',{bubbles:true}));
      const next=[...window.eduRoot.querySelectorAll('.edu-field select')];next[1].value='manual';next[1].dispatchEvent(new Event('change',{bubbles:true}));
      const input=window.eduRoot.querySelector('.edu-manual-value');input.value='人工确认专业';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await browser.evaluate("[...window.eduRoot.querySelectorAll('button')].find(b=>b.textContent.includes('核对所选回填')).click()");
    await browser.wait("window.eduRoot.innerText.includes('回填预览')");
    const row=await browser.evaluate("window.eduCalls.find(r=>r.operation==='preview').data.rows[0]");
    assert.deepEqual([row.schoolAction,row.majorAction,row.majorValue],['candidate','manual','人工确认专业']);
    assert.equal(await browser.evaluate("window.eduCalls.some(r=>r.operation==='execute')"),false);
    await mount(browser,{currentSchool:'北大',currentMajor:'经济学'});
    assert.deepEqual(await browser.evaluate("[...window.eduRoot.querySelectorAll('.edu-field select')].map(x=>x.value)"),['keep','keep']);
    assert.equal(await browser.evaluate("window.eduRoot.querySelectorAll('.edu-match-tag').length"),2);
  }finally{await browser.close();}
});

test('iPad: created-time, updated-time and search modes create fixed cohorts in both languages',async()=>{
  const browser=new Browser(path.resolve(__dirname,'../..'));
  try{
    await browser.start();await browser.setViewport(820,1180);await mount(browser);
    await browser.evaluate("window.eduRoot.querySelector('input[type=number]').value='75'");
    await browser.evaluate("[...window.eduRoot.querySelectorAll('button')].find(b=>b.textContent==='开始生成候选').click()");
    await browser.wait("window.eduCreated.length===1");
    assert.equal(await browser.evaluate('window.eduCreated[0].sampleSize'),75);
    assert.equal(await browser.evaluate('window.eduCreated[0].selectionMode'),'recent_created');
    await browser.evaluate(`(()=>{const s=window.eduRoot.querySelector('select[aria-label="选择处理人群"]');
      s.value='recent_updated';s.dispatchEvent(new Event('change',{bubbles:true}));
      window.eduRoot.querySelector('input[type=number]').value='40';})()`);
    assert.equal(await browser.evaluate("window.eduRoot.querySelector('input[type=number]').parentElement.hidden"),false);
    assert.match(await browser.evaluate("window.eduRoot.querySelector('input[type=number]').parentElement.innerText"),/最近更新时间倒序/);
    await browser.evaluate("[...window.eduRoot.querySelectorAll('button')].find(b=>b.textContent==='开始生成候选').click()");
    await browser.wait("window.eduCreated.length===2");
    assert.deepEqual(await browser.evaluate('[window.eduCreated[1].selectionMode,window.eduCreated[1].sampleSize]'),['recent_updated',40]);
    await browser.evaluate("(async()=>{const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang('en');await window.eduRender();})()");
    assert.equal(await browser.evaluate("[...window.eduRoot.querySelectorAll('select option')].some(o=>o.textContent==='Recently updated People')"),true);
    await browser.evaluate(`(()=>{const s=window.eduRoot.querySelector('select[aria-label="Choose people to process"]');
      s.value='recent_updated';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    assert.match(await browser.evaluate("window.eduRoot.querySelector('input[type=number]').parentElement.innerText"),/last update/);
    await browser.evaluate("(async()=>{const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang('zh-CN');await window.eduRender();})()");
    await browser.evaluate(`(()=>{const s=window.eduRoot.querySelector('select[aria-label="选择处理人群"]');s.value='search';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await browser.wait("window.eduRoot.querySelectorAll('.edu-person-option').length===2");
    await browser.evaluate("window.eduRoot.querySelectorAll('.edu-person-option input')[1].click()");
    await browser.evaluate("[...window.eduRoot.querySelectorAll('button')].find(b=>b.textContent==='开始生成候选').click()");
    await browser.wait("window.eduCreated.length===3");
    assert.deepEqual(await browser.evaluate('window.eduCreated[2].personIds'),['8']);
    assert.equal(await browser.evaluate('window.eduCreated[2].selectionMode'),'selected');
    assert.equal(await browser.evaluate("window.eduCalls.filter(r=>r.operation==='people').length>0"),true);
    assert.equal(await browser.evaluate("window.eduCalls.some(r=>r.operation==='execute')"),false);
  }finally{await browser.close();}
});
