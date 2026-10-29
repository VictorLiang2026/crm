/**
 * activities — 轻量活动经营 CRUD（事件云函数，rdb() 版）
 * 入参 event: { action, ... }
 *   list:        { action:'list' } → { rows }（活动列表，倒序）
 *   get:         { action:'get', id } → { activity, participants }（活动详情+参与者）
 *   create:      { action:'create', data:{ name, activity_date?, activity_type?, location?, description? } } → { id }
 *   update:      { action:'update', id, data:{...} } → { ok }
 *   remove:      { action:'remove', id } → { ok }（软删除）
 *   addParticipant:     { action:'addParticipant', data:{ activity_id, person_type, person_id?, person_name?, status?, relationship_note? } }
 *                         person_id 有值=关联已有客户/增员（回填 person_name）；无值=按姓名暂存，待后续 linkParticipant 关联
 *   searchPerson:       { action:'searchPerson', person_type, keyword } → { rows:[{id, name, occupation, phone?}] }（姓名/电话模糊，上限10）
 *   linkParticipant:    { action:'linkParticipant', id（participant 记录 id）, person_id } → { ok }（暂存记录关联到已有人员，回填姓名）
 *   updateParticipant:  { action:'updateParticipant', id, data:{ status?, relationship_note?, ai_followup_suggestion? } } → { ok }
 *   removeParticipant:  { action:'removeParticipant', id } → { ok }（软删除）
 *   listByPerson: { action:'listByPerson', person_type, person_id } → { rows }（某客户/增员参加的所有活动）
 */
'use strict';

const { rdb, nowIso, normFields, assertOk } = require('./db');

const ACT_FIELDS = ['name', 'activity_date', 'activity_type', 'location', 'description',
  'status', 'goal_types', 'target_participants', 'actual_participants', 'topic_ids',
  'review_summary', 'review_notes', 'review_score', 'reviewed_at'];
const PART_FIELDS = ['activity_id', 'person_type', 'person_id', 'person_name', 'status', 'relationship_note', 'ai_followup_suggestion',
  'participant_role', 'followup_status'];
var PT_ENUM = ['customer', 'recruit', 'speaker'];
var ST_ENUM = ['invited', 'attended', 'absent'];
var ACT_STATUS_ENUM = ['idea', 'preparing', 'confirmed', 'in_progress', 'ended', 'reviewed'];
var PARTICIPANT_ROLE_ENUM = ['attendee', 'speaker', 'organizer', 'partner', 'guest'];
var FOLLOWUP_STATUS_ENUM = ['none', 'pending', 'done', 'not_needed'];

// 增员视图由客户提供姓名，candidate_id 仍为候选人 ID；视图已过滤双方软删除。
function personTable(pt) {
  if (pt === 'recruit') return { table: 'v_recruit_candidates', idCol: 'candidate_id', nameCol: 'customer_name' };
  if (pt === 'speaker') return { table: 'activity_speakers', idCol: 'id', nameCol: 'name' };
  return { table: 'customers', idCol: 'Id', nameCol: 'customer_name' };
}

function personQuery(cfg, columns) {
  const q = rdb.from(cfg.table).select(columns);
  return cfg.table === 'v_recruit_candidates' ? q : q.is('deleted_at', null);
}

exports.main = async (event, context) => {
  try {
    const action = (event && event.action) || '';
    switch (action) {
      case 'list':            return await list(event);
      case 'directory':       return await directory(event);
      case 'get':             return await get(event);
      case 'create':          return await create(event);
      case 'update':          return await update(event);
      case 'updateConsole':   return await update(event, true);
      case 'updateStatus':    return await updateStatus(event);
      case 'getSummary':      return await getSummary(event);
      case 'remove':          return await remove(event);
      case 'previewRemove':   return await previewRemove(event);
      case 'removeConsole':   return await removeConsole(event);
      case 'addParticipant':     return await addParticipant(event);
      case 'searchPerson':      return await searchPerson(event);
      case 'linkParticipant':   return await linkParticipant(event);
      case 'updateParticipant':  return await updateParticipant(event);
      case 'updateParticipantConsole': return await updateParticipantConsole(event);
      case 'removeParticipant':  return await removeParticipant(event);
      case 'listByPerson':        return await listByPerson(event);
      case 'applyTopics':         return await applyTopics(event);
      case 'applyTopicsConsole':  return await applyTopics(event, true);
      case 'getActivityData':     return await getActivityData(event);
      default: return { error: 'unknown action: ' + action };
    }
  } catch (e) {
    return { error: e.message };
  }
};

async function list(event) {
  const r = assertOk(await rdb.from('activities').select()
    .is('deleted_at', null)
    .order('activity_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(100));
  return { rows: r.data || [] };
}

// Console activity directory. Keep the legacy list contract and its ordering unchanged.
async function directory(event) {
  const page = Number(event.page ?? 1), pageSize = Number(event.pageSize ?? 30);
  const keyword = String(event.keyword || '').trim().toLowerCase();
  const activityDate = String(event.activityDate || '');
  const sortField = event.sortField == null ? 'activity_date' : String(event.sortField);
  const sortDir = event.sortDir == null ? 'desc' : String(event.sortDir);
  if (!Number.isInteger(page) || page < 1 || page > 10000 ||
      !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50 || keyword.length > 120 ||
      (activityDate && !/^\d{4}-\d{2}-\d{2}$/.test(activityDate)) ||
      !['id', 'name', 'activity_date', 'activity_type'].includes(sortField) ||
      !['asc', 'desc'].includes(sortDir)) throw new Error('Invalid activity directory query');
  const ascending = sortDir === 'asc';
  const read = async (offset, count) => {
    let q = rdb.from('activities').select().is('deleted_at', null);
    if (activityDate) q = q.eq('activity_date', activityDate);
    q = q.order(sortField, { ascending, nullsFirst: false });
    if (sortField !== 'id') q = q.order('id', { ascending });
    const result = assertOk(await q.range(offset, offset + count - 1));
    return result.data || [];
  };
  const start = (page - 1) * pageSize;
  let rows = [];
  if (!keyword) {
    rows = await read(start, pageSize + 1);
  } else {
    let matched = 0;
    const startedAt = Date.now();
    for (let offset = 0; offset < 10000; offset += 200) {
      if (Date.now() - startedAt > 6000) throw new Error('ACTIVITY_SEARCH_LIMIT: narrow the search criteria');
      const batch = await read(offset, 201);
      for (const row of batch.slice(0, 200)) {
        if (![row.name, row.location, row.activity_type, row.description]
          .some(value => String(value || '').toLowerCase().includes(keyword))) continue;
        if (matched++ >= start) rows.push(row);
        if (rows.length > pageSize) break;
      }
      if (rows.length > pageSize || batch.length <= 200) break;
      if (offset >= 9800) throw new Error('ACTIVITY_SEARCH_LIMIT: narrow the search criteria');
    }
  }
  return { rows: rows.slice(0, pageSize), page, pageSize, hasMore: rows.length > pageSize, total: null };
}

async function get(event) {
  const id = parseInt(event.id, 10);
  if (!id) return { error: 'id required' };
  const a = assertOk(await rdb.from('activities').select()
    .eq('id', id).is('deleted_at', null).maybeSingle());
  if (!a.data) return { error: 'activity not found' };
  const p = assertOk(await rdb.from('activity_participants').select()
    .eq('activity_id', id).is('deleted_at', null)
    .order('created_at', { ascending: true }));
  const parts = await enrichParticipants(p.data || []);
  return { activity: a.data, participants: parts };
}

// 老记录 person_name 为空但已关联 person_id 时，批量从客户/增员/嘉宾表回填姓名
// PMC-14：有 canonical_person_id 的行新增返回 canonicalPersonId（字符串，R-ID1），
// 展示名 Person 优先（persons.display_name；Person 已软删时回退快照/回填名）。
// 覆盖仅作用于返回值，不写库——快照列 person_name 保持不可变（D6）。
async function enrichParticipants(parts) {
  const needByType = { customer: [], recruit: [], speaker: [] };
  const canonicalIds = [];
  parts.forEach(function (it) {
    if (it.canonical_person_id) canonicalIds.push(it.canonical_person_id);
    if (it.person_id && !it.person_name && needByType[it.person_type]) {
      needByType[it.person_type].push(it.person_id);
    }
  });
  const personMap = {};
  if (canonicalIds.length) {
    const psRes = assertOk(await rdb.from('persons').select('id, display_name')
      .in('id', canonicalIds).is('deleted_at', null));
    (psRes.data || []).forEach(function (p) { personMap[p.id] = p.display_name; });
  }
  const nameMap = {};
  for (const pt of PT_ENUM) {
    const ids = needByType[pt];
    if (!ids || !ids.length) continue;
    const cfg = personTable(pt);
    const q = await personQuery(cfg, cfg.idCol + ',' + cfg.nameCol)
      .in(cfg.idCol, ids);
    (q.data || []).forEach(function (row) { nameMap[pt + ':' + row[cfg.idCol]] = row[cfg.nameCol]; });
  }
  // 查询只补齐返回姓名；持久化由显式新增/关联参与者操作负责。
  parts.forEach(function (it) {
    const nm = nameMap[it.person_type + ':' + it.person_id];
    if (nm) {
      it.person_name = nm;
    }
  });
  // canonical 展示名最后生效（Person 优先）；canonicalPersonId 一律字符串输出
  parts.forEach(function (it) {
    if (!it.canonical_person_id) return;
    it.canonicalPersonId = String(it.canonical_person_id);
    const pn = personMap[it.canonical_person_id];
    if (pn) it.person_name = pn;
  });
  return parts;
}

async function create(event) {
  const data = Object.assign({}, event.data || {});
  if (!data.name) return { error: 'name required' };
  // 校验 status
  if (data.status && ACT_STATUS_ENUM.indexOf(data.status) < 0) return { error: '无效 status，允许: ' + ACT_STATUS_ENUM.join('/') };
  // goal_types 字符串 → 数组
  if (typeof data.goal_types === 'string') {
    data.goal_types = data.goal_types.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
  }
  // 校验 target/actual participants
  if (data.target_participants != null) {
    data.target_participants = parseInt(data.target_participants, 10);
    if (isNaN(data.target_participants) || data.target_participants < 0) return { error: 'target_participants 必须是非负整数' };
  }
  data.created_at = nowIso();
  data.updated_at = nowIso();
  const payload = normFields(data, ACT_FIELDS.concat(['created_at', 'updated_at']));
  const r = assertOk(await rdb.from('activities').insert(payload).select('id'));
  return { id: r.data[0].id };
}

async function update(event, consoleScoped) {
  const id = parseInt(event.id, 10);
  if (!id) return { error: 'id required' };
  const expectedUpdatedAt = consoleScoped ? String(event.expectedUpdatedAt || '') : '';
  if (consoleScoped && (!expectedUpdatedAt || !Number.isFinite(Date.parse(expectedUpdatedAt)))) {
    return { error: 'activity version required' };
  }
  const data = Object.assign({}, event.data || {});
  // 校验 status
  if (data.status && ACT_STATUS_ENUM.indexOf(data.status) < 0) return { error: '无效 status，允许: ' + ACT_STATUS_ENUM.join('/') };
  // 校验 goal_types（字符串 → 数组）
  if (typeof data.goal_types === 'string') {
    data.goal_types = data.goal_types.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
  }
  if (Array.isArray(data.goal_types) && !data.goal_types.every(function(g){ return typeof g === 'string'; })) {
    return { error: 'goal_types 必须是字符串数组' };
  }
  // 校验 target/actual participants
  if (data.target_participants != null) {
    data.target_participants = parseInt(data.target_participants, 10);
    if (isNaN(data.target_participants) || data.target_participants < 0) return { error: 'target_participants 必须是非负整数' };
  }
  if (data.actual_participants != null) {
    data.actual_participants = parseInt(data.actual_participants, 10);
    if (isNaN(data.actual_participants) || data.actual_participants < 0) return { error: 'actual_participants 必须是非负整数' };
  }
  // 校验 review_score
  if (data.review_score != null) {
    data.review_score = parseInt(data.review_score, 10);
    if (isNaN(data.review_score) || data.review_score < 1 || data.review_score > 5) return { error: 'review_score 必须是 1-5' };
  }
  const payload = normFields(
    Object.assign({}, data, { updated_at: nowIso() }),
    ACT_FIELDS.concat(['updated_at'])
  );
  if (!Object.keys(payload).length) return { ok: true, updated: false };
  let query = rdb.from('activities').update(payload).eq('id', id).is('deleted_at', null);
  if (consoleScoped) query = query.eq('updated_at', expectedUpdatedAt);
  const r = assertOk(await query.select('id'));
  return (r.data || []).length === 1 ? { ok: true } : { error: 'activity changed or unavailable' };
}

// 更新活动状态（切到 reviewed 时自动记录 reviewed_at）
async function updateStatus(event) {
  const id = parseInt(event.id, 10);
  if (!id) return { error: 'id required' };
  const status = event.status;
  if (!status || ACT_STATUS_ENUM.indexOf(status) < 0) return { error: '无效的 status，允许: ' + ACT_STATUS_ENUM.join('/') };
  const payload = { status: status, updated_at: nowIso() };
  if (status === 'reviewed') payload.reviewed_at = nowIso();
  const r = assertOk(await rdb.from('activities').update(payload).eq('id', id).select('id'));
  return { ok: (r.data || []).length === 1 };
}

// 活动摘要：基础信息 + 参与者人数统计（按角色/按跟进状态）
async function getSummary(event) {
  const id = parseInt(event.id, 10);
  if (!id) return { error: 'id required' };
  const a = assertOk(await rdb.from('activities').select()
    .eq('id', id).is('deleted_at', null).maybeSingle());
  if (!a.data) return { error: 'activity not found' };
  const activity = a.data;
  // 统计参与者人数
  const p = assertOk(await rdb.from('activity_participants').select('id, participant_role, followup_status')
    .eq('activity_id', id).is('deleted_at', null));
  const parts = p.data || [];
  const participant_counts = {
    total: parts.length,
    by_role: {},
    by_followup_status: {},
  };
  PARTICIPANT_ROLE_ENUM.forEach(function (r) { participant_counts.by_role[r] = 0; });
  FOLLOWUP_STATUS_ENUM.forEach(function (r) { participant_counts.by_followup_status[r] = 0; });
  parts.forEach(function (it) {
    if (it.participant_role && participant_counts.by_role[it.participant_role] !== undefined) {
      participant_counts.by_role[it.participant_role]++;
    } else if (!it.participant_role) {
      participant_counts.by_role.attendee++;
    }
    if (it.followup_status && participant_counts.by_followup_status[it.followup_status] !== undefined) {
      participant_counts.by_followup_status[it.followup_status]++;
    } else if (!it.followup_status) {
      participant_counts.by_followup_status.none++;
    }
  });
  return { activity: activity, participant_counts: participant_counts };
}

async function remove(event) {
  const id = parseInt(event.id, 10);
  if (!id) return { error: 'id required' };
  const r = assertOk(await rdb.from('activities')
    .update({ deleted_at: nowIso(), updated_at: nowIso() }).eq('id', id).select('id'));
  // 软删除参与者
  await rdb.from('activity_participants')
    .update({ deleted_at: nowIso() }).eq('activity_id', id);
  return { ok: (r.data || []).length === 1 };
}

// Console deletion preview keeps the legacy remove action untouched. The new page
// presents the server-computed participant cascade and names records left intact.
async function previewRemove(event) {
  const id = parseInt(event.id, 10);
  if (!Number.isSafeInteger(id) || id < 1) return { error: 'id required' };
  const activity = assertOk(await rdb.from('activities').select('id,name,activity_date,updated_at')
    .eq('id', id).is('deleted_at', null).maybeSingle());
  if (!activity.data) return { error: 'activity not found' };
  const [participants, tasks, actions] = await Promise.all([
    rdb.from('activity_participants').select('id').eq('activity_id', id),
    rdb.from('activity_tasks').select('id').eq('activity_id', id),
    rdb.from('actions').select('id').eq('activity_id', id),
  ]);
  const participantRows = assertOk(participants).data || [];
  const taskRows = assertOk(tasks).data || [];
  const actionRows = assertOk(actions).data || [];
  return { activity: activity.data, impact: {
    participantsSoftDeleted: participantRows.length,
    preparationTasksRetained: taskRows.length,
    actionsRetained: actionRows.length,
  } };
}

async function removeConsole(event) {
  const id = parseInt(event.id, 10);
  const expectedUpdatedAt = String(event.expectedUpdatedAt || '');
  const expectedParticipantCount = Number(event.expectedParticipantCount);
  if (!Number.isSafeInteger(id) || id < 1 || !expectedUpdatedAt ||
      !Number.isFinite(Date.parse(expectedUpdatedAt)) || !Number.isInteger(expectedParticipantCount) ||
      expectedParticipantCount < 0) return { error: 'activity impact preview required' };
  const current = assertOk(await rdb.from('activities').select('id,updated_at')
    .eq('id', id).is('deleted_at', null).maybeSingle());
  if (!current.data || current.data.updated_at !== expectedUpdatedAt) {
    return { error: 'activity changed; reload the impact preview' };
  }
  const participants = assertOk(await rdb.from('activity_participants').select('id')
    .eq('activity_id', id));
  if ((participants.data || []).length !== expectedParticipantCount) {
    return { error: 'participants changed; reload the impact preview' };
  }
  return remove({ id });
}

// 搜索人员（姓名/电话模糊），供前端添加参与者时联想
async function searchPerson(event) {
  const pt = event.person_type;
  if (PT_ENUM.indexOf(pt) < 0) return { error: '无效的 person_type' };
  const kw = String(event.keyword || '').trim();
  if (kw.length < 1) return { rows: [] };
  const cfg = personTable(pt);
  // 各类型的附加展示列：客户=职业+电话；增员=职业；嘉宾=机构+职务+电话
  const EXTRA = {
    customer: 'occupation, phone',
    recruit: 'occupation',
    speaker: 'organization, position, phone',
  };
  // 转义 postgrest 保留字符
  const safeKw = kw.replace(/[%,_()\\]/g, function (c) { return '\\' + c; });
  let q = personQuery(cfg, cfg.idCol + ', ' + cfg.nameCol + ', ' + EXTRA[pt]);
  // 嘉宾仅可加入启用中的；停用嘉宾不进入联想结果
  if (pt === 'speaker') q = q.eq('status', 'active');
  // 姓名模糊；客户/嘉宾额外支持电话匹配（仅当关键词含数字时才加电话条件，避免 ilike '%%' 匹配全部）
  let orCond = cfg.nameCol + '.ilike.%' + safeKw + '%';
  if (pt === 'customer') {
    const digits = kw.replace(/[^0-9]/g, '');
    if (digits) orCond += ',phone.ilike.%' + digits + '%';
  } else if (pt === 'speaker') {
    // 嘉宾：姓名/机构/专业/主题任一命中
    orCond += ',organization.ilike.%' + safeKw + '%,expertise.ilike.%' + safeKw + '%,topic_summary.ilike.%' + safeKw + '%';
    const digits = kw.replace(/[^0-9]/g, '');
    if (digits) orCond += ',phone.ilike.%' + digits + '%';
  }
  q = q.or(orCond);
  const r = assertOk(await q.limit(10));
  const rows = (r.data || []).map(function (row) {
    return {
      id: row[cfg.idCol],
      name: row[cfg.nameCol],
      occupation: row.occupation || row.organization || '',
      phone: row.phone || '',
    };
  });
  return { rows: rows };
}

async function addParticipant(event) {
  const data = Object.assign({}, event.data || {});
  if (PT_ENUM.indexOf(data.person_type) < 0) return { error: '无效的 person_type' };
  if (!data.activity_id) return { error: 'activity_id required' };
  // 检查活动存在
  const a = assertOk(await rdb.from('activities').select('id').eq('id', data.activity_id).is('deleted_at', null).maybeSingle());
  if (!a.data) return { error: 'activity not found' };

  const cfg = personTable(data.person_type);
  var pid = parseInt(data.person_id, 10);
  if (pid) {
    // 关联已有人员：校验存在并回填姓名
    const p = assertOk(await personQuery(cfg, cfg.idCol + ', ' + cfg.nameCol)
      .eq(cfg.idCol, pid).maybeSingle());
    if (!p.data) return { error: '未找到该' + ({ customer: '客户', recruit: '增员对象', speaker: '嘉宾' }[data.person_type] || '人员') };
    data.person_id = pid;
    data.person_name = p.data[cfg.nameCol];
    // 去重：同一活动同一人不重复添加
    const dup = assertOk(await rdb.from('activity_participants').select('id')
      .eq('activity_id', data.activity_id).eq('person_type', data.person_type)
      .eq('person_id', pid).is('deleted_at', null));
    if (dup.data && dup.data.length) return { error: '已添加该参与者', id: dup.data[0].id };
  } else {
    // 未关联：按姓名暂存，待后续 linkParticipant 关联
    data.person_id = null;
    data.person_name = String(data.person_name || '').trim();
    if (!data.person_name) return { error: '请填写姓名，或从搜索结果中选择已有客户/增员对象' };
    // 去重：同活动同类型同名暂存记录不重复
    const dup = assertOk(await rdb.from('activity_participants').select('id')
      .eq('activity_id', data.activity_id).eq('person_type', data.person_type)
      .is('person_id', null).eq('person_name', data.person_name).is('deleted_at', null));
    if (dup.data && dup.data.length) return { error: '已添加该参与者（待关联）', id: dup.data[0].id };
  }
  if (!data.status) data.status = 'invited';
  if (data.participant_role && PARTICIPANT_ROLE_ENUM.indexOf(data.participant_role) < 0) return { error: '无效 participant_role' };
  if (!data.participant_role) data.participant_role = 'attendee';
  if (!data.followup_status) data.followup_status = 'none';
  data.created_at = nowIso();
  const payload = normFields(data, PART_FIELDS.concat(['created_at']));
  const r = assertOk(await rdb.from('activity_participants').insert(payload).select('id'));
  return { id: r.data[0].id, linked: !!pid };
}

// 暂存参与者关联到已有人员
async function linkParticipant(event) {
  const id = parseInt(event.id, 10);
  const pid = parseInt(event.person_id, 10);
  if (!id || !pid) return { error: 'id 和 person_id 必填' };
  const rec = assertOk(await rdb.from('activity_participants').select()
    .eq('id', id).is('deleted_at', null).maybeSingle());
  if (!rec.data) return { error: '参与者记录不存在' };
  if (rec.data.person_id) return { error: '该参与者已关联' };
  if (PT_ENUM.indexOf(rec.data.person_type) < 0) return { error: '参与者类型无效' };
  const cfg = personTable(rec.data.person_type);
  const p = assertOk(await personQuery(cfg, cfg.idCol + ', ' + cfg.nameCol)
    .eq(cfg.idCol, pid).maybeSingle());
  if (!p.data) return { error: '未找到该' + ({ customer: '客户', recruit: '增员对象', speaker: '嘉宾' }[rec.data.person_type] || '人员') };
  // 同活动同人已关联则不重复
  const dup = assertOk(await rdb.from('activity_participants').select('id')
    .eq('activity_id', rec.data.activity_id).eq('person_type', rec.data.person_type)
    .eq('person_id', pid).is('deleted_at', null));
  if (dup.data && dup.data.length) return { error: '该人员已在活动参与者中' };
  const r = assertOk(await rdb.from('activity_participants')
    .update({ person_id: pid, person_name: p.data[cfg.nameCol] })
    .eq('id', id).select('id'));
  return { ok: (r.data || []).length === 1, name: p.data[cfg.nameCol] };
}

async function updateParticipant(event) {
  const id = parseInt(event.id, 10);
  if (!id) return { error: 'id required' };
  const data = Object.assign({}, event.data || {});
  if (data.status && ST_ENUM.indexOf(data.status) < 0) return { error: '无效 status' };
  if (data.participant_role && PARTICIPANT_ROLE_ENUM.indexOf(data.participant_role) < 0) return { error: '无效 participant_role' };
  if (data.followup_status && FOLLOWUP_STATUS_ENUM.indexOf(data.followup_status) < 0) return { error: '无效 followup_status' };
  const payload = normFields(
    Object.assign({}, data, { updated_at: nowIso() }),
    ['status', 'relationship_note', 'ai_followup_suggestion', 'participant_role', 'followup_status', 'updated_at']
  );
  if (!Object.keys(payload).length) return { ok: true, updated: false };
  const r = assertOk(await rdb.from('activity_participants').update(payload).eq('id', id).select('id'));
  return { ok: (r.data || []).length === 1 };
}

// Console status changes are activity-scoped and reject stale participant versions.
// Attendance remains a participation fact; this action never creates an Interaction.
async function updateParticipantConsole(event) {
  const id = parseInt(event.id, 10), activityId = parseInt(event.activity_id, 10);
  const expectedUpdatedAt = String(event.expectedUpdatedAt || ''), expectedStatus = event.expectedStatus;
  const status = event.status;
  if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(activityId) || activityId < 1 ||
      !expectedUpdatedAt || !Number.isFinite(Date.parse(expectedUpdatedAt)) ||
      ST_ENUM.indexOf(expectedStatus) < 0 || ST_ENUM.indexOf(status) < 0) {
    return { error: 'participant activity scope and version required' };
  }
  const activity = assertOk(await rdb.from('activities').select('id')
    .eq('id', activityId).is('deleted_at', null).maybeSingle());
  if (!activity.data) return { error: 'activity not found' };
  const saved = assertOk(await rdb.from('activity_participants').update({ status, updated_at: nowIso() })
    .eq('id', id).eq('activity_id', activityId).eq('status', expectedStatus)
    .eq('updated_at', expectedUpdatedAt).is('deleted_at', null).select('id'));
  return (saved.data || []).length === 1 ? { ok: true } : { error: 'participant changed or unavailable' };
}

async function removeParticipant(event) {
  const id = parseInt(event.id, 10);
  if (!id) return { error: 'id required' };
  const r = assertOk(await rdb.from('activity_participants')
    .update({ deleted_at: nowIso() }).eq('id', id).select('id'));
  return { ok: (r.data || []).length === 1 };
}

async function listByPerson(event) {
  const pt = event.person_type;
  const pid = parseInt(event.person_id, 10);
  if (PT_ENUM.indexOf(pt) < 0 || !pid) return { error: 'person_type and person_id required' };
  const r = assertOk(await rdb.from('activity_participants').select('activity_id, status, relationship_note, ai_followup_suggestion, created_at')
    .eq('person_type', pt).eq('person_id', pid).is('deleted_at', null)
    .order('created_at', { ascending: false }));
  var rows = r.data || [];
  // 批量查活动信息
  if (rows.length) {
    var ids = rows.map(function(r){ return r.activity_id; });
    var acts = assertOk(await rdb.from('activities').select('id, name, activity_date, activity_type, location')
      .in('id', ids).is('deleted_at', null));
    var map = {};
    (acts.data || []).forEach(function(a){ map[a.id] = a; });
    rows.forEach(function(r){ r.activity = map[r.activity_id] || null; });
  }
  return { rows: rows };
}

// 保存活动主题（v1.7.4 Activity Topic Pool）：
// 更新 activities.topic_ids；对"新采用"的主题 use_count+1、last_used_date=活动日期（无日期取今天）。
// 移除主题不回退计数（保留历史使用事实）；同一活动重复保存不重复计数（差集计算）。
async function applyTopics(event, consoleScoped) {
  const id = parseInt(event.id, 10);
  if (!id) return { error: 'id required' };
  // 规范化 topic_ids：正整数数组、去重
  let ids = Array.isArray(event.topic_ids) ? event.topic_ids : [];
  ids = ids.map(function (t) { return parseInt(t, 10); }).filter(function (t) { return t && t > 0; });
  ids = Array.from(new Set(ids));

  // 活动存在且未删除
  const a = assertOk(await rdb.from('activities').select('id, topic_ids, activity_date, updated_at')
    .eq('id', id).is('deleted_at', null).maybeSingle());
  if (!a.data) return { error: 'activity not found' };
  if (consoleScoped) {
    const expectedUpdatedAt = String(event.expectedUpdatedAt || '');
    const expectedTopicIds = Array.isArray(event.expectedTopicIds) ? event.expectedTopicIds.map(Number) : null;
    const currentIds = Array.isArray(a.data.topic_ids) ? a.data.topic_ids.map(Number) : [];
    if (!expectedUpdatedAt || !Number.isFinite(Date.parse(expectedUpdatedAt)) ||
        a.data.updated_at !== expectedUpdatedAt || !expectedTopicIds ||
        currentIds.length !== expectedTopicIds.length || currentIds.some((value, index) => value !== expectedTopicIds[index])) {
      return { error: 'activity topics changed; reload before saving' };
    }
  }

  // 过滤掉已删除/不存在的主题 id
  let validIds = ids;
  if (ids.length) {
    const t = assertOk(await rdb.from('activity_topics').select('id')
      .in('id', ids).is('deleted_at', null));
    const exist = {};
    (t.data || []).forEach(function (x) { exist[x.id] = true; });
    validIds = ids.filter(function (x) { return exist[x]; });
  }

  // 更新活动 topic_ids
  let activityUpdate = rdb.from('activities').update({ topic_ids: validIds, updated_at: nowIso() })
    .eq('id', id).is('deleted_at', null);
  if (consoleScoped) activityUpdate = activityUpdate.eq('updated_at', String(event.expectedUpdatedAt));
  const updated = assertOk(await activityUpdate.select('id'));
  if (!(updated.data || []).length) return { error: 'activity topics changed; reload before saving' };

  // 差集：本次新采用的主题才计数
  const oldIds = Array.isArray(a.data.topic_ids)
    ? a.data.topic_ids.map(function (x) { return parseInt(x, 10); }).filter(Boolean) : [];
  const oldMap = {};
  oldIds.forEach(function (x) { oldMap[x] = true; });
  const added = validIds.filter(function (x) { return !oldMap[x]; });

  if (added.length) {
    // 最近使用日期：活动日期优先，否则取北京时间今天
    let usedDate = a.data.activity_date ? String(a.data.activity_date).slice(0, 10) : null;
    if (!usedDate || !/^\d{4}-\d{2}-\d{2}$/.test(usedDate)) {
      usedDate = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    }
    for (const tid of added) {
      const cur = assertOk(await rdb.from('activity_topics').select('use_count')
        .eq('id', tid).maybeSingle());
      const next = (cur.data && typeof cur.data.use_count === 'number' ? cur.data.use_count : 0) + 1;
      assertOk(await rdb.from('activity_topics')
        .update({ use_count: next, last_used_date: usedDate, updated_at: nowIso() })
        .eq('id', tid));
    }
  }

  return { ok: true, topic_ids: validIds, added: added };
}

// 活动复盘数据：互动记录 + 机会候选（委托 person_360 查询，因 interactions 表权限在 person_360）
async function getActivityData(event) {
  const id = parseInt(event.id, 10);
  if (!id) return { error: 'id required' };
  const cloudbase = require('@cloudbase/node-sdk');
  const app = cloudbase.init({ env: process.env.TCB_ENV });
  const res = await app.callFunction({
    name: 'person_360',
    data: { action: 'listActivityData', activityId: String(id) },
  });
  return res.result;
}
