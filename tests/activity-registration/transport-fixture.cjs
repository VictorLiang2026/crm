'use strict';
const { generateKeyPairSync } = require('node:crypto');
const { requestTransport } = require('../../cloudfunctions/activity_registration/registration-request');
const keys = generateKeyPairSync('rsa',{modulusLength:2048});
module.exports = requestTransport(keys.privateKey.export({format:'pem',type:'pkcs8'}));
