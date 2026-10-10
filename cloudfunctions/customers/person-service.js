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
    return ['display_name', 'phone', 'wechat', 'gender', 'birthday', 'occupation', 'education'];
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
      payload[key] = (typeof value === 'string' && value.trim() === '') ? null : value;
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
    let query = this.rdb.from('persons').update(payload)
      .eq('id', pid).is('deleted_at', null);
    if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt);
    const wr = await query.select('id, updated_at');
    if (!wr || wr.error) {
      throw new PersonResolutionError('WRITE_FAILED', 'Person update failed', wr?.error);
    }
    if (!Array.isArray(wr.data) || wr.data.length === 0) {
      return { ok: false, conflict: true, message: 'Concurrent modification detected; refresh and retry' };
    }
    const personRow = wr.data[0];

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
}

module.exports = { PersonService, PersonResolutionError, parsePersonName };
