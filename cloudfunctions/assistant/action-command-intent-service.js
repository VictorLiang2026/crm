/** PC26: interpret a bounded Action change request without choosing a business identity. */
'use strict';

const { createAIGateway } = require('./ai-gateway');
const { createSearchData } = require('./search-data');
const { createActionCommandData } = require('./action-command-data');
const { disclose, refsForRows } = require('./test-data');

const FIELDS = ['action_type','title','description','due_at','priority'];
const GUIDANCE = Object.freeze({
  operations:['update','close'],
  fields:FIELDS,
  rules:'Interpret only an explicit request to update or complete one existing Action. “close” means mark an open/in_progress Action completed; never delete, reopen, cancel, create, alter an Opportunity or Commitment, or choose an identity. Return a short Person name phrase and Action title phrase only, never IDs or SQL. For update return only explicitly requested field values; use null for every unchanged field. due_at must be a precise ISO-8601 timestamp with timezone; if relative or unclear, ask for clarification. close has all changes null. If the request is ambiguous, unsupported, or missing a Person or Action phrase, ask for clarification. Do not infer fields from CRM data or claim that anything was saved.',
});
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
function fail(code,message){const error=new Error(message);error.code=code;throw error;}
function plain(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
  (Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);}
function id(value){const text=String(value??'');if(!/^[1-9][0-9]{0,18}$/.test(text)||!Number.isSafeInteger(Number(text)))fail('INVALID_INPUT','Invalid CRM reference');return text;}
function optionalMention(value,max){
  if(value===null)return null;
  if(typeof value!=='string'||!value.trim()||value.trim().length>max||/^\d+$/.test(value.trim()))fail('INVALID_RESULT','Invalid Action command phrase');
  return value.trim();
}
function validateProposal(value){
  const allowed=['status','operation','interpretation','personMention','actionMention','changes'];
  if(!plain(value)||Object.keys(value).some(key=>!allowed.includes(key))||
     !['supported','needs_clarification','unsupported'].includes(value.status)||
     !['update','close','unsupported'].includes(value.operation)||
     typeof value.interpretation!=='string'||!value.interpretation.trim()||value.interpretation.length>300||
     !plain(value.changes)||Object.keys(value.changes).some(key=>!FIELDS.includes(key))){
    fail('INVALID_RESULT','Invalid Action command result');
  }
  const personMention=optionalMention(value.personMention,120);
  const actionMention=optionalMention(value.actionMention,200);
  const changes={};
  for(const field of FIELDS){
    const item=own(value.changes,field)?value.changes[field]:null;
    if(item!==null&&typeof item!=='string')fail('INVALID_RESULT','Invalid Action field');
    if(field==='priority'&&item!==null&&!['low','medium','high','urgent'].includes(item))fail('INVALID_RESULT','Invalid Action priority');
    if(field==='action_type'&&item!==null&&(!item.trim()||item.trim().length>64))fail('INVALID_RESULT','Invalid Action type');
    if(field==='title'&&item!==null&&(!item.trim()||item.trim().length>200))fail('INVALID_RESULT','Invalid Action title');
    if(field==='description'&&item!==null&&item.length>4000)fail('INVALID_RESULT','Invalid Action description');
    if(field==='due_at'&&item!==null&&(!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(item)||!Number.isFinite(Date.parse(item))))fail('INVALID_RESULT','Action due date must be an explicit ISO timestamp');
    changes[field]=item;
  }
  if(value.status==='supported'){
    if(!['update','close'].includes(value.operation)||!personMention||!actionMention)fail('INVALID_RESULT','Supported command lacks a target');
    if(value.operation==='close'&&FIELDS.some(field=>changes[field]!==null))fail('INVALID_RESULT','Close cannot change fields');
    if(value.operation==='update'&&FIELDS.every(field=>changes[field]===null))fail('INVALID_RESULT','Update has no explicit fields');
  }
  return {...value,personMention,actionMention,changes};
}
function unwrap(result){const value=result&&Object.hasOwn(result,'result')?result.result:result;
  if(!value||typeof value!=='object'||Array.isArray(value)||value.error)fail('UPSTREAM_UNAVAILABLE','Action command interpretation failed');return value;}

async function interpretActionCommand(event,dependencies={}){
  const query=typeof event?.query==='string'?event.query.trim():'';
  if(!query||query.length>1200)fail('INVALID_INPUT','Invalid Action request');
  const language=event.language==='en'?'en':'zh-CN';
  const app=dependencies.app||require('./db').app;
  const database=dependencies.database||createSearchData({env:process.env.TCB_ENV,key:process.env.CRM_ASSISTANT_DB_API_KEY});
  const gateway=dependencies.gateway||createAIGateway({app,rdb:database.auditRdb,timeoutMs:30000,maxAttempts:1});
  const task=await gateway.runAITask({taskType:'assistant_action_update_v1',skill:'assistant_action_update_v1',
    capability:'structured_extraction',input:{text:query,language},context:{guidance:GUIDANCE},
    contextSnapshot:{guidance:GUIDANCE,_context:{recipe:'assistant_action_update_v1',version:'1.0.0',source:'bounded Action update/close proposal'}}});
  const proposal=validateProposal(task.result);
  const base={taskId:task.taskId,resultId:task.resultId,proposal:{operation:proposal.operation,
    interpretation:proposal.interpretation,personMention:proposal.personMention,
    actionMention:proposal.actionMention,changes:proposal.changes},
    execution:{performed:false,modelCalled:true,businessDataRead:false,businessDataWritten:false}};
  if(proposal.status==='unsupported'||proposal.operation==='unsupported')return {...base,status:'unsupported',requiresHumanDecision:false};
  if(proposal.status==='needs_clarification'||!proposal.personMention||!proposal.actionMention||
     (proposal.operation==='update'&&FIELDS.every(field=>proposal.changes[field]===null))){
    return {...base,status:'needs_clarification',requiresHumanDecision:true};
  }
  const resolution=await (dependencies.resolveName||database.resolveName)(proposal.personMention);
  const candidates=resolution?.candidates;
  if(!Array.isArray(candidates)||candidates.length>10||candidates.some(row=>
    !/^[1-9][0-9]{0,18}$/.test(String(row?.id))||!Number.isSafeInteger(Number(row.id))||
    typeof row.displayName!=='string'||!row.displayName.trim()||row.displayName.length>160))fail('UPSTREAM_UNAVAILABLE','Person resolution unavailable');
  base.execution.businessDataRead=true;
  if(!candidates.length)return {...base,status:'person_not_found',candidates:[],requiresHumanDecision:true};
  return {...base,status:'needs_person_selection',requiresHumanDecision:true,
    candidates:candidates.map(row=>({id:String(row.id),displayName:row.displayName,
      organization:row.organization||'',occupation:row.occupation||''})),hasMore:resolution.hasMore===true};
}

async function listActionTargets(event,dependencies={}){
  const personMention=optionalMention(event?.personMention,120);
  const selectedPersonId=id(event?.selectedPersonId);
  if(!personMention)fail('INVALID_INPUT','Person selection is required');
  const database=dependencies.searchData||createSearchData({env:process.env.TCB_ENV,key:process.env.CRM_ASSISTANT_DB_API_KEY});
  const resolution=await (dependencies.resolveName||database.resolveName)(personMention);
  const candidates=resolution?.candidates;
  if(resolution?.hasMore===true)fail('INVALID_INPUT','Person name needs a more specific phrase');
  if(!Array.isArray(candidates)||candidates.length>10||candidates.some(row=>
    !/^[1-9][0-9]{0,18}$/.test(String(row?.id))||typeof row.displayName!=='string'))fail('UPSTREAM_UNAVAILABLE','Person resolution unavailable');
  const selected=candidates.find(row=>String(row.id)===selectedPersonId);
  if(!selected)fail('INVALID_INPUT','Selected Person is no longer a name-resolution candidate');
  const commandData=dependencies.commandData||createActionCommandData({env:process.env.TCB_ENV,key:process.env.CRM_ASSISTANT_DB_API_KEY});
  const result=await (dependencies.listOpenActions||commandData.listOpenActions)(selectedPersonId);
  if(!result||!Array.isArray(result.rows)||result.rows.length>50)fail('UPSTREAM_UNAVAILABLE','Action list unavailable');
  const rows=result.rows;
  const testData=await (dependencies.disclose||((refs)=>disclose(refs)))([
    {table:'persons',id:selectedPersonId},...refsForRows('actions',rows),
  ]);
  return {ok:true,status:rows.length?'targets_available':'no_open_actions',person:{id:selectedPersonId,
    displayName:selected.displayName},actions:rows,hasMore:result.hasMore===true,testData,
    requiresHumanDecision:true,execution:{performed:false,modelCalled:false,businessDataRead:true,businessDataWritten:false}};
}

module.exports={GUIDANCE,interpretActionCommand,listActionTargets,validateProposal};
