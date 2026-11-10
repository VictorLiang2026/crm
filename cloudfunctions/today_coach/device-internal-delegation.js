'use strict';

async function unwrap(app,event,context,name){
 if(!event||!Object.hasOwn(event,'__crmDelegation'))return {event,context};
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
