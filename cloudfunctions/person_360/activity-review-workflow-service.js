/** Human-reviewed activity candidates and Outcome; all writes use service-only public RPCs. */
'use strict';

const { disclose, refsForRows } = require('./test-data');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[1-9][0-9]*$/;
const OPS = new Set(['action','opportunity','reject_action','reject_opportunity','outcome']);
const TYPES = new Set(['insurance','recruit','referral','activity','speaker',
  'partnership','service','relationship']);
function id(value) {
  if (!ID.test(String(value)) || !Number.isSafeInteger(Number(value)))
    throw new Error('Invalid activity ID');
  return Number(value);
}
function plain(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function exactKeys(value, keys) {
  return plain(value) && Object.keys(value).sort().join(',') === keys.slice().sort().join(',');
}
function instant(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
      !Number.isFinite(Date.parse(value))) throw new Error('Invalid activity time');
  return new Date(value).toISOString();
}
function payload(operation, value) {
  if (operation.startsWith('reject_')) {
    if (!exactKeys(value, [])) throw new Error('Invalid activity rejection');
    return {};
  }
  if (operation === 'action') {
    if (!exactKeys(value, ['title','description','dueAt','priority']) ||
        typeof value.title !== 'string' || !value.title.trim() || value.title.trim().length > 200 ||
        (value.description != null && (typeof value.description !== 'string' || value.description.length > 4000)) ||
        !['low','medium','high','urgent'].includes(value.priority))
      throw new Error('Invalid activity Action draft');
    return {title:value.title.trim(),description:value.description || null,
      dueAt:instant(value.dueAt),priority:value.priority};
  }
  if (operation === 'opportunity') {
    if (!exactKeys(value,['type','reason','nextAction']) || !TYPES.has(value.type) ||
        typeof value.reason !== 'string' || !value.reason.trim() || value.reason.trim().length>1000 ||
        typeof value.nextAction !== 'string' || !value.nextAction.trim() ||
        value.nextAction.trim().length>500) throw new Error('Invalid activity Opportunity draft');
    return {type:value.type,reason:value.reason.trim(),nextAction:value.nextAction.trim()};
  }
  if (!exactKeys(value,['outcomeType','result','occurredAt']) ||
      typeof value.outcomeType !== 'string' || !value.outcomeType.trim() ||
      value.outcomeType.trim().length>64 || typeof value.result !== 'string' ||
      !value.result.trim() || value.result.trim().length>4000)
    throw new Error('Invalid activity Outcome draft');
  const occurredAt = instant(value.occurredAt);
  if (!occurredAt) throw new Error('Invalid activity Outcome time');
  return {outcomeType:value.outcomeType.trim(),result:value.result.trim(),occurredAt};
}

class ActivityReviewWorkflowService {
  constructor({request,rpc,disclosure=disclose}={}) {
    if (typeof request !== 'function' || typeof rpc !== 'function')
      throw new Error('Invalid activity review service');
    this.request=request; this.rpc=rpc; this.disclosure=disclosure;
  }
  async preview(data,actorUid) {
    if (typeof actorUid!=='string' || !actorUid.trim() || !plain(data) ||
        Object.keys(data).some(key=>!['idempotencyKey','operation','activityId',
          'resultId','candidateIndex','draft'].includes(key)) ||
        !UUID.test(String(data.idempotencyKey||'')) || !OPS.has(data.operation))
      throw new Error('Invalid activity preview');
    const activityId=id(data.activityId);
    const resultId=data.operation==='outcome'?null:id(data.resultId);
    const candidateIndex=data.operation==='outcome'?null:Number(data.candidateIndex);
    if (data.operation==='outcome' && (data.resultId!=null || data.candidateIndex!=null))
      throw new Error('Invalid activity candidate reference');
    if (candidateIndex!=null && (!Number.isInteger(candidateIndex) || candidateIndex<0 || candidateIndex>11))
      throw new Error('Invalid activity candidate index');
    return this.rpc('crm_activity_review_preview_v1',{
      p_actor_uid:actorUid,p_idempotency_key:data.idempotencyKey,
      p_operation:data.operation,p_activity_id:activityId,
      p_ai_result_id:resultId,p_candidate_index:candidateIndex,
      p_payload:payload(data.operation,data.draft),
    });
  }
  async execute(previewId,actorUid) {
    if (typeof actorUid!=='string' || !actorUid.trim() || !UUID.test(String(previewId||'')))
      throw new Error('Invalid activity execution');
    return this.rpc('crm_activity_review_execute_v1',{
      p_actor_uid:actorUid,p_preview_id:previewId,
    });
  }
  async outcomes(activityId) {
    const idValue=id(activityId);
    const activity=await this.request('activities','GET',{
      select:'id,name,status',id:`eq.${idValue}`,deleted_at:'is.null',limit:1,
    });
    if (!activity.length) throw new Error('Activity unavailable');
    const rows=await this.request('outcomes','GET',{
      select:'id,activity_id,outcome_type,result,occurred_at',
      activity_id:`eq.${idValue}`,order:'occurred_at.desc,id.desc',limit:20,
    });
    return {rows,testData:await this.disclosure([
      ...refsForRows('activities',activity),...refsForRows('outcomes',rows)])};
  }
}
module.exports={ActivityReviewWorkflowService,payload};
