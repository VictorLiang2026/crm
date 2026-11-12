'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {Browser}=require('../regression/browser.cjs');
const {createKnowledgeLibrary}=require('../../cloudfunctions/assistant/knowledge-library-service');
const {createMain}=require('../../cloudfunctions/assistant/index');

test('desktop, iPad and iPhone generate, reload and distinguish background-read failures',async()=>{
  const b=new Browser(path.resolve(__dirname,'../..'));
  const rows=[],tasks=[];
  let contextState='ready',modelCalls=0;
  const service=createKnowledgeLibrary({
    env:'crm-fixture',key:'local-only',
    client:{callFunction:async({name,data})=>{
      assert.equal(name,'person_360');assert.deepEqual(data,{action:'getMeetingPrepContext',personId:'783'});
      if(contextState==='denied')throw Object.assign(new Error('device denied'),{code:'DEVICE_ACCESS_DENIED'});
      if(contextState==='unavailable')return {result:{error:'BACKGROUND_UNAVAILABLE'}};
      return {result:{person:{occupation:'Teacher'}}};
    }},
    fetchImpl:async(url,{method,body})=>{
      const u=new URL(url),table=u.pathname.split('/').pop(),p=u.searchParams;
      let data=[];
      if(table==='person_followup_advice'){
        const matches=rows.filter(row=>(!p.has('id')||'eq.'+row.id===p.get('id'))&&
          (!p.has('system_task_id')||'eq.'+row.system_task_id===p.get('system_task_id'))&&
          (!p.has('client_request_id')||'eq.'+row.client_request_id===p.get('client_request_id')));
        if(method==='POST'){
          const row={id:rows.length+1,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),...JSON.parse(body)};
          rows.unshift(row);data=[row];
        }else {if(method==='PATCH')matches.forEach(row=>Object.assign(row,JSON.parse(body)));data=matches;}
      }else if(table==='ai_tasks')data=tasks.filter(row=>'eq.'+row.id===p.get('id'));
      return {ok:true,text:async()=>JSON.stringify(data)};
    },
    searchDataFactory:()=>({auditRdb:{}}),
    gatewayFactory:()=>({runAITask:async request=>{
      const taskId=++modelCalls;
      tasks.push({id:taskId,status:'completed'});
      await request.onStarted?.({taskId});
      return {taskId,result:{title:'Advice '+taskId,overallStrategy:{summary:'Clarify the next meeting.',objective:'Check needs',nextStep:'Ask permission',sourceRefs:[]},
        productServiceAdvice:{recommendation:'No verified product match',sourceRefs:[]},wechatMessage:'Would you like to discuss your priorities?'}};
    }})
  });
  const operator='fixture-operator';
  const handler=createMain(()=>({uid:operator,isAnonymous:false}),...Array(10).fill(undefined),
    (event,actor,options)=>service.run(event,actor,options),event=>service.adviceStatus(event,operator));
  try{
    await b.start();
    await b.openConsole('#/more','authCase=1');
    await b.wait("document.querySelector('.more-primary')");
    await b.send('Runtime.addBinding',{name:'fixtureAdviceCall'});
    b.socket.addEventListener('message',async message=>{
      const packet=JSON.parse(String(message.data));
      if(packet.method!=='Runtime.bindingCalled'||packet.params.name!=='fixtureAdviceCall')return;
      try{
        const {id,event}=JSON.parse(packet.params.payload);
        const reply=await new Promise((resolve,reject)=>{
          const returned=handler(event,{},(err,value)=>err?reject(err):resolve(value));
          if(returned!==undefined)Promise.resolve(returned).then(resolve,reject);
        });
        await b.evaluate('window.fixture.settle('+JSON.stringify(id)+','+JSON.stringify(reply)+')');
      }catch(error){b.runtimeErrors.push(error.message);}
    });
    await b.evaluate(`(async()=>{
      const {renderFollowupAdvice}=await import('/crm/js/modules/console/followup-advice.js');
      const {t,setLang}=await import('/crm/js/modules/console/i18n.js');
      const responses=new Map();let serial=0;
      window.fixture={t,settle(id,value){responses.get(id)(value);responses.delete(id);},draw(lang){
        setLang(lang);
        renderFollowupAdvice({main:document.querySelector('.console-main'),api:{call:async(name,event)=>{
          if(name!=='assistant')throw Error('Unexpected service');
          const id=++serial;return new Promise(resolve=>{responses.set(id,resolve);window.fixtureAdviceCall(JSON.stringify({id,event}));});
        }}},'783');
      }};
    })()`);
    for(const [width,height,lang] of [[1440,900,'en'],[820,1180,'zh-CN'],[390,844,'zh-CN']]){
      await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width===390});
      await b.evaluate(`fixture.draw('${lang}')`);
      await b.wait("document.querySelector('.fa-compare,.fa-empty')");
      const click="document.querySelector('.head-actions .btn-primary').click()";
      contextState='ready';await b.evaluate(click);
      await b.wait("document.querySelector('.fa-page-status[role=status]').textContent===fixture.t('fa_generated')");
      assert.ok(await b.evaluate(`document.querySelector('.fa-row h2').textContent==='Advice ${modelCalls}'`));
      assert.ok(await b.evaluate("document.documentElement.scrollWidth<=innerWidth+1"));
      for(const [state,key] of [['denied','fa_generation_context_denied'],['unavailable','fa_generation_context_unavailable']]){
        contextState=state;const before=modelCalls;await b.evaluate(click);
        await b.wait(`document.querySelector('.fa-page-status[role=status]').textContent===fixture.t('${key}')`);
        assert.equal(modelCalls,before);
      }
    }
    assert.equal(modelCalls,3);assert.equal(rows.filter(r=>r.system_status==='ready').length,3);
    await b.healthy();
  }finally{await b.close();}
});
