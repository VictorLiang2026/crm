'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { registrationCall } = require('../../crm/js/modules/console/registration-call.js');
const { seal, recipient } = require('../../cloudfunctions/activity_registration/registration-reply.js');

test('public HTTP event accepts POST JSON and rejects an invalid transport or method',async()=>{
  const previousScope=process.env.CRM_REGISTRATION_SCOPE,previousKey=process.env.CRM_REGISTRATION_REQUEST_PRIVATE_PEM;
  try {
    process.env.CRM_REGISTRATION_SCOPE='public';
    process.env.CRM_REGISTRATION_REQUEST_PRIVATE_PEM=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
    const {publicMain}=require('../../cloudfunctions/activity_registration_public/index');
    const body=JSON.stringify({action:'getRegistrationTransportKey'});
    const key=await publicMain({httpMethod:'POST',body});
    assert.ok(recipient(key.publicKey));
    assert.deepEqual(await publicMain({httpMethod:'POST',body:'{' }),{error:'INVALID_REQUEST'});
    assert.deepEqual(await publicMain({httpMethod:'GET',body}),{error:'INVALID_REQUEST'});
  }finally{
    if(previousScope===undefined)delete process.env.CRM_REGISTRATION_SCOPE;else process.env.CRM_REGISTRATION_SCOPE=previousScope;
    if(previousKey===undefined)delete process.env.CRM_REGISTRATION_REQUEST_PRIVATE_PEM;else process.env.CRM_REGISTRATION_REQUEST_PRIVATE_PEM=previousKey;
  }
});

// Mirrors the browser payload passed to the CloudBase gateway. Markers have no
// relationship to an account, valid management link, or service credential.
test('private requests and responses exclude reusable management links and applicant fields at the SDK boundary', async () => {
  const token = 'fixture-' + crypto.randomBytes(32).toString('hex');
  const person = 'fictional-name-' + crypto.randomUUID();
  for (const action of ['submit', 'getMyRegistration', 'updateMyRegistration']) {
    let requestContainsMarker = false;
    let replyContainsMarker = false;
    const transport = require('./transport-fixture.cjs');
    const send = async payload => {
      if (payload.action === 'getRegistrationTransportKey') return {publicKey:transport.publicKey};
      requestContainsMarker = [token, person].some(marker => JSON.stringify(payload).includes(marker));
      const clear = transport.open(action,payload.sealedRequest);
      assert.equal(clear.managementToken,token);
      assert.equal(clear.name,person);
      const reply = seal({ managementToken:token, name:person }, recipient(clear.replyKey));
      replyContainsMarker = [token, person].some(marker => JSON.stringify(reply).includes(marker));
      return reply;
    };
    const result = await registrationCall(send, action, { managementToken:token, name:person });
    assert.equal(result.managementToken, token);
    assert.equal(replyContainsMarker, false, action + ': private reply must be sealed');
    assert.equal(requestContainsMarker, false, action + ': gateway request contains a plaintext synthetic marker');
  }
});
