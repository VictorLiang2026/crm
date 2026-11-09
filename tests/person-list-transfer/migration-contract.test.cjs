'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, 'cloudbase/migrations', name), 'utf8');
const commands = read('20261109160000_person_list_transfer_commands.sql');
const commandsRollback = read('20261109160000_person_list_transfer_commands.rollback.sql');
const atomicCreate = read('20261109170000_person_list_transfer_atomic_create.sql');
const atomicRollback = read('20261109170000_person_list_transfer_atomic_create.rollback.sql');

test('command migration is public-only, service-only and requires the ready confirmation state', () => {
  assert.match(commands, /CREATE TABLE public\.crm_person_list_transfer_commands/);
  assert.match(commands, /ENABLE ROW LEVEL SECURITY[\s\S]*FORCE ROW LEVEL SECURITY/);
  assert.match(commands, /REVOKE ALL ON public\.crm_person_list_transfer_commands FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(commands, /GRANT SELECT, INSERT, UPDATE ON public\.crm_person_list_transfer_commands TO service_role/);
  assert.match(commands, /status IN \('preview','ready','executing','partial','completed','stale','expired'\)/);
  assert.doesNotMatch(commands, /\bpr(?:_[a-z0-9_]+)?\b/i);
});

test('command rollback guards unfinished confirmed executions and does not cascade', () => {
  assert.match(commandsRollback, /status IN \('ready','executing','partial'\)/);
  assert.match(commandsRollback, /DROP TABLE public\.crm_person_list_transfer_commands/);
  assert.doesNotMatch(commandsRollback, /CASCADE/i);
});

test('different-person rename and create share one locked public transaction', () => {
  assert.match(atomicCreate, /CREATE FUNCTION public\.crm_person_list_transfer_create_v1/);
  assert.match(atomicCreate, /current_user <> 'service_role'/);
  assert.match(atomicCreate, /FOR UPDATE/);
  assert.match(atomicCreate, /updated_at IS DISTINCT FROM/);
  assert.match(atomicCreate, /UPDATE public\.persons[\s\S]*?INSERT INTO public\.persons/);
  assert.match(atomicCreate, /GRANT EXECUTE ON FUNCTION public\.crm_person_list_transfer_create_v1\(text,jsonb,jsonb\) TO service_role/);
  assert.doesNotMatch(atomicCreate, /\bpr(?:_[a-z0-9_]+)?\b/i);
  assert.match(atomicRollback, /DROP FUNCTION public\.crm_person_list_transfer_create_v1\(text,jsonb,jsonb\)/);
  assert.doesNotMatch(atomicRollback, /CASCADE/i);
});

