'use strict';

const MAX_DIRECTORY_ROWS = 1000;
const MAX_SOURCE_ROWS = 1000;
const STAGES = new Set(['新增人才', '互动暖客', '初次面谈', '增员活动', '精准面谈', '入职申请', '签约入司', '流失']);
const PRIORITIES = new Set(['A', 'B', 'C', 'D', 'E']);
const SORT_FIELDS = Object.freeze({
  name: 'customer_name',
  stage: 'stage',
  recruitment_priority: 'recruitment_priority',
  potential_score: 'potential_score',
  next_action_date: 'next_action_date',
  idle_days: 'idle_days',
  updated_at: 'updated_at',
  candidate_id: 'candidate_id',
});

function pageOf(event = {}, filtered = false) {
  const page = Number(event.page ?? 1);
  const pageSize = Number(event.pageSize ?? (filtered ? 30 : 50));
  const maxPage = filtered ? Math.ceil(MAX_DIRECTORY_ROWS / pageSize) : 20;
  if (!Number.isInteger(page) || page < 1 || page > maxPage ||
      !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50 ||
      (filtered && pageSize > 30)) {
    throw new Error('Invalid recruit directory page');
  }
  return { page, pageSize };
}

function cursorBoundary(value) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['candidateId', 'nextActionDate'].includes(key)) ||
      !/^[1-9]\d*$/.test(String(value.candidateId ?? '')) ||
      !(value.nextActionDate == null || /^\d{4}-\d{2}-\d{2}$/.test(value.nextActionDate))) {
    throw new Error('Invalid recruit directory cursor');
  }
  return { candidate_id: String(value.candidateId), next_action_date: value.nextActionDate ?? null };
}

function after(boundary) {
  if (!boundary) return {};
  if (boundary.next_action_date == null) {
    return { next_action_date: 'is.null', candidate_id: `lt.${boundary.candidate_id}` };
  }
  const date = boundary.next_action_date;
  const id = boundary.candidate_id;
  return { or: `(next_action_date.lt.${date},and(next_action_date.eq.${date},candidate_id.lt.${id}),next_action_date.is.null)` };
}

function arrayField(value, allowed, name) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > allowed.size || value.some(item => !allowed.has(item))) {
    throw new Error(`Invalid recruit directory ${name}`);
  }
  return [...new Set(value)];
}

function criteriaOf(event) {
  // CloudBase RPC event objects can carry transport context in addition to
  // the caller's criteria. Only read the explicitly supported query fields;
  // never forward arbitrary event properties into a database request.
  if (event.action != null && event.action !== 'listRecruitDirectory') {
    throw new Error('Invalid recruit directory criteria');
  }
  const search = String(event.search ?? '').trim();
  const sortField = String(event.sortField ?? 'next_action_date');
  const sortDir = String(event.sortDir ?? 'desc');
  if (search.length > 40 || (event.search != null && typeof event.search !== 'string') ||
      !Object.hasOwn(SORT_FIELDS, sortField) || !['asc', 'desc'].includes(sortDir)) {
    throw new Error('Invalid recruit directory criteria');
  }
  return {
    search,
    stages: arrayField(event.stages, STAGES, 'stages'),
    priorities: arrayField(event.priorities, PRIORITIES, 'priorities'),
    sortField,
    sortDir,
  };
}

function compareValues(a, b, direction, field) {
  const aNull = a == null || a === '';
  const bNull = b == null || b === '';
  if (aNull || bNull) return aNull === bNull ? 0 : aNull ? 1 : -1;
  let compared;
  if (field === 'candidate_id') {
    const ai = BigInt(a), bi = BigInt(b);
    compared = ai === bi ? 0 : ai < bi ? -1 : 1;
  } else if (typeof a === 'number' || typeof b === 'number') {
    const an = Number(a), bn = Number(b);
    compared = an === bn ? 0 : an < bn ? -1 : 1;
  } else {
    compared = String(a).localeCompare(String(b), 'zh-CN', { sensitivity: 'base' });
  }
  return direction === 'asc' ? compared : -compared;
}

function compareRows(a, b, field, direction) {
  const fieldName = SORT_FIELDS[field];
  const primary = compareValues(a[fieldName], b[fieldName], direction, fieldName);
  if (primary) return primary;
  const id = compareValues(a.candidate_id, b.candidate_id, direction, 'candidate_id');
  return id || String(a._source).localeCompare(String(b._source));
}

function postgrestFilters(criteria, field, direction) {
  const filters = {
    select: 'candidate_id,customer_name,stage,occupation,potential_score,next_action,next_action_date,idle_days,person_id,customer_id,recruitment_priority,updated_at',
    order: `${SORT_FIELDS[field]}.${direction}.nullslast,candidate_id.${direction}`,
    limit: MAX_SOURCE_ROWS,
  };
  if (criteria.search) filters.customer_name = `ilike.*${criteria.search.replace(/[\\%_*]/g, '\\$&')}*`;
  if (criteria.stages.length) filters.stage = `in.(${criteria.stages.join(',')})`;
  if (criteria.priorities.length) filters.recruitment_priority = `in.(${criteria.priorities.join(',')})`;
  return filters;
}

class RecruitDirectoryService {
  constructor({ request } = {}) {
    if (typeof request !== 'function') throw new Error('Authorized database request is required');
    this.request = request;
  }

  async list(event = {}) {
    const filtered = ['search', 'stages', 'priorities', 'sortField', 'sortDir'].some(key => Object.hasOwn(event, key));
    if (filtered) return this.listFiltered(event);
    return this.listLegacy(event);
  }

  async listLegacy(event = {}) {
    const { page, pageSize } = pageOf(event);
    const cursor = event.cursor == null ? {} : event.cursor;
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor) ||
        Object.keys(cursor).some(key => !['legacy', 'person'].includes(key))) {
      throw new Error('Invalid recruit directory cursor');
    }
    const boundaries = { legacy: cursorBoundary(cursor.legacy), person: cursorBoundary(cursor.person) };
    const limit = pageSize + 1;
    const select = 'candidate_id,customer_name,stage,occupation,potential_score,next_action,next_action_date,idle_days,person_id,customer_id';
    const order = 'next_action_date.desc.nullslast,candidate_id.desc';
    const [legacy, personOnly] = await Promise.all([
      this.request('v_recruit_candidates', 'GET', {
        select, order, limit, ...after(boundaries.legacy), customer_id: 'not.is.null',
      }),
      this.request('v_recruit_candidates_person_only', 'GET', { select, order, limit, ...after(boundaries.person) }),
    ]);
    const compare = (a, b) => {
      const ad = a.next_action_date == null ? '' : String(a.next_action_date);
      const bd = b.next_action_date == null ? '' : String(b.next_action_date);
      if (ad !== bd) return bd.localeCompare(ad);
      const ai = BigInt(a.candidate_id), bi = BigInt(b.candidate_id);
      if (ai !== bi) return ai > bi ? -1 : 1;
      return a._source.localeCompare(b._source);
    };
    const merged = [
      ...(legacy || []).slice(0, pageSize + 1).map(row => ({ ...row, _source: 'legacy' })),
      ...(personOnly || []).slice(0, pageSize + 1).map(row => ({ ...row, _source: 'person' })),
    ].sort(compare);
    const selected = merged.slice(0, pageSize);
    const rows = selected.map(({ _source, ...row }) => ({ ...row, source: _source }));
    const nextCursor = { ...cursor };
    for (const row of selected) {
      nextCursor[row._source] = {
        candidateId: String(row.candidate_id),
        nextActionDate: row.next_action_date == null ? null : String(row.next_action_date),
      };
    }
    const sourceMayContinue = (legacy || []).length === limit || (personOnly || []).length === limit;
    const hasMore = merged.length > pageSize || sourceMayContinue;
    return { rows, page, pageSize, hasMore, truncated: page === 20 && hasMore,
      cursor: hasMore ? nextCursor : null };
  }

  async listFiltered(event = {}) {
    const { page, pageSize } = pageOf(event, true);
    const criteria = criteriaOf(event);
    const filters = postgrestFilters(criteria, criteria.sortField, criteria.sortDir);
    const [legacy, personOnly] = await Promise.all([
      this.request('v_recruit_candidates', 'GET', { ...filters, customer_id: 'not.is.null' }),
      this.request('v_recruit_candidates_person_only', 'GET', filters),
    ]);
    const merged = [
      ...(legacy || []).map(row => ({ ...row, _source: 'legacy' })),
      ...(personOnly || []).map(row => ({ ...row, _source: 'person' })),
    ].sort((a, b) => compareRows(a, b, criteria.sortField, criteria.sortDir));
    const truncated = merged.length > MAX_DIRECTORY_ROWS ||
      (legacy || []).length === MAX_SOURCE_ROWS || (personOnly || []).length === MAX_SOURCE_ROWS;
    const boundedRows = merged.slice(0, MAX_DIRECTORY_ROWS);
    const rows = boundedRows.slice((page - 1) * pageSize, page * pageSize)
      .map(({ _source, ...row }) => ({ ...row, source: _source }));
    const total = boundedRows.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return { rows, page, pageSize, total, totalPages,
      hasMore: page < totalPages, truncated, cursor: null };
  }
}

module.exports = { RecruitDirectoryService };
