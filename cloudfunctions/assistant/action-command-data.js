/** Narrow public RPC client; the API key remains in the assistant function only. */
'use strict';

const STAGES = new Set(['plan', 'preview', 'confirm', 'execute']);
function createActionCommandData({ env, key, fetchImpl = fetch } = {}) {
  if (!/^crm-[a-z0-9]+$/.test(env || '') || typeof key !== 'string' || !key) {
    throw new Error('Action command database is not configured');
  }
  async function run(stage, uid, { commandId = null, personId = null, operation = 'create',
    targetActionId = null, draft = null, previewHash = null } = {}) {
    if (!STAGES.has(stage) || typeof uid !== 'string' || !uid.trim()) {
      throw new Error('Invalid Action command request');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetchImpl(
        `https://${env}.api.tcloudbasegateway.com/v1/rdb/rest/rpc/assistant_action_command_v1`, {
          method: 'POST', headers: { Authorization: `Bearer ${key}`,
            'Accept-Profile': 'public', 'Content-Profile': 'public',
            Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_stage: stage, p_actor_uid: uid,
            p_command_id: commandId, p_person_id: personId,
            p_draft: stage === 'plan' && operation !== 'create' ?
              { operation, targetActionId, changes:draft } : draft,
            p_preview_hash: previewHash }),
          signal: controller.signal,
        });
      if (!response.ok) {
        let code = 'ACTION_COMMAND_FAILED';
        try {
          const error = await response.json();
          const pgCode = typeof error.code === 'string' ?
            error.code.replace(/^DATABASE_/, '') : '';
          if (pgCode === '23505') code = 'DUPLICATE_ACTION';
          else if (pgCode === '40001') code = 'PREVIEW_STALE';
          else if (pgCode === '42501') code = 'CONFIRMATION_REQUIRED';
          else if (pgCode === '22023' || pgCode === '23503') code = 'INVALID_COMMAND';
        } catch (_) { /* Never expose database diagnostics to the browser. */ }
        const failure = new Error('Action command could not be completed');
        failure.code = code;
        throw failure;
      }
      const value = await response.json();
      if (!value || value.ok !== true || !['planned','previewed','confirmed','executed'].includes(value.status)) {
        throw new Error('Invalid Action command response');
      }
      return value;
    } finally { clearTimeout(timer); }
  }
  async function listOpenActions(personId) {
    const id = String(personId ?? '');
    if (!/^[1-9][0-9]{0,18}$/.test(id) || !Number.isSafeInteger(Number(id))) {
      throw new Error('Invalid Person reference');
    }
    const url = new URL(`https://${env}.api.tcloudbasegateway.com/v1/rdb/rest/actions`);
    for (const [name, value] of Object.entries({
      select:'id,person_id,action_type,title,description,due_at,priority,status,updated_at',
      person_id:`eq.${id}`, status:'in.(open,in_progress)',
      order:'due_at.asc.nullslast,id.desc', limit:'51',
    })) url.searchParams.set(name,value);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetchImpl(url, { method:'GET', headers: {
        Authorization:`Bearer ${key}`, 'Accept-Profile':'public', 'Content-Profile':'public',
        Accept:'application/json', 'Content-Type':'application/json',
      }, signal:controller.signal });
      if (!response.ok) throw new Error('Action list could not be read');
      const rows = await response.json();
      if (!Array.isArray(rows) || rows.length > 51 || rows.some(row =>
        String(row.person_id) !== id || !/^[1-9][0-9]{0,18}$/.test(String(row.id)) ||
        !['open','in_progress'].includes(row.status))) throw new Error('Invalid Action list response');
      return { rows:rows.slice(0,50), hasMore:rows.length > 50 };
    } finally { clearTimeout(timer); }
  }
  return { run, listOpenActions };
}

module.exports = { createActionCommandData };
