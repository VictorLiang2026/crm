'use strict';

async function unwrap(app,event,context,name){
 if (!event || (Object.hasOwn(event,'__deviceRequest') && Object.hasOwn(event,'__crmDelegation'))) throw Error('DEVICE_ACCESS_DENIED');
 if (!Object.hasOwn(event,'__crmDelegation')) {
   const request=event.__deviceRequest;
   if (!request || !request.__deviceProof) throw Error('DEVICE_ACCESS_DENIED');
   const who=app.auth().getUserInfo();
   if (typeof who?.uid!=='string' || !who.uid.trim() || who.isAnonymous===true || who.is_anonymous===true) throw Error('DEVICE_ACCESS_DENIED');
   const response=await app.callFunction({name:'person_360',data:{action:'verifyBusinessDeviceOnly',audience:name,request}});
   if (response?.result?.verified!==true || response.result.actor!==who.uid) throw Error('DEVICE_ACCESS_DENIED');
   const {__deviceProof,...payload}=request;
   const {__crmInternalDelegation,...platform}=context||{};
   return {event:payload,context:platform};
 }
 const ticket=event.__crmDelegation;
 if(Object.keys(event).length!==1||!ticket||Object.keys(ticket).sort().join(',')!=='payload,token'||
   typeof ticket.token!=='string'||!/^[a-f0-9-]{36}$/.test(ticket.token)||
   !ticket.payload||typeof ticket.payload!=='object'||Array.isArray(ticket.payload))throw Error('DEVICE_ACCESS_DENIED');
 const response=await app.callFunction({name:'person_360',data:{action:'consumeInternalDelegation',
   audience:name,token:ticket.token,payload:ticket.payload}});
 const verified=response?.result;
 if(verified?.verified!==true||verified.actor==null||verified.origin!=='browser'||
   !verified.payload||verified.payload.action!=='daily_review'||verified.payload.view!=='morning')throw Error('DEVICE_ACCESS_DENIED');
 return {event:verified.payload,context:{...(context||{}),__crmInternalDelegation:{actor:verified.actor,origin:verified.origin,audience:name}}};
}

module.exports={unwrap};
