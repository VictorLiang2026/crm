'use strict';
const { PersonService } = require('./person-service');
const NAME = '【系统测试·勿联系】虚构体验甲';
const STAGES = new Set(['status','dryRun','confirm','execute']);
function fail(code) { const e=new Error(code); e.code=code; throw e; }
function createScenarioData({env,key,fetchImpl=fetch}) {
 if (!/^crm-[a-z0-9]+$/.test(env||'') || typeof key!=='string' || !key) fail('SEED_NOT_CONFIGURED');
 async function request(path,method,filters,body) {
  const url=new URL(`https://${env}.api.tcloudbasegateway.com/v1/rdb/rest/${path}`);
  for(const [k,v] of Object.entries(filters||{})) url.searchParams.set(k,v);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try {
   const response=await fetchImpl(url,{method,headers:{Authorization:`Bearer ${key}`,
    'Accept-Profile':'public','Content-Profile':'public','Content-Type':'application/json',Accept:'application/json'},
    body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
   if(!response.ok){let code;try{code=(await response.json()).code?.replace(/^DATABASE_/,'');}catch{/* No raw server diagnostics. */}
    fail(({42501:'CONFIRMATION_REQUIRED',40001:'PREVIEW_STALE',23514:'SEED_CONFLICT',23505:'SEED_CONFLICT'})[code]||'SEED_DATABASE_ERROR');}
   return await response.json();
  }finally{clearTimeout(timer);}
 }
 const personService=new PersonService({request:(table,method,filters)=>{
  if(table!=='persons'||method!=='GET')fail('SEED_INVALID_REQUEST');
  return request(table,method,filters);
 }});
 return {resolve:()=>personService.resolveName(NAME),
  run:(stage,uid,id,hash)=>request('rpc/crm_test_scenario_v1','POST',{},
   {p_stage:stage,p_actor_uid:uid,p_preview_id:id||null,p_preview_hash:hash||null})};
}
async function runScenario(event,identity,{allowedUids=[],data}={}) {
 if(identity?.isAnonymous!==false||typeof identity.uid!=='string'||!allowedUids.includes(identity.uid))fail('SEED_FORBIDDEN');
 if(!event||!STAGES.has(event.stage)||Object.keys(event).some(k=>!['action','stage','previewId','previewHash','TCB_CONTEXT_KEYS'].includes(k)))fail('SEED_INVALID_REQUEST');
 if(['confirm','execute'].includes(event.stage)&& !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(event.previewId||''))fail('CONFIRMATION_REQUIRED');
 if(event.stage==='confirm'&&!/^[0-9a-f]{32}$/.test(event.previewHash||''))fail('CONFIRMATION_REQUIRED');
 if(event.stage!=='confirm'&&event.previewHash!==undefined)fail('SEED_INVALID_REQUEST');
 const db=data||createScenarioData({env:process.env.TCB_ENV,key:process.env.CRM_ASSISTANT_DB_API_KEY});
 let resolution;
 if(event.stage==='dryRun') {
  const state=await db.run('status',identity.uid);
  resolution=await db.resolve();
  const registered=state.ready&&resolution.candidates.length===1&&String(resolution.candidates[0].id)===String(state.targets.personId);
  if(resolution.hasMore||(!registered&&resolution.status!=='available'))fail('SEED_IDENTITY_CONFLICT');
 }
 const result=await db.run(event.stage,identity.uid,event.previewId,event.previewHash);
 if(!result||result.ok!==true)fail('SEED_DATABASE_ERROR');
 if(resolution)result.identity={name:NAME,decision:result.ready?'confirm_registered':'confirm_new',requiresHumanConfirmation:true};
 return result;
}
module.exports={NAME,createScenarioData,runScenario};
