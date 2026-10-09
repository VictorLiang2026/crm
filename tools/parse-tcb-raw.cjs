// Parse tcb-exec raw output (.raw) into {columns, rows} JSON. Usage: node tools/parse-tcb-raw.cjs <raw> <out.json>
const fs = require('fs');
const [, , rawPath, outPath] = process.argv;
const t = fs.readFileSync(rawPath, 'utf8');
const m = t.indexOf('{');
if (m < 0) { console.log('NO JSON: ' + t.slice(0, 300)); process.exit(1); }
const j = JSON.parse(t.slice(m));
if (j.data && j.data.Rows) {
  const rows = j.data.Rows.map(r => JSON.parse(r));
  fs.writeFileSync(outPath, JSON.stringify({ columns: j.data.Columns, rows }, null, 1));
  console.log('rows=' + rows.length);
} else {
  fs.writeFileSync(outPath, JSON.stringify(j, null, 1));
  console.log('non-rows payload written');
}
