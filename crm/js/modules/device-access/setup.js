import {t,getLang} from '../console/i18n.js';
import {createDeviceClient} from './client.js';
const ref=id=>document.getElementById(id),status=k=>{ref('status').textContent=t(k);};
document.documentElement.lang=getLang();document.title=t('device_setup_title');
const texts={'title':'device_setup_title','intro':'device_setup_intro','u-label':'kmcp_username','p-label':'kmcp_password','sign':'device_sign_in','name-label':'device_label','request':'device_request'};for(const [id,k] of Object.entries(texts))ref(id).textContent=t(k);
const env='crm-d1gkae8ddc930d151';
async function start(){
 if(!window.isSecureContext||!window.crypto?.subtle||!window.indexedDB)throw Error('DEVICE_STORAGE_UNAVAILABLE');
 const app=window.cloudbase.init({env,timeout:30000}),auth=app.auth({persistence:'local'});
 const client=createDeviceClient(env,async input=>{const {action,...args}=input;
 const res=await app.callFunction({name:'person_360',data:{action:action==='request'?'requestBrowserDevice':'issueBrowserChallenge',...args}});
 if(res?.error||res?.result?.error)throw Error(res?.result?.error||'DEVICE_SERVICE_UNAVAILABLE');return res.result;});
 const show=async()=>{ref('device').hidden=true;ref('login').hidden=false;
 const r=await auth.getSession();const trusted=!r?.error&&Boolean(r?.data?.session)&&r.data.session.user?.is_anonymous!==true;
 ref('login').hidden=trusted;ref('device').hidden=!trusted;return trusted;};
 ref('login').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;ref('sign').disabled=true;
 try{const r=await auth.signInWithPassword({username:form.elements.username.value.trim(),password:form.elements.password.value});if(r?.error)throw Error();form.elements.password.value='';if(!await show())throw Error('LOGIN_FAILED');status('device_ready');}catch{status('device_login_failed');}finally{ref('sign').disabled=false;}};
 ref('request').onclick=async()=>{ref('request').disabled=true;ref('fingerprint').textContent='';status('device_wait');
 try{const result=await client.enroll(ref('label').value.trim());ref('fingerprint').textContent=t('device_fingerprint')+' '+result.fingerprint.toUpperCase().match(/.{1,8}/g).join(' ');
 const states={pending:'device_pending',approved:'device_approved',revoked:'device_revoked'};status(states[result.state]||'device_error');
 }catch(e){status(({DEVICE_REQUEST_LIMIT:'device_limit',DEVICE_MEMBER_REQUIRED:'device_member_required',
   UNAUTHORIZED:'device_session_required',DEVICE_STORAGE_UNAVAILABLE:'device_local_storage',
   DEVICE_ACCESS_DENIED:'device_proof_rejected',DEVICE_NOT_APPROVED:'device_proof_rejected'})[e.message]||'device_service_unavailable');}finally{ref('request').disabled=false;}};
 await show();
}
start().catch(e=>status(e?.message==='DEVICE_STORAGE_UNAVAILABLE'?'device_local_storage':'device_service_unavailable'));
