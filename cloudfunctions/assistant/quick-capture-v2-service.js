/** WP07 test-only V2 Command -> Plan -> Preview -> Confirm -> Execute. */
'use strict';
const { PersonService } = require('./person-service');
const { createAIGateway } = require('./ai-gateway');
const { createSearchData } = require('./search-data');
const { createScenarioData } = require('./test-scenario-service');
const { normalizeDraft, prompt } = require('./quick-capture-v2-parser');
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const MD5=/^[0-9a-f]{32}$/;
const ID=/^[1-9][0-9]*$/;
const MARKER='【系统测试·勿联系】';
function fail(code){const error=new Error(code);error.code=code;throw error;}
function numberId(value){if(!ID.test(String(value))||!Number.isSafeInteger(Number(value)))fail('INVALID_INPUT');return Number(value);}
function createData({env,key,fetchImpl=fetch}={}){
  if(!/^crm-[a-z0-9]+$/.test(env||'')||typeof key!=='string'||!key)fail('INVALID_CONFIG');
  async function request(path,method,filters,body){
    const url=new URL(`https://${env}.api.tcloudbasegateway.com/v1/rdb/rest/${path}`);
    for(const [k,v] of Object.entries(filters||{}))url.searchParams.set(k,v);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetchImpl(url,{method,headers:{Authorization:`Bearer ${key}`,
        'Accept-Profile':'public','Content-Profile':'public','Content-Type':'application/json',
        Accept:'application/json',Prefer:'return=representation'},
        body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
      if(!response.ok){
        let code='QUICK_CAPTURE_DATABASE_ERROR';
        try{const error=await response.json();const pg=String(error.code||'').replace(/^DATABASE_/,'');
          code=({42501:'CONFIRMATION_REQUIRED',40001:'PREVIEW_STALE',22023:'INVALID_INPUT',
            23514:'INVALID_INPUT',23503:'INVALID_INPUT'})[pg]||code;}catch{/* no raw database detail */}
        fail(code);
      }
      return await response.json();
    }finally{clearTimeout(timer);}
  }
  const personService=new PersonService({request:(table,method,filters)=>{
    if(table!=='persons'||method!=='GET')fail('INVALID_INPUT');
    return request(table,method,filters);
  }});
  return {resolve:name=>personService.resolveName(name),
    run:(stage,uid,args={})=>stage==='plan'
      ? request('rpc/quick_capture_v2_plan_v1','POST',{},
        {p_actor_uid:uid,p_person_id:args.personId,p_selected_display_name:args.selectedDisplayName,
          p_draft:args.draft,p_ai_task_id:args.aiTaskId,p_ai_result_id:args.aiResultId})
      : request('rpc/quick_capture_v2_command_v1','POST',{},
        {p_stage:stage,p_actor_uid:uid,p_command_id:args.commandId||null,
          p_person_id:null,p_selected_display_name:null,p_draft:null,
          p_preview_hash:args.previewHash||null,p_ai_task_id:null,p_ai_result_id:null})};
}
async function runQuickCaptureV2(event,identity,{data,gateway,scenarioData,linkAudit}={}){
  const allowed=String(process.env.CRM_TEST_SEED_UIDS||'').split(',').map(s=>s.trim()).filter(Boolean);
  if(identity?.isAnonymous!==false||typeof identity.uid!=='string'||!allowed.includes(identity.uid))fail('FORBIDDEN');
  if(!event||event.action!=='quickCaptureV2'||
    !['parse','resolve','plan','preview','confirm','execute'].includes(event.stage))fail('INVALID_INPUT');
  const stage=event.stage;
  const db=data||createData({env:process.env.TCB_ENV,key:process.env.CRM_ASSISTANT_DB_API_KEY});
  if(stage==='resolve'){
    if(typeof event.name!=='string')fail('INVALID_INPUT');
    return {ok:true,stage,resolution:await db.resolve(event.name)};
  }
  if(stage==='parse'){
    if(typeof event.text!=='string'||!event.text.includes(MARKER)||
      !event.text.trim()||event.text.length>10000)fail('INVALID_INPUT');
    const scene=scenarioData||createScenarioData({env:process.env.TCB_ENV,
      key:process.env.CRM_ASSISTANT_DB_API_KEY});
    const state=await scene.run('status',identity.uid);
    if(state?.ok!==true||state.ready!==true||!ID.test(String(state.targets?.personId||'')))
      fail('TEST_SCENE_NOT_READY');
    const scenePersonId=numberId(state.targets.personId);
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',
      month:'2-digit',day:'2-digit'}).format(new Date());
    const ai=gateway||createAIGateway({
      app:require('@cloudbase/node-sdk').init({env:process.env.TCB_ENV}),
      rdb:createSearchData({env:process.env.TCB_ENV,
        key:process.env.CRM_ASSISTANT_DB_API_KEY}).auditRdb,
      timeoutMs:60000,maxAttempts:1});
    const task=await ai.runAITask({taskType:'quick_capture_v2',skill:'quick_capture_v2',
      capability:'structured_extraction',input:{text:event.text},
      context:{guidance:prompt(today),today,actor_uid:identity.uid}});
    const link=linkAudit||createSearchData({env:process.env.TCB_ENV,
      key:process.env.CRM_ASSISTANT_DB_API_KEY}).linkTestAudit;
    try{
      const linked=await link(task.taskId,[{table:'persons',id:String(scenePersonId)}]);
      if(!linked||linked.linkedBatches<1)fail('AI_AUDIT_LINK_FAILED');
    }catch(error){
      const failure=new Error('AI_AUDIT_LINK_FAILED');failure.code='AI_AUDIT_LINK_FAILED';
      failure.auditTaskId=task.taskId;throw failure;
    }
    return {ok:true,stage,preview:normalizeDraft(task.result),today,
      aiTaskId:task.taskId,aiRunId:task.runId,aiResultId:task.resultId,
      notice:'AI 草稿待人工核对；含测试数据',businessDataWritten:false};
  }
  if(stage==='plan'){
    const personId=numberId(event.personId);
    if(typeof event.selectedDisplayName!=='string'||!event.selectedDisplayName.includes(MARKER)||
      !event.draft||typeof event.draft!=='object'||Array.isArray(event.draft))fail('INVALID_INPUT');
    const resolution=await db.resolve(event.selectedDisplayName);
    if(!resolution.candidates.some(c=>String(c.id)===String(personId)&&
      c.displayName===event.selectedDisplayName))fail('IDENTITY_CHANGED');
    const aiTaskId=numberId(event.aiTaskId),aiResultId=numberId(event.aiResultId);
    const result=await db.run(stage,identity.uid,{personId,selectedDisplayName:event.selectedDisplayName,
      draft:event.draft,aiTaskId,aiResultId});
    if(result?.ok!==true)fail('QUICK_CAPTURE_DATABASE_ERROR');
    return result;
  }
  if(typeof event.commandId!=='string'||!UUID.test(event.commandId))fail('INVALID_INPUT');
  if(stage==='confirm'){
    if(typeof event.previewHash!=='string'||!MD5.test(event.previewHash))fail('CONFIRMATION_REQUIRED');
  }else if(event.previewHash!==undefined)fail('INVALID_INPUT');
  const result=await db.run(stage,identity.uid,{commandId:event.commandId,
    previewHash:stage==='confirm'?event.previewHash:null});
  if(result?.ok!==true)fail('QUICK_CAPTURE_DATABASE_ERROR');
  return result;
}
module.exports={runQuickCaptureV2,createData};
