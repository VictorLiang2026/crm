'use strict';
// M06: bounded server-side directory queries. Legacy list/search contracts stay unchanged.
function directoryOptions(event) {
  const page = Number(event.page ?? 1), pageSize = Number(event.pageSize ?? 20);
  const keyword = String(event.keyword || '').trim().toLowerCase();
  const status = String(event.status || ''), stage = String(event.stage || '');
  const sortField = event.sortField == null ? 'updated_at' : String(event.sortField);
  const sortDir = event.sortDir == null ? 'desc' : String(event.sortDir);
  if (!Number.isInteger(page) || page < 1 || page > 10000 ||
      !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50 ||
      keyword.length > 120 || !['', 'active', 'inactive'].includes(status) ||
      !['', 'new', 'contacted', 'cooperated', 'stable', 'deep', 'inactive'].includes(stage) ||
      !['id', 'topic_name', 'category', 'use_count', 'last_used_date', 'updated_at'].includes(sortField) ||
      !['asc', 'desc'].includes(sortDir)) {
    throw new Error('Invalid resource directory query');
  }
  return { page, pageSize, keyword, status, stage, sortField, sortDir };
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
module.exports = { directoryOptions, directoryPage };
