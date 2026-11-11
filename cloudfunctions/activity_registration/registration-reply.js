'use strict';
const crypto = require('node:crypto');

// SCF records returned values in platform logs. Only the requesting browser can open this compact JWE.
const PROTECTED = Buffer.from('{"alg":"RSA-OAEP-256","enc":"A256GCM"}').toString('base64url');
function recipient(encoded) {
  try {
    if (typeof encoded !== 'string' || !/^[\w-]{360,450}$/.test(encoded)) throw Error();
    const key = crypto.createPublicKey({key:Buffer.from(encoded,'base64url'), format:'der', type:'spki'});
    if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength !== 2048 ||
        key.asymmetricKeyDetails.publicExponent !== 65537n) throw Error();
    return key;
  } catch { throw new Error('INVALID_REPLY_KEY'); }
}
function seal(value, key) {
  const cek = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm',cek,iv);
  cipher.setAAD(Buffer.from(PROTECTED,'ascii'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  const wrapped = crypto.publicEncrypt({key,oaepHash:'sha256',padding:crypto.constants.RSA_PKCS1_OAEP_PADDING},cek);
  return {sealed:[PROTECTED,...[wrapped,iv,ciphertext,cipher.getAuthTag()].map(v=>v.toString('base64url'))].join('.')};
}
module.exports={recipient,seal};
