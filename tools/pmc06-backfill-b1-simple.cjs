#!/usr/bin/env node
/* pmc06-backfill-b1-simple.cjs — PMC-06 B1 批次简化版：直接用 UPDATE JOIN 回填 customers.person_id */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, '..', 'tests', 'security', '.results');
const LOG_FILE = path.join(RESULTS_DIR, 'pmc06-batch-log.json');
const TEMP_SQL = path.join(__dirname, '..', 'temp-pmc06.sql');

function runSQL(sql) {
  fs.writeFileSync(TEMP_SQL, sql, 'utf8');
  try {
    const result = execSync(`tcb.cmd db execute -e crm-d1gkae8ddc930d151 --sql (Get-Content '${TEMP_SQL}' -Raw) --json`, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      shell: 'powershell.exe'
    });
    fs.unlinkSync(TEMP_SQL);
    const lines = result.split('\n');
    let jsonStart = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim().startsWith('{')) { jsonStart = i; break; }
    }
    if (jsonStart === -1) throw new Error('No JSON output');
    const parsed = JSON.parse(lines.slice(jsonStart).join('\n'));
    return parsed.data;
  } catch (e) {
    try { fs.unlinkSync(TEMP_SQL); } catch {}
    throw e;
  }
}

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

function parseCount(rows) {
  if (!rows || rows.length === 0) return 0;
  const str = rows[0].replace(/[\[\]"]/g, '');
  return parseInt(str, 10) || 0;
}

async function main() {
  log('=== PMC-06 B1 批次回填开始（简化版）===');

  // 1. 预检：确认可回填行数
  log('Step 1: 预检可回填行数...');
  const precheck = runSQL('SELECT count(*) AS count FROM customers c JOIN persons p ON p.legacy_customer_id = c."Id" WHERE c.person_id IS NULL AND c.deleted_at IS NULL AND p.deleted_at IS NULL');
  const totalCount = parseCount(precheck.Rows);
  log(`Precheck: ${totalCount} rows eligible for backfill`);

  if (totalCount === 0) {
    log('No rows to backfill (all person_id already filled).');
    return;
  }

  // 2. 执行批量 UPDATE（用 JOIN 一次性回填，幂等：WHERE person_id IS NULL）
  log('Step 2: 执行批量 UPDATE...');
  const updateSQL = `
UPDATE customers c
SET person_id = p.id
FROM persons p
WHERE p.legacy_customer_id = c."Id"
  AND c.person_id IS NULL
  AND c.deleted_at IS NULL
  AND p.deleted_at IS NULL
`;
  const updateResult = runSQL(updateSQL);
  const affectedRows = updateResult.AffectedRows || 0;
  log(`UPDATE executed: ${affectedRows} rows affected`);

  // 3. 回填后核对
  log('Step 3: 回填后核对...');
  const verify = runSQL('SELECT count(*) AS total, count(person_id) AS with_person_id FROM customers WHERE deleted_at IS NULL');
  const parts = verify.Rows[0].replace(/[\[\]"]/g, '').split(',');
  const total = parseInt(parts[0], 10) || 0;
  const withPersonId = parseInt(parts[1], 10) || 0;
  log(`Verify: total=${total}, with_person_id=${withPersonId}, without_person_id=${total - withPersonId}`);

  // 4. 检查孤立引用
  log('Step 4: 检查孤立引用...');
  const orphans = runSQL('SELECT count(*) AS orphans FROM customers c LEFT JOIN persons p ON p.id = c.person_id WHERE c.person_id IS NOT NULL AND p.id IS NULL');
  const orphanCount = parseCount(orphans.Rows);
  log(`Orphans: ${orphanCount}`);

  // 5. 检查一对一完整性
  log('Step 5: 检查一对一完整性...');
  const duplicates = runSQL('SELECT count(*) AS dupes FROM (SELECT person_id FROM customers WHERE person_id IS NOT NULL GROUP BY person_id HAVING count(*) > 1) t');
  const dupeCount = parseCount(duplicates.Rows);
  log(`Duplicate person_id: ${dupeCount}`);

  // 6. 保存日志
  const logData = {
    observedAt: new Date().toISOString(),
    totalEligible: totalCount,
    affectedRows,
    totalCustomers: total,
    withPersonId,
    withoutPersonId: total - withPersonId,
    orphans: orphanCount,
    duplicatePersonIds: dupeCount
  };
  fs.writeFileSync(LOG_FILE, JSON.stringify(logData, null, 2));
  log(`Log saved: ${LOG_FILE}`);

  log('=== PMC-06 B1 批次回填完成 ===');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
