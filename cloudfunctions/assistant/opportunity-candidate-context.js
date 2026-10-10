/** Bounded, attributed CRM evidence. Missing records never mean a confirmed need. */
'use strict';

const ID = /^[1-9][0-9]*$/;
const clip = (value, size = 300) => typeof value === 'string' ? value.trim().slice(0,size) : '';
function idOf(value) {
  if (!ID.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    const error = new Error('Invalid Person ID'); error.code = 'INVALID_INPUT'; throw error;
  }
  return Number(value);
}
function add(items, type, row, content, primary, date, certainty) {
  const text = clip(content);
  if (text && ID.test(String(row.id))) items.push({
    ref: `public.${type}#${row.id}`, text, primary: Boolean(primary),
    date: date || null, certainty: certainty || 'unverified',
  });
}

async function buildCandidateContext(data, personId) {
  const id = idOf(personId);
  const read = data.read;
  const person = (await read('persons', { select: 'id,display_name,'+
    'occupation,organization,updated_at', id: `eq.${id}`, deleted_at: 'is.null', limit: 1 }))[0];
  if (!person) { const error = new Error('Person not found'); error.code='INVALID_INPUT'; throw error; }
  // PMC-19 CL-03: legacy_customer_id removed; resolve customer_id via customers.person_id
  const customer = (await read('customers', { select: 'Id', person_id: `eq.${id}`,
    deleted_at: 'is.null', limit: 1 }))[0] || null;
  const customerId = customer?.Id ?? null;
  const [interactions, items, participants, recruit, opportunities] = await Promise.all([
    read('interactions', { select: 'id,interaction_at,summary,importance,source_type,source_id',
      person_id: `eq.${id}`, order: 'interaction_at.desc,id.desc', limit: 5 }),
    read('context_items', { select: 'id,item_type,content,confidence,confirmed,valid_from,valid_to,created_at',
      person_id: `eq.${id}`, order: 'created_at.desc,id.desc', limit: 5 }),
    read('activity_participants', { select: 'id,activity_id,status,relationship_note,created_at',
      canonical_person_id: `eq.${id}`, status: 'eq.attended', deleted_at: 'is.null',
      order: 'created_at.desc,id.desc', limit: 3 }),
    read('recruit_candidates', { select: 'id,stage,motivation,concerns,career_plan,updated_at',
      person_id: `eq.${id}`, deleted_at: 'is.null', order: 'updated_at.desc,id.desc', limit: 3 }),
    read('opportunities', { select: 'id,opportunity_type,status,last_progress',
      person_id: `eq.${id}`, deleted_at: 'is.null', order: 'updated_at.desc,id.desc', limit: 10 }),
  ]);
  const [followups, reports, products, ocr, photos, legacyParticipants] = customerId == null ?
    [[],[],[],[],[],[]] : await Promise.all([
      read('followups', { select: 'Id,followup_date,interaction_summary,followup_notes',
        customer_id: `eq.${customerId}`, deleted_at: 'is.null',
        order: 'followup_date.desc,Id.desc', limit: 4 }),
      read('policy_review_reports', { select: 'id,report_date,edited_gaps,edited_recommendations,'+
        'gaps_found,summary', customer_id: `eq.${customerId}`, deleted_at: 'is.null',
        order: 'report_date.desc,id.desc', limit: 3 }),
      read('products', { select: 'id,items,created_at', customer_id: `eq.${customerId}`,
        deleted_at: 'is.null', order: 'id.desc', limit: 2 }),
      read('ocr_records', { select: 'id,summary,created_at', customer_id: `eq.${customerId}`,
        deleted_at: 'is.null', order: 'created_at.desc,id.desc', limit: 1 }),
      read('photos', { select: 'id,category,photo_notes,created_at',
        customer_id: `eq.${customerId}`, deleted_at: 'is.null',
        order: 'created_at.desc,id.desc', limit: 1 }),
      read('activity_participants', { select:'id,activity_id,status,relationship_note,created_at',
        person_type:'eq.customer',person_id:`eq.${customerId}`,status:'eq.attended',
        deleted_at:'is.null',order:'created_at.desc,id.desc',limit:3 }),
    ]);
  const attended=[...new Map(participants.concat(legacyParticipants)
    .map(row=>[String(row.id),row])).values()].slice(0,3);
  const activityIds = [...new Set(attended.map(p=>String(p.activity_id)))].filter(x=>ID.test(x));
  const activities = activityIds.length ? await read('activities', { select:'id,name,activity_date',
    id:`in.(${activityIds.join(',')})`, deleted_at:'is.null', limit:5 }) : [];
  const activityById = new Map(activities.map(a=>[String(a.id),a]));
  const recruitIds = recruit.map(r=>String(r.id)).filter(x=>ID.test(x));
  const recruitFollowups = recruitIds.length ? await read('recruit_followups', {
    select:'id,candidate_id,followup_date,interaction_summary,followup_notes',
    candidate_id:`in.(${recruitIds.join(',')})`, deleted_at:'is.null',
    order:'followup_date.desc,id.desc', limit:2 }) : [];
  const evidence=[];
  const represented=new Set(interactions.filter(row=>row.source_id!=null)
    .map(row=>`${row.source_type}#${row.source_id}`));
  for (const row of interactions) add(evidence,'interactions',row,row.summary,
    Number(row.importance)>=3,row.interaction_at,'recorded_interaction');
  for (const row of followups) if (!represented.has(`followups#${row.Id}`)) {
    add(evidence,'followups',{id:row.Id},
      row.interaction_summary || row.followup_notes,true,row.followup_date,'legacy_followup');
  }
  for (const row of items) {
    if (row.valid_from && Date.parse(row.valid_from) > Date.now()) continue;
    if (row.valid_to && Date.parse(row.valid_to) < Date.now()) continue;
    add(evidence,'context_items',row,`${row.item_type}: ${row.content}`,
      (row.item_type==='fact' && row.confirmed===true) ||
      (row.item_type==='signal' && Number(row.confidence)>=0.6),
      row.created_at, row.confirmed ? 'confirmed_fact' : row.item_type);
  }
  for (const row of attended) {
    const activity=activityById.get(String(row.activity_id));
    if (activity) add(evidence,'activity_participants',row,
      `已到场活动：${clip(activity.name,120)}。${clip(row.relationship_note,150)}`,
      false,activity.activity_date,'attended_not_need');
  }
  for (const row of recruit) add(evidence,'recruit_candidates',row,
    `增员阶段：${clip(row.stage,60)}；动机：${clip(row.motivation,120)}；顾虑：${clip(row.concerns,120)}；规划：${clip(row.career_plan,120)}`,
    Boolean(clip(row.motivation)||clip(row.concerns)||clip(row.career_plan)),row.updated_at,'recruit_profile');
  for (const row of recruitFollowups) if (!represented.has(`recruit_followups#${row.id}`)) {
    add(evidence,'recruit_followups',row,
      row.interaction_summary || row.followup_notes,true,row.followup_date,'recruit_followup');
  }
  for (const row of reports) add(evidence,'policy_review_reports',row,
    row.edited_gaps || row.edited_recommendations || row.gaps_found || row.summary,
    Boolean(row.edited_gaps || row.edited_recommendations),row.report_date,
    row.edited_gaps || row.edited_recommendations ? 'human_edited_review' : 'unverified_review');
  for (const row of products) add(evidence,'products',row,
    '已有保单产品记录；需要人工检查保障内容，不能据此推断缺口。',false,row.created_at,'coverage_exists');
  for (const row of ocr) add(evidence,'ocr_records',row,
    `OCR 摘要：${clip(row.summary,200)}`,false,row.created_at,'unverified_ocr');
  for (const row of photos) add(evidence,'photos',row,
    `证据资料：${clip(row.category,70)} ${clip(row.photo_notes,160)}`,false,row.created_at,'photo_metadata');
  const deduped=[...new Map(evidence.map(x=>[x.ref,x])).values()].slice(0,30);
  return { person:{ id, displayName:clip(person.display_name,160),
    occupation:clip(person.occupation,120),organization:clip(person.organization,120) },
    evidence:deduped,
    existing_opportunities:opportunities.map(o=>({id:o.id,type:o.opportunity_type,
      status:o.status,reason:clip(o.last_progress,160)})),
    guidance:{ rules:'只提出一个有具体正面证据的待审核机会；无证据则 insufficient_evidence。报名不等于到场，到场本身不等于需求。已有保单或缺少记录不等于保障缺口。未核实的 OCR、AI 报告或推断不能单独支持机会。sourceRefs 只能引用所给 evidence.ref，不能创造人员或事实。' },
  };
}

function verifyCandidate(result, context) {
  if (result.status !== 'candidate') return { status:'insufficient_evidence' };
  const byRef=new Map(context.evidence.map(e=>[e.ref,e]));
  const refs=result.sourceRefs;
  if (!Array.isArray(refs) || !refs.length || refs.length>8 ||
      !refs.every(ref=>byRef.has(ref)) ||
      !refs.some(ref=>byRef.get(ref).primary) ||
      !String(result.reason||'').trim() || !String(result.nextAction||'').trim()) {
    return { status:'insufficient_evidence' };
  }
  return { status:'candidate', draft:{ opportunity_type:result.opportunityType,
    reason:result.reason.trim(), next_action:result.nextAction.trim() },
    evidence:refs, confidence:result.confidence };
}

module.exports={ buildCandidateContext,verifyCandidate,idOf };
