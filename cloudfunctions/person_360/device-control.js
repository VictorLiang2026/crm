'use strict';
const {deviceProtocol}=require('./device-proof');
const ALLOWED=new Set('activities activity_reports activity_speakers activity_tasks activity_topics ai_activity ai_followup ai_parse ai_recommend ai_recommendations ai_referral assistant customers followups funnel_insight gifts opportunities ocr_records person_360 photos pmc18_observer policy_review_reports products recruit_candidates recruit_followups recruit_goals recruit_recommend recruit_score today_coach activity_registration'.split(' '));
// Only the app-side authenticated UID from the CloudBase runtime is accepted.
// Never expose rpc(), inspect, consume, UID overrides or an approval API.
function makeControl(app,env){
 const protocol=deviceProtocol({env,permitted:ALLOWED,rpc:async(op,uid,fp,args)=>{
 const result=await app.rdb().rpc('crm_device_gateway_v1',{p_op:op,p_uid:uid,p_fingerprint:fp,p_args:args});
 if(result?.error||!result?.data){
 const code=['DEVICE_NOT_APPROVED','DEVICE_REQUEST_LIMIT','DEVICE_ACCESS_DENIED'].find(x=>result?.error?.message?.includes(x))||'DEVICE_ACCESS_DENIED';
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
