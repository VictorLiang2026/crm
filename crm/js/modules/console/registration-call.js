const header = btoa('{"alg":"RSA-OAEP-256","enc":"A256GCM"}').replace(/=+$/, '').replace(/\+/g,'-').replace(/\//g,'_');
const fromBase64 = value => Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
let recipient;
const pendingWrites = new Map();
const writes = new Set(['submit','updateMyRegistration','savePage','review','markNotified','reissueManagementLink','linkPerson']);
async function makeRecipient() {
  const keys = await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['encrypt','decrypt']);
  const bytes = new Uint8Array(await crypto.subtle.exportKey('spki',keys.publicKey));
  const replyKey = btoa(String.fromCharCode(...bytes)).replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
  return {replyKey,privateKey:keys.privateKey};
}
function encode(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
async function sealRequest(publicKey, payload) {
  const key = await crypto.subtle.importKey('spki',fromBase64(publicKey),{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
  const transportKey = await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const raw = await crypto.subtle.exportKey('raw',transportKey);
  const wrapped = await crypto.subtle.encrypt({name:'RSA-OAEP'},key,raw);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(header)},transportKey,new TextEncoder().encode(JSON.stringify(payload))));
  return [header,encode(wrapped),encode(iv),encode(encrypted.slice(0,-16)),encode(encrypted.slice(-16))].join('.');
}
export async function registrationCall(send, action, data = {}) {
  const privateReply = action !== 'getPublishedPage';
  if (privateReply && !recipient) recipient=makeRecipient().catch(error=>{recipient=null;throw error;});
  const target = privateReply ? await recipient : null;
  let payload = { ...data,action }, writeKey;
  if (writes.has(action)) {
    writeKey = encode(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload))));
    if (!pendingWrites.has(writeKey)) {
      if (pendingWrites.size >= 64) pendingWrites.delete(pendingWrites.keys().next().value);
      pendingWrites.set(writeKey,crypto.randomUUID());
    }
  }
  if (target) {
    const transport = await send({action:'getRegistrationTransportKey'});
    if (!transport?.publicKey) throw Error('REGISTRATION_TRANSPORT_UNAVAILABLE');
    payload = { action,sealedRequest:await sealRequest(transport.publicKey,{...payload,requestId:pendingWrites.get(writeKey)||crypto.randomUUID(),issued:Date.now(),replyKey:target.replyKey}) };
  }
  const reply = await send(payload);
  if (reply?.error) throw Error(typeof reply.error==='string'?reply.error:reply.error.code||'REQUEST_FAILED');
  if (!target) return reply;
  const parts=typeof reply?.sealed==='string'?reply.sealed.split('.'):[];
  if (parts.length!==5 || parts[0]!==header) throw Error('INVALID_PRIVATE_REPLY');
  const raw=await crypto.subtle.decrypt({name:'RSA-OAEP'},target.privateKey,fromBase64(parts[1]));
  const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);
  const body=fromBase64(parts[3]),tag=fromBase64(parts[4]),input=new Uint8Array(body.length+tag.length);
  input.set(body);input.set(tag,body.length);
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64(parts[2]),additionalData:new TextEncoder().encode(header)},key,input);
  const result=JSON.parse(new TextDecoder().decode(plain));
  if (writeKey) pendingWrites.delete(writeKey);
  return result;
}
