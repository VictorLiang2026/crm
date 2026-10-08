/**
 * customers — 客户 CRUD（事件云函数，rdb() 版）
 * 入参 event: { action, ... }
 *   list:   { action:'list', page?, pageSize?, keyword?, exactName?, sortField?, sortDir?, today? } → { rows, total, page, pageSize }
 *   get:    { action:'get', id } → { customer, followups, products, gifts, photos, recommendations, reports }
 *           reports = 保单检视报告最近 10 条（按 report_date DESC, id DESC）
 *   create: { action:'create', data:{...} } → { id }
 *   update: { action:'update', id, data:{...} } → { ok }
 *   remove: { action:'remove', id } → { ok, cascaded }（软删除 deleted_at，级联标记子记录）
 *   trashList: { action:'trashList', page?, pageSize?, keyword?, sortDir? } → { rows, total, page, pageSize }
 *              （回收站：已删除客户 + 级联删除的子记录计数，默认按删除时间倒序）
 *   restore: { action:'restore', ids:[...] } → { ok, restored, cascaded, legacy_restored }
 *            （新记录按删除批次精确恢复；历史无批次记录只恢复客户）
 * photos 仅返回元数据（不含 base64），需单独调 photos.get 取图。
 */
'use strict';

const { rdb, nowIso, normFields, assertOk } = require('./db');

const FIELDS = [
  'customer_name', 'sales_priority', 'recruitment_priority', 'referral_priority',
  'hobbies', 'additional_info', 'gender', 'source', 'tags', 'marital_status',
  'properties_info', 'occupation', 'annual_income', 'household_income',
  'first_contact_date', 'birthday', 'customer_stage', 'phone',
  'profile', // 轻量客户画像 jsonb：{family,children,parents,career,needs,relationship,events[]}
];

// 分页 RPC 保持旧列表字段完整：AI 解析同名匹配仍把返回行作为 oldC。

exports.main = async (event, context) => {
  try {
    const action = (event && event.action) || '';
    switch (action) {
      case 'list':   return await list(event);
      case 'get':    return await get(event);
      case 'create': return await create(event);
      case 'update': return await update(event);
      case 'remove': return await remove(event);
      case 'trashList': return await trashList(event);
      case 'restore': return await restore(event);
      default: return { error: 'unknown action: ' + action };
    }
  } catch (e) {
    return { error: e.message };
  }
};

async function list(event) {
  const parsedPage = parseInt(event.page, 10);
  const parsedSize = parseInt(event.pageSize, 10);
  const page = Number.isFinite(parsedPage) ? Math.max(1, Math.min(1000000, parsedPage)) : 1;
  const pageSize = Number.isFinite(parsedSize) ? Math.max(1, Math.min(1000, parsedSize)) : 20;
  const sortField = ['Id', 'customer_name', 'sales_priority', 'latest_followup_date',
    'next_followup_date', 'wb_status'].includes(event.sortField) ? event.sortField : 'Id';
  const sortDir = event.sortDir === 'asc' ? 'asc' : 'desc';
  const today = typeof event.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(event.today)
    ? event.today : null;
  return rpcResult(await rdb.rpc('crm_customers_page_v1', {
    p_page: page,
    p_page_size: pageSize,
    p_keyword: typeof event.keyword === 'string' ? event.keyword.trim() : '',
    p_sort_field: sortField,
    p_sort_dir: sortDir,
    p_today: today,
    p_exact_name: typeof event.exactName === 'string' && event.exactName.trim()
      ? event.exactName.trim() : null,
  }));
}

async function get(event) {
  const id = parseInt(event.id, 10);
  if (!id) return { error: 'id required' };
  const c = assertOk(await rdb.from('customers').select().eq('Id', id).is('deleted_at', null).maybeSingle());
  if (!c.data) return { error: 'not found' };
  const [fol, prod, gif, pho, ai, rpt] = await Promise.all([
    rdb.from('followups').select().eq('customer_id', id).is('deleted_at', null)
      .order('followup_date', { ascending: false, nullsFirst: false })
      .order('Id', { ascending: false }),
    rdb.from('products').select().eq('customer_id', id).is('deleted_at', null),
    rdb.from('gifts').select().eq('customer_id', id).is('deleted_at', null)
      .order('given_date', { ascending: false, nullsFirst: false })
      .order('Id', { ascending: false }),
    rdb.from('photos').select('id, customer_id, customer_name, file_name, content_type, sort_order, created_at, photo_notes, category')
      .eq('customer_id', id).is('deleted_at', null)
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true }),
    rdb.from('ai_recommendations').select().eq('customer_id', id)
      .order('created_at', { ascending: false })
      .limit(10),
    // 保单检视报告：最近 10 条，按报告日期倒序
    rdb.from('policy_review_reports')
      .select('id, customer_id, customer_name, report_date, report_type, summary, gaps_found, recommendations, asset_allocation, next_action, edited_summary, edited_gaps, edited_recommendations, edited_asset_allocation, edited_next_action, created_at, updated_at')
      .eq('customer_id', id).is('deleted_at', null)
      .order('report_date', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .limit(10),
  ]);
  return {
    customer: c.data,
    followups: assertOk(fol).data || [],
    products: assertOk(prod).data || [],
    gifts: assertOk(gif).data || [],
    photos: assertOk(pho).data || [],
    recommendations: assertOk(ai).data || [],
    reports: assertOk(rpt).data || [],
  };
}

async function create(event) {
  const data = event.data || {};
  if (!data.customer_name) return { error: 'customer_name required' };
  const payload = normFields(data, FIELDS);
  if (!Object.keys(payload).length) return { error: 'no valid fields' };
  const r = assertOk(await rdb.from('customers').insert(payload).select('Id'));
  const customerId = r.data[0].Id;

  // PMC-08: 创建客户时自动建/关联 Person（统一基础资料写入口接管）
  // 不凭同名自动合并：persons 中 display_name 完全匹配且唯一则关联，多个则报错，无则新建
  const nameKey = String(data.customer_name).trim().toLowerCase().replace(/\s+/g, ' ');
  const personMatch = assertOk(await rdb.from('persons')
    .select('id, display_name')
    .eq('display_name', data.customer_name)
    .is('deleted_at', null)
    .limit(2));
  const matches = personMatch.data || [];
  let personId;
  if (matches.length === 1) {
    // 唯一匹配 → 关联
    personId = matches[0].id;
    assertOk(await rdb.from('persons')
      .update({ legacy_customer_id: customerId, updated_at: nowIso() })
      .eq('id', personId));
  } else if (matches.length > 1) {
    // 同名不同人 → 报错让人工确认（不自动选择）
    return { error: '存在多个同名人物，请通过 Person 身份解析确认后关联', customerId };
  } else {
    // 无匹配 → 创建新 Person
    const personPayload = {
      display_name: data.customer_name,
      name_key: nameKey,
      phone: data.phone || null,
      wechat: data.wx_account || null,
      gender: data.gender || null,
      birthday: data.birthday || null,
      occupation: data.occupation || null,
      education: data.education || null,
      source: '客户建档',
      legacy_customer_id: customerId,
    };
    const pr = assertOk(await rdb.from('persons').insert(personPayload).select('id'));
    personId = pr.data[0].id;
  }
  // 设置 customers.person_id（PMC-05 新增列）
  if (personId) {
    assertOk(await rdb.from('customers')
      .update({ person_id: personId, updated_at: nowIso() })
      .eq('Id', customerId));
  }
  return { id: customerId, personId: String(personId) };
}

async function update(event) {
  const id = parseInt(event.id, 10);
  if (!id) return { error: 'id required' };
  const payload = normFields(
    Object.assign({}, event.data, { updated_at: nowIso() }),
    FIELDS.concat(['updated_at'])
  );
  if (!Object.keys(payload).length) return { ok: true, updated: false };

  // PMC-08: OCR 恢复保护——检测疑似快照整包覆盖
  // 基础字段集合（与数据库触发器 customer_person_identity_bridge 同步的字段）
  const PERSON_BRIDGE_FIELDS = ['customer_name', 'phone', 'wx_account', 'gender', 'birthday', 'occupation', 'education'];
  const bridgeFieldsInPayload = PERSON_BRIDGE_FIELDS.filter(f => Object.prototype.hasOwnProperty.call(payload, f));
  const isSnapshotRestore = bridgeFieldsInPayload.length >= 3;

  if (isSnapshotRestore && !event.forceRestore) {
    // 疑似 OCR 快照恢复：比较当前值，有冲突则要求重新预览
    const cur = assertOk(await rdb.from('customers')
      .select(PERSON_BRIDGE_FIELDS.join(','))
      .eq('Id', id).maybeSingle());
    const curData = cur.data || {};
    const conflicts = bridgeFieldsInPayload.filter(f => {
      const curVal = curData[f] == null ? '' : String(curData[f]);
      const newVal = payload[f] == null ? '' : String(payload[f]);
      return curVal !== newVal;
    });
    if (conflicts.length) {
      return {
        error: 'OCR_SNAPSHOT_RESTORE_CONFLICT',
        message: '快照恢复将覆盖已变更的基础资料，请重新预览后确认',
        conflicts,
        suggestion: '通过 Person 身份解析或 OCR 重新预览确认后再执行恢复',
      };
    }
  }

  const r = assertOk(await rdb.from('customers').update(payload).eq('Id', id).select('Id'));
  const n = (r.data || []).length;
  // PMC-08: 移除应用层 Person 映射——数据库触发器 customer_person_identity_bridge_trigger
  // 已在 AFTER UPDATE 时经 legacy_customer_id 同步 customers→persons，避免双重更新

  return { ok: n === 1, updated: n };
}

// 级联软删除的子表清单（主键列名用于计数 select）
const CASC_TABLES = [
  { table: 'followups',              pk: 'Id', fk: 'customer_id' },
  { table: 'gifts',                  pk: 'Id', fk: 'customer_id' },
  { table: 'photos',                 pk: 'id', fk: 'customer_id' },
  { table: 'policy_review_reports',  pk: 'id', fk: 'customer_id' },
  { table: 'ocr_records',            pk: 'id', fk: 'customer_id' },
  { table: 'products',               pk: 'id', fk: 'customer_id' },
];

async function remove(event) {
  const id = parseInt(event.id, 10);
  if (!id) return { error: 'id required' };
  return rpcResult(await rdb.rpc('crm_delete_batch', {
    p_kind: 'customer', p_action: 'remove', p_ids: [id],
  }));
}

// 回收站列表：已删除客户（默认按删除时间倒序），附级联删除的子记录计数
async function trashList(event) {
  const page = Math.max(1, parseInt(event.page || 1, 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(event.pageSize || 50, 10)));
  const keyword = (event.keyword || '').trim();
  const sortDir = event.sortDir === 'asc' ? 'asc' : 'desc';

  const res = assertOk(await rdb.from('customers').select('*'));
  let rows = (res.data || []).filter(c => c.deleted_at);

  if (keyword) {
    const kw = keyword.toLowerCase();
    rows = rows.filter(c =>
      (c.customer_name && c.customer_name.toLowerCase().indexOf(kw) !== -1) ||
      (c.phone && String(c.phone).indexOf(kw) !== -1) ||
      (c.occupation && c.occupation.toLowerCase().indexOf(kw) !== -1)
    );
  }

  rows.sort((a, b) => {
    const va = a.deleted_at || '', vb = b.deleted_at || '';
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return (b.Id || 0) - (a.Id || 0);
  });

  const total = rows.length;
  const offset = (page - 1) * pageSize;
  const pageRows = rows.slice(offset, offset + pageSize);

  // 页内客户的可恢复批次计数。历史无批次记录不猜测归属。
  const ids = pageRows.map(c => c.Id);
  const counts = {};
  const recoverableCounts = {};
  if (ids.length) {
    const set = new Set(ids);
    const batchByCustomer = new Map();
    for (const c of pageRows) {
      recoverableCounts[c.Id] = {};
      batchByCustomer.set(c.Id, c.delete_batch_id || null);
    }
    for (const t of CASC_TABLES) {
      const cr = assertOk(await rdb.from(t.table)
        .select(t.fk + ', deleted_at, delete_batch_id'));
      let totalForPage = 0;
      for (const r of (cr.data || [])) {
        const customerId = r[t.fk];
        const batchId = batchByCustomer.get(customerId);
        if (r.deleted_at && batchId && r.delete_batch_id === batchId && set.has(customerId)) {
          recoverableCounts[customerId][t.table] = (recoverableCounts[customerId][t.table] || 0) + 1;
          totalForPage++;
        }
      }
      counts[t.table] = totalForPage;
    }
    // 增员候选人计数（仅同一删除批次）
    const cc = assertOk(await rdb.from('recruit_candidates')
      .select('customer_id, deleted_at, delete_batch_id'));
    let candidateTotal = 0;
    for (const r of (cc.data || [])) {
      const batchId = batchByCustomer.get(r.customer_id);
      if (r.deleted_at && batchId && r.delete_batch_id === batchId && set.has(r.customer_id)) {
        recoverableCounts[r.customer_id].recruit_candidates =
          (recoverableCounts[r.customer_id].recruit_candidates || 0) + 1;
        candidateTotal++;
      }
    }
    counts.recruit_candidates = candidateTotal;
  }

  for (const row of pageRows) {
    row.legacy_delete = !row.delete_batch_id;
    delete row.delete_batch_id;
  }
  return { rows: pageRows, total, page, pageSize, counts, recoverable_counts: recoverableCounts };
}

// 恢复：新记录按批次精确恢复；历史无批次记录只恢复客户本身。
async function restore(event) {
  const ids = Array.isArray(event.ids)
    ? event.ids.map(x => parseInt(x, 10)).filter(Boolean)
    : (event.id ? [parseInt(event.id, 10)] : []);
  if (!ids.length) return { error: 'ids required' };
  return rpcResult(await rdb.rpc('crm_delete_batch', {
    p_kind: 'customer', p_action: 'restore', p_ids: ids,
  }));
}

function rpcResult(response) {
  const data = assertOk(response).data;
  return Array.isArray(data) && data.length === 1 ? data[0] : data;
}
