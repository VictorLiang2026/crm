'use strict';
const {createHash,createHmac,timingSafeEqual}=require('node:crypto');
const {projectContent,isCommunicationReference}=require('./knowledge-content');
const manualDigest='8c4085c33f45a030a26ee764cac1349d5f7541bf75166b70094b3cfc2789244b';
const bad=code=>{const e=new Error(code);e.code=code;throw e;};
const fields=['content','entryKey','keywords','kind','origin','title'];
function validManual(entries,hash){
 if(!Array.isArray(entries)||entries.length!==156)return false;
 if(!entries.every(row=>row&&typeof row==='object'&&Object.keys(row).length===fields.length&&fields.every(field=>Object.hasOwn(row,field))))return false;
 return createHash('sha256').update(JSON.stringify(entries,fields)).digest('hex')===hash;
}
const normal=value=>String(value||'').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu,'');
function scoreReference(row,query){
 const q=normal(query);if(!q)return 0;
 const title=normal(row.scenario),keys=row.metadata?.keywords||[];
 let score=title&&(q.includes(title)||title.includes(q))?8:0;
 for(const key of keys){const k=normal(key);if(k&&q.includes(k))score+=4;}
 // CJK bigrams permit everyday paraphrases without treating an unmatched item as a match.
 const terms=[...new Set((q.match(/[\p{Script=Han}]{2,}|[a-z0-9]{3,}/gu)||[]).flatMap(t=>/\p{Script=Han}/u.test(t)?Array.from({length:t.length-1},(_,i)=>t.slice(i,i+2)):[t]))];
 const text=normal(row.scenario+' '+keys.join(' '));
 return score+terms.reduce((n,t)=>n+(text.includes(t)?1:0),0);
}
function createCommunicationReferences({rpc,request,key,check,expectedManualDigest=manualDigest,now=()=>Date.now()}){
 async function call(op,actor,data){
  if(typeof actor!=='string'||!actor.trim())bad('UNAUTHORIZED');
  const r=await rpc('crm_knowledge_maintain_v1',{p_operation:op,p_actor_uid:actor,p_data:data});
  if(r?.error||!r?.data?.ok)bad('KNOWLEDGE_MAINTENANCE_FAILED');return r.data;
 }
 async function all(actor){
  const rows=[];let offset=0;
  for(;;){const r=await call('list',actor,{offset,limit:200});rows.push(...r.rows.slice(0,200));
   if(!r.hasMore)break;if(!Number.isInteger(r.nextOffset)||r.nextOffset<=offset)bad('KNOWLEDGE_COVERAGE_INVALID');offset=r.nextOffset;}
  return rows;
 }
 async function candidates(actor,query){
  const matches=(await all(actor)).filter(isCommunicationReference).filter(row=>!JSON.stringify(row).includes('【系统测试·勿联系】')).map(row=>projectContent(row,'playbooks',null,undefined,true))
   .filter(row=>row&&row.lifecycle_status==='verified').map(row=>({row,score:scoreReference(row,query)}))
   .filter(x=>x.score>=2).sort((a,b)=>b.score-a.score||Number(a.row.id)-Number(b.row.id)).slice(0,3).map(x=>x.row);
  if(!matches.length)return [];
  if(typeof check!=='function')bad('KNOWLEDGE_PROVENANCE_UNAVAILABLE');
  const clean=[];
  for(const row of matches){const disclosure=await check([{schema:'public',table:'playbooks',id:String(row.id)}]);
   if(disclosure?.status!=='verified'||typeof disclosure.containsTestData!=='boolean')bad('KNOWLEDGE_PROVENANCE_UNAVAILABLE');
   if(!disclosure.containsTestData)clean.push(row);}
  return clean;
 }
 function token(actor,stamp){
  const payload=Buffer.from(JSON.stringify({actor,stamp,hash:expectedManualDigest})).toString('base64url');
  return payload+'.'+createHmac('sha256',key).update(payload).digest('base64url');
 }
 function verify(value,actor){
  if(typeof value!=='string'||value.length>2000)bad('KNOWLEDGE_PREVIEW_REQUIRED');
  const [p,signature,...extra]=value.split('.');if(extra.length||!p||!signature)bad('KNOWLEDGE_PREVIEW_REQUIRED');
  const expected=createHmac('sha256',key).update(p).digest('base64url');
  if(Buffer.byteLength(expected)!==Buffer.byteLength(signature)||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))bad('KNOWLEDGE_PREVIEW_REQUIRED');
  let v;try{v=JSON.parse(Buffer.from(p,'base64url'));}catch{bad('KNOWLEDGE_PREVIEW_REQUIRED');}
  if(v.actor!==actor||v.hash!==expectedManualDigest||!Number.isFinite(v.stamp)||v.stamp>now()||now()-v.stamp>600000)bad('KNOWLEDGE_PREVIEW_EXPIRED');
 }
 async function run(op,data,actor){
  if(op==='list')return {ok:true,rows:await all(actor)};
  if(op==='importPreview'||op==='importConfirm'){
   if(typeof actor!=='string'||!actor.trim())bad('UNAUTHORIZED');
   if(!validManual(data?.entries,expectedManualDigest))bad('KNOWLEDGE_MANUAL_MISMATCH');
  }
  if(op==='importPreview'){
   return {ok:true,count:data.entries.length,previewToken:token(actor,now())};
  }
  if(op==='importConfirm'){
   verify(data?.previewToken,actor);
   const existing=new Set((await all(actor)).map(r=>r.metadata?.entryKey));let added=0,skipped=0;
   for(const seed of data.entries){if(existing.has(seed.entryKey)){skipped++;continue;}
    const r=await call('saveReference',actor,{...seed,table:'playbooks'});existing.add(seed.entryKey);if(r.skipped)skipped++;else added++;}
   return {ok:true,added,skipped};
  }
  if(!['saveReference','toggle','history','restore'].includes(op))bad('INVALID_OPERATION');
  return call(op,actor,data);
 }
 async function adviceBasis(adviceId){
  if(!/^[1-9]\d*$/.test(String(adviceId||'')))bad('INVALID_INPUT');
  const rows=await request('person_followup_advice','GET',{select:'id,person_id,system_strategy,system_product_advice,system_version,system_status',
   id:'eq.'+adviceId,deleted_at:'is.null',limit:1});
  const r=rows[0];if(!r||r.system_status!=='ready')bad('ADVICE_NOT_READY');return r;
 }
 return {run,candidates,adviceBasis};
}
module.exports={createCommunicationReferences,scoreReference};
