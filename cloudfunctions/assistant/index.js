/** CRM assistant V1: authenticated intent router, not a chat or execution endpoint. */
'use strict';

const { routeIntent, IntentError } = require('./intent-router');
const { handleCommand, OPERATIONS } = require('./command-safety');

function createMain(getIdentity, searchRunner = event => require('./search-service').runSearch(event),
  actionRunner = (event, uid) => require('./action-command-service').runActionCommand(event, uid),
  candidateRunner = (event, uid) => require('./opportunity-candidate-service').runOpportunityCandidate(event, uid)) {
  return async event => {
    let identity;
    try { identity = await getIdentity(); }
    catch (_) { return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Login required' } }; }
    if (typeof identity?.uid !== 'string' || !identity.uid.trim() || identity.isAnonymous !== false) {
      return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Login required' } };
    }
    if (event?.action === 'opportunityCandidate') {
      try { return await candidateRunner(event, identity.uid); }
      catch (error) {
        const code = ['INVALID_INPUT','INVALID_CONFIG','INVALID_RESULT','RATE_LIMIT','TIMEOUT',
          'UPSTREAM_UNAVAILABLE','PERSISTENCE_ERROR','AI_REQUEST_FAILED','INVALID_CANDIDATE',
          'DUPLICATE_OPPORTUNITY','PREVIEW_STALE','CONFIRMATION_REQUIRED',
          'CANDIDATE_DATABASE_ERROR'].includes(error?.code) ? error.code : 'CANDIDATE_FAILED';
        return { ok:false,error:{code,message:'机会候选操作未完成'} };
      }
    }
    const isActionPlan = event?.action === 'command' && event.stage === 'plan' &&
      event.command?.operation === 'create' && event.command?.resource === 'actions' &&
      event.command?.personId != null;
    const isActionNext = event?.action === 'command' && event.resource === 'actions' &&
      ['preview', 'confirm', 'execute'].includes(event.stage);
    if (isActionPlan || isActionNext) {
      try { return await actionRunner({ action: 'command', stage: event.stage,
        command: event.command, resource: event.resource,
        commandId: event.commandId, previewHash: event.previewHash }, identity.uid); }
      catch (error) {
        const code = ['INVALID_COMMAND','DUPLICATE_ACTION','PREVIEW_STALE',
          'CONFIRMATION_REQUIRED','ACTION_COMMAND_FAILED'].includes(error?.code) ?
          error.code : 'ACTION_COMMAND_FAILED';
        return { ok: false, error: { code, message: 'Action command could not be completed' } };
      }
    }
    if (event?.action === 'command' || OPERATIONS.includes(event?.action)) {
      return handleCommand({ action: event.action, stage: event.stage, command: event.command });
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
