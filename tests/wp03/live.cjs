'use strict';
// Serve the real CRM files locally; credentials remain in an isolated browser profile.
// This helper never submits credentials, confirms a preview, or generates records.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const evidence = path.join(root, 'tests/security/.results');
const allowed = new Map([['/crm/admin.html', 'admin.html']]);
for (const folder of ['crm/js', 'crm/css']) {
  for (const name of fs.readdirSync(path.join(root, folder), { recursive: true })) {
    const relative = folder + '/' + name.replaceAll('\\', '/');
    if (/\.(js|css)$/.test(relative) && fs.statSync(path.join(root, relative)).isFile()) allowed.set('/' + relative, relative);
  }
}
const server = http.createServer((req, res) => {
  const file = allowed.get(new URL(req.url, 'http://127.0.0.1').pathname);
  if (req.method !== 'GET' || !file) { res.writeHead(404); res.end(); return; }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8');
  res.end(fs.readFileSync(path.join(root, file)));
});
server.listen(0, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + server.address().port + '/crm/admin.html#/test-scenario';
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-wp03-live-'));
  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(evidence, 'wp03-live-window.json'), JSON.stringify({ url, profile, observedAt: new Date().toISOString() }, null, 2));
  const exe = process.env.CRM_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const child = spawn(exe, ['--new-window', '--no-first-run', '--no-default-browser-check', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile, url], { stdio: 'ignore', detached: true });
  child.on('error', () => { console.error('Test browser failed to open'); server.close(); process.exitCode = 1; });
  child.unref();
  console.log('WP03 real CRM test window: ' + url);
});
