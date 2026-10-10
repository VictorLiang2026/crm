// PMC-20: format exported live pg_views definitions into an archival migration SQL.
'use strict';
const fs = require('node:fs');
const raw = fs.readFileSync('tools/pmc20-views-live.json', 'utf8');
const parsed = JSON.parse(raw.slice(raw.indexOf('{')));
const rows = (parsed.data.Rows || []).map(r => JSON.parse(r));
let out = `-- PMC-19 CL-02 (archived by PMC-20): rebuild the 11 views that used to read base
-- identity columns from customers (customer_name/phone/birthday/gender/occupation/
-- education/wx_account). After CL-02 they read those columns from persons via
-- customers.person_id. Executed 2026-10-10 before the customer copy columns were dropped.
-- Source of this file: live pg_views export taken 2026-10-10 (tools/pmc20-export-views.sql).
-- Security options (e.g. security_invoker) are view-level and survive CREATE OR REPLACE.
`;
for (const [name, def] of rows) {
  const trimmed = def.trimEnd();
  out += `\n-- ${name}\nCREATE OR REPLACE VIEW public.${name} AS\n${trimmed.endsWith(';') ? trimmed : trimmed + ';'}\n`;
}
fs.writeFileSync('tools/pmc20-views-archive.out.sql', out);
console.log('views:', rows.map(r => r[0]).join(', '));
