'use strict';
const crypto = require('node:crypto');

const protectedHeader = Buffer.from('{"alg":"RSA-OAEP-256","enc":"A256GCM"}').toString('base64url');
function requestTransport(privatePem) {
  if (!privatePem) throw Error('REGISTRATION_TRANSPORT_UNAVAILABLE');
  const privateKey = crypto.createPrivateKey(privatePem);
  if (privateKey.asymmetricKeyType !== 'rsa' || privateKey.asymmetricKeyDetails.modulusLength !== 2048) throw Error('REGISTRATION_TRANSPORT_UNAVAILABLE');
  const publicKey = crypto.createPublicKey(privateKey).export({format:'der',type:'spki'}).toString('base64url');
  function open(action, envelope) {
    try {
      if (typeof envelope !== 'string' || envelope.length > 160000) throw Error();
      const parts = envelope.split('.');
      if (parts.length !== 5 || parts[0] !== protectedHeader) throw Error();
      const [wrapped,iv,ciphertext,tag] = parts.slice(1).map(v => Buffer.from(v,'base64url'));
      if (wrapped.length !== 256 || iv.length !== 12 || tag.length !== 16) throw Error();
      const key = crypto.privateDecrypt({key:privateKey,oaepHash:'sha256',padding:crypto.constants.RSA_PKCS1_OAEP_PADDING}, wrapped);
      const decoder = crypto.createDecipheriv('aes-256-gcm',key,iv);
      decoder.setAAD(Buffer.from(protectedHeader,'ascii'));
      decoder.setAuthTag(tag);
      const request = JSON.parse(Buffer.concat([decoder.update(ciphertext),decoder.final()]).toString('utf8'));
      if (!request || request.action !== action || typeof request.replyKey !== 'string' ||
          !Number.isSafeInteger(request.issued) || Math.abs(Date.now()-request.issued)>120000 ||
          !/^[a-f0-9-]{36}$/.test(request.requestId||'')) throw Error();
      return request;
    } catch { throw Error('INVALID_PRIVATE_REQUEST'); }
  }
  return { publicKey,open };
}
module.exports = { requestTransport };
