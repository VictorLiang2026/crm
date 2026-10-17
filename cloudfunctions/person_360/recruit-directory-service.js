'use strict';

function pageOf(event = {}) {
  const page = Number(event.page ?? 1);
  const pageSize = Number(event.pageSize ?? 50);
  if (!Number.isInteger(page) || page < 1 || page > 20 ||
      !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
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

class RecruitDirectoryService {
  constructor({ request } = {}) {
    if (typeof request !== 'function') throw new Error('Authorized database request is required');
    this.request = request;
  }

  async list(event = {}) {
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
      this.request('v_recruit_candidates', 'GET', { select, order, limit, ...after(boundaries.legacy) }),
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
      ...(legacy || []).map(row => ({ ...row, _source: 'legacy' })),
      ...(personOnly || []).map(row => ({ ...row, _source: 'person' })),
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
}

module.exports = { RecruitDirectoryService };
