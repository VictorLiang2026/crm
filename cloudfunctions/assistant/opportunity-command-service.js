/** Strict validation and stage routing for one Assistant Opportunity update/close. */
'use strict';
const {createOpportunityCommandData}=require('./opportunity-command-data');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH=/^[0-9a-f]{32}$/i;
const ID=/^[1-9][0-9]{0,18}$/;
const TYPES=new Set(['insurance','recruit','referral','activity','speaker','partnership','service','relationship']);
const STATUSES=new Set(['发现','沟通','方案','潜在线索','已介绍','已联系','已建立关系']);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
  (Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
function fail(code){const error=new Error('Opportunity command is invalid');error.code=code;throw error;}
function positiveId(value){if(!ID.test(String(value??''))||!Number.isSafeInteger(Number(value)))fail('INVALID_COMMAND');return Number(value);}
function draft(operation,value){
  if(!plain(value))fail('INVALID_COMMAND');const keys=Object.keys(value);
  if(operation==='edit'){
    const allowed=new Set(['type','progress','nextAction','nextActionDate']);
    if(!keys.length||keys.some(key=>!allowed.has(key)))fail('INVALID_COMMAND');
    const out={};
    if(Object.hasOwn(value,'type')){if(typeof value.type!=='string'||!TYPES.has(value.type))fail('INVALID_COMMAND');out.type=value.type;}
    for(const key of ['progress','nextAction'])if(Object.hasOwn(value,key)){
      const max=key==='progress'?4000:1000;
      if(typeof value[key]!=='string'||value[key].length>max)fail('INVALID_COMMAND');out[key]=value[key].trim();
    }
    if(Object.hasOwn(value,'nextActionDate')){
      if(value.nextActionDate!==null&&(typeof value.nextActionDate!=='string'||
        !/^\d{4}-\d{2}-\d{2}$/.test(value.nextActionDate)||!Number.isFinite(Date.parse(`${value.nextActionDate}T00:00:00Z`))))fail('INVALID_COMMAND');
      out.nextActionDate=value.nextActionDate;
    }
    return out;
  }
  if(operation==='stage'){
    if(keys.length!==1||keys[0]!=='status'||typeof value.status!=='string'||!STATUSES.has(value.status))fail('INVALID_COMMAND');
    return {status:value.status};
  }
  if(operation==='close'){
    if(keys.length!==2||keys.some(key=>!['status','result'].includes(key))||
      !['成交','关闭'].includes(value.status)||typeof value.result!=='string'||
      !value.result.trim()||value.result.trim().length>4000)fail('INVALID_COMMAND');
    return {status:value.status,result:value.result.trim()};
  }
  fail('INVALID_COMMAND');
}
function commandOf(value){
  if(!plain(value)||Object.keys(value).some(key=>!['operation','resource','personId','opportunityId','changes'].includes(key))||
    value.resource!=='opportunities'||!['edit','stage','close'].includes(value.operation))fail('INVALID_COMMAND');
  return {operation:value.operation,personId:positiveId(value.personId),opportunityId:positiveId(value.opportunityId),
    draft:draft(value.operation,value.changes)};
}
async function runOpportunityCommand(event,actorUid,deps={}){
  if(typeof actorUid!=='string'||!actorUid.trim()||!plain(event)||event.action!=='opportunityCommand'||
    !['plan','preview','confirm','execute'].includes(event.stage))fail('INVALID_COMMAND');
  const stage=event.stage;let args;
  if(stage==='plan'){
    if(Object.keys(event).some(key=>!['action','stage','command','idempotencyKey'].includes(key))||!UUID.test(String(event.idempotencyKey||'')))fail('INVALID_COMMAND');
    args={...commandOf(event.command),idempotencyKey:event.idempotencyKey};
  }else{
    if(Object.keys(event).some(key=>!['action','stage','commandId','previewHash'].includes(key))||!UUID.test(String(event.commandId||'')))fail('INVALID_COMMAND');
    if(stage==='confirm'){if(!HASH.test(String(event.previewHash||'')))fail('INVALID_COMMAND');}
    else if(event.previewHash!==undefined)fail('INVALID_COMMAND');
    args={commandId:event.commandId,previewHash:stage==='confirm'?event.previewHash:null};
  }
  const data=deps.data||createOpportunityCommandData({env:process.env.TCB_ENV,key:process.env.CRM_ASSISTANT_DB_API_KEY});
  const result=await data.run(stage,actorUid,args);
  return {...result,execution:{performed:stage==='execute'&&result.replayed!==true,
    modelCalled:false,businessDataRead:stage!=='plan',businessDataWritten:stage==='execute'&&result.replayed!==true}};
}
module.exports={draft,commandOf,runOpportunityCommand};
