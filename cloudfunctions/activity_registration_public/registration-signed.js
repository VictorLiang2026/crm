'use strict';
const crypto = require('node:crypto');
const allowedErrors = new Set(['PAGE_UNAVAILABLE','INVALID_PAGE','INVALID_ACTIVITY','ACTIVITY_NOT_FOUND','INVALID_MANAGEMENT_LINK','REGISTRATION_NOT_FOUND','REGISTRATION_LOCKED','REGISTRATION_FULL','ALREADY_REGISTERED','FORM_INVALID','FORM_REQUIRED','CONTACT_REQUIRED','APPROVAL_REQUIRED','PERSON_ALREADY_LINKED_TO_EVENT','PERSON_NOT_FOUND','INVALID_REVIEW','STAFF_ACCESS_DENIED','REQUEST_CONFLICT','PAGE_NOT_FOUND','DUPLICATE_PAGE']);
function derive(key,label) {
  return crypto.createHmac('sha256',key).update(label).digest();
}
function decryptResult(key,scope,nonce,reply) {
  const {iv,ciphertext,mac}=reply||{};
  if (![iv,ciphertext,mac].every(s=>typeof s==='string' && /^[0-9a-f]+$/.test(s)) || mac.length!==64 || iv.length!==32) throw Error('REGISTRATION_DATABASE_UNAVAILABLE');
  const expected=crypto.createHmac('sha256',derive(key,'response-mac')).update([scope,nonce,iv,ciphertext].join('.')).digest();
  if (!crypto.timingSafeEqual(expected,Buffer.from(mac,'hex'))) throw Error('REGISTRATION_DATABASE_UNAVAILABLE');
  const cipher=crypto.createDecipheriv('aes-256-cbc',derive(key,'response-enc'),Buffer.from(iv,'hex'));
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(ciphertext,'hex')),cipher.final()]).toString('utf8'));
}
function makeEnvelope(env,scope,key,payload) {
  const nonce=crypto.randomUUID(), issued=Math.floor(Date.now()/1000);
  const iv=crypto.randomBytes(16),cipher=crypto.createCipheriv('aes-256-cbc',derive(key,'request-enc'),iv);
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(payload),'utf8'),cipher.final()]).toString('hex');
  const envelope=JSON.stringify({v:1,aud:env,scope,nonce,issued,iv:iv.toString('hex'),ciphertext});
  const mac=crypto.createHmac('sha256',derive(key,'request-mac')).update(envelope).digest('hex');
  return {nonce,envelope,mac};
}
async function signedCall(scope,payload,config=process.env) {
  const keyText=config.CRM_REGISTRATION_SIGNING_KEY;
  if (!/^[0-9a-f]{64}$/.test(keyText||'') || config.CRM_REGISTRATION_SCOPE!==scope || !/^crm-[a-z0-9]+$/.test(config.TCB_ENV||'') || !config.CRM_REGISTRATION_PUBLISHABLE_KEY) throw Error('REGISTRATION_DATABASE_UNAVAILABLE');
  const key=Buffer.from(keyText,'hex'),call=makeEnvelope(config.TCB_ENV,scope,key,payload);
  const url='https://'+config.TCB_ENV+'.api.tcloudbasegateway.com/v1/rdb/rest/rpc/crm_registration_'+scope+'_v1';
  const response=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(14000),
    headers:{Authorization:'Bearer '+config.CRM_REGISTRATION_PUBLISHABLE_KEY,'Accept-Profile':'public','Content-Profile':'public','Content-Type':'application/json'},
    body:JSON.stringify({p_envelope:call.envelope,p_mac:call.mac})});
  if (!response.ok) throw Error('REGISTRATION_DATABASE_UNAVAILABLE');
  const result=decryptResult(key,scope,call.nonce,await response.json());
  if (result.error) throw Error(allowedErrors.has(result.error)?result.error:'REGISTRATION_DATABASE_UNAVAILABLE');
  return result;
}
module.exports={signedCall,makeEnvelope,decryptResult,derive};
