'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const Module = require('node:module');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { makeControl } = require('../../cloudfunctions/person_360/device-control');
const env = 'crm-d1gkae8ddc930d151';
const root = path.resolve(__dirname, '../..');

(async () => {
  let approved = false, key, ticket, lastRequest, bareReceipt = false;
  const info = { uid: 'fixture', isAnonymous: false };
  const app = { auth: () => ({getUserInfo: () => info}) };
  async function database(body) {
    const args = body.p_args;
    assert.equal(body.p_uid, info.uid);
    if (body.p_op === 'request') { key = args.public_key; return {data:{state:approved ? 'approved' : 'pending'}}; }
    assert.ok(approved);
    if (body.p_op === 'issue') {
      ticket = {challenge:randomUUID(), ...args};
      return {data:{challenge:ticket.challenge}};
    }
    assert.deepEqual(args, ticket);
    if (body.p_op === 'inspect') return {data:{public_key:key}};
    assert.equal(body.p_op,'consume'); ticket = null; return {data:{ok:true}};
  }
  const entry = path.join(root, 'cloudfunctions/person_360/index.js');
  process.env.TCB_ENV = env;
  process.env.CRM_PERSON360_DB_API_KEY = 'synthetic-local-fixture';
  global.fetch = async (url, options) => {
    assert.equal(new URL(url).pathname, '/v1/rdb/rest/rpc/crm_device_member_gateway_v1');
    const result = await database(JSON.parse(options.body));
    return Response.json(result.data);
  };
  const mod = new Module(entry);
  mod.require = id => {
    if (id === '@cloudbase/node-sdk') return {init:() => app};
    if (id === './device-runtime') {
      const runtime = require('../../cloudfunctions/person_360/device-runtime');
      return {...runtime, protect:(name,handler)=>runtime.protect(name,handler,()=>app)};
    }
    if (id === './device-control') return {makeControl:() => makeControl(app, env, database)};
    return {};
  };
  mod._compile(fs.readFileSync(entry, 'utf8'), entry);
  const server = http.createServer((req,res) => {
    const file = new URL(req.url,'http://fixture').pathname;
    const allowed = ['/crm/device-access.html','/crm/js/modules/device-access/setup.js','/crm/js/modules/device-access/client.js',
      '/crm/js/modules/console/i18n.js','/crm/css/device-access.css'];
    if (!allowed.includes(file)) {res.writeHead(404);res.end();return;}
    const contents = fs.readFileSync(path.join(root,file.slice(1)),'utf8');
    res.setHeader('content-type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript':'text/css');
    res.end(file.endsWith('.html') ? contents.replace(/<script src="https:[^"]+"><\/script>/,'') : contents);
  });
  await new Promise(ok => server.listen(0,'127.0.0.1',ok));
  let browser;
  try {
    browser = await puppeteer.launch({executablePath:process.env.CRM_TEST_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
    const page = await browser.newPage();
    await page.exposeFunction('invoke', async ({data}) => {
      if (data.__deviceRequest) lastRequest = data;
      return {result: bareReceipt && data.__deviceRequest ? {ok:true} : await mod.exports.main(data)};
    });
    await page.evaluateOnNewDocument(() => {
      window.cloudbase = {init:() => ({callFunction:window.invoke,auth:() => ({getSession:async()=>({data:{session:{user:{is_anonymous:false}}}})})})};
    });
    await page.goto('http://127.0.0.1:'+server.address().port+'/crm/device-access.html');
    await page.waitForSelector('#request',{visible:true});
    async function clickAndRead() {
      await page.click('#request');
      await page.waitForFunction(()=>!document.querySelector('#request').disabled);
      return page.$eval('#status',e=>e.textContent);
    }
    assert.match(await clickAndRead(),/待|等待/);
    approved = true;
    assert.match(await clickAndRead(),/设备签名验证通过/);
    assert.equal((await mod.exports.main(lastRequest)).error,'DEVICE_ACCESS_DENIED');
    bareReceipt = true;
    assert.match(await clickAndRead(),/签名验证未通过/);
    console.log('PASS: real application page and function handler verify an approved browser signature; a replay and a bare success receipt fail');
  } finally {if(browser) await browser.close();await new Promise(ok=>server.close(ok));}
})().catch(e=>{console.error(e);process.exitCode=1;});
