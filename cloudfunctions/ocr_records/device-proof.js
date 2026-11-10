'use strict';
const crypto=require('node:crypto');
const denied=()=>Object.assign(new Error('DEVICE_ACCESS_DENIED'),{code:'DEVICE_ACCESS_DENIED'});
function canonical(value){
 if(value===null||typeof value==='string'||typeof value==='boolean'||(typeof value==='number' && Number.isFinite(value))) return JSON.stringify(value);
 if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
 if(!value || typeof value!=='object'||![null,Object.prototype].includes(Object.getPrototypeOf(value)))throw denied();
 return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
function decode(s,n){if(typeof s!=='string'||!/^[A-Za-z0-9_-]+$/.test(s))throw denied();const b=Buffer.from(s,'base64url');if(b.length!==n||b.toString('base64url')!==s)throw denied();return b;}
function publicKey(j){if(j?.kty!=='EC'||j.crv!=='P-256'||j.d!==undefined)throw denied();decode(j.x,32);decode(j.y,32);const jwk={kty:'EC',crv:'P-256',x:j.x,y:j.y};
 const key=crypto.createPublicKey({key:jwk,format:'jwk'});return {jwk,key,fingerprint:digest(canonical(jwk))};}
function identity(info){if(typeof info?.uid!=='string'||!info.uid.trim()||info.uid.length>120||info.isAnonymous===true||info.is_anonymous===true) throw denied();return info.uid;}
function deviceMessage(env,audience,payloadHash,challenge,fingerprint){return canonical(['crm.device.v1',env,audience,payloadHash,challenge,fingerprint]);}
function deviceProtocol({env,rpc,permitted}){
 if(!env||typeof rpc!=='function'||!(permitted instanceof Set))throw Error('Device protocol configuration required');
 const aud=v=>{if(!permitted.has(v))throw denied();return v;};
 async function enroll(info,{key,label}){const uid=identity(info),k=publicKey(key);if(typeof label!=='string'||label.length>80)throw denied();
  return {...await rpc('request',uid,k.fingerprint,{public_key:k.jwk,label}),fingerprint:k.fingerprint};}
 async function issue(info,{fingerprint,audience,payloadHash}){const uid=identity(info);if(!/^[0-9a-f]{64}$/.test(fingerprint)||!/^[0-9a-f]{64}$/.test(payloadHash))throw denied();return rpc('issue',uid,fingerprint,{audience:aud(audience),payload_hash:payloadHash});}
 async function authorize(info,name,event){const uid=identity(info);const {__deviceProof:proof,...data}=event||{};
  if(!proof||!/^([0-9a-f]{64})$/.test(proof.fingerprint)||!/^[a-f0-9-]{36}$/.test(proof.challenge))throw denied();
  const fingerprint=proof.fingerprint,sig=decode(proof.signature,64);const payloadHash=digest(canonical(data));
  const args={challenge:proof.challenge,audience:aud(name),payload_hash:payloadHash};
  const stored=await rpc('inspect',uid,fingerprint,args);const key=publicKey(stored?.public_key);
  if(key.fingerprint!==fingerprint||!crypto.verify('sha256',Buffer.from(deviceMessage(env,name,payloadHash,proof.challenge,fingerprint)),{key:key.key,dsaEncoding:'ieee-p1363'},sig))throw denied();
  if((await rpc('consume',uid,fingerprint,args))?.ok!==true)throw denied();return data;}
 return {enroll,issue,authorize};
}
module.exports={canonical,digest,publicKey,identity,deviceMessage,deviceProtocol};
