/** Read-only identity resolution for future server-side CRM callers.
 *  PMC-17: 增加基础资料受控写入（updateBasicsWithProjection）——所有 Person 基础字段
 *  写入统一经此边界：字段白名单、乐观锁、投影回写（投影仅作兼容，非权威）。 */
'use strict';

const MAX_DISPLAY_LENGTH = 160;
const MAX_CANDIDATES = 10;
const COLUMNS = 'id,display_name,name_key,organization,occupation';

class PersonResolutionError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'PersonResolutionError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

function normalizeWhitespace(value) {
  return value.replace(/[ \t\r\n\f\v\u3000]+/gu, ' ').trim();
}

function validateParentheses(value) {
  const stack = [];
  for (const char of value) {
    if (char === '（' || char === '(') stack.push(char);
    else if (char === '）' || char === ')') {
      if (stack.pop() !== (char === '）' ? '（' : '(')) {
        throw new PersonResolutionError('INVALID_NAME', 'Unbalanced name qualifier');
      }
    }
  }
  if (stack.length) throw new PersonResolutionError('INVALID_NAME', 'Unbalanced name qualifier');
}

function parsePersonName(value) {
  if (typeof value !== 'string') throw new PersonResolutionError('INVALID_NAME', 'displayName must be text');
  const displayName = normalizeWhitespace(value);
  if (!displayName || displayName.length > MAX_DISPLAY_LENGTH) {
    throw new PersonResolutionError('INVALID_NAME', 'displayName must have 1-160 characters');
  }
  validateParentheses(displayName);
  const qualifiers = [];
  let baseName = displayName;
  for (;;) {
    const match = baseName.match(/(?:（([^（）]*)）|\(([^()]*)\))$/u);
    if (!match) break;
    const qualifier = normalizeWhitespace(match[1] ?? match[2]);
    if (!qualifier) throw new PersonResolutionError('INVALID_NAME', 'Name qualifier cannot be empty');
    qualifiers.unshift(qualifier);
    baseName = baseName.slice(0, match.index).trimEnd();
  }
  if (!baseName) throw new PersonResolutionError('INVALID_NAME', 'Name is required before qualifier');
  return {
    displayName,
    nameKey: normalizeWhitespace(baseName).toLowerCase(),
    qualifierKey: qualifiers.map(item => item.toLowerCase()).join('|'),
    hasQualifier: qualifiers.length > 0,
  };
}

function personId(value) {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^[1-9]\d*$/.test(String(value)) ||
      (typeof value === 'number' && !Number.isSafeInteger(value))) {
    throw new PersonResolutionError('READ_FAILED', 'Person search returned an invalid id');
  }
  return String(value);
}

// 受控建档允许的 persons 列白名单（created_at/updated_at/id/delete_batch_id 等由库侧管理）
const PERSON_INSERT_FIELDS = new Set([
  'display_name', 'name_key', 'phone', 'wechat', 'gender', 'birthday',
  'occupation', 'organization', 'education', 'source', 'hobbies', 'customer_stage',
  'sales_priority', 'referral_priority', 'marital_status', 'first_contact_date', 'notes',
]);

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch (e) { return null; }
}

// persons 受控写入通道：node-sdk rdb 网关在库内映射为 anon，而 persons 仅授予 anon
// SELECT（persons_anon_read），写权限只给 service_role（persons_service_only）。
// 因此所有 persons 写入必须与 person_360 pgRequest 一样，使用服务端 service_role
// 受控密钥直连 PostgREST；密钥只存在于函数环境变量，绝不下发客户端。
async function personRestWrite(method, filters, body) {
  const env = process.env.TCB_ENV;
  const key = process.env.CRM_PERSON360_DB_API_KEY;
  if (!/^crm-[a-z0-9]+$/.test(env || '') || !key) {
    throw new PersonResolutionError('INVALID_CONFIG', 'Person write channel is not configured');
  }
  if (method !== 'POST' && method !== 'PATCH') {
    throw new PersonResolutionError('INVALID_CONFIG', 'Unsupported person write method');
  }
  const url = new URL(`https://${env}.api.tcloudbasegateway.com/v1/rdb/rest/persons`);
  for (const [name, value] of Object.entries(filters || {})) {
    url.searchParams.set(name, String(value));
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        'Accept-Profile': 'public',
        'Content-Profile': 'public',
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      const detail = safeJsonParse(text);
      throw new PersonResolutionError('WRITE_FAILED',
        'Person write failed (' + response.status + ')',
        detail && (detail.message || detail.error) || text.slice(0, 300));
    }
    const rows = text ? JSON.parse(text) : [];
    if (!Array.isArray(rows)) throw new PersonResolutionError('WRITE_FAILED', 'Unexpected person write response');
    return rows;
  } catch (error) {
    if (error instanceof PersonResolutionError) throw error;
    throw new PersonResolutionError('WRITE_FAILED', 'Person write request failed: ' + error.message);
  } finally {
    clearTimeout(timeout);
  }
}

class PersonService {
  constructor({ rdb, request } = {}) {
    if ((!rdb || typeof rdb.from !== 'function') && typeof request !== 'function') {
      throw new PersonResolutionError('INVALID_CONFIG', 'Authorized server-side CloudBase RDB is required');
    }
    this.rdb = rdb;
    this.request = request;
  }

  async resolveName(displayName) {
    const parsed = parsePersonName(displayName);
    let response;
    try {
      response = this.request ? { data: await this.request('persons', 'GET', {
        select: COLUMNS, name_key: `eq.${parsed.nameKey}`, deleted_at: 'is.null',
        order: 'id.asc', limit: MAX_CANDIDATES + 1,
      }) } : await this.rdb.from('public.persons')
        .select(COLUMNS)
        .eq('name_key', parsed.nameKey)
        .is('deleted_at', null)
        .order('id', { ascending: true })
        .limit(MAX_CANDIDATES + 1);
    } catch (error) {
      throw new PersonResolutionError('READ_FAILED', 'Person search failed', error);
    }
    if (!response || response.error || !Array.isArray(response.data) ||
        response.data.length > MAX_CANDIDATES + 1) {
      throw new PersonResolutionError('READ_FAILED', 'Person search returned an invalid result', response?.error);
    }
    const hasMore = response.data.length > MAX_CANDIDATES;
    const candidateRows = response.data.slice(0, MAX_CANDIDATES);
    // PMC-19 CL-03: legacy_customer_id removed; resolve customer_id via customers.person_id
    const pidList = candidateRows.map(row => personId(row.id));
    let personToCustomer = new Map();
    if (pidList.length) {
      let custRows;
      try {
        custRows = this.request
          ? await this.request('customers', 'GET', {
              select: 'Id,person_id', person_id: `in.(${pidList.join(',')})`, deleted_at: 'is.null',
            })
          : (await this.rdb.from('public.customers')
              .select('Id,person_id').in('person_id', pidList).is('deleted_at', null)).data;
      } catch (error) {
        throw new PersonResolutionError('READ_FAILED', 'Customer lookup failed', error);
      }
      if (Array.isArray(custRows)) {
        personToCustomer = new Map(custRows.map(c => [String(c.person_id), String(c.Id)]));
      }
    }
    const candidates = candidateRows.map(row => {
      if (!row || typeof row.display_name !== 'string' || row.name_key !== parsed.nameKey) {
        throw new PersonResolutionError('READ_FAILED', 'Person search returned an inconsistent row');
      }
      let candidateName;
      try { candidateName = parsePersonName(row.display_name); }
      catch (error) { throw new PersonResolutionError('READ_FAILED', 'Person search returned an invalid name', error); }
      if (candidateName.nameKey !== parsed.nameKey) {
        throw new PersonResolutionError('READ_FAILED', 'Person search returned a mismatched name key');
      }
      const pid = personId(row.id);
      return {
        id: pid,
        displayName: row.display_name,
        organization: row.organization ?? null,
        occupation: row.occupation ?? null,
        legacyCustomerId: personToCustomer.get(pid) ?? null,
      };
    });
    let status;
    let qualifierMatches = [];
    if (parsed.hasQualifier && !hasMore) {
      qualifierMatches = candidates.filter(candidate =>
        parsePersonName(candidate.displayName).qualifierKey === parsed.qualifierKey &&
        parsed.qualifierKey !== '').map(candidate => candidate.id);
    }
    if (response.data.length === 0) status = 'available';
    else if (response.data.length === 1) status = 'confirm_existing';
    else if (parsed.hasQualifier && !hasMore) {
      status = qualifierMatches.length === 1 ? 'confirm_qualified_match' :
        qualifierMatches.length === 0 ? 'confirm_new_qualified' : 'choose_or_qualify';
    } else status = 'choose_or_qualify';

    return {
      displayName: parsed.displayName,
      nameKey: parsed.nameKey,
      status,
      candidates,
      hasMore,
      qualifierMatches,
      selectedPersonId: null,
      requiresHumanDecision: status !== 'available',
      canCreate: status === 'available',
      canCreateAfterConfirmation: status === 'confirm_new_qualified' ||
        (status === 'confirm_existing' && parsed.hasQualifier && qualifierMatches.length === 0),
    };
  }

  // PMC-17: Person 基础资料受控写入边界 + customers 投影回写
  // personId 必须已知（resolveName/人工确认在前）；fields 仅接受白名单键（snake_case）。
  // 顺序：persons UPDATE（乐观锁可空）→ 投影表 UPDATE。两步非事务（RDB 无跨表事务），
  // 投影失败抛出错误由调用方处理重试，persons 值已为权威。
  static get BASIC_WRITABLE_FIELDS() {
    return ['display_name', 'phone', 'wechat', 'gender', 'birthday', 'occupation', 'education',
      'source', 'hobbies', 'customer_stage', 'sales_priority', 'referral_priority',
      'marital_status', 'first_contact_date', 'notes'];
  }

  async updateBasicsWithProjection(personIdValue, fields, { expectedUpdatedAt, projection } = {}) {
    if (!this.rdb || typeof this.rdb.from !== 'function') {
      throw new PersonResolutionError('INVALID_CONFIG', 'updateBasicsWithProjection requires rdb');
    }
    const pid = personId(personIdValue);
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      throw new PersonResolutionError('INVALID_PAYLOAD', 'fields must be an object');
    }
    const allowed = new Set(PersonService.BASIC_WRITABLE_FIELDS);
    const payload = {};
    for (const [key, value] of Object.entries(fields)) {
      if (!allowed.has(key)) {
        throw new PersonResolutionError('FIELD_NOT_ALLOWED', 'Field not writable: ' + key);
      }
      const normalized = (typeof value === 'string' && value.trim() === '') ? null : value;
      if (['sales_priority', 'referral_priority'].includes(key) && normalized != null &&
          !['A', 'B', 'C', 'D', 'E'].includes(normalized)) {
        throw new PersonResolutionError('INVALID_PAYLOAD', 'Invalid priority: ' + key);
      }
      if (key === 'customer_stage' && normalized != null &&
          !['新认识', '关系维护', '需求挖掘', '方案沟通', '成交推进', '转介绍经营'].includes(normalized)) {
        throw new PersonResolutionError('INVALID_PAYLOAD', 'Invalid customer_stage');
      }
      if (key === 'first_contact_date' && normalized != null &&
          (typeof normalized !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(normalized))) {
        throw new PersonResolutionError('INVALID_PAYLOAD', 'Invalid first_contact_date');
      }
      payload[key] = normalized;
    }
    if (!Object.keys(payload).length) {
      throw new PersonResolutionError('INVALID_PAYLOAD', 'no writable fields provided');
    }
    payload.updated_at = new Date().toISOString();

    // 存在性预检（避免对不存在/已软删 Person 空写）
    const exist = await this.rdb.from('persons').select('id').eq('id', pid).is('deleted_at', null);
    if (!exist || exist.error) {
      throw new PersonResolutionError('READ_FAILED', 'Person read failed', exist?.error);
    }
    if (!Array.isArray(exist.data) || exist.data.length !== 1) {
      throw new PersonResolutionError('PERSON_NOT_FOUND', 'Person not found or deleted: ' + pid);
    }
    // persons 写入走 service_role 受控 REST（anon 网关无 persons 写权限）；
    // 读预检仍走 rdb（anon 对未删除行有 SELECT）。
    const filters = { id: `eq.${pid}`, deleted_at: 'is.null' };
    if (expectedUpdatedAt) filters.updated_at = `eq.${expectedUpdatedAt}`;
    const rows = await personRestWrite('PATCH', filters, payload);
    if (rows.length === 0) {
      return { ok: false, conflict: true, message: 'Concurrent modification detected; refresh and retry' };
    }
    const personRow = rows[0];

    let projectionResult = null;
    if (projection && projection.table && projection.match &&
        typeof projection.table === 'string' && typeof projection.match === 'object') {
      const projPayload = projection.map(fields);
      if (projPayload && Object.keys(projPayload).length) {
        projPayload.updated_at = payload.updated_at;
        let pq = this.rdb.from(projection.table).update(projPayload);
        for (const [k, v] of Object.entries(projection.match)) pq = pq.eq(k, v);
        const pr = await pq.select('id');
        if (!pr || pr.error) {
          throw new PersonResolutionError('PROJECTION_FAILED',
            'Projection update failed after Person write; retry required', pr?.error);
        }
        projectionResult = Array.isArray(pr.data) ? pr.data.length : 0;
      }
    }
    return { ok: true, id: pid, updatedAt: personRow.updated_at, projectionUpdated: projectionResult };
  }

  // PMC-17 建档边界：resolveName 确认无匹配后由本方法创建 Person；只接受白名单列。
  // 同样必须走 service_role 受控 REST（rdb/anon 无 persons INSERT 权限）。
  async createPerson(fields) {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      throw new PersonResolutionError('INVALID_PAYLOAD', 'fields must be an object');
    }
    const payload = {};
    for (const [key, value] of Object.entries(fields)) {
      if (!PERSON_INSERT_FIELDS.has(key)) {
        throw new PersonResolutionError('FIELD_NOT_ALLOWED', 'Field not insertable: ' + key);
      }
      payload[key] = (typeof value === 'string' && value.trim() === '') ? null : value;
    }
    if (!payload.display_name || !payload.name_key) {
      throw new PersonResolutionError('INVALID_PAYLOAD', 'display_name and name_key are required');
    }
    const rows = await personRestWrite('POST', {}, payload);
    const row = rows[0];
    if (!row || row.id == null) {
      throw new PersonResolutionError('WRITE_FAILED', 'Person create returned no id');
    }
    return { id: String(row.id), row };
  }
}

module.exports = { PersonService, PersonResolutionError, parsePersonName };
