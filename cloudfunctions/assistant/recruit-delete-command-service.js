/** PC28: one target, strict Command -> Plan -> Preview -> Confirm -> Execute. */
'use strict';
const {createSearchData}=require('./search-data');
const {createRecruitDeleteCommandData}=require('./recruit-delete-command-data');
const {explicitSingleCandidate}=require('./recruit-delete-intent-service');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH=/^[0-9a-f]{32}$/i;
const ID=/^[1-9][0-9]{0,18}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
  (Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
function fail(){const error=new Error('Recruit delete command is invalid');error.code='INVALID_COMMAND';throw error;}
function positiveId(value){if(!ID.test(String(value??''))||!Number.isSafeInteger(Number(value)))fail();return Number(value);}
function commandOf(value){
  if(!plain(value)||Object.keys(value).some(key=>
      !['resource','operation','personId','candidateId','personMention','requestText'].includes(key))||
     value.resource!=='recruit_candidates'||value.operation!=='delete'||
     typeof value.personMention!=='string'||!value.personMention.trim()||
     value.personMention.trim().length>120||typeof value.requestText!=='string'||
     !value.requestText.trim()||value.requestText.trim().length>1200||
     !explicitSingleCandidate(value.requestText.trim()))fail();
  return {personId:positiveId(value.personId),candidateId:positiveId(value.candidateId),
    personMention:value.personMention.trim(),requestText:value.requestText.trim()};
}
async function runRecruitDeleteCommand(event,actorUid,deps={}){
  if(typeof actorUid!=='string'||!actorUid.trim()||!plain(event)||
     event.action!=='recruitDeleteCommand'||!['plan','preview','confirm','execute'].includes(event.stage))fail();
  const stage=event.stage;let args;
  if(stage==='plan'){
    if(Object.keys(event).some(key=>!['action','stage','command','idempotencyKey'].includes(key))||
       !UUID.test(String(event.idempotencyKey||'')))fail();
    args={...commandOf(event.command),idempotencyKey:event.idempotencyKey};
    const search=deps.searchData||(!deps.resolveName?createSearchData({env:process.env.TCB_ENV,
      key:process.env.CRM_ASSISTANT_DB_API_KEY}):null);
    const resolution=await (deps.resolveName||search.resolveName)(args.personMention);
    if(resolution?.hasMore===true||!Array.isArray(resolution?.candidates)||
       !resolution.candidates.some(row=>String(row.id)===String(args.personId)))fail();
  }else{
    if(Object.keys(event).some(key=>!['action','stage','commandId','previewHash'].includes(key))||
       !UUID.test(String(event.commandId||'')))fail();
    if(stage==='confirm'){if(!HASH.test(String(event.previewHash||'')))fail();}
    else if(event.previewHash!==undefined)fail();
    args={commandId:event.commandId,previewHash:stage==='confirm'?event.previewHash:null};
  }
  const data=deps.data||createRecruitDeleteCommandData({env:process.env.TCB_ENV,
    key:process.env.CRM_ASSISTANT_DB_API_KEY});
  const result=await data.run(stage,actorUid,args);
  return {...result,execution:{performed:stage==='execute'&&result.replayed!==true,
    modelCalled:false,businessDataRead:stage!=='plan',
    businessDataWritten:stage==='execute'&&result.replayed!==true}};
}
module.exports={commandOf,runRecruitDeleteCommand};
