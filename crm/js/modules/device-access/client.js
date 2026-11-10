// Browser half. Each origin + CloudBase environment keeps its own non-extractable P-256 key.
const enc=new TextEncoder();
function canonical(v){if(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(!v||typeof v!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(v)))throw Error('DEVICE_INVALID_PAYLOAD');return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';}
async function hash(v){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(canonical(v)))),b=>b.toString(16).padStart(2,'0')).join('');}
function b64url(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');}
async function open(env){return new Promise((res,rej)=>{const req=indexedDB.open('crm.devices.v1:'+env,1);req.onupgradeneeded=()=>req.result.createObjectStore('keys');req.onerror=()=>rej(req.error);req.onsuccess=()=>res(req.result);});}
async function pair(env){
 const db=await open(env);
 const get=()=>new Promise((res,rej)=>{const r=db.transaction('keys').objectStore('keys').get('identity');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
 try{
 const old=await get();if(old)return old;
 const proposed=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
 return await new Promise((res,rej)=>{const tx=db.transaction('keys','readwrite'),store=tx.objectStore('keys');let chosen;
 const r=store.get('identity');r.onsuccess=()=>{chosen=r.result||proposed;if(!r.result)store.add(chosen,'identity');};
 tx.oncomplete=()=>res(chosen);tx.onabort=()=>rej(tx.error||Error('DEVICE_STORAGE_UNAVAILABLE'));tx.onerror=()=>rej(tx.error);});
 }finally{db.close();}
}
export function createDeviceClient(env,callControl){
 let ready;
 const identity=()=>{if(!ready)ready=(async()=>{const keys=await pair(env).catch(()=>{throw Error('DEVICE_STORAGE_UNAVAILABLE');});
 if(!keys?.privateKey||keys.privateKey.extractable)throw Error('DEVICE_STORAGE_UNAVAILABLE');
 const {kty,crv,x,y}=await crypto.subtle.exportKey('jwk',keys.publicKey),key={kty,crv,x,y};return {key,priv:keys.privateKey,fingerprint:await hash(key)};})().catch(e=>{ready=null;throw e;});return ready;};
 return {
 async enroll(label=''){const {key,fingerprint}=await identity();const result=await callControl({action:'request',key,label});if(!result||result.fingerprint!==fingerprint)throw Error('DEVICE_ACCESS_DENIED');return {state:result.state,fingerprint};},
 async sign(name,input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.hasOwn(input,'__deviceProof'))throw Error('DEVICE_INVALID_PAYLOAD');
 // Normalize to exactly the representation the JSON transport sends. Dates/undefined never change after signing.
 const data=JSON.parse(JSON.stringify(input)),{fingerprint,priv}=await identity(),payloadHash=await hash(data);
 const {challenge}=await callControl({action:'issue',fingerprint,audience:name,payloadHash});if(!/^[a-f0-9-]{36}$/.test(challenge))throw Error('DEVICE_ACCESS_DENIED');
 const message=canonical(['crm.device.v1',env,name,payloadHash,challenge,fingerprint]);
 const bytes=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},priv,enc.encode(message));
 return {...data,__deviceProof:{fingerprint,challenge,signature:b64url(bytes)}};
 }
 };
}
