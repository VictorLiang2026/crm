#!/usr/bin/env node
/*
 * extract-snapshot.cjs — extract the "snapshot" JSON payload from `tcb db execute --json` output.
 *
 * tcb wraps the SQL result in { data: { Rows: [[ "<escaped JSON string>" ]] } }.
 * This script unwraps it and writes the inner snapshot JSON to a file.
 *
 * Usage:
 *   node tools/extract-snapshot.cjs <input-file> <output-file>
 */
'use strict';
const fs = require('node:fs');

function main() {
  const [inputFile, outputFile] = process.argv.slice(2);
  if (!inputFile || !outputFile) {
    console.error('Usage: node tools/extract-snapshot.cjs <input-file> <output-file>');
    process.exit(1);
  }

  let content = fs.readFileSync(inputFile, 'utf8');
  // Strip BOM
  content = content.replace(/^﻿/, '');

  // Find the JSON object containing "data" (allow whitespace)
  const start = content.indexOf('"data"');
  if (start === -1) {
    console.error('No "data" key found in input');
    process.exit(1);
  }
  // Backtrack to the opening brace of the object containing "data"
  let objStart = start;
  while (objStart > 0 && content[objStart] !== '{') objStart--;
  // Count braces to find matching close (handle strings and escapes)
  let depth = 0, end = objStart, inString = false, escape = false;
  for (let i = objStart; i < content.length; i++) {
    if (escape) { escape = false; continue; }
    if (content[i] === '\\') { escape = true; continue; }
    if (content[i] === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (content[i] === '{') depth++;
    if (content[i] === '}') depth--;
    if (depth === 0) { end = i + 1; break; }
  }

  const outerJson = content.substring(objStart, end);
  console.log('outer JSON length:', outerJson.length);
  console.log('outer JSON last 50:', JSON.stringify(outerJson.substring(outerJson.length - 50)));
  const raw = JSON.parse(outerJson);
  const snapshotJson = raw.data.Rows[0][0];
  const snapshot = JSON.parse(snapshotJson);

  fs.writeFileSync(outputFile, JSON.stringify(snapshot, null, 2));
  console.log('snapshot saved to', outputFile);
  console.log('observedAt:', snapshot.observedAt);
  if (snapshot.objects) console.log('objects count:', snapshot.objects.length);
  if (snapshot.roles) console.log('roles count:', snapshot.roles.length);
  if (snapshot.summary) console.log('summary rows:', snapshot.summary.length);
}

main();
