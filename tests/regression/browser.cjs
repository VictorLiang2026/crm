'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { installFixtures } = require('./fixtures.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

class Browser {
  constructor(root) { this.root = root; this.pending = new Map(); this.serial = 0; this.networkViolations = []; this.runtimeErrors = []; }
  async start() {
    const executable = [process.env.CRM_TEST_BROWSER,
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].filter(Boolean).find(p => fs.existsSync(p));
    if (!executable) throw new Error('No browser: set CRM_TEST_BROWSER to a Chromium/Edge executable');
    const source = fs.readFileSync(path.join(this.root, 'admin.html'), 'utf8');
    const sdk = /<script\s+src="https:\/\/static\.cloudbase\.net\/cloudbase-js-sdk\/latest\/cloudbase\.full\.js"><\/script>/g;
    if ([...source.matchAll(sdk)].length !== 1) throw new Error('SDK injection anchor changed; refuse to serve production SDK');
    const html = source.replace(sdk, '<script src="/fixtures.js"></script>');
    this.server = http.createServer((req, res) => {
      const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'");
      if (pathname === '/admin.html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); }
      else if (pathname === '/fixtures.js') { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end('(' + installFixtures.toString() + ')();'); }
      else { res.writeHead(404); res.end(); }
    });
    this.server.listen(0, '127.0.0.1');
    await once(this.server, 'listening');
    this.origin = 'http://127.0.0.1:' + this.server.address().port;
    this.profile = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-regression-'));
    this.process = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
      '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + this.profile, 'about:blank'],
    { windowsHide: true, stdio: 'ignore' });
    let spawnError;
    this.process.on('error', e => { spawnError = e; });
    const portFile = path.join(this.profile, 'DevToolsActivePort');
    for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) {
      if (spawnError) throw spawnError;
      if (this.process.exitCode !== null) throw new Error('Browser exited before debugger ready');
      await delay(100);
    }
    if (!fs.existsSync(portFile)) throw new Error('Browser debugger startup timed out');
    const port = fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0];
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    const target = targets.find(t => t.type === 'page');
    if (!target) throw new Error('No browser page target');
    this.socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { this.socket.addEventListener('open', resolve, { once: true }); this.socket.addEventListener('error', reject, { once: true }); });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const p = this.pending.get(message.id);
        if (p) { clearTimeout(p.timer); this.pending.delete(message.id); message.error ? p.reject(new Error(message.error.message)) : p.resolve(message.result); }
      } else if (message.method === 'Fetch.requestPaused') {
        const { request, requestId } = message.params;
        const allowed = request.url.startsWith(this.origin + '/') && request.method === 'GET';
        if (!allowed) this.networkViolations.push(request.method + ' ' + request.url);
        this.send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', allowed ? { requestId } : { requestId, errorReason: 'BlockedByClient' })
          .catch(e => this.runtimeErrors.push(e.message));
      } else if (message.method === 'Runtime.exceptionThrown') {
        this.runtimeErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      }
    });
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  }
  send(method, params = {}) {
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  async wait(expression, timeout = 6000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await this.evaluate(expression)) return; await delay(50); }
    throw new Error('Timed out: ' + expression + '\nView: ' + (await this.evaluate("document.getElementById('view')?.innerText"))?.slice(0, 1400));
  }
  async open(hash, query = '') {
    this.runtimeErrors.length = 0;
    await this.send('Page.navigate', { url: this.origin + '/admin.html?' + query + '&run=' + Date.now() + hash });
    await this.wait('Boolean(window.__crmTest && document.getElementById("view"))');
  }
  async click(selector, text) {
    await this.evaluate(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.includes(${JSON.stringify(text)})); if (!e) throw new Error('Control not found: ' + ${JSON.stringify(text)}); e.click(); })()`);
  }
  async healthy() {
    const state = await this.evaluate('window.__crmTest');
    const failures = [...this.runtimeErrors, ...this.networkViolations, ...state.errors, ...state.violations];
    if (failures.length) throw new Error(failures.join('\n'));
  }
  async close() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      try { await this.send('Browser.close'); } catch (e) { if (this.process?.exitCode === null) this.process.kill(); }
      this.socket.close();
    }
    if (this.process?.exitCode === null) {
      this.process.kill();
      await Promise.race([once(this.process, 'exit'), delay(2000)]);
    }
    this.server?.closeAllConnections();
    if (this.server?.listening) await new Promise(resolve => this.server.close(resolve));
    // Keep the temporary profile for diagnosis; never touch the user's browser profile.
  }
}
module.exports = { Browser };
