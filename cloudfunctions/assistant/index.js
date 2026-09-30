/** CRM assistant V1: authenticated intent router, not a chat or execution endpoint. */
'use strict';

const { routeIntent, IntentError } = require('./intent-router');

function createMain(getIdentity, searchRunner = event => require('./search-service').runSearch(event)) {
  return async event => {
    let identity;
    try { identity = await getIdentity(); }
    catch (_) { return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Login required' } }; }
    if (typeof identity?.uid !== 'string' || !identity.uid.trim() || identity.isAnonymous !== false) {
      return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Login required' } };
    }
    if (event?.action === 'search') {
      try { return await searchRunner({ query: event.query }); }
      catch (error) {
        const code = ['INVALID_INPUT', 'INVALID_CONFIG', 'RATE_LIMIT', 'TIMEOUT',
          'UPSTREAM_UNAVAILABLE', 'PERSISTENCE_ERROR', 'AI_REQUEST_FAILED',
          'INVALID_RESULT'].includes(error?.code) ? error.code : 'SEARCH_FAILED';
        return { ok: false, error: { code, message: 'CRM search could not be completed' } };
      }
    }
    // CloudBase may add transport metadata to the event. Only route the declared request fields.
    try { return routeIntent({ intent: event?.intent, subject: event?.subject, input: event?.input }); }
    catch (error) {
      if (error instanceof IntentError) {
        return { ok: false, error: { code: error.code, message: error.message } };
      }
      return { ok: false, error: { code: 'ROUTING_ERROR', message: 'Routing failed' } };
    }
  };
}

function getIdentity() {
  const cloudbase = require('@cloudbase/node-sdk');
  return cloudbase.init({ env: process.env.TCB_ENV }).auth().getUserInfo();
}

exports.main = createMain(getIdentity);
exports.createMain = createMain;
