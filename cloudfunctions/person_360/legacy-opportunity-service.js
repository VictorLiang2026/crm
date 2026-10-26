'use strict';

const TYPES=new Set(['医疗保障','重疾保障','养老规划','教育规划','财富规划','家庭保障','转介绍',
  'insurance','recruit','referral','activity','speaker','partnership','service','relationship']);
const STAGES=new Set(['发现','沟通','方案','潜在线索','已介绍','已联系','已建立关系']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function plain(v){return v&&typeof v==='object'&&!Array.isArray(v);}
function exact(v,keys){if(!plain(v)||Object.keys(v).sort().join(',')!==keys.split(',').sort().join(','))throw Error('Invalid legacy Opportunity fields');}
function id(v){if(!/^[1-9][0-9]*$/.test(String(v))||!Number.isSafeInteger(Number(v)))throw Error('Invalid legacy Opportunity identity');return String(v);}
function uuid(v){if(typeof v!=='string'||!UUID.test(v))throw Error('Invalid legacy Opportunity request');return v;}
function text(v,max){if(typeof v!=='string'||v.length>max)throw Error('Invalid legacy Opportunity text');return v.trim();}
function date(v){if(v===null||v==='')return null;
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||
   new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw Error('Invalid legacy Opportunity date');return v;}
function normalize(input){
 exact(input,'idempotencyKey,operation,personId,customerId,opportunityId,draft');
 const result={idempotencyKey:uuid(input.idempotencyKey),operation:input.operation,personId:id(input.personId),
   customerId:id(input.customerId),opportunityId:id(input.opportunityId)};
 if(Number(result.customerId)>2147483647)throw Error('Invalid legacy Opportunity customer');
 const d=input.draft;
 if(input.operation==='edit'){
   exact(d,'type,status,progress,nextAction,nextActionDate,discoveredAt,referredName,referredRelation');
   if(!TYPES.has(d.type)||!STAGES.has(d.status))throw Error('Invalid legacy Opportunity type or stage');
   result.draft={type:d.type,status:d.status,progress:text(d.progress,4000),nextAction:text(d.nextAction,1000),
     nextActionDate:date(d.nextActionDate),discoveredAt:date(d.discoveredAt),
     referredName:text(d.referredName,160),referredRelation:text(d.referredRelation,200)};
 }else if(input.operation==='stage'){
   exact(d,'status');if(!STAGES.has(d.status))throw Error('Invalid legacy Opportunity stage');result.draft={status:d.status};
 }else if(input.operation==='close'){
   exact(d,'status,result,actionId');const note=text(d.result,4000);
   if(!['成交','关闭'].includes(d.status)||!note)throw Error('Invalid legacy Opportunity closing result');
   result.draft={status:d.status,result:note,actionId:d.actionId==null?null:id(d.actionId)};
 }else throw Error('Invalid legacy Opportunity operation');
 return result;
}
class LegacyOpportunityService {
 constructor({rpc}){this.rpc=rpc;}
 call(actor,operation,data){
   if(typeof actor!=='string'||!actor.trim()||actor.length>128)throw Error('UNAUTHORIZED');
   return this.rpc('crm_legacy_opportunity_v1',{p_actor_uid:actor,p_operation:operation,p_data:data});
 }
 preview(input,actor){return this.call(actor,'preview',normalize(input));}
 execute(previewId,actor){return this.call(actor,'execute',{previewId:uuid(previewId)});}
}
function normalizeMaintenance(input){
 exact(input,'idempotencyKey,operation,customerId,opportunityId,draft');
 const result={idempotencyKey:uuid(input.idempotencyKey),operation:input.operation,
   customerId:id(input.customerId),opportunityId:id(input.opportunityId)};
 if(Number(result.customerId)>2147483647)throw Error('Invalid legacy Opportunity customer');
 if(input.operation==='terminal_edit'){
   exact(input.draft,'type,status,progress,nextAction,nextActionDate,discoveredAt,referredName,referredRelation');
   const d=input.draft;
   if(!TYPES.has(d.type)||!['成交','关闭'].includes(d.status))throw Error('Invalid terminal correction');
   result.draft={type:d.type,status:d.status,progress:text(d.progress,4000),
     nextAction:text(d.nextAction,1000),nextActionDate:date(d.nextActionDate),
     discoveredAt:date(d.discoveredAt),referredName:text(d.referredName,160),
     referredRelation:text(d.referredRelation,200)};
 }else if(input.operation==='remove'){
   exact(input.draft,'');result.draft={};
 }else throw Error('Invalid maintenance operation');
 return result;
}
class LegacyOpportunityMaintenanceService {
 constructor({rpc}){this.rpc=rpc;}
 call(actor,phase,data){
   if(typeof actor!=='string'||!actor.trim()||actor.length>128)throw Error('UNAUTHORIZED');
   return this.rpc('crm_legacy_opportunity_maintenance_v1',{
     p_actor_uid:actor,p_phase:phase,p_data:data});
 }
 preview(input,actor){return this.call(actor,'preview',normalizeMaintenance(input));}
 execute(previewId,actor){return this.call(actor,'execute',{previewId:uuid(previewId)});}
}
module.exports={LegacyOpportunityService,LegacyOpportunityMaintenanceService,normalize,normalizeMaintenance};
