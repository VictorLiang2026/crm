/** Authenticated Action-create workflow. Only a database-verified confirmation may execute. */
'use strict';

const { createActionCommandData } = require('./action-command-data');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MD5 = /^[0-9a-f]{32}$/;
const FIELDS = new Set(['action_type', 'title', 'description', 'due_at', 'priority']);
const OPERATIONS = new Set(['create','update','close']);
const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
const plain = value => value && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function invalid() { const error = new Error('Invalid Action command'); error.code = 'INVALID_COMMAND'; throw error; }
function idOf(value) {
  if (!/^[1-9][0-9]*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) invalid();
  return Number(value);
}
function draftOf(command) {
  if (!plain(command) || Object.keys(command).some(key =>
      !['operation','resource','personId','targetActionId','changes'].includes(key)) ||
      !OPERATIONS.has(command.operation) || command.resource !== 'actions') invalid();
  const personId = idOf(command.personId);
  const changes = command.changes;
  if (!plain(changes) || Object.keys(changes).some(key => !FIELDS.has(key))) invalid();
  if (command.operation === 'create') {
    if (Object.hasOwn(command,'targetActionId') || typeof changes.action_type !== 'string' || !changes.action_type.trim() ||
        changes.action_type.trim().length > 64 || typeof changes.title !== 'string' || !changes.title.trim() ||
        changes.title.trim().length > 200 || (changes.description != null &&
        (typeof changes.description !== 'string' || changes.description.length > 4000)) ||
        (changes.priority != null && !PRIORITIES.has(changes.priority)) ||
        (changes.due_at != null && (typeof changes.due_at !== 'string' ||
         !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(changes.due_at) ||
         !Number.isFinite(Date.parse(changes.due_at))))) invalid();
    return { personId, operation:'create', draft: {
      action_type: changes.action_type.trim(), title: changes.title.trim(),
      description: changes.description || null, due_at: changes.due_at || null,
      priority: changes.priority || 'medium',
    } };
  }
  const targetActionId = idOf(command.targetActionId);
  if (command.operation === 'close') {
    if (Object.keys(changes).length) invalid();
    return {personId,operation:'close',targetActionId,draft:{}};
  }
  if (!Object.keys(changes).length ||
      (Object.hasOwn(changes,'action_type') && (typeof changes.action_type!=='string' || !changes.action_type.trim() || changes.action_type.trim().length>64)) ||
      (Object.hasOwn(changes,'title') && (typeof changes.title!=='string' || !changes.title.trim() || changes.title.trim().length>200)) ||
      (Object.hasOwn(changes,'description') && changes.description!==null &&
        (typeof changes.description!=='string' || changes.description.length>4000)) ||
      (Object.hasOwn(changes,'priority') && !PRIORITIES.has(changes.priority)) ||
      (Object.hasOwn(changes,'due_at') && changes.due_at!==null &&
        (typeof changes.due_at!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(changes.due_at)||!Number.isFinite(Date.parse(changes.due_at))))) invalid();
  const draft={};
  for(const key of Object.keys(changes)) draft[key]=typeof changes[key]==='string'&&['action_type','title'].includes(key)?changes[key].trim():changes[key];
  if(Object.hasOwn(draft,'due_at')&&draft.due_at)draft.due_at=new Date(draft.due_at).toISOString();
  return {personId,operation:'update',targetActionId,draft};
}

async function runActionCommand(event, uid, { data } = {}) {
  if (typeof uid !== 'string' || !uid.trim() || !plain(event) ||
      event.action !== 'command' || !['plan','preview','confirm','execute'].includes(event.stage)) invalid();
  const stage = event.stage;
  let args;
  if (stage === 'plan') {
    if (event.resource !== undefined || event.commandId !== undefined || event.previewHash !== undefined) invalid();
    const { personId, operation, targetActionId, draft } = draftOf(event.command);
    args = { personId, operation, targetActionId:targetActionId||null, draft };
  } else {
    if (event.resource !== 'actions' || event.command !== undefined ||
        typeof event.commandId !== 'string' || !UUID.test(event.commandId)) invalid();
    if (stage === 'confirm') {
      if (typeof event.previewHash !== 'string' || !MD5.test(event.previewHash)) invalid();
    } else if (event.previewHash !== undefined) invalid();
    args = { commandId: event.commandId,
      previewHash: stage === 'confirm' ? event.previewHash : null };
  }
  const database = data || createActionCommandData({ env: process.env.TCB_ENV,
    key: process.env.CRM_ASSISTANT_DB_API_KEY });
  const result = await database.run(stage, uid, args);
  return { ...result,
    execution: { performed: stage === 'execute' && result.replayed !== true,
      modelCalled: false, businessDataRead: stage !== 'plan' || args.operation !== 'create',
      businessDataWritten: stage === 'execute' && result.replayed !== true } };
}

module.exports = { runActionCommand, draftOf };
