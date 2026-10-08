#!/usr/bin/env node
/* tcb-db-execute.cjs — 用 tcb db execute 执行 SQL 文件并保存 JSON 结果（替代 pg-readonly.cjs） */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--file') args.file = process.argv[++i];
  else if (a === '--out') args.out = process.argv[++i];
  else throw new Error('Unknown argument: ' + a);
}

if (!args.file) throw new Error('--file <path> is required');
if (!args.out) throw new Error('--out <path> is required');

const filePath = path.resolve(args.file);
const outPath = path.resolve(args.out);

if (!fs.existsSync(filePath)) throw new Error('File not found: ' + filePath);
const sql = fs.readFileSync(filePath, 'utf8');

console.log('[tcb-db-execute] file=' + filePath);
console.log('[tcb-db-execute] executing via tcb db execute...');

const result = execSync(`tcb.cmd db execute -e crm-d1gkae8ddc930d151 --sql "${sql.replace(/"/g, '\\"')}" --json`, {
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024
});

// 解析 tcb 输出（最后几行是 JSON）
const lines = result.split('\n');
let jsonStart = -1;
for (let i = lines.length - 1; i >= 0; i--) {
  if (lines[i].trim().startsWith('{')) {
    jsonStart = i;
    break;
  }
}

if (jsonStart === -1) {
  throw new Error('No JSON output found in tcb db execute result');
}

const jsonStr = lines.slice(jsonStart).join('\n');
const parsed = JSON.parse(jsonStr);

if (!parsed.data || !parsed.data.Rows || parsed.data.Rows.length === 0) {
  throw new Error('No rows returned');
}

// catalog.sql/audit.sql 返回单列 "snapshot"（JSON 字符串）
const snapshotStr = parsed.data.Rows[0];
const snapshot = JSON.parse(snapshotStr.replace(/^\["|"\]$/g, '').replace(/\\"/g, '"'));

fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
console.log('[tcb-db-execute] saved to ' + outPath);
