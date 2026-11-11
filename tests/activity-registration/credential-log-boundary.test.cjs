'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { registrationCall } = require('../../crm/js/modules/console/registration-call.js');
const { seal, recipient } = require('../../cloudfunctions/activity_registration/registration-reply.js');

// Mirrors the SDK payload passed to the CloudBase gateway. Markers have no
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
