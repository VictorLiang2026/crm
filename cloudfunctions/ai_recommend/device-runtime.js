'use strict';
// Only the deployed entry point opens a scope. Incoming event fields never establish one.
const {AsyncLocalStorage}=require('node:async_hooks');
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
async function internalCall(app,request){
 const s=scope.getStore();if(!s||!permitted(s,request.name,request.data?.action))throw deny();
 const payload=JSON.parse(JSON.stringify(request.data)),args={audience:request.name,payload_hash:digest(canonical(payload)),actor:s.actor,origin:s.origin,fingerprint:s.fingerprint||null};
 if(s.origin!=='browser'||!s.attestation||s.name!=='ai_recommend')throw deny();
 const issued=await app.callFunction({name:'person_360',data:{action:'issueInternalDelegation',attestation:s.attestation,payload}});
 const token=issued?.result?.token;
 if(typeof token!=='string'||!/^[a-f0-9-]{36}$/.test(token))throw deny();
 return app.callFunction({...request,data:{__crmDelegation:{token,payload}}});
}
function scopedApp(app){return new Proxy(app,{get(target,k){if(k==='callFunction')return req=>internalCall(target,req);const v=Reflect.get(target,k,target);return typeof v==='function'?v.bind(target):v;}});}
function callerIdentity(app){const s=scope.getStore();return s?{uid:s.actor,isAnonymous:false}:app.auth().getUserInfo();}
function authenticatedWorker(e,secret){return typeof secret==='string'&&secret.length>=32&&e?.Type==='Timer'&&e.Message===secret;}
async function dispatch(name,main,event,ctx,callback,app){
 if(name==='person_360'&&event?.action==='verifyBusinessDeviceOnly'){
   return require('./device-verifier').verifyOnly(event,app);
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
   let attestation;
   if(name==='person_360'){
     data=await makeControl(app,process.env.TCB_ENV).protocol.authorize(info,name,request);
   }else{
     const result=await app.callFunction({name:'person_360',data:{action:'verifyBusinessDeviceOnly',audience:name,request}});
     if(result?.result?.verified!==true||result.result.actor!==actor)throw deny();
     const {__deviceProof,...fields}=request;data=fields;
     attestation=result.result.attestation;
   }
   s={name,origin:'browser',actor,fingerprint:request.__deviceProof.fingerprint,
     ...(attestation?{attestation}:{})};
 }
 if(!s.actor||!data||data.Type==='Timer'||['knowledgeMcpInternal','requestBrowserDevice','issueBrowserChallenge','verifyBusinessDeviceOnly'].includes(data.action))throw deny();
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
module.exports={protect,scopedApp,callerIdentity,internalCall,permitted};
