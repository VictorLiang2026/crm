/** PC28: extract a bounded delete intent; never choose a Person or candidate ID. */
'use strict';
const {createAIGateway}=require('./ai-gateway');
const {createSearchData}=require('./search-data');
const {createRecruitDeleteCommandData}=require('./recruit-delete-command-data');
const {disclose,refsForRows}=require('./test-data');

const GUIDANCE=Object.freeze({resource:'recruit_candidates',operation:'delete',
  rules:'Only interpret an explicit request to delete exactly one existing recruit candidate that is not linked to a customer. Return a short Person name phrase and candidate phrase, never business IDs, SQL, a customer, or a whole Person. Reject requests for people, customers, customer-linked candidates, actions, opportunities, relationships, database objects, permanent deletion, purge, or more than one candidate. If the target or operation is unclear, request clarification. Do not claim anything was deleted. Human selection and a server-verified preview are mandatory.'});
const ID=/^[1-9][0-9]{0,18}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
  (Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
function fail(code){const error=new Error('Recruit delete request could not be interpreted');error.code=code;throw error;}
function mention(value,max){if(value===null)return null;
  if(typeof value!=='string'||!value.trim()||value.trim().length>max||/^#?\d+$/.test(value.trim())||/#\d+/.test(value))
    fail('INVALID_RESULT');return value.trim();}
function validateProposal(value){
  if(!plain(value)||Object.keys(value).some(key=>
      !['status','operation','interpretation','personMention','candidateMention'].includes(key))||
     !['supported','needs_clarification','unsupported'].includes(value.status)||
     !['delete','unsupported'].includes(value.operation)||
     typeof value.interpretation!=='string'||!value.interpretation.trim()||value.interpretation.length>300)
    fail('INVALID_RESULT');
  const personMention=mention(value.personMention,120);
  const candidateMention=mention(value.candidateMention,200);
  if(value.status==='supported'&&(value.operation!=='delete'||!personMention||!candidateMention))
    fail('INVALID_RESULT');
  return {...value,personMention,candidateMention};
}
function explicitSingleCandidate(query){
  return /(删除|删掉|移除|delete|remove)/i.test(query)&&
    /(增员候选人|候选人|人才|recruit(?:ment)? candidate|candidate)/i.test(query)&&
    !/(全部|所有|批量|一批|永久|彻底|清空|purge|drop|delete all|remove all|every\s+candidate|客户|customer|机会|opportunity|行动|action|整个人|whole\s+person|人物(?:和|及|与|还有).*(?:候选人|人才)|person\s+(?:and|&)\s+(?:recruit\s+)?candidate|数据库|database|表结构|table\s+schema)/i.test(query);
}
async function interpretRecruitDelete(event,deps={}){
  const query=typeof event?.query==='string'?event.query.trim():'';
  if(!query||query.length>1200)fail('INVALID_INPUT');
  const language=event.language==='en'?'en':'zh-CN';
  if(!explicitSingleCandidate(query))return {ok:true,status:'unsupported',requiresHumanDecision:false,
    proposal:{operation:'unsupported',interpretation:'Unsupported delete scope'},
    execution:{performed:false,modelCalled:false,businessDataRead:false,businessDataWritten:false}};
  const app=deps.app||require('./db').app;
  const database=deps.database||createSearchData({env:process.env.TCB_ENV,key:process.env.CRM_ASSISTANT_DB_API_KEY});
  const gateway=deps.gateway||createAIGateway({app,rdb:database.auditRdb,timeoutMs:30000,maxAttempts:1});
  const task=await gateway.runAITask({taskType:'assistant_recruit_delete_v1',skill:'assistant_recruit_delete_v1',
    capability:'structured_extraction',input:{text:query,language},context:{guidance:GUIDANCE},
    contextSnapshot:{guidance:GUIDANCE,_context:{recipe:'assistant_recruit_delete_v1',version:'1.0.0',
      source:'bounded Person-only recruit candidate delete proposal'}}});
  const proposal=validateProposal(task.result);
  const base={ok:true,taskId:task.taskId,resultId:task.resultId,
    proposal:{operation:proposal.operation,interpretation:proposal.interpretation,
      personMention:proposal.personMention,candidateMention:proposal.candidateMention},
    execution:{performed:false,modelCalled:true,businessDataRead:false,businessDataWritten:false}};
  if(proposal.status==='unsupported'||proposal.operation==='unsupported')return {...base,status:'unsupported'};
  if(proposal.status==='needs_clarification'||!proposal.personMention||!proposal.candidateMention)
    return {...base,status:'needs_clarification',requiresHumanDecision:true};
  const resolution=await (deps.resolveName||database.resolveName)(proposal.personMention);
  const candidates=resolution?.candidates;
  if(!Array.isArray(candidates)||candidates.length>10||candidates.some(row=>
    !ID.test(String(row?.id))||!Number.isSafeInteger(Number(row.id))||
    typeof row.displayName!=='string'||!row.displayName.trim()||row.displayName.length>160))
    fail('UPSTREAM_UNAVAILABLE');
  base.execution.businessDataRead=true;
  if(!candidates.length)return {...base,status:'person_not_found',candidates:[],requiresHumanDecision:true};
  return {...base,status:'needs_person_selection',requiresHumanDecision:true,
    candidates:candidates.map(row=>({id:String(row.id),displayName:row.displayName,
      organization:row.organization||'',occupation:row.occupation||''})),hasMore:resolution.hasMore===true};
}
async function listRecruitDeleteTargets(event,actorUid,deps={}){
  const phrase=mention(event?.personMention,120);
  const personId=String(event?.selectedPersonId??'');
  if(typeof actorUid!=='string'||!actorUid.trim()||!phrase||
     !ID.test(personId)||!Number.isSafeInteger(Number(personId)))fail('INVALID_INPUT');
  const search=deps.searchData||(!deps.resolveName?createSearchData({env:process.env.TCB_ENV,
    key:process.env.CRM_ASSISTANT_DB_API_KEY}):null);
  const resolution=await (deps.resolveName||search.resolveName)(phrase);
  const candidates=resolution?.candidates;
  if(resolution?.hasMore===true||!Array.isArray(candidates)||candidates.length>10||
     candidates.some(row=>!ID.test(String(row.id))||typeof row.displayName!=='string'))fail('INVALID_INPUT');
  const selected=candidates.find(row=>String(row.id)===personId);
  if(!selected)fail('INVALID_INPUT');
  const data=deps.commandData||(!deps.listActive?createRecruitDeleteCommandData({env:process.env.TCB_ENV,
    key:process.env.CRM_ASSISTANT_DB_API_KEY}):null);
  const result=await (deps.listActive||data.listActive)(personId,actorUid);
  if(!result||!Array.isArray(result.rows)||result.rows.length>50)fail('UPSTREAM_UNAVAILABLE');
  const testData=await (deps.disclose||disclose)([{table:'persons',id:personId},
    ...refsForRows('recruit_candidates',result.rows)]);
  return {ok:true,status:result.rows.length?'targets_available':'no_candidate',
    person:{id:personId,displayName:selected.displayName},candidates:result.rows,
    hasMore:result.hasMore===true,testData,requiresHumanDecision:true,
    execution:{performed:false,modelCalled:false,businessDataRead:true,businessDataWritten:false}};
}
module.exports={GUIDANCE,validateProposal,explicitSingleCandidate,
  interpretRecruitDelete,listRecruitDeleteTargets};
