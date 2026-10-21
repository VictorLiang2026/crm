/** PC27: bounded Opportunity interpretation and explicit Person/Opportunity selection. */
'use strict';
const {createAIGateway}=require('./ai-gateway');
const {createSearchData}=require('./search-data');
const {createOpportunityCommandData}=require('./opportunity-command-data');
const {disclose,refsForRows}=require('./test-data');
const TYPES=['insurance','recruit','referral','activity','speaker','partnership','service','relationship'];
const STATUSES=['发现','沟通','方案','潜在线索','已介绍','已联系','已建立关系'];
const GUIDANCE=Object.freeze({operations:['edit','stage','close'],types:TYPES,stages:STATUSES,
  rules:'Interpret only one explicit update, type-compatible stage change, or close of an existing Person-only Opportunity. Return a short Person name phrase and Opportunity title/type phrase, never IDs or SQL. For edit return only requested values among type (the enum list), progress (maximum 4000 characters), nextAction (maximum 1000 characters), and nextActionDate (an exact YYYY-MM-DD or null). For stage return only a requested allowed stage. For close return only status 成交 or 关闭 when clearly stated; never write an outcome result because the human must provide it in the UI. Never create, delete, reopen, link an Action, touch a customer Opportunity, or alter fields outside this list. If ambiguous, unsupported, missing a target phrase, unclear date, or no explicit edit field, ask for clarification. Do not claim that anything was saved.'});
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
function fail(code){const error=new Error('Opportunity request could not be interpreted');error.code=code;throw error;}
function plain(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
  (Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);}
function optionalMention(value,max){if(value===null)return null;
  if(typeof value!=='string'||!value.trim()||value.trim().length>max||/^\d+$/.test(value.trim()))fail('INVALID_RESULT');
  return value.trim();}
function validateProposal(value){
  const allowed=['status','operation','interpretation','personMention','opportunityMention','changes'];
  if(!plain(value)||Object.keys(value).some(key=>!allowed.includes(key))||
    !['supported','needs_clarification','unsupported'].includes(value.status)||
    !['edit','stage','close','unsupported'].includes(value.operation)||
    typeof value.interpretation!=='string'||!value.interpretation.trim()||value.interpretation.length>300||
    !plain(value.changes)||Object.keys(value.changes).some(key=>!['type','progress','nextAction','nextActionDate','status'].includes(key)))fail('INVALID_RESULT');
  const personMention=optionalMention(value.personMention,120);
  const opportunityMention=optionalMention(value.opportunityMention,200);
  const changes={};
  if(own(value.changes,'type')&&value.changes.type!==null&&
    (typeof value.changes.type!=='string'||!TYPES.includes(value.changes.type)))fail('INVALID_RESULT');
  if(own(value.changes,'progress')&&value.changes.progress!==null&&
    (typeof value.changes.progress!=='string'||value.changes.progress.length>4000))fail('INVALID_RESULT');
  if(own(value.changes,'nextAction')&&value.changes.nextAction!==null&&
    (typeof value.changes.nextAction!=='string'||value.changes.nextAction.length>1000))fail('INVALID_RESULT');
  if(own(value.changes,'nextActionDate')&&value.changes.nextActionDate!==null&&
    (typeof value.changes.nextActionDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value.changes.nextActionDate)||
      !Number.isFinite(Date.parse(`${value.changes.nextActionDate}T00:00:00Z`))))fail('INVALID_RESULT');
  if(own(value.changes,'status')&&value.changes.status!==null&&
    !(value.operation==='close'?['成交','关闭']:STATUSES).includes(value.changes.status))fail('INVALID_RESULT');
  // Every schema field is required for Gateway structured output; null means "not requested".
  // This natural-language path does not interpret null as a destructive field clear.
  for(const key of ['type','progress','nextAction','nextActionDate','status'])
    if(own(value.changes,key)&&value.changes[key]!==null)changes[key]=value.changes[key];
  if(value.status==='supported'){
    if(value.operation==='unsupported'||!personMention||!opportunityMention)fail('INVALID_RESULT');
    if(value.operation==='edit'&&!Object.keys(changes).length)fail('INVALID_RESULT');
    if(value.operation==='stage'&&(!own(changes,'status')||changes.status===null))fail('INVALID_RESULT');
    if(value.operation==='close'&&(Object.entries(changes).some(([key,item])=>key!=='status'&&item!==null)||
      !own(changes,'status')))fail('INVALID_RESULT');
  }
  if(value.operation==='edit'&&changes.status!=null||value.operation==='stage'&&
    Object.entries(changes).some(([key,item])=>key!=='status'&&item!==null)||value.operation==='close'&&
    Object.entries(changes).some(([key,item])=>key!=='status'&&item!==null))fail('INVALID_RESULT');
  return {...value,personMention,opportunityMention,changes};
}
async function interpretOpportunityCommand(event,deps={}){
  const query=typeof event?.query==='string'?event.query.trim():'';
  if(!query||query.length>1200)fail('INVALID_INPUT');
  const language=event.language==='en'?'en':'zh-CN';
  const app=deps.app||require('./db').app;
  const database=deps.database||createSearchData({env:process.env.TCB_ENV,key:process.env.CRM_ASSISTANT_DB_API_KEY});
  const gateway=deps.gateway||createAIGateway({app,rdb:database.auditRdb,timeoutMs:30000,maxAttempts:1});
  const task=await gateway.runAITask({taskType:'assistant_opportunity_update_v1',skill:'assistant_opportunity_update_v1',
    capability:'structured_extraction',input:{text:query,language},context:{guidance:GUIDANCE},
    contextSnapshot:{guidance:GUIDANCE,_context:{recipe:'assistant_opportunity_update_v1',version:'1.0.0',
      source:'bounded Person-only Opportunity update/stage/close proposal'}}});
  const proposal=validateProposal(task.result);
  const base={ok:true,taskId:task.taskId,resultId:task.resultId,proposal:{operation:proposal.operation,
    interpretation:proposal.interpretation,personMention:proposal.personMention,
    opportunityMention:proposal.opportunityMention,changes:proposal.changes},
    execution:{performed:false,modelCalled:true,businessDataRead:false,businessDataWritten:false}};
  if(proposal.status==='unsupported'||proposal.operation==='unsupported')return {...base,status:'unsupported'};
  if(proposal.status==='needs_clarification'||!proposal.personMention||!proposal.opportunityMention||
    (proposal.operation==='edit'&&!Object.keys(proposal.changes).length)||
    (proposal.operation==='stage'&&proposal.changes.status==null))return {...base,status:'needs_clarification'};
  const resolution=await (deps.resolveName||database.resolveName)(proposal.personMention);
  const candidates=resolution?.candidates;
  if(!Array.isArray(candidates)||candidates.length>10||candidates.some(row=>
    !/^[1-9][0-9]{0,18}$/.test(String(row?.id))||!Number.isSafeInteger(Number(row.id))||
    typeof row.displayName!=='string'||!row.displayName.trim()||row.displayName.length>160))fail('UPSTREAM_UNAVAILABLE');
  base.execution.businessDataRead=true;
  if(!candidates.length)return {...base,status:'person_not_found',candidates:[],requiresHumanDecision:true};
  return {...base,status:'needs_person_selection',requiresHumanDecision:true,
    candidates:candidates.map(row=>({id:String(row.id),displayName:row.displayName,
      organization:row.organization||'',occupation:row.occupation||''})),hasMore:resolution.hasMore===true};
}
async function listOpportunityTargets(event,actorUid,deps={}){
  const personMention=optionalMention(event?.personMention,120),personId=String(event?.selectedPersonId??'');
  if(typeof actorUid!=='string'||!actorUid.trim()||!personMention||
    !/^([1-9][0-9]{0,18})$/.test(personId)||!Number.isSafeInteger(Number(personId)))fail('INVALID_INPUT');
  const search=deps.searchData||(!deps.resolveName?createSearchData({env:process.env.TCB_ENV,
    key:process.env.CRM_ASSISTANT_DB_API_KEY}):null);
  const resolution=await (deps.resolveName||search.resolveName)(personMention);
  const candidates=resolution?.candidates;
  if(resolution?.hasMore===true||!Array.isArray(candidates)||candidates.length>10||
    candidates.some(row=>!/^[1-9][0-9]{0,18}$/.test(String(row?.id))||typeof row.displayName!=='string'))fail('INVALID_INPUT');
  const selected=candidates.find(row=>String(row.id)===personId);
  if(!selected)fail('INVALID_INPUT');
  const data=deps.commandData||(!deps.listActive?createOpportunityCommandData({env:process.env.TCB_ENV,
    key:process.env.CRM_ASSISTANT_DB_API_KEY}):null);
  const result=await (deps.listActive||data.listActive)(personId,actorUid);
  if(!result||!Array.isArray(result.rows)||result.rows.length>50)fail('UPSTREAM_UNAVAILABLE');
  const testData=await (deps.disclose||disclose)([{table:'persons',id:personId},...refsForRows('opportunities',result.rows)]);
  return {ok:true,status:result.rows.length?'targets_available':'no_open_opportunities',
    person:{id:personId,displayName:selected.displayName},opportunities:result.rows,
    hasMore:result.hasMore===true,testData,requiresHumanDecision:true,
    execution:{performed:false,modelCalled:false,businessDataRead:true,businessDataWritten:false}};
}
module.exports={GUIDANCE,validateProposal,interpretOpportunityCommand,listOpportunityTargets};
