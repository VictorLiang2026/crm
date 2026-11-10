'use strict';
const {makeControl}=require('./device-control');
const {canonical,digest}=require('./device-proof');
const denied=()=>{throw Error('DEVICE_ACCESS_DENIED')};
async function lookup(proof,name,hash){
 const env=process.env.TCB_ENV,key=process.env.CRM_PERSON360_DB_API_KEY;
 if(!/^crm-[a-z0-9]+$/.test(env||'')||!key)denied();
 const url=new URL('https://'+env+'.api.tcloudbasegateway.com/v1/rdb/rest/crm_device_challenges');
 for(const [k,v] of Object.entries({select:'uid',id:'eq.'+proof.challenge,fingerprint:'eq.'+proof.fingerprint,audience:'eq.'+name,payload_hash:'eq.'+hash,limit:'1'}))url.searchParams.set(k,v);
 const r=await fetch(url,{headers:{Authorization:'Bearer '+key,'Accept-Profile':'public'},redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!r.ok)denied();const rows=await r.json();return rows?.[0]?.uid;
}
// This endpoint consumes a one-time proof. It cannot enroll, issue a challenge,
// select a target user, return an unused credential, or execute a business handler.
async function verifyOnly(event,app,find=lookup,control=makeControl(app,process.env.TCB_ENV)){
 const {audience,request}=event;
 if(!request||typeof audience!=='string'||audience.length>80)denied();
 const {__deviceProof:proof,...data}=request;
 if(!/^[0-9a-f]{64}$/.test(proof?.fingerprint||'')||!/^[a-f0-9-]{36}$/.test(proof?.challenge||''))denied();
 const actor=await find(proof,audience,digest(canonical(data)));if(typeof actor!=='string'||!actor)denied();
 await control.protocol.authorize({uid:actor},audience,request);
 return {verified:true,actor};
}
module.exports={verifyOnly};
