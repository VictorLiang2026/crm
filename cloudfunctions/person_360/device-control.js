'use strict';
const {deviceProtocol}=require('./device-proof');
const ALLOWED=new Set('activities activity_reports activity_speakers activity_tasks activity_topics ai_activity ai_followup ai_parse ai_recommend ai_recommendations ai_referral assistant customers followups funnel_insight gifts opportunities ocr_records person_360 photos pmc18_observer policy_review_reports products recruit_candidates recruit_followups recruit_goals recruit_recommend recruit_score today_coach'.split(' '));
// Only the app-side authenticated UID from the CloudBase runtime is accepted.
// Never expose rpc(), inspect, consume, UID overrides or an approval API.
async function serviceRpc(env,body){
 const key=process.env.CRM_PERSON360_DB_API_KEY;
 if(!/^crm-[a-z0-9]+$/.test(env||'')||!key)throw Error('DEVICE_SERVICE_UNAVAILABLE');
 const r=await fetch('https://'+env+'.api.tcloudbasegateway.com/v1/rdb/rest/rpc/crm_device_member_gateway_v1',{
   method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
   headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Content-Profile':'public','Accept-Profile':'public'},
   body:JSON.stringify(body)
 });
 if(r.ok)return {data:await r.json()};
 const err=await r.json().catch(()=>({}));
 console.warn('CRM_DEVICE_GATEWAY_REJECTED',{status:r.status,sqlState:/^[A-Z0-9]{5}$/.test(err.code||'')?err.code:'unknown'});
 return {error:{message:err.message}};
}
function makeControl(app,env,callRpc=body=>serviceRpc(env,body)){
 const protocol=deviceProtocol({env,permitted:ALLOWED,rpc:async(op,uid,fp,args)=>{
 const result=await callRpc({p_op:op,p_uid:uid,p_fingerprint:fp,p_args:args});
 if(result?.error||!result?.data){
 const code=['DEVICE_MEMBER_REQUIRED','DEVICE_NOT_APPROVED','DEVICE_REQUEST_LIMIT','DEVICE_ACCESS_DENIED'].find(x=>result?.error?.message?.includes(x))||'DEVICE_SERVICE_UNAVAILABLE';
 throw Object.assign(Error(code),{code});}
 return result.data;
 }});
 return {protocol,async control(event,identity){
 if(event.action==='requestBrowserDevice')return protocol.enroll(identity,{key:event.key,label:event.label});
 if(event.action==='issueBrowserChallenge')return protocol.issue(identity,{fingerprint:event.fingerprint,audience:event.audience,payloadHash:event.payloadHash});
 throw Error('DEVICE_ACCESS_DENIED');
 }};
}
module.exports={makeControl};
