const header = btoa('{"alg":"RSA-OAEP-256","enc":"A256GCM"}').replace(/=+$/, '').replace(/\+/g,'-').replace(/\//g,'_');
const fromBase64 = value => Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
let recipient;
async function makeRecipient() {
  const keys = await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['encrypt','decrypt']);
  const bytes = new Uint8Array(await crypto.subtle.exportKey('spki',keys.publicKey));
  const replyKey = btoa(String.fromCharCode(...bytes)).replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
  return {replyKey,privateKey:keys.privateKey};
}
export async function registrationCall(send, action, data = {}) {
  const privateReply = action !== 'getPublishedPage';
  if (privateReply && !recipient) recipient=makeRecipient().catch(error=>{recipient=null;throw error;});
  const target = privateReply ? await recipient : null;
  const reply = await send({action,...data,...(target?{replyKey:target.replyKey}:{})});
  if (reply?.error) throw Error(typeof reply.error==='string'?reply.error:reply.error.code||'REQUEST_FAILED');
  if (!target) return reply;
  const parts=typeof reply?.sealed==='string'?reply.sealed.split('.'):[];
  if (parts.length!==5 || parts[0]!==header) throw Error('INVALID_PRIVATE_REPLY');
  const raw=await crypto.subtle.decrypt({name:'RSA-OAEP'},target.privateKey,fromBase64(parts[1]));
  const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);
  const body=fromBase64(parts[3]),tag=fromBase64(parts[4]),input=new Uint8Array(body.length+tag.length);
  input.set(body);input.set(tag,body.length);
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64(parts[2]),additionalData:new TextEncoder().encode(header)},key,input);
  return JSON.parse(new TextDecoder().decode(plain));
}
