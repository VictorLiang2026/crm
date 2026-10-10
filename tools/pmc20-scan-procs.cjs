// PMC-20 local scanner for dumped pg_get_functiondef output.
// Usage: node tools/pmc20-scan-procs.cjs tools/pmc20-procs-all.json
'use strict';
const fs = require('node:fs');
const file = process.argv[2];
const raw = fs.readFileSync(file, 'utf8');
const start = raw.indexOf('{');
const parsed = JSON.parse(raw.slice(start));
const rows = (parsed.data.Rows || []).map(r => JSON.parse(r));
const tokenRe = /(legacy_customer_id|wx_account|[A-Za-z_][A-Za-z0-9_]*\.customer_name|[A-Za-z_][A-Za-z0-9_]*\.(?:gender|birthday|occupation|education|phone)|customer_person_identity_bridge|recruit_candidate_person_sync)/gi;
for (const [name, def] of rows) {
  const hits = [];
  def.split('\n').forEach((line, i) => {
    if (tokenRe.test(line)) hits.push((i + 1) + ': ' + line.trim());
    tokenRe.lastIndex = 0;
  });
  if (hits.length) {
    console.log('=== ' + name + ' ===');
    hits.forEach(h => console.log(h));
  }
}
