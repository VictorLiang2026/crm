// Pretty-print dumped function defs: node tools/pmc20-pretty-procs.cjs <json>
'use strict';
const fs = require('node:fs');
const raw = fs.readFileSync(process.argv[2], 'utf8');
const parsed = JSON.parse(raw.slice(raw.indexOf('{')));
for (const r of (parsed.data.Rows || []).map(x => JSON.parse(x))) {
  console.log('########## ' + r[0] + ' ##########');
  console.log(r[1]);
  console.log('');
}
