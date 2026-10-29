'use strict';
// M06: bounded server-side directory queries. Legacy list/search contracts stay unchanged.
function directoryOptions(event) {
  const page = Number(event.page ?? 1), pageSize = Number(event.pageSize ?? 20);
  const keyword = String(event.keyword || '').trim().toLowerCase();
  const status = String(event.status || ''), stage = String(event.stage || '');
  const due = event.due == null ? '' : event.due;
  const sortField = event.sortField == null ? 'updated_at' : String(event.sortField);
  const sortDir = event.sortDir == null ? 'desc' : String(event.sortDir);
  if (!Number.isInteger(page) || page < 1 || page > 10000 ||
      !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50 ||
      keyword.length > 120 || !['', 'active', 'inactive'].includes(status) ||
      !['', 'new', 'contacted', 'cooperated', 'stable', 'deep', 'inactive'].includes(stage) ||
      typeof due !== 'string' || !['', 'overdue', 'today', 'next7', 'unscheduled'].includes(due) ||
      !['id', 'name', 'last_contact_date', 'next_contact_date', 'cooperation_count', 'updated_at'].includes(sortField) ||
      !['asc', 'desc'].includes(sortDir)) {
    throw new Error('Invalid resource directory query');
  }
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  return { page, pageSize, keyword, status, stage, due, today, sortField, sortDir };
}
function contactFilter(query, options) {
  const { due, today } = options;
  if (due === 'overdue') return query.lt('next_contact_date', today);
  if (due === 'today') return query.eq('next_contact_date', today);
  if (due === 'unscheduled') return query.is('next_contact_date', null);
  if (due === 'next7') {
    const until = new Date(Date.parse(today + 'T00:00:00Z') + 7 * 86400000).toISOString().slice(0, 10);
    return query.gt('next_contact_date', today).lte('next_contact_date', until);
  }
  return query;
}
async function directoryPage(event, { read, enrich = async rows => rows, matches, now = Date.now }) {
  const options = directoryOptions(event);
  const start = (options.page - 1) * options.pageSize;
  const result = rows => ({ rows: rows.slice(0, options.pageSize), page: options.page,
    pageSize: options.pageSize, hasMore: rows.length > options.pageSize, total: null });
  if (!options.keyword) {
    const rows = await read(options, start, options.pageSize + 1);
    return result(await enrich(rows));
  }
  let matched = 0;
  const selected = [];
  const startedAt = now();
  for (let offset = 0; offset < 10000; offset += 200) {
    if (now() - startedAt > 6000) throw new Error('RESOURCE_SEARCH_LIMIT: narrow the search criteria');
    const batch = await read(options, offset, 201);
    const rows = await enrich(batch.slice(0, 200));
    if (now() - startedAt > 6000) throw new Error('RESOURCE_SEARCH_LIMIT: narrow the search criteria');
    for (const row of rows) {
      if (!matches(row, options.keyword)) continue;
      if (matched++ >= start) selected.push(row);
      if (selected.length > options.pageSize) return result(selected);
    }
    if (batch.length <= 200) return result(selected);
  }
  // Never report an incomplete scan as an empty/final page.
  throw new Error('RESOURCE_SEARCH_LIMIT: narrow the status, stage or search criteria');
}
module.exports = { directoryOptions, directoryPage, contactFilter };
