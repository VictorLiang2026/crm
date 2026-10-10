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
const { PersonService, PersonResolutionError } = require('./person-service');

// PMC-19 CL-02: base columns removed from FIELDS (customer_name, gender, occupation, birthday, phone)
// These are now exclusively on persons; customers columns dropped
const FIELDS = [
  'sales_priority', 'recruitment_priority', 'referral_priority',
  'hobbies', 'additional_info', 'source', 'tags', 'marital_status',
  'properties_info', 'annual_income', 'household_income',
  'first_contact_date', 'customer_stage',
  'profile', // 轻量客户画像 jsonb：{family,children,parents,career,needs,relationship,events[]}
];

// PMC-17: Person 基础字段（权威=persons；customers 同名列仅为兼容投影）
// 与 person-service BASIC_WRITABLE_FIELDS 对齐；customers 列名映射不同：customer_name/wx_account
const PERSON_BASIC_FIELDS = {
  customer_name: 'display_name', phone: 'phone', wx_account: 'wechat',
  gender: 'gender', birthday: 'birthday', occupation: 'occupation', education: 'education',
};
const personService = () => new PersonService({ rdb });

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
  // PMC-09: 基础字段从 persons 读取（经 person_id），persons 无值时回退 customers
  if (c.data.person_id) {
    const p = assertOk(await rdb.from('persons')
      .select('display_name, phone, wechat, gender, birthday, occupation, education')
      .eq('id', c.data.person_id).is('deleted_at', null).maybeSingle());
    if (p.data) {
      c.data.customer_name = p.data.display_name || c.data.customer_name;
      c.data.phone = p.data.phone || c.data.phone;
      c.data.wx_account = p.data.wechat || c.data.wx_account;
      c.data.gender = p.data.gender || c.data.gender;
      c.data.birthday = p.data.birthday || c.data.birthday;
      c.data.occupation = p.data.occupation || c.data.occupation;
      c.data.education = p.data.education || c.data.education;
    }
  }
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

  // PMC-17: 基础字段经 Person 受控边界（resolveName 服务端解析 + 同名多候选拒绝自动合并）
  const nameKey = String(data.customer_name).trim().toLowerCase().replace(/\s+/g, ' ');
  let resolution;
  try {
    resolution = await personService().resolveName(String(data.customer_name));
  } catch (e) {
    if (e instanceof PersonResolutionError) return { error: e.message, code: e.code };
    throw e;
  }
  const basic = {};
  for (const [custKey, personKey] of Object.entries(PERSON_BASIC_FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(data, custKey)) basic[personKey] = data[custKey];
  }

  let personId;
  if (resolution.candidates.length > 1) {
    // 同名不同人 → 不自动选择；人工确认走 Person 身份解析流程
    return { error: '存在多个同名人物，请通过 Person 身份解析确认后关联', code: 'PERSON_AMBIGUOUS',
      candidates: resolution.candidates.map(c => ({ id: c.id, displayName: c.displayName,
        organization: c.organization, occupation: c.occupation })) };
  } else if (resolution.candidates.length === 1) {
    const candidate = resolution.candidates[0];
    if (candidate.legacyCustomerId) {
      return { error: '同名人物已关联其他客户（#' + candidate.legacyCustomerId + '），请通过 Person 身份解析确认',
        code: 'PERSON_ALREADY_LINKED' };
    }
    personId = candidate.id;
    // 唯一匹配 → 基础字段经边界写入该 Person（空值不覆盖既有值）
    const nonempty = Object.fromEntries(Object.entries(basic)
      .filter(([, v]) => !(v == null || (typeof v === 'string' && v.trim() === ''))));
    if (Object.keys(nonempty).length) {
      const wr = await personService().updateBasicsWithProjection(personId, nonempty);
      if (!wr.ok) return { error: wr.message || 'Person 基础资料写入冲突，请刷新重试', code: 'PERSON_CONFLICT' };
    }
  } else {
    // 无匹配 → 经边界口径创建新 Person（source 标记客户建档）
    const personPayload = {
      display_name: resolution.displayName,
      name_key: nameKey,
      phone: basic.phone ?? null,
      wechat: basic.wechat ?? null,
      gender: basic.gender ?? null,
      birthday: basic.birthday ?? null,
      occupation: basic.occupation ?? null,
      education: basic.education ?? null,
      source: '客户建档',
    };
    const pr = assertOk(await rdb.from('persons').insert(personPayload).select('id'));
    personId = pr.data[0].id;
  }

  // customers 业务字段建行（含基础字段投影值，保持旧客户端读到一致值）；
  // person_id 随 INSERT 直写（PMC-17 migration B：customers.person_id NOT NULL + UNIQUE + FK）
  const payload = { ...normFields(data, FIELDS), person_id: personId };
  const r = assertOk(await rdb.from('customers').insert(payload).select('Id'));
  const customerId = r.data[0].Id;

  // PMC-19 CL-03: legacy_customer_id write removed; customers.person_id is the link
  return { id: customerId, personId: String(personId) };
}

async function update(event) {
  const id = parseInt(event.id, 10);
  if (!id) return { error: 'id required' };
  const rawData = event.data || {};
  if (!Object.keys(rawData).length) return { ok: true, updated: false };

  // PMC-17: 基础字段（PERSON_BASIC_FIELDS 键）经 Person 受控边界写入；其余业务字段直写 customers
  const basicIn = {};
  const businessIn = {};
  for (const [k, v] of Object.entries(rawData)) {
    if (Object.prototype.hasOwnProperty.call(PERSON_BASIC_FIELDS, k)) basicIn[k] = v;
    else businessIn[k] = v;
  }

  // 业务字段载荷（含 updated_at）
  const payload = normFields(
    Object.assign({}, businessIn, { updated_at: nowIso() }),
    FIELDS.concat(['updated_at'])
  );

  // PMC-08: OCR 恢复保护——检测疑似快照整包覆盖（仅针对基础字段）
  const bridgeFieldsInPayload = Object.keys(basicIn);
  const isSnapshotRestore = bridgeFieldsInPayload.length >= 3;

  if (isSnapshotRestore && !event.forceRestore) {
    // 疑似 OCR 快照恢复：比较当前值，有冲突则要求重新预览
    // PMC-19 CL-02: read base fields from persons (customers columns dropped)
    const crowOCR = assertOk(await rdb.from('customers')
      .select('person_id').eq('Id', id).maybeSingle());
    const prowOCR = crowOCR.data && crowOCR.data.person_id
      ? assertOk(await rdb.from('persons')
          .select('display_name, phone, wechat, gender, birthday, occupation, education')
          .eq('id', crowOCR.data.person_id).maybeSingle())
      : { data: null };
    const curData = {};
    if (prowOCR.data) {
      curData.customer_name = prowOCR.data.display_name;
      curData.phone = prowOCR.data.phone;
      curData.wx_account = prowOCR.data.wechat;
      curData.gender = prowOCR.data.gender;
      curData.birthday = prowOCR.data.birthday;
      curData.occupation = prowOCR.data.occupation;
      curData.education = prowOCR.data.education;
    }
    const conflicts = bridgeFieldsInPayload.filter(f => {
      const curVal = curData[f] == null ? '' : String(curData[f]);
      const newVal = basicIn[f] == null ? '' : String(basicIn[f]);
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

  let personResult = null;
  if (bridgeFieldsInPayload.length) {
      // PMC-19 CL-03: legacy_customer_id removed; persons linked via customers.person_id
      const crow = assertOk(await rdb.from('customers')
        .select('person_id').eq('Id', id).maybeSingle());
      if (!crow.data) return { error: 'not found' };
      let personId = crow.data.person_id ? String(crow.data.person_id) : null;
      if (!personId) {
        // 无关联 Person：该客户尚无权威基础资料归属，拒绝静默旧值兜底
        return { error: '该客户未关联 Person，基础字段无法写入；请先完成身份关联',
          code: 'PERSON_NOT_LINKED', customerId: id };
      }
    // 经边界写入（person-service 白名单映射 customers→persons 键名）
    const personFields = {};
    for (const [custKey, personKey] of Object.entries(PERSON_BASIC_FIELDS)) {
      if (Object.prototype.hasOwnProperty.call(basicIn, custKey)) personFields[personKey] = basicIn[custKey];
    }
    try {
      // PMC-19 CL-02: projection to customers removed (base columns dropped)
      personResult = await personService().updateBasicsWithProjection(personId, personFields, {});
      if (!personResult.ok) {
        return { error: personResult.message || 'Person 基础资料写入冲突，请刷新后重试',
          code: 'PERSON_CONFLICT', customerId: id };
      }
    } catch (e) {
      if (e instanceof PersonResolutionError) {
        return { error: e.message, code: e.code, customerId: id };
      }
      throw e;
    }
  }

  let n = 0;
  if (Object.keys(payload).length > 1 || !bridgeFieldsInPayload.length) {
    // 有业务字段（payload 至少含 updated_at + 一个业务键）或无基础字段时照常更新 customers
    const r = assertOk(await rdb.from('customers').update(payload).eq('Id', id).select('Id'));
    n = (r.data || []).length;
    if (!n) return { ok: false, updated: 0, error: 'not found or no change', customerId: id };
  } else if (personResult) {
    // 仅基础字段：边界已完成 persons+投影写入，customers.updated_at 已由投影刷新
    n = 1;
  }

  return { ok: true, updated: n,
    personId: personResult ? personResult.id : undefined,
    personUpdated: personResult ? true : undefined };
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
