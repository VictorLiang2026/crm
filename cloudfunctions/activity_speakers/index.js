/**
 * activity_speakers — 活动嘉宾资源池（v1.7.3 Activity Speaker Pool）
 *
 * actions:
 *   list    {keyword?, status?, stage?}                        → { rows:[嘉宾全字段 + linked_customer/linked_recruit] }   （姓名/机构/专业/主题 模糊 + 状态/阶段筛选）
 *   get     {id}                                               → { speaker }  （含 linked_customer/linked_recruit）
 *   create  {data:{name, ...}}                                 → { id }
 *   update  {id, data:{...}}                                   → { ok:true }
 *   remove  {id}                                               → { ok:true }  （软删除：置 deleted_at）
 *   search  {keyword}                                          → { rows:[{id,name,organization,position,phone,expertise,topic_summary}] }
 *                                                                   （活动添加嘉宾时的联想：姓名/机构/专业/主题）
 *
 * 约束：relationship_stage/status 枚举校验；cooperation_count 非负整数；本版本 cooperation_count 仅手动维护。
 */
'use strict';

const { rdb, normFields, assertOk, nowIso } = require('./db');
const { directoryPage, contactFilter } = require('./resource-directory');

const SP_FIELDS = ['name', 'position', 'relationship_stage',
  'expertise', 'topic_summary', 'last_contact_date', 'next_contact_date', 'last_contact_note',
  'cooperation_count', 'preferred_format', 'status', 'customer_id', 'recruit_candidate_id', 'notes'];
const STAGE_ENUM = ['new', 'contacted', 'cooperated', 'stable', 'deep', 'inactive'];
const STATUS_ENUM = ['active', 'inactive'];

exports.main = async (event, context) => {
  try {
    const action = (event && event.action) || '';
    switch (action) {
      case 'list':    return await list(event);
      case 'directory': return await directory(event);
      case 'get':     return await get(event);
      case 'create':  return await create(event);
      case 'update':  return await update(event);
      case 'remove':  return await remove(event);
      case 'previewRemoveConsole': return await previewRemoveConsole(event);
      case 'removeConsole': return await removeConsole(event);
      case 'search':  return await search(event);
      default: return { error: 'unknown action: ' + action };
    }
  } catch (e) {
    return { error: e.message };
  }
};

// 枚举/数值校验（create/update 共用）
function normSpeaker(data) {
  const d = Object.assign({}, data || {});
  if (d.relationship_stage && STAGE_ENUM.indexOf(d.relationship_stage) < 0) {
    return { error: '无效 relationship_stage，允许: ' + STAGE_ENUM.join('/') };
  }
  if (d.status && STATUS_ENUM.indexOf(d.status) < 0) {
    return { error: '无效 status，允许: ' + STATUS_ENUM.join('/') };
  }
  if (d.cooperation_count != null) {
    d.cooperation_count = parseInt(d.cooperation_count, 10);
    if (isNaN(d.cooperation_count) || d.cooperation_count < 0) return { error: 'cooperation_count 必须是非负整数' };
  }
  if (d.customer_id != null) d.customer_id = parseInt(d.customer_id, 10) || null;
  if (d.recruit_candidate_id != null) d.recruit_candidate_id = parseInt(d.recruit_candidate_id, 10) || null;
  return { data: d };
}

// 转义 postgrest ilike 保留字符（与 activities.searchPerson 同款）
function safeKw(s) {
  return String(s || '').replace(/[%,_()\\]/g, function (c) { return '\\' + c; });
}

function kwOrCond(kw, personIds = []) {
  const s = safeKw(kw);
  const parts = ['name', 'expertise', 'topic_summary']
    .map(function (c) { return c + '.ilike.%' + s + '%'; });
  if (personIds.length) parts.push('person_id.in.(' + personIds.join(',') + ')');
  return parts.join(',');
}

async function matchingPersonIds(kw) {
  const safe = safeKw(kw);
  const result = assertOk(await rdb.from('persons').select('id')
    .or('organization.ilike.%' + safe + '%,phone.ilike.%' + safe + '%')
    .is('deleted_at', null).limit(100));
  return (result.data || []).map(row => String(row.id)).filter(id => /^\d+$/.test(id));
}

// 身份合并（PMC-13：Person 优先读基础信息，customers 回退；弱关联只读展示，失败不阻塞主流程）
async function enrichIdentity(rows, strict = false) {
  if (!rows || !rows.length) return rows;
  var pids = [], cids = [], rids = [];
  rows.forEach(function (r) {
    if (r.person_id != null) pids.push(r.person_id);
    if (r.customer_id != null) cids.push(r.customer_id);
    if (r.recruit_candidate_id != null) rids.push(r.recruit_candidate_id);
  });
  var pmap = {}, cmap = {}, rmap = {};
  // Person 优先读基础信息（裁决①）
  if (pids.length) {
    try {
      var pr = assertOk(await rdb.from('persons')
        .select('id, display_name, phone, wechat, organization, occupation')
        .in('id', pids).is('deleted_at', null));
      (pr.data || []).forEach(function (p) { pmap[p.id] = p; });
    } catch (e) { if (strict) throw e; /* Legacy Person 合并失败不阻塞 */ }
  }
  if (cids.length) {
    try {
      // PMC-20：客户展示名取 Person（customers.customer_name 已退出，CL-02）
      var cr = assertOk(await rdb.from('customers').select('Id, person_id').in('Id', cids).is('deleted_at', null));
      var custRows = cr.data || [];
      var custPids = custRows.map(function (c) { return c.person_id; }).filter(Boolean);
      var custPmap = {};
      if (custPids.length) {
        var cpr = assertOk(await rdb.from('persons').select('id, display_name')
          .in('id', custPids).is('deleted_at', null));
        (cpr.data || []).forEach(function (p) { custPmap[p.id] = p.display_name; });
      }
      custRows.forEach(function (c) { cmap[c.Id] = { id: c.Id, name: (c.person_id && custPmap[c.person_id]) || '' }; });
    } catch (e) { /* 客户身份合并失败不阻塞 */ }
  }
  if (rids.length) {
    try {
      var rr = assertOk(await rdb.from('v_recruit_candidates').select('candidate_id, customer_id, customer_name').in('candidate_id', rids));
      (rr.data || []).forEach(function (c) { rmap[c.candidate_id] = { id: c.candidate_id, name: c.customer_name, customer_id: c.customer_id }; });
    } catch (e) { /* 增员视图不可用时降级 */ }
  }
  return rows.map(function (r) {
    var person = r.person_id != null ? (pmap[r.person_id] || null) : null;
    return Object.assign({}, r, {
      // Shared Person fields are authoritative; speaker rows retain role-specific attributes only.
      name: person && person.display_name ? person.display_name : r.name,
      phone: person ? person.phone : null,
      wechat: person ? person.wechat : null,
      organization: person ? person.organization : null,
      linked_person: person ? { id: r.person_id, name: person.display_name } : null,
      linked_customer: r.customer_id != null ? (cmap[r.customer_id] || null) : null,
      linked_recruit: r.recruit_candidate_id != null ? (rmap[r.recruit_candidate_id] || null) : null,
    });
  });
}

async function list(event) {
  let q = rdb.from('activity_speakers').select().is('deleted_at', null);
  const kw = String(event.keyword || '').trim();
  if (kw) q = q.or(kwOrCond(kw, await matchingPersonIds(kw)));
  if (event.status) q = q.eq('status', event.status);
  if (event.stage) q = q.eq('relationship_stage', event.stage);
  const r = assertOk(await q.order('updated_at', { ascending: false }).limit(100));
  return { rows: await enrichIdentity(r.data || []) };
}

async function directory(event) {
  return directoryPage(event, {
    read: async (options, offset, count) => {
      let q = rdb.from('activity_speakers').select().is('deleted_at', null);
      if (options.status) q = q.eq('status', options.status);
      if (options.stage) q = q.eq('relationship_stage', options.stage);
      q = contactFilter(q, options);
      const result = assertOk(await q.order('updated_at', { ascending: false })
        .order('id', { ascending: false }).range(offset, offset + count - 1));
      return result.data || [];
    },
    enrich: rows => enrichIdentity(rows, true),
    matches: (row, keyword) => [row.name, row.organization, row.phone, row.position,
      row.expertise, row.topic_summary, row.notes].some(value => String(value || '').toLowerCase().includes(keyword)),
  });
}

async function get(event) {
  const id = parseInt(event.id, 10);
  if (!id) return { error: 'id required' };
  const r = assertOk(await rdb.from('activity_speakers').select()
    .eq('id', id).is('deleted_at', null).maybeSingle());
  if (!r.data) return { error: 'speaker not found' };
  return { speaker: (await enrichIdentity([r.data]))[0] };
}

async function create(event) {
  const n = normSpeaker(event.data);
  if (n.error) return n;
  const d = n.data;
  if (!d.name || !String(d.name).trim()) return { error: 'name required' };
  // PMC-13：嘉宾身份不自动代表销售客户，不强制创建客户档案（裁决②）
  // 未传 customer_id 时不自动建客户；person_id 由 service_role 写入（走 person_360 入口）
  d.created_at = nowIso();
  d.updated_at = nowIso();
  const payload = normFields(d, SP_FIELDS.concat(['created_at', 'updated_at']));
  const r = assertOk(await rdb.from('activity_speakers').insert(payload).select('id'));
  return { id: r.data[0].id, customer_id: d.customer_id };
}

async function update(event) {
  const id = parseInt(event.id, 10);
  if (!id) return { error: 'id required' };
  const n = normSpeaker(event.data);
  if (n.error) return n;
  n.data.updated_at = nowIso();
  const payload = normFields(n.data, SP_FIELDS.concat(['updated_at']));
  const r = assertOk(await rdb.from('activity_speakers').update(payload)
    .eq('id', id).is('deleted_at', null).select('id'));
  if (!r.data || !r.data.length) return { error: 'speaker not found' };
  return { ok: true };
}

// 软删除（资源池数据可复用，不物理删除）
async function remove(event) {
  const id = parseInt(event.id, 10);
  if (!id) return { error: 'id required' };
  assertOk(await rdb.from('activity_speakers')
    .update({ deleted_at: nowIso(), updated_at: nowIso() })
    .eq('id', id));
  return { ok: true };
}

async function participantReferenceCount(id) {
  let total = 0, offset = 0;
  for (;;) {
    const result = assertOk(await rdb.from('activity_participants').select('id')
      .eq('person_type', 'speaker').eq('person_id', id).order('id', { ascending: true })
      .range(offset, offset + 500));
    const rows = result.data || [];
    total += Math.min(rows.length, 500);
    if (rows.length <= 500) return total;
    offset += 500;
    if (offset >= 100000) throw new Error('Speaker references exceed preview limit');
  }
}

async function previewRemoveConsole(event) {
  const id = parseInt(event.id, 10);
  if (!Number.isSafeInteger(id) || id < 1) return { error: 'speaker id required' };
  const result = assertOk(await rdb.from('activity_speakers').select('id,name,person_id,status,updated_at')
    .eq('id', id).is('deleted_at', null).maybeSingle());
  if (!result.data) return { error: 'speaker not found' };
  return { speaker: result.data, impact: { participantRows: await participantReferenceCount(id) } };
}

async function removeConsole(event) {
  const id = parseInt(event.id, 10), expectedUpdatedAt = String(event.expectedUpdatedAt || '');
  const expectedParticipantRows = Number(event.expectedParticipantRows);
  if (!Number.isSafeInteger(id) || id < 1 || !expectedUpdatedAt ||
      !Number.isFinite(Date.parse(expectedUpdatedAt)) || !Number.isInteger(expectedParticipantRows) ||
      expectedParticipantRows < 0) return { error: 'speaker impact preview required' };
  const current = assertOk(await rdb.from('activity_speakers').select('id,updated_at')
    .eq('id', id).is('deleted_at', null).maybeSingle());
  if (!current.data || current.data.updated_at !== expectedUpdatedAt) return { error: 'speaker changed; reload the impact preview' };
  const count = await participantReferenceCount(id);
  if (count !== expectedParticipantRows) return { error: 'speaker references changed; reload the impact preview' };
  if (count > 0) return { error: 'speaker has participant records; set inactive to retain the history' };
  const now = nowIso();
  const saved = assertOk(await rdb.from('activity_speakers').update({ deleted_at: now, updated_at: now })
    .eq('id', id).is('deleted_at', null).eq('updated_at', expectedUpdatedAt).select('id'));
  return (saved.data || []).length === 1 ? { ok: true } : { error: 'speaker changed; reload the impact preview' };
}

// 联想搜索（供 openPersonPickerModal 下拉）：姓名/机构/专业/主题
async function search(event) {
  const kw = String(event.keyword || '').trim();
  if (kw.length < 1) return { rows: [] };
  const personIds = await matchingPersonIds(kw);
  // 供添加参与者联想：仅返回启用中的嘉宾（停用嘉宾不在管理页 list 过滤，但不可加入活动）
  const r = assertOk(await rdb.from('activity_speakers')
    .select('id, name, position, expertise, topic_summary, person_id')
    .or(kwOrCond(kw, personIds))
    .is('deleted_at', null)
    .eq('status', 'active')
    .limit(10));
  return { rows: await enrichIdentity(r.data || []) };
}
