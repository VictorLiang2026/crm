import {createDeviceClient} from './client.js';
const sessions=new WeakMap();
function denied(code){return ['DEVICE_NOT_APPROVED','DEVICE_ACCESS_DENIED','DEVICE_STORAGE_UNAVAILABLE'].includes(code);}
function requireSetup(code){
  if(denied(code)){document.body.hidden=true;location.replace(new URL('device-access.html',document.baseURI).href);}
  throw Error(code||'DEVICE_CONNECTION_FAILED');
}
export async function deviceCall(app,env,name,data){
  let client=sessions.get(app);
  if(!client){client=createDeviceClient(env,async ({action,...args})=>{
    const r=await app.callFunction({name:'person_360',data:{action:'issueBrowserChallenge',...args}});
    if(r?.error||r?.result?.error)requireSetup(r?.result?.error||'DEVICE_CONNECTION_FAILED');
    return r?.result;
  });sessions.set(app,client);}
  let signed;
  try{signed=await client.sign(name,data||{});}catch(e){if(denied(e.message))requireSetup(e.message);throw e;}
  const r=await app.callFunction({name,data:{__deviceRequest:signed}});
  if(denied(r?.result?.error))requireSetup(r.result.error);
  return r;
}
export async function verifyDevice(app,env){
 const r=await deviceCall(app,env,'person_360',{action:'verifyBrowserDevice'});
 if(r?.result?.ok!==true)throw Error('DEVICE_CONNECTION_FAILED');
}
// Do not restore a snapshot of the workspace from Safari's back/forward cache before checking again.
export function guardResume(isOpen,check){
 let hidden=false,epoch=0;
 const conceal=()=>{if(isOpen()){epoch++;hidden=true;document.documentElement.style.visibility='hidden';}};
 const restore=async()=>{if(!hidden||document.hidden)return;const ticket=++epoch;
   try{await check();if(ticket!==epoch)return;hidden=false;document.documentElement.style.visibility='';}
   catch{if(ticket===epoch)location.replace(new URL('device-access.html',document.baseURI).href);}
 };
 addEventListener('pagehide',conceal);addEventListener('pageshow',restore);
 document.addEventListener('visibilitychange',()=>document.hidden?conceal():restore());
}
