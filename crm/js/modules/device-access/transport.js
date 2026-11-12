import {createDeviceClient} from './client.js';
const sessions=new WeakMap();
// Browser-device approval is site-wide. Keep the verified state on the app
// instance; individual page/function failures must not masquerade as enrollment.
const siteAuthorization=new WeakMap();
function denied(code){return ['DEVICE_MEMBER_REQUIRED','DEVICE_NOT_APPROVED','DEVICE_ACCESS_DENIED','DEVICE_STORAGE_UNAVAILABLE','UNAUTHORIZED'].includes(code);}
function requireSetup(code){
  if(denied(code)){document.body.hidden=true;location.replace(new URL('device-access.html',document.baseURI).href);}
  throw Error(code||'DEVICE_CONNECTION_FAILED');
}
function resultError(r){const value=r?.result?.error||r?.error;return typeof value==='string'?value:value?.code||null;}
async function signedCall(app,env,name,data){
  let client=sessions.get(app);
  if(!client){client=createDeviceClient(env,async ({action,...args})=>{
    const r=await app.callFunction({name:'person_360',data:{action:'issueBrowserChallenge',...args}});
    if(r?.error||r?.result?.error)throw Error(resultError(r)||'DEVICE_CONNECTION_FAILED');
    return r?.result;
  });sessions.set(app,client);}
  let signed;
  signed=await client.sign(name,data||{});
  return app.callFunction({name,data:{__deviceRequest:signed}});
}
async function recheckSiteAuthorization(app,env){
  for(let attempt=0;attempt<2;attempt++){
    try{
      const r=await signedCall(app,env,'person_360',{action:'verifyBrowserDevice'});
      if(!resultError(r)&&r?.result?.ok===true){siteAuthorization.set(app,true);return true;}
    }catch{}
  }
  siteAuthorization.set(app,false);return false;
}
export async function deviceCall(app,env,name,data){
  let r;
  try{r=await signedCall(app,env,name,data);}catch(e){
    if(denied(e.message)){
      if(await recheckSiteAuthorization(app,env))throw e;
      return requireSetup(e.message);
    }
    throw e;
  }
  // Activity detail is read-only. A fresh challenge can recover a one-off proof
  // rejection without relaxing authorization or replaying any business write.
  if(name==='activities'&&data?.action==='get'&&resultError(r)==='DEVICE_ACCESS_DENIED'){
    try{r=await signedCall(app,env,name,data);}catch(e){
      if(denied(e.message)){
        if(await recheckSiteAuthorization(app,env))throw e;
        return requireSetup(e.message);
      }
      throw e;
    }
  }
  const code=resultError(r);
  if(denied(code)){
    // The function may reject its own scoped operation even while the browser
    // remains approved. Only the site-wide check decides whether setup is needed.
    if(await recheckSiteAuthorization(app,env)){
      if(name==='activities'&&data?.action==='get'){
        r=await signedCall(app,env,name,data);
        const retryCode=resultError(r);
        if(denied(retryCode))throw Error(retryCode);
      }else throw Error(code);
    }else return requireSetup(code);
  }
  if(name==='person_360'&&data?.action==='verifyBrowserDevice'&&r?.result?.ok===true)siteAuthorization.set(app,true);
  else if(!resultError(r))siteAuthorization.set(app,true);
  return r;
}
export async function verifyDevice(app,env){
 let r;
 try{
  r=await signedCall(app,env,'person_360',{action:'verifyBrowserDevice'});
 }catch(e){
  siteAuthorization.set(app,false);
  if(denied(e.message))return requireSetup(e.message);
  throw e;
 }
 if(!resultError(r)&&r?.result?.ok===true){siteAuthorization.set(app,true);return;}
 const code=resultError(r)||'DEVICE_CONNECTION_FAILED';siteAuthorization.set(app,false);
 return requireSetup(code);
}
export function isSiteDeviceAuthorized(app){return siteAuthorization.get(app)===true;}
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
