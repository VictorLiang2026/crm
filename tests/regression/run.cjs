'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { parseArgs, counts, shouldRetryBrowser, mergeRetry } = require('./runner-core.cjs');

const root = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const parsed = parseArgs(args);
if (parsed.error) {
  console.error(parsed.error);
  process.exit(2);
}

const startedAt = new Date().toISOString();
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'admin.html'))).digest('hex');
const runId = `${startedAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${head.slice(0, 8)}-${parsed.mode}`;
const runDir = path.join(__dirname, '.results', runId);
fs.mkdirSync(runDir, { recursive: true });

function testFactory(targetResults, attemptName) {
  return async function test(id, title, layer, fn, metadata = {}) {
    if (parsed.browserGroup && metadata.group && metadata.group !== 'harness' && metadata.group !== parsed.browserGroup) {
      targetResults.push({ id, title, layer, group: metadata.group, status: 'SKIP', reason: `Excluded by browser group ${parsed.browserGroup}` });
      return true;
    }
    const start = Date.now();
    try {
      await fn();
      targetResults.push({ id, title, layer, ...(metadata.group ? { group: metadata.group } : {}), status: 'PASS', durationMs: Date.now() - start, attempt: attemptName });
      console.log('PASS ' + id);
      return true;
    } catch (error) {
      let diagnostics;
      if (typeof metadata.diagnostics === 'function') {
        try {
          diagnostics = await metadata.diagnostics({ runDir, captureScreenshot: true, testId: id });
        } catch (diagnosticError) {
          diagnostics = { diagnosticError: diagnosticError.message };
        }
      }
      const errorText = error.stack || String(error);
      targetResults.push({ id, title, layer, ...(metadata.group ? { group: metadata.group } : {}), status: 'FAIL', durationMs: Date.now() - start,
        error: errorText, errorCode: error.code || null, failureStage: error.stage || diagnostics?.stage || null,
        ...(diagnostics ? { diagnostics } : {}), attempt: attemptName });
      console.log('FAIL ' + id + ': ' + error.message);
      if (metadata.abortOnInfrastructureFailure && error.code === 'BROWSER_INFRASTRUCTURE') {
        const abort = new Error('Browser suite stopped after an infrastructure failure');
        abort.code = 'BROWSER_SUITE_ABORT';
        throw abort;
      }
      return false;
    }
  };
}

function saveAttempt(name, results, attemptStartedAt) {
  const report = { runId, attempt: name, startedAt: attemptStartedAt, node: process.version,
    head, sourceHash, mode: parsed.mode, browserGroup: parsed.browserGroup, counts: counts(results), results };
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(runDir, `${name}.json`), JSON.stringify(report, null, 2) + '\n');
  return report;
}

function runBrowser(root, browserResults, attemptName) {
  return require('./smoke.cjs')(root, testFactory(browserResults, attemptName), {
    runId, runDir, attemptName, browserGroup: parsed.browserGroup,
  }).catch(error => {
    if (error.code === 'BROWSER_SUITE_ABORT') return;
    throw error;
  });
}

(async () => {
  const results = [];
  if (parsed.mode !== 'browser' && !parsed.mode.startsWith('browser-')) {
    await require('./backend.cjs')(root, testFactory(results, 'initial'));
    await require('./activity-schema.cjs')(root, testFactory(results, 'initial'));
    await require('./activity-canonical.cjs')(root, testFactory(results, 'initial'));
    await require('./activity-speaker-person.cjs')(root, testFactory(results, 'initial'));
  }

  let browserResults = [];
  if (parsed.mode !== 'backend') {
    const initialStartedAt = new Date().toISOString();
    await runBrowser(root, browserResults, 'initial');
    saveAttempt('browser-initial', browserResults, initialStartedAt);
    if (shouldRetryBrowser(browserResults)) {
      console.warn('BROWSER_INFRASTRUCTURE_FAILURE: retrying the isolated browser suite once; assertion failures are never retried.');
      const retryResults = [];
      const retryStartedAt = new Date().toISOString();
      await runBrowser(root, retryResults, 'isolated-retry');
      saveAttempt('browser-isolated-retry', retryResults, retryStartedAt);
      browserResults = mergeRetry(browserResults, retryResults);
    }
    results.push(...browserResults);
  } else {
    results.push({ id: 'browser.suite', title: '本次选择仅后端测试', layer: 'not exercised', status: 'SKIP' });
  }
  if (parsed.mode === 'browser' || parsed.mode.startsWith('browser-')) {
    results.push({ id: 'backend.suite', title: '本次选择仅浏览器测试', layer: 'not exercised', status: 'SKIP' });
  }

  const skipped = [
    ['live.login', '真实 CloudBase 账号、SDK 与会话认证'],
    ['live.database', '线上 public 对象 SQL 检查（需通过只读管理工具单独执行）'],
    ['live.ai', '真实 AI 生成与计费链路'],
    ['live.writes', '线上新增、编辑、删除、恢复；本骨架不提供线上写模式'],
    ['live.mobile', '真实移动设备及视觉布局回归'],
  ];
  for (const [id, title] of skipped) results.push({ id, title, layer: 'not exercised', status: 'SKIP' });

  const summary = counts(results);
  const report = { runId, startedAt, finishedAt: new Date().toISOString(), head, node: process.version, sourceHash,
    mode: parsed.mode, browserGroup: parsed.browserGroup, attempts: fs.readdirSync(runDir).filter(file => file.startsWith('browser-') && file.endsWith('.json')),
    safety: 'Offline fixtures only. No production SDK, database connection, cloud function invocation or remote data mutation.', counts: summary, results };
  fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const latestDir = path.join(__dirname, '.results');
  fs.mkdirSync(latestDir, { recursive: true });
  fs.writeFileSync(path.join(latestDir, 'latest.json'), JSON.stringify(report, null, 2) + '\n');
  const cell = value => String(value || '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
  fs.writeFileSync(path.join(latestDir, 'latest.md'), '# CRM 自动化回归结果\n\n' +
    `运行：${report.startedAt}\n\nGit HEAD：${head}\n\nNode：${process.version}\n\n页面 SHA-256：${sourceHash}\n\n模式：${report.mode}\n\n` +
    `PASS ${summary.PASS} / FLAKY ${summary.FLAKY} / FAIL ${summary.FAIL} / TODO ${summary.TODO} / SKIP ${summary.SKIP}\n\n` +
    '隔离测试通过不代表生产端到端通过。线上登录、数据库写入、AI 与真机移动未在此运行中执行。\n\n' +
    '| ID | 项目 | 层级/分组 | 结果 | 阶段 | 截图 | 错误 |\n| --- | --- | --- | --- | --- | --- | --- |\n' +
    results.map(item => `| ${cell(item.id)} | ${cell(item.title)} | ${cell(item.group || item.layer)} | ${item.status} | ${cell(item.failureStage)} | ${cell(item.diagnostics?.screenshot)} | ${cell(item.error)} |`).join('\n') + '\n\n' +
    `完整运行证据：${path.relative(root, path.join(runDir, 'report.json')).replace(/\\/g, '/')}\n`);
  console.log(JSON.stringify(summary));
  process.exitCode = summary.FAIL ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 2; });
