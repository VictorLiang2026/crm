'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {Browser}=require('./browser-fixture.cjs');

test('iPad: explicit field selection, plan, real preview, then separate human confirmation; Chinese and English',async()=>{
  const browser=new Browser(path.resolve(__dirname,'../..'));
  try{
    await browser.start();await browser.setViewport(820,1180);
    await browser.evaluate(`(async()=>{
      const {renderEducationBackfill}=await import('/crm/js/modules/console/education-backfill.js');
      const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang('zh-CN');
      const batch='00000000-0000-4000-8000-000000000001',item='00000000-0000-4000-8000-000000000002';
      window.eduCalls=[];window.eduWritten=false;
      const candidate={school:'北京大学',major:'经济学',relationship:'self',educationType:'graduated',ambiguous:false,
        evidence:[{table:'persons',id:'7',field:'notes',quote:'本人毕业于北大，经济学专业。'}]};
      const callFn=async(name,request)=>{
        window.eduCalls.push(request);const op=request.operation;
        if(op==='batches')return{ok:true,batches:[{id:batch,status:'completed',created_at:'2026-11-15T15:00:00Z'}]};
        if(op==='status')return{ok:true,batch:{status:'completed',calls_used:1,max_calls:50},counts:{ready:1},items:[{
          id:item,person_id:'7',display_name:'[CRM_TEST_ONLY] Sample',status:window.eduWritten?'applied':'ready',result:{candidates:[candidate]}}]};
        if(op==='plan')return{ok:true,planId:'00000000-0000-4000-8000-000000000003'};
        if(op==='preview')return{ok:true,previewId:'00000000-0000-4000-8000-000000000004',expiresAt:'2026-11-15T16:00:00Z',rows:[{
          displayName:'[CRM_TEST_ONLY] Sample',before:{graduation_school:null,department_or_major:null},patch:{graduation_school:'北京大学',department_or_major:'经济学'}}]};
        if(op==='confirm')return{ok:true,confirmationToken:'00000000-0000-4000-8000-000000000005'};
        if(op==='execute'){window.eduWritten=true;return{ok:true};}
        throw Error('Unexpected operation');
      };
      window.eduRoot=document.createElement('div');window.eduRoot.className='console-main';document.body.replaceChildren(window.eduRoot);
      window.eduRender=()=>renderEducationBackfill({main:window.eduRoot,callFn});
      await window.eduRender();return true;
    })()`);
    assert.match(await browser.evaluate('window.eduRoot.innerText'),/教育资料补全/);
    assert.equal(await browser.evaluate("window.eduCalls.some(r=>['confirm','execute'].includes(r.operation))"),false);
    await browser.evaluate(`(()=>{const n=window.eduRoot.querySelector('input[type=radio]');n.click();
      [...window.eduRoot.querySelectorAll('button')].find(b=>b.textContent==='查看所选回填计划').click();})()`);
    await browser.wait("window.eduRoot.innerText.includes('生成服务端预览')");
    assert.equal(await browser.evaluate("window.eduCalls.some(r=>r.operation==='execute')"),false);
    await browser.evaluate("[...window.eduRoot.querySelectorAll('button')].find(b=>b.textContent==='生成服务端预览').click()");
    await browser.wait("window.eduRoot.innerText.includes('我已核对以上变更，确认执行')");
    assert.match(await browser.evaluate('window.eduRoot.innerText'),/服务器核实的原值/);
    assert.equal(await browser.evaluate("window.eduCalls.some(r=>r.operation==='confirm')"),false);
    await browser.evaluate("[...window.eduRoot.querySelectorAll('button')].find(b=>b.textContent==='我已核对以上变更，确认执行').click()");
    await browser.wait('window.eduWritten===true');
    assert.deepEqual(await browser.evaluate("window.eduCalls.filter(r=>['plan','preview','confirm','execute'].includes(r.operation)).map(r=>r.operation)"),['plan','preview','confirm','execute']);
    assert.equal(await browser.evaluate("window.eduCalls.find(r=>r.operation==='execute').data.confirmationToken"),'00000000-0000-4000-8000-000000000005');
    await browser.evaluate("(async()=>{const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang('en');await window.eduRender();})()");
    assert.match(await browser.evaluate('window.eduRoot.innerText'),/Education enrichment/);
    assert.equal(await browser.evaluate("window.eduRoot.innerText.includes('edu_')"),false);
    for(const [width,height] of [[820,1180],[1180,820]]){
      await browser.setViewport(width,height);
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    }
  }finally{await browser.close();}
});
