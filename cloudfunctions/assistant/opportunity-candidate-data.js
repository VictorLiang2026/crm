/** Fixed public-schema reads and the service-only candidate command RPC. */
'use strict';

const TABLES = new Set(['persons','interactions','context_items','followups',
  'activity_participants','activities','products','policy_review_reports',
  'ocr_records','photos','recruit_candidates','recruit_followups',
  'opportunities','opportunity_candidates','crm_test_batches','crm_test_records']);
const ID = /^[1-9][0-9]*$/;

function createOpportunityCandidateData({ env, key, fetchImpl = fetch } = {}) {
  if (!/^crm-[a-z0-9]+$/.test(env || '') || !key) {
    const error = new Error('Candidate database not configured');
    error.code = 'INVALID_CONFIG'; throw error;
  }
  async function request(path, method, filters, body) {
    const url = new URL(`https://${env}.api.tcloudbasegateway.com/v1/rdb/rest/${path}`);
    for (const [name, value] of Object.entries(filters || {})) url.searchParams.set(name, value);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetchImpl(url, { method,
        headers: { Authorization: `Bearer ${key}`, 'Accept-Profile': 'public',
          'Content-Profile': 'public', Accept: 'application/json',
          'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
      if (!response.ok) {
        let pgCode = '';
        try { pgCode = String((await response.json()).code || '').replace(/^DATABASE_/, ''); }
        catch (_) { /* Do not expose SQL or source data. */ }
        const error = new Error('Candidate database request failed');
        error.code = ({ '23505':'DUPLICATE_OPPORTUNITY', '40001':'PREVIEW_STALE',
          '42501':'CONFIRMATION_REQUIRED', '22023':'INVALID_CANDIDATE',
          '23503':'INVALID_CANDIDATE' })[pgCode] || 'CANDIDATE_DATABASE_ERROR';
        throw error;
      }
      return response.json();
    } finally { clearTimeout(timer); }
  }
  async function read(table, filters) {
    if (!TABLES.has(table) || !filters || !Number.isInteger(Number(filters.limit)) ||
        Number(filters.limit) < 1 || Number(filters.limit) > 100) throw new Error('Invalid bounded read');
    const rows = await request(table, 'GET', filters);
    if (!Array.isArray(rows)) throw new Error('Invalid candidate data response');
    return rows;
  }
  async function run(operation, uid, args = {}) {
    if (!['create','edit','reject','preview','confirm','execute'].includes(operation) ||
        typeof uid !== 'string' || !uid.trim()) throw new Error('Invalid candidate operation');
    const value = await request('rpc/opportunity_candidate_v1','POST',{}, {
      p_operation: operation, p_actor_uid: uid, p_candidate_id: args.candidateId ?? null,
      p_person_id: args.personId ?? null, p_ai_result_id: args.aiResultId ?? null,
      p_draft: args.draft ?? null, p_evidence: args.evidence ?? null,
      p_preview_hash: args.previewHash ?? null,
    });
    if (!value || value.ok !== true) throw new Error('Invalid candidate command response');
    return value;
  }
  async function list(personId) {
    if (!ID.test(String(personId))) throw new Error('Invalid Person ID');
    return read('opportunity_candidates', { select: 'id,person_id,draft,evidence,status,version,'+
      'opportunity_id,created_at,updated_at', person_id: `eq.${personId}`,
      order: 'created_at.desc,id.desc', limit: 20 });
  }
  async function get(candidateId) {
    if (!ID.test(String(candidateId))) throw new Error('Invalid Candidate ID');
    return (await read('opportunity_candidates', {select:'id,person_id,draft,evidence,status',
      id:`eq.${candidateId}`,limit:1}))[0] || null;
  }
  return { read, run, list, get };
}

module.exports = { createOpportunityCandidateData };
