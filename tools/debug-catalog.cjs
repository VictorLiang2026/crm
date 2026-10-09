#!/usr/bin/env node
// Generic tcb snapshot extractor with format autodetection.
'use strict';
const fs = require('fs');

const [inputFile, outputFile] = process.argv.slice(2);
let content = fs.readFileSync(inputFile, 'utf8').replace(/^﻿/, '');
const key = content.indexOf('"data"');
if (key === -1) { console.error('no data'); process.exit(1); }
let s = key; while (s > 0 && content[s] !== '{') s--;
let depth = 0, inStr = false, esc = false, end = s;
for (let i = s; i < content.length; i++) {
  if (esc) { esc = false; continue; }
  if (content[i] === '\\') { esc = true; continue; }
  if (content[i] === '"') { inStr = !inStr; continue; }
  if (inStr) continue;
  if (content[i] === '{') depth++;
  if (content[i] === '}') depth--;
  if (depth === 0) { end = i + 1; break; }
}
const raw = JSON.parse(content.substring(s, end));
const data = raw.data;
if (!data || !Array.isArray(data.Rows) || !data.Rows.length) {
  console.error('no Rows; keys:', data && Object.keys(data));
  process.exit(1);
}
let cell = data.Rows[0];
// tcb may return the row as an array-of-cells or a single cell string
let value = Array.isArray(cell) ? cell[0] : cell;
// The jsonb cell may itself be a JSON-encoded array containing the object string
function tryParse(v) { try { return [JSON.parse(v), true]; } catch { return [null, false]; } }
let [parsed, ok] = tryParse(value);
while (ok && (typeof parsed === 'string' || Array.isArray(parsed))) {
  if (Array.isArray(parsed)) parsed = parsed[0];
  else { [parsed, ok] = tryParse(parsed); if (!ok) break; }
  if (typeof parsed === 'object') break;
  const next = tryParse(parsed);
  if (!next[1]) break;
  parsed = next[0];
}
// Simpler: loop until object
let cur = value;
for (let i = 0; i < 6; i++) {
  if (typeof cur === 'object' && cur !== null) break;
  const [p, ok2] = tryParse(cur);
  if (!ok2) { console.error('cannot parse at depth', i); process.exit(1); }
  cur = Array.isArray(p) ? p[0] : p;
}
fs.writeFileSync(outputFile, JSON.stringify(cur, null, 2));
console.log('SAVED', outputFile, 'keys:', Object.keys(cur).join(','));
