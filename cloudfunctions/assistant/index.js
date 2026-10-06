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
    if (event?.action === 'testSamples') {
      try { return await require('./test-scenario-service').runScenario({action:event.action,stage:event.stage,
        ...(event.previewId === undefined ? {} : {previewId:event.previewId}),
        ...(event.previewHash === undefined ? {} : {previewHash:event.previewHash}),
        ...(event.confirmed === undefined ? {} : {confirmed:event.confirmed}),
        ...(event.plan === undefined ? {} : {plan:event.plan}),
        ...Object.fromEntries(['count','counts','personId','customerId','batchKey','rows']
          .filter(key => event[key] !== undefined).map(key => [key,event[key]]))}, identity, {
        allowedUids: String(process.env.CRM_TEST_SEED_UIDS || '').split(',').map(s => s.trim()).filter(Boolean),
      }); } catch (error) { return {ok:false,error:{code:error.code || 'SEED_DENIED',message:'测试场景操作未完成，请核对预览或权限'}}; }
    }
    if (event?.action === 'quickCaptureV2') {
      try { return await require('./quick-capture-v2-service').runQuickCaptureV2(event,identity); }
      catch (error) { return {ok:false,error:{code:error.code || 'QUICK_CAPTURE_FAILED',
        message:'快速记录 V2 操作未完成，请核对身份、预览或权限',
        ...(Number.isSafeInteger(Number(error.auditTaskId)) && Number(error.auditTaskId)>0 ?
          {auditTaskId:Number(error.auditTaskId)} : {})}}; }
    }
    if (event?.action === 'opportunityCandidate') {
      try { return await candidateRunner(event, identity.uid); }
      catch (error) {
        const code = ['INVALID_INPUT','INVALID_CONFIG','INVALID_RESULT','RATE_LIMIT','TIMEOUT',
          'UPSTREAM_UNAVAILABLE','PERSISTENCE_ERROR','AI_REQUEST_FAILED','INVALID_CANDIDATE',
          'DUPLICATE_OPPORTUNITY','PREVIEW_STALE','CONFIRMATION_REQUIRED',
          'TEST_PERSON_REQUIRED',
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
    if (event?.action === 'summarize') {
      try { return await require('./summarize-service').runSummarize(event); }
      catch (error) {
        const code = ['INVALID_INPUT', 'NOT_FOUND', 'INVALID_CONFIG', 'INVALID_RESULT',
          'RATE_LIMIT', 'TIMEOUT', 'UPSTREAM_UNAVAILABLE', 'PERSISTENCE_ERROR',
          'AI_REQUEST_FAILED'].includes(error?.code) ? error.code : 'SUMMARY_FAILED';
        const detail = error?.message ? String(error.message) : '';
        return { ok: false, error: { code, message: detail || 'Person summary could not be generated' } };
      }
    }
    if (event?.action === 'meetingPrep') {
      try { return await require('./meeting-prep-service').runMeetingPrep(event); }
      catch (error) {
        const code = ['INVALID_INPUT', 'NOT_FOUND', 'INVALID_CONFIG', 'INVALID_RESULT',
          'RATE_LIMIT', 'TIMEOUT', 'UPSTREAM_UNAVAILABLE', 'PERSISTENCE_ERROR',
          'AI_REQUEST_FAILED'].includes(error?.code) ? error.code : 'MEETING_PREP_FAILED';
        const detail = error?.message ? String(error.message) : '';
        return { ok: false, error: { code, message: detail || 'Meeting prep could not be generated' } };
      }
    }
    if (event?.action === 'conversationPlaybook') {
      try { return await require('./conversation-playbook-service').runConversationPlaybook(event); }
      catch (error) {
        const code = ['INVALID_INPUT', 'NOT_FOUND', 'INVALID_CONFIG', 'INVALID_RESULT',
          'RATE_LIMIT', 'TIMEOUT', 'UPSTREAM_UNAVAILABLE', 'PERSISTENCE_ERROR',
          'AI_REQUEST_FAILED'].includes(error?.code) ? error.code : 'PLAYBOOK_FAILED';
        const detail = error?.message ? String(error.message) : '';
        return { ok: false, error: { code, message: detail || 'Conversation playbook could not be generated' } };
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
