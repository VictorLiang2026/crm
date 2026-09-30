/** AI command safety contract. This release has no business mutation executor. */
'use strict';

const OPERATIONS = Object.freeze(['create', 'update', 'close', 'delete']);
const OPERATION_SET = new Set(OPERATIONS);
const STEPS = Object.freeze(['command', 'plan', 'preview', 'confirm', 'execute']);
const EXECUTION = Object.freeze({ performed: false, modelCalled: false,
  businessDataRead: false, businessDataWritten: false });

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
function safePayload(value, depth = 0) {
  if (depth > 8) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))) return true;
  if (Array.isArray(value)) return value.length <= 30 &&
    value.every(item => safePayload(item, depth + 1));
  if (!plain(value) || Object.keys(value).length > 40 ||
      Object.keys(value).some(key => ['__proto__', 'prototype', 'constructor',
        'sql', 'query', 'statement'].includes(key))) return false;
  return Object.values(value).every(item => safePayload(item, depth + 1));
}

function fail(code, message) {
  return { ok: false, error: { code, message }, requiredFlow: STEPS, execution: EXECUTION };
}

function parseCommand(event) {
  if (!plain(event) || Object.keys(event).some(key => !['action', 'stage', 'command'].includes(key)) ||
      event.action !== 'command' || event.stage !== 'plan' || !plain(event.command)) return null;
  const command = event.command;
  if (Object.keys(command).some(key => !['operation', 'resource', 'targetId', 'changes'].includes(key)) ||
      !OPERATION_SET.has(command.operation) || typeof command.resource !== 'string' ||
      !/^[a-z][a-z0-9_]{0,49}$/.test(command.resource) ||
      command.resource === 'pr' || command.resource.startsWith('pr_')) return null;
  if (command.operation === 'create') {
    if (own(command, 'targetId') && command.targetId != null) return null;
  } else if (!/^[1-9][0-9]*$/.test(String(command.targetId)) ||
             !Number.isSafeInteger(Number(command.targetId))) return null;
  if (command.operation === 'close' || command.operation === 'delete') {
    if (own(command, 'changes')) return null;
  } else if (!plain(command.changes) || !safePayload(command.changes) || !Object.keys(command.changes).length ||
             Object.keys(command.changes).length > 40 ||
             Object.keys(command.changes).some(key => !/^[a-z][a-z0-9_]{0,49}$/.test(key))) return null;
  try {
    if (JSON.stringify(command).length > 8000) return null;
  } catch (_) { return null; }
  return command;
}

function handleCommand(event) {
  if (event?.action !== 'command') {
    return fail('COMMAND_PLAN_REQUIRED', 'Mutation commands require a reviewed plan');
  }
  if (event.stage === 'plan') {
    const command = parseCommand(event);
    if (!command) return fail('INVALID_COMMAND', 'A structured mutation command is required');
    return { ok: true, status: 'planned', plan: {
      operation: command.operation, resource: command.resource,
      targetId: command.operation === 'create' ? null : String(command.targetId),
      proposedFields: command.changes ? Object.keys(command.changes).sort() : [],
      nextStep: 'preview', previewVerified: false, confirmationRecorded: false,
      executable: false,
    }, requiredFlow: STEPS, execution: EXECUTION };
  }
  if (event.stage === 'preview') {
    return fail('VERIFIED_PREVIEW_REQUIRED', 'No server-verified business preview is available');
  }
  if (event.stage === 'confirm') {
    return fail('SERVER_CONFIRMATION_REQUIRED', 'No server-verified preview can be confirmed');
  }
  if (event.stage === 'execute') {
    return fail('EXECUTOR_NOT_ENABLED', 'No business mutation executor is enabled');
  }
  return fail('INVALID_COMMAND_STAGE', 'Unsupported command stage');
}

module.exports = { handleCommand, OPERATIONS, STEPS };
