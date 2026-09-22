'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
if (args.some(x => !['--backend-only', '--browser-only'].includes(x)) || args.length > 1) {
  console.error('Usage: node tests/regression/run.cjs [--backend-only|--browser-only]'); process.exit(2);
}
const results = [];
async function test(id, title, layer, fn) {
  const start = Date.now();
  try { await fn(); results.push({ id, title, layer, status: 'PASS', durationMs: Date.now() - start }); console.log('PASS ' + id); return true; }
  catch (e) { results.push({ id, title, layer, status: 'FAIL', durationMs: Date.now() - start, error: e.stack || String(e) }); console.log('FAIL ' + id + ': ' + e.message); return false; }
}

(async () => {
  const startedAt = new Date().toISOString();
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'admin.html'))).digest('hex');
  if (!args.includes('--browser-only')) await require('./backend.cjs')(root, test);
  if (!args.includes('--backend-only')) await require('./smoke.cjs')(root, test);
  if (!args.includes('--browser-only')) await require('./activity-schema.cjs')(root, test);
  const skipped = [
    ['live.login', '真实 CloudBase 账号、SDK 与会话认证'],
    ['live.database', '线上public对象SQL检查（需通过只读管理工具单独执行 database-readonly.sql）'],
    ['live.ai', '真实 Today / 漏斗 AI 生成与计费链路'],
    ['live.writes', '新增、编辑、删除、恢复和级联写入；本骨架不提供线上写模式'],
    ['live.mobile', '真实移动设备及视觉布局回归']
  ];
  if (args.includes('--backend-only')) skipped.push(['browser.suite', '本次选择仅后端测试']);
  if (args.includes('--browser-only')) skipped.push(['backend.suite', '本次选择仅浏览器测试']);
  for (const [id, title] of skipped) results.push({ id, title, layer: 'not exercised', status: 'SKIP' });
  const counts = Object.fromEntries(['PASS', 'FAIL', 'SKIP'].map(status => [status, results.filter(x => x.status === status).length]));
  const report = { startedAt, finishedAt: new Date().toISOString(), head, sourceHash, mode: args[0] || 'all',
    safety: 'Offline fixtures only. No production SDK, database connection, cloud function invocation or remote data mutation.', counts, results };
  const dir = path.join(__dirname, '.results'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(report, null, 2) + '\n');
  const cell = s => String(s || '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
  fs.writeFileSync(path.join(dir, 'latest.md'), '# CRM 自动化回归结果\n\n' +
    `运行：${startedAt}\n\nGit HEAD：${head}\n\n页面 SHA-256：${sourceHash}\n\n模式：${report.mode}\n\nPASS ${counts.PASS} / FAIL ${counts.FAIL} / SKIP ${counts.SKIP}\n\n` +
    '隔离测试通过不代表生产端到端通过。无线上写入；真实登录、AI、RLS及写操作见SKIP。\n\n' +
    '| ID | 项目 | 层级 | 结果 | 错误 |\n| --- | --- | --- | --- | --- |\n' + results.map(r => `| ${r.id} | ${cell(r.title)} | ${cell(r.layer)} | ${r.status} | ${cell(r.error)} |`).join('\n') + '\n');
  console.log(JSON.stringify(counts));
  process.exitCode = counts.FAIL ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 2; });
