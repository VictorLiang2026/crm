/** Interactive, fictional Person-only production AI probe. No credentials or generated text are saved. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const start = source.indexOf('var authInst = null;');
const end = source.indexOf('// ==================== 表单生成');
const sdk = source.match(/https:\/\/static\.cloudbase\.net\/cloudbase-js-sdk\/\d+\.\d+\.\d+\/cloudbase\.full\.js/)?.[0];
if (start < 0 || end <= start || !sdk) throw Error('Production login anchors changed');
const envId = 'crm-d1gkae8ddc930d151';
const nonce = crypto.randomBytes(24).toString('hex');
const dual = process.argv.includes('--dual');
const playbook = process.argv.includes('--playbook');
const payload = dual ? { action: 'knowledgeLibrary', operation: 'dualGenerate', data: { personId: '783' } } : playbook ? { action: 'conversationPlaybook', personId: '783',
  objection: '【系统测试·勿联系】我想先理解保障内容，再决定是否继续。' } :
  { action: 'summarize', personId: '783' };
const reportFile = path.join(root, playbook ?
  'tests/security/.results/pc33-live-playbook.json' : dual ?
  'tests/security/.results/pc33-live-dual.json' : 'tests/security/.results/pc33-live-model.json');
async function probe(nonce, payload, runRepeat) {
  const report = { login: 'FAIL', first: 'NOT_RUN', repeat: 'NOT_RUN',
    sameTask: false, sameResult: false, taskId: null, resultId: null };
  try {
    await initSdk();
    const session = await authInst.getSession();
    if (session?.error || !session?.data?.session) throw Error('NO_SESSION');
    report.login = 'PASS';
    document.getElementById('view').textContent = '正在对“【系统测试·勿联系】虚构体验甲”调用已配置的 AI 模型，仅生成建议，不写业务数据。';
    const first = await Promise.race([callFn('assistant', payload),
      new Promise((_, reject) => setTimeout(() => reject(Error('LOCAL_TIMEOUT')), 95000))]);
    const validDual = dual && first?.ok === true && Number.isSafeInteger(Number(first.taskId)) &&
      Array.isArray(first.candidates) && first.candidates.length === 2 &&
      first.candidates.map(item => item?.candidateType).sort().join(',') === 'library_based,strategy_based' &&
      first.candidates.every(item => Number.isSafeInteger(Number(item.id)));
    if (dual ? !validDual : first?.ok !== true || !Number.isSafeInteger(Number(first.taskId)) ||
        !Number.isSafeInteger(Number(first.resultId))) {
      report.first = first?.error?.code || 'INVALID_RESPONSE';
    } else {
      report.first = 'PASS';
      report.taskId = Number(first.taskId);
      report.resultId = Number(dual ? first.candidates[0].id : first.resultId);
      if (runRepeat) {
        const repeat = await Promise.race([callFn('assistant', payload),
          new Promise((_, reject) => setTimeout(() => reject(Error('LOCAL_TIMEOUT')), 95000))]);
        report.sameTask = Number(repeat?.taskId) === report.taskId;
        report.sameResult = Number(repeat?.resultId) === report.resultId;
        report.repeat = repeat?.ok === true && report.sameTask && report.sameResult ? 'PASS' :
          (repeat?.error?.code || 'NEW_RESULT');
      }
    }
  } catch (error) { if (report.login === 'PASS') report.first = error?.message === 'LOCAL_TIMEOUT' ? 'LOCAL_TIMEOUT' : 'REQUEST_FAILED'; }
  finally {
    try {
      const response = await fetch('/result', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-PC33-Nonce': nonce },
        body: JSON.stringify(report) });
      document.getElementById('view').textContent = response.ok ?
        'AI 探针结束，结果已保存。可关闭窗口。' : '结果保存失败，请保留窗口。';
    } catch { document.getElementById('view').textContent = '结果保存失败，请保留窗口。'; }
    try { await authInst.signOut(); } catch { /* Isolated browser profile closes after probe. */ }
  }
}
const html = '<!doctype html><meta charset="utf-8"><title>PC33 AI 测试账号登录</title>' +
  '<style>body{font:16px sans-serif;max-width:620px;margin:48px auto}input,button{padding:12px;margin:8px}label{display:block}</style>' +
  '<h1>PC33 虚构人物 AI 验证</h1><p>请使用测试账号。仅为已登记的虚构 Person 783 生成一次' +
  (dual ? '双视角跟进建议' : playbook ? '对话建议' : '摘要并核对同请求重用') + '；不写业务数据，不保存账号、令牌或生成内容。</p>' +
  '<div id="env-label"></div><div id="view"></div><div id="modal-root"></div><div id="toast-root"></div>' +
  '<script src="' + sdk + '"></script><script>var CONFIG={envId:' + JSON.stringify(envId) + '};var app=null;function route(){}' +
  source.slice(start, end) + '\n(' + probe.toString() + ')(' + JSON.stringify(nonce) + ',' +
  JSON.stringify(payload) + ',' + JSON.stringify(!playbook) + ');</script>';
let origin;
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET' && req.url === '/') { res.setHeader('Content-Type','text/html; charset=utf-8'); res.end(html); return; }
  if (req.method !== 'POST' || req.url !== '/result' || req.headers.origin !== origin || req.headers['x-pc33-nonce'] !== nonce) {
    res.writeHead(403); res.end(); return;
  }
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > 2000) req.destroy(); });
  req.on('end', () => {
    try {
      const input = JSON.parse(body);
      const codes = new Set(['PASS','FAIL','NOT_RUN','NO_SESSION','INVALID_RESPONSE','LOCAL_TIMEOUT','REQUEST_FAILED',
        'NEW_RESULT','UNAUTHORIZED','INVALID_INPUT','NOT_FOUND','INVALID_CONFIG','INVALID_RESULT','RATE_LIMIT',
        'TIMEOUT','UPSTREAM_UNAVAILABLE','PERSISTENCE_ERROR','AI_IN_PROGRESS','AI_RETRY_LATER',
        'AI_AUDIT_UNKNOWN','AI_REQUEST_FAILED','SUMMARY_FAILED']);
      if (!codes.has(input.login) || !codes.has(input.first) || !codes.has(input.repeat) ||
          typeof input.sameTask !== 'boolean' || typeof input.sameResult !== 'boolean' ||
          (input.taskId != null && !(Number.isSafeInteger(input.taskId) && input.taskId > 0)) ||
          (input.resultId != null && !(Number.isSafeInteger(input.resultId) && input.resultId > 0))) throw Error('Invalid summary');
      const report = { environment: envId, observedAt: new Date().toISOString(),
        login: input.login, first: input.first, repeat: input.repeat,
        sameTask: input.sameTask, sameResult: input.sameResult,
        taskId: input.taskId, resultId: input.resultId };
      fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
      res.end('ok'); console.log(JSON.stringify(report));
      setTimeout(() => server.close(), 1000);
    } catch { res.writeHead(400); res.end('Invalid summary'); }
  });
});
server.listen(0, '127.0.0.1', () => {
  origin = 'http://127.0.0.1:' + server.address().port;
  const exe = process.env.CRM_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-pc33-model-'));
  console.log('PC33 model login: ' + origin);
  const browser = spawn(exe, ['--new-window','--no-first-run','--no-default-browser-check',
    '--user-data-dir=' + profile, origin], { stdio: 'ignore', detached: true, windowsHide: true });
  browser.on('error', () => { console.error('Test browser failed to open'); server.close(); process.exitCode = 1; });
  browser.unref();
});
