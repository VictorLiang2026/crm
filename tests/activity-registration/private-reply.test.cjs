'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {recipient,seal}=require('../../cloudfunctions/activity_registration/registration-reply');
test('private registration responses are readable by the requesting browser without plaintext in the runtime response',async()=>{
  const {registrationCall}=await import('../../crm/js/modules/console/registration-call.js');
  for(const result of [{managementToken:'fixture-management-link'}, {registrations:[{phone:'TEST-PRIVATE',answers:{answer:'synthetic answer'}}]}]){
    let logged;
    const actual=await registrationCall(async input=>{
      const transport=require('./transport-fixture.cjs');
      if(input.action==='getRegistrationTransportKey')return {publicKey:transport.publicKey};
      const request=transport.open(input.action,input.sealedRequest);
      const reply=seal(result,recipient(request.replyKey));logged=JSON.stringify(reply);return reply;
    },'submit');
    assert.deepEqual(actual,result);assert.doesNotMatch(logged,/fixture-management-link|TEST-PRIVATE|synthetic answer/);
  }
  await assert.rejects(registrationCall(async p=>p.action==='getRegistrationTransportKey'?{publicKey:require('./transport-fixture.cjs').publicKey}:{managementToken:'unexpected'},'submit'),/INVALID_PRIVATE_REPLY/);
  assert.throws(()=>recipient(''),/INVALID_REPLY_KEY/);
  for(const folder of ['activity_registration','activity_registration_public']){
    const f=path.resolve(__dirname,'../../cloudfunctions',folder,'registration-reply.js');
    assert.equal(fs.readFileSync(f,'utf8').replace(/\r/g,''),fs.readFileSync(require.resolve('../../cloudfunctions/activity_registration/registration-reply'),'utf8').replace(/\r/g,''));
  }
});
