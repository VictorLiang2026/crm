#!/usr/bin/env node
const fs = require('fs');
const c = fs.readFileSync('tests/security/.results/wp04-audit-raw.json', 'utf8');
const idx = c.indexOf('data');
let s = idx;
while (s > 0 && c[s] !== '{') s--;
let depth = 0, inStr = false, esc = false, end = s;
for (let i = s; i < c.length; i++) {
  if (esc) { esc = false; continue; }
  if (c[i] === '\\') { esc = true; continue; }
  if (c[i] === '"') { inStr = !inStr; continue; }
  if (inStr) continue;
  if (c[i] === '{') depth++;
  if (c[i] === '}') depth--;
  if (depth === 0) { end = i + 1; break; }
}
const outer = c.substring(s, end);
const raw = JSON.parse(outer);
const str = raw.data.Rows[0];
const parsed = JSON.parse(str);
const snapshot = JSON.parse(parsed[0]);
console.log('snapshot keys:', Object.keys(snapshot));
console.log('observedAt:', snapshot.observedAt);
console.log('summary rows:', snapshot.summary.length);
fs.writeFileSync('tests/security/.results/wp04-audit.json', JSON.stringify(snapshot, null, 2));
console.log('SAVED');
