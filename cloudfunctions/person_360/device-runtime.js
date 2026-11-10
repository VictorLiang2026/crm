'use strict';
// Only the deployed entry point opens a scope. Incoming event fields never establish one.
const {AsyncLocalStorage}=require('node:async_hooks');
const crypto=require('node:crypto');
const {canonical,digest,identity}=require('./device-proof');
const {makeControl}=require('./device-control');
const scope=new AsyncLocalStorage();
const deny=()=>Object.assign(Error('DEVICE_ACCESS_DENIED'),{code:'DEVICE_ACCESS_DENIED'});
const fail=()=>({ok:false,error:'DEVICE_ACCESS_DENIED'});
const internalRoutes={
 activities:{person_360:['listActivityData']},activity_reports:{recruit_goals:['getProgress']},
 ai_followup:{person_360:['listInteractions']},ai_recommend:{person_360:['listInteractions']},ai_referral:{person_360:['listInteractions']},
 assistant:{person_360:['getMeetingPrepContext','listRecruitContext','getRecruitCoachContext','extractKnowledgePdfText'],ai_parse:['ocr_knowledge_source'],today_coach:['daily_review']},
 person_360:{ai_parse:['parse_import_draft']}
};
function permitted(s,name,action){
 if(!internalRoutes[s.name]?.[name]?.includes(action))return false;
 if(s.origin==='mcp')return name==='person_360'&&['getMeetingPrepContext','listRecruitContext'].includes(action);
 if(s.origin==='worker')return name==='ai_parse'&&action==='ocr_knowledge_source';
 return s.origin==='browser';
}
async function delegate(app,op,args){
 const env=process.env.TCB_ENV,key=process.env.CRM_PERSON360_DB_API_KEY;
 if(!/^crm-[a-z0-9]+$/.test(env||'')||!key)throw deny();
 let r;
 try{
  r=await fetch('https://'+env+'.api.tcloudbasegateway.com/v1/rdb/rest/rpc/crm_device_delegate_v1',{
   method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),
   headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Content-Profile':'public','Accept-Profile':'public'},
   body:JSON.stringify({p_op:op,p_args:args})
  });
  if(!r.ok)throw deny();
  const data=await r.json();if(!data||typeof data!=='object')throw deny();return data;
 }catch{throw deny();}
}
function verifiedDeviceAttestation(value){
 const key=process.env.CRM_PERSON360_DB_API_KEY;
 if(typeof key!=='string'||!key||typeof value!=='string')throw deny();
 const parts=value.split('.');if(parts.length!==2||!/^[A-Za-z0-9_-]+$/.test(parts[0])||!/^[A-Za-z0-9_-]+$/.test(parts[1]))throw deny();
 let claims,body;
 try{body=Buffer.from(parts[0],'base64url').toString('utf8');claims=JSON.parse(body);}catch{throw deny();}
 if(canonical(claims)!==body)throw deny();
 const expected=crypto.createHmac('sha256',key).update(parts[0]).digest();let actual;
 try{actual=Buffer.from(parts[1],'base64url');}catch{throw deny();}
 if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected)||claims?.v!==1||!['activities','activity_reports','assistant','ai_followup','ai_recommend','ai_referral'].includes(claims?.source)||claims?.origin!=='browser'||
   typeof claims.actor!=='string'||!claims.actor.trim()||claims.actor.length>120||!/^([0-9a-f]{64})$/.test(claims.fingerprint||'')||
   !Number.isSafeInteger(claims.expiresAt)||claims.expiresAt<Date.now()||claims.expiresAt>Date.now()+30000)throw deny();
 return claims;
}
function validRecruitGoalPayload(payload){
 return Boolean(payload&&typeof payload==='object'&&!Array.isArray(payload)&&Object.keys(payload).sort().join(',')==='action,endMonth,startMonth'&&
  payload.action==='getProgress'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(payload.startMonth||'')&&/^\d{4}-(0[1-9]|1[0-2])$/.test(payload.endMonth||'')&&
  payload.startMonth<=payload.endMonth&&(Number(payload.endMonth.slice(0,4))*12+Number(payload.endMonth.slice(5))-Number(payload.startMonth.slice(0,4))*12-Number(payload.startMonth.slice(5)))<=12);
}
function exactKeys(payload,keys){return Boolean(payload&&typeof payload==='object'&&!Array.isArray(payload)&&Object.keys(payload).sort().join(',')===keys.slice().sort().join(','));}
function positiveId(value){return /^[1-9]\d{0,14}$/.test(String(value||''));}
function assistantPayloadAllowed(payload,audience,actor){
 if(audience==='person_360'){
  if(payload.action==='getMeetingPrepContext')return (exactKeys(payload,['action','personId'])||exactKeys(payload,['action','personId','objection','scenario']))&&
   positiveId(payload.personId)&&String(payload.objection||'').length<=1000&&String(payload.scenario||'').length<=256;
  if(payload.action==='listRecruitContext')return exactKeys(payload,['action','personId'])&&positiveId(payload.personId);
  if(payload.action==='getRecruitCoachContext')return (exactKeys(payload,['action','personId'])||exactKeys(payload,['action','candidateId'])||
   exactKeys(payload,['action','personId','candidateId']))&&
   (payload.personId==null||positiveId(payload.personId))&&(payload.candidateId==null||positiveId(payload.candidateId));
  if(payload.action==='extractKnowledgePdfText')return exactKeys(payload,['action','actorUid','sourceId'])&&
   positiveId(payload.sourceId)&&payload.actorUid===actor;
 }
 if(audience==='ai_parse'&&payload.action==='ocr_knowledge_source'){
  if(exactKeys(payload,['action','sourceId','uploadId']))return positiveId(payload.sourceId)&&
   /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(payload.uploadId||''));
  if(exactKeys(payload,['action','fileName','contentType','base64']))return typeof payload.fileName==='string'&&payload.fileName.length<=255&&
   ['image/png','image/jpeg','image/webp'].includes(payload.contentType)&&typeof payload.base64==='string'&&payload.base64.length<=8*1024*1024;
  if(exactKeys(payload,['action','images']))return Array.isArray(payload.images)&&payload.images.length>0&&payload.images.length<=3&&payload.images.every(image=>
   exactKeys(image,['fileName','contentType','base64'])&&typeof image.fileName==='string'&&image.fileName.length<=255&&
   ['image/png','image/jpeg','image/webp'].includes(image.contentType)&&typeof image.base64==='string'&&image.base64.length<=1024*1024);
 }
 if(audience==='today_coach')return (exactKeys(payload,['action','view'])||exactKeys(payload,['action','view','guidance']))&&
   payload.action==='daily_review'&&payload.view==='morning'&&(payload.guidance===undefined||payload.guidance==='rules');
 return false;
}
function audienceForInternalPayload(source,payload){
 if(['ai_followup','ai_recommend','ai_referral'].includes(source)&&payload?.action==='listInteractions')return 'person_360';
 if(source==='assistant'){
  if(['getMeetingPrepContext','listRecruitContext','getRecruitCoachContext','extractKnowledgePdfText'].includes(payload?.action))return 'person_360';
  if(payload?.action==='ocr_knowledge_source')return 'ai_parse';
  if(payload?.action==='daily_review')return 'today_coach';
 }
 return null;
}
function internalPayloadAllowed(source,audience,payload,actor){
 if(['ai_followup','ai_recommend','ai_referral'].includes(source))return audience==='person_360'&&exactKeys(payload,['action','personId','limit'])&&
  payload.action==='listInteractions'&&positiveId(payload.personId)&&Number.isInteger(payload.limit)&&payload.limit>=1&&payload.limit<=50;
 return source==='assistant'&&assistantPayloadAllowed(payload,audience,actor);
}
async function issueInternalDelegation(app,event){
 if(!event||Object.keys(event).sort().join(',')!=='action,attestation,payload')throw deny();
 const attestation=verifiedDeviceAttestation(event.attestation),payload=event.payload;
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(k=>['__crmDelegation','__deviceRequest','__proto__','constructor','prototype'].includes(k)))throw deny();
 let audience;
 if(attestation.source==='activities'&&Object.keys(payload).sort().join(',')==='action,activityId'&&/^\d{1,20}$/.test(String(payload.activityId))&&
   permitted({name:'activities',origin:'browser'},'person_360',payload.action)) audience='person_360';
 else if(attestation.source==='activity_reports'&&validRecruitGoalPayload(payload)&&
   permitted({name:'activity_reports',origin:'browser'},'recruit_goals',payload.action)) audience='recruit_goals';
 else if(['assistant','ai_followup','ai_recommend','ai_referral'].includes(attestation.source)){
   audience=audienceForInternalPayload(attestation.source,payload);
   if(!audience||!internalPayloadAllowed(attestation.source,audience,payload,attestation.actor)||
      !permitted({name:attestation.source,origin:'browser'},audience,payload.action))throw deny();
 }else throw deny();
 const normalized=JSON.parse(JSON.stringify(payload));
 const result=await delegate(app,'issue',{audience,payload_hash:digest(canonical(normalized)),actor:attestation.actor,origin:'browser',fingerprint:attestation.fingerprint});
 if(typeof result?.token!=='string')throw deny();return {token:result.token};
}
async function consumeInternalDelegation(app,event){
 if(!event||Object.keys(event).sort().join(',')!=='action,audience,payload,token'||!/^[a-f0-9-]{36}$/.test(event.token||''))throw deny();
 const input=event.payload;
 const importDraft=event.audience==='ai_parse' && input?.action==='parse_import_draft' && (
   (exactKeys(input,['action','text']) && typeof input.text==='string' && input.text.length>0 && input.text.length<=100000) ||
   (exactKeys(input,['action','images']) && Array.isArray(input.images) && input.images.length===1 &&
    exactKeys(input.images[0],['base64','content_type','file_name']) &&
    ['image/jpeg','image/png','image/webp'].includes(input.images[0].content_type) &&
    typeof input.images[0].file_name==='string' && typeof input.images[0].base64==='string' &&
    input.images[0].base64.length<=4*Math.ceil(4*1024*1024/3))
 );
 const source=event.audience==='recruit_goals'?'activity_reports':event.audience==='person_360'&&event.payload?.action==='listActivityData'?'activities':
   event.audience==='person_360'&&event.payload?.action==='listInteractions'?'ai_followup':
   ['person_360','ai_parse','today_coach'].includes(event.audience)?'assistant':null;
 const valid=event.audience==='recruit_goals'?validRecruitGoalPayload(event.payload):
   (source==='activities'&&exactKeys(event.payload,['action','activityId'])&&/^\d{1,20}$/.test(String(event.payload.activityId||'')))||
   importDraft || Boolean(source&&internalPayloadAllowed(source,event.audience,event.payload,
     event.payload?.action==='extractKnowledgePdfText'?event.payload.actorUid:undefined));
 if(!valid)throw deny();
 const payload=JSON.parse(JSON.stringify(event.payload));
 const result=await delegate(app,'consume',{audience:event.audience,payload_hash:digest(canonical(payload)),token:event.token});
 if(typeof result?.actor!=='string'||!result.actor||!['browser','mcp','worker'].includes(result.origin)||(importDraft&&result.origin!=='browser')||
   (result.origin==='browser'&&!/^([0-9a-f]{64})$/.test(result.fingerprint||''))||
   (event.payload?.action==='extractKnowledgePdfText'&&event.payload.actorUid!==result.actor))throw deny();
 return {verified:true,actor:result.actor,origin:result.origin,fingerprint:result.fingerprint,payload};
}
async function internalCall(app,request){
 const s=scope.getStore();if(!s||!permitted(s,request.name,request.data?.action))throw deny();
 const payload=JSON.parse(JSON.stringify(request.data)),args={audience:request.name,payload_hash:digest(canonical(payload)),actor:s.actor,origin:s.origin,fingerprint:s.fingerprint||null};
 const {token}=await delegate(app,'issue',args);if(!token)throw deny();
 return app.callFunction({...request,data:{__crmDelegation:{token,payload}}});
}
function scopedApp(app){return new Proxy(app,{get(target,k){if(k==='callFunction')return req=>internalCall(target,req);const v=Reflect.get(target,k,target);return typeof v==='function'?v.bind(target):v;}});}
function callerIdentity(app){const s=scope.getStore();return s?{uid:s.actor,isAnonymous:false}:app.auth().getUserInfo();}
function authenticatedWorker(e,secret){return typeof secret==='string'&&secret.length>=32&&e?.Type==='Timer'&&e.Message===secret;}
async function dispatch(name,main,event,ctx,callback,app){
 if(name==='person_360'&&event?.action==='verifyBusinessDeviceOnly'){
   return require('./device-verifier').verifyOnly(event,app);
 }
 if(name==='person_360'&&event?.action==='issueInternalDelegation'){
   return issueInternalDelegation(app,event);
 }
 if(name==='person_360'&&event?.action==='consumeInternalDelegation'){
   return consumeInternalDelegation(app,event);
 }
 if(name==='person_360'&&event?.__crmDelegation&&!event?.__deviceRequest){
   const ticket=event.__crmDelegation;
   if(!ticket||Object.keys(ticket).sort().join(',')!=='payload,token'||typeof ticket.token!=='string'||
      !ticket.payload||typeof ticket.payload!=='object'||Array.isArray(ticket.payload))throw deny();
   const verified=await consumeInternalDelegation(app,{action:'consumeInternalDelegation',audience:'person_360',
     token:ticket.token,payload:ticket.payload});
   return scope.run({name,origin:verified.origin,actor:verified.actor,fingerprint:verified.fingerprint},
     ()=>main(verified.payload,ctx,callback));
 }
 if(name==='person_360'&&['requestBrowserDevice','issueBrowserChallenge'].includes(event?.action)){
   const info=app.auth().getUserInfo();identity(info);
   try{return await makeControl(app,process.env.TCB_ENV).control(event,info);}
   catch(e){return {error:['DEVICE_MEMBER_REQUIRED','DEVICE_REQUEST_LIMIT','DEVICE_ACCESS_DENIED','DEVICE_NOT_APPROVED'].includes(e?.message)?e.message:'DEVICE_SERVICE_UNAVAILABLE'};}
 }
 // Machine entrances are narrow and never dispatch arbitrary business actions.
 if(name==='assistant'&&event?.action==='knowledgeMcpInternal'){
   const {assertion,input}=event;
   if(require('./knowledge-mcp-auth').assertionFailure(assertion,process.env.CRM_KNOWLEDGE_MCP_HMAC_KEY,input))throw deny();
   return scope.run({name,origin:'mcp',actor:assertion.actorUid},()=>main({action:'knowledgeMcpInternal',assertion,input},ctx,callback));
 }
 if(name==='assistant'&&event?.TriggerName==='knowledgeOcrWorker'&&authenticatedWorker(event,process.env.KNOWLEDGE_OCR_TRIGGER_SECRET))
   return scope.run({name,origin:'worker',actor:'knowledge-ocr-worker'},()=>main({Type:'Timer',TriggerName:'knowledgeOcrWorker',Message:event.Message},ctx,callback));
 if(name==='pmc18_observer'&&event?.TriggerName==='pmc18_daily_0200'&&authenticatedWorker(event,process.env.CRM_OBSERVER_TRIGGER_SECRET))
   return main({action:'collect'},ctx,callback);
 let s,data;
 if(event?.__crmDelegation&&!event.__deviceRequest){
   const ticket=event.__crmDelegation,{token}=ticket;
   let payload=ticket.payload;
   if(Array.isArray(ticket.keys)){
     const keys=ticket.keys;
     if(payload||keys.length>40||keys.some(k=>typeof k!=='string'||!Object.hasOwn(event,k)||['__deviceRequest','__crmDelegation','__proto__','constructor','prototype'].includes(k))||new Set(keys).size!==keys.length)throw deny();
     payload=Object.fromEntries(keys.map(k=>[k,event[k]]));
   }
   if(!payload||typeof token!=='string')throw deny();
   const verified=await delegate(app,'consume',{token,audience:name,payload_hash:digest(canonical(payload))});
   s={...verified,name};data=payload;
 }else{
   const request=event?.__deviceRequest;
   if(!request||event?.__crmDelegation)throw deny();
   const info=app.auth().getUserInfo();
   const actor=identity(info);
   if(name==='person_360'){
     data=await makeControl(app,process.env.TCB_ENV).protocol.authorize(info,name,request);
   }else{
     const result=await app.callFunction({name:'person_360',data:{action:'verifyBusinessDeviceOnly',audience:name,request}});
     if(result?.result?.verified!==true||result.result.actor!==actor)throw deny();
     const {__deviceProof,...fields}=request;data=fields;
   }
   s={name,origin:'browser',actor,fingerprint:request.__deviceProof.fingerprint};
 }
 if(!s.actor||!data||data.Type==='Timer'||['knowledgeMcpInternal','requestBrowserDevice','issueBrowserChallenge','verifyBusinessDeviceOnly','consumeInternalDelegation'].includes(data.action))throw deny();
 if (name === 'assistant' && data.action === 'knowledgeMcpAuthorize') {
   const owner = process.env.CRM_KNOWLEDGE_MCP_OWNER_UID || require('./device-oauth-owner.json')[process.env.TCB_ENV];
   if (s.origin !== 'browser' || !owner || s.actor !== owner) throw deny();
 }
 return scope.run(s,()=>{
   if (name === 'person_360' && data.action === 'verifyBrowserDevice' && s.origin === 'browser') {
     console.info('CRM_DEVICE_PILOT_SIGNATURE_VERIFIED');
     return {ok:true, deviceSignatureVerified:true};
   }
   if(name==='person_360'&&data.action==='deviceAttachment')return require('./device-attachment').handle(data,s).catch(e=>({error:['DEVICE_ACCESS_DENIED','INVALID_ATTACHMENT','STORAGE_RANGE_UNAVAILABLE'].includes(e?.code)?e.code:'STORAGE_FAILED'}));
   return main(data,ctx,callback);
 });
}
function protect(name,main,resolveApp=()=>require('./db').app){
 return function(event,ctx,callback){
   // The assistant's long jobs use the SCF callback, with work continuing after early acknowledgement.
   const cb=name==='assistant'&&typeof callback==='function'?callback:null;
   const work=Promise.resolve().then(()=>dispatch(name,main,event,ctx,cb||undefined,resolveApp())).catch(()=>fail());
   if(!cb)return work;
   work.then(result=>{if(result!==undefined)cb(null,result);});return undefined;
 };
}
module.exports={protect,scopedApp,callerIdentity,internalCall,permitted,verifiedDeviceAttestation,issueInternalDelegation};
