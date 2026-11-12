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
    if (!approved) return {error:{message:'DEVICE_NOT_APPROVED'}};
    if (body.p_op === 'issue') {
      ticket = {challenge:randomUUID(), ...args};
      return {data:{challenge:ticket.challenge}};
    }
    assert.deepEqual(args, ticket);
    if (body.p_op === 'inspect') return {data:{public_key:key}};
    assert.equal(body.p_op,'consume'); ticket = null; return {data:{ok:true}};
  }
  const entry = path.join(root, 'cloudfunctions/person_360/index.js');
  const deviceControlModule=require('../../cloudfunctions/person_360/device-control');
  const originalMakeControl=deviceControlModule.makeControl;
  deviceControlModule.makeControl=()=>makeControl(app,env,database);
  const runtime=require('../../cloudfunctions/person_360/device-runtime');
  const runtimeAdapter={...runtime,protect:(name,main)=>runtime.protect(name,main,()=>app)};
  const mod = new Module(entry);
  mod.require = id => {
    if (id === '@cloudbase/node-sdk') return {init:() => app};
    if (id === './device-control') return {makeControl:() => makeControl(app, env, database)};
    if (id === './device-runtime') return runtimeAdapter;
    return {};
  };
  mod._compile(fs.readFileSync(entry, 'utf8'), entry);
  const server = http.createServer((req,res) => {
    const file = new URL(req.url,'http://fixture').pathname;
    if(file==='/callback'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end('OAuth callback received');return;}
    const allowed = ['/crm/device-access.html','/crm/oauth-consent.html','/crm/js/modules/device-access/setup.js','/crm/js/modules/device-access/client.js',
      '/crm/js/modules/device-access/transport.js','/crm/js/modules/console/knowledge-mcp-consent.js',
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
    const assistantCalls=[];
    await page.exposeFunction('invoke', async ({name,data}) => {
      if(name==='assistant'&&data.__deviceRequest){assistantCalls.push(data);return {result:{ok:true,code:'oauth-code-1',state:'oauth-state-1'}};}
      if (data.__deviceRequest) lastRequest = data;
      return {result: bareReceipt && data.__deviceRequest ? {ok:true} : await mod.exports.main(data)};
    });
    await page.evaluateOnNewDocument(() => {
      window.cloudbase = {init:() => ({callFunction:window.invoke,auth:() => ({getSession:async()=>({data:{session:{user:{is_anonymous:false}}}})})})};
      localStorage.setItem('crm_last_activity',String(Date.now()));
    });
    const origin='http://127.0.0.1:'+server.address().port;
    const consentUrl=origin+'/crm/oauth-consent.html?'+new URLSearchParams({client_id:'fixture-client',redirect_uri:origin+'/callback',resource:'https://api.example.test',oauth_issuer:'https://issuer.example.test',response_type:'code',scope:'knowledge:read',state:'request-state',code_challenge:'challenge',code_challenge_method:'S256'});
    await page.goto(consentUrl);
    await page.waitForFunction(()=>location.pathname==='/crm/device-access.html');
    await page.waitForSelector('#request',{visible:true});
    async function clickAndRead() {
      await page.click('#request');
      await page.waitForFunction(()=>!document.querySelector('#request').disabled);
      return page.$eval('#status',e=>e.textContent);
    }
    const pending=await clickAndRead();
    assert.match(pending,/当前浏览器的设备码仍待批准/);
    assert.match(pending,/完整设备码/);
    const firstCode=await page.$eval('#fingerprint',e=>e.textContent);
    assert.match(firstCode.replace(/[^A-F0-9]/g,''),/^[A-F0-9]{64}$/,'the full SHA-256 browser code is displayed');
    approved = true;
    assert.match(await clickAndRead(),/设备签名验证通过/);
    assert.equal(await page.$eval('#fingerprint',e=>e.textContent),firstCode,'checking approval reuses the exact browser code');
    assert.equal((await mod.exports.main(lastRequest)).error,'DEVICE_ACCESS_DENIED');
    bareReceipt = true;
    assert.match(await clickAndRead(),/签名验证未通过/);
    bareReceipt = false;
    await page.goto(consentUrl);
    await page.waitForSelector('#consent:not(.hidden) #allow:not([disabled])',{visible:true});
    await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.click('#allow')]);
    assert.equal(new URL(page.url()).pathname,'/callback');
    assert.equal(new URL(page.url()).searchParams.get('code'),'oauth-code-1');
    assert.equal(new URL(page.url()).searchParams.get('state'),'oauth-state-1');
    assert.equal(assistantCalls.length,1);
    assert.equal(assistantCalls[0].__deviceRequest.action,'knowledgeMcpAuthorize');
    assert.ok(assistantCalls[0].__deviceRequest.__deviceProof.signature,'OAuth authorization is sent with a device signature');
    console.log('PASS: pending consent routes to device setup; approval status reuses the displayed browser code; replay and bare receipts fail; OAuth consent is signed after approval');
  } finally {deviceControlModule.makeControl=originalMakeControl;if(browser) await browser.close();await new Promise(ok=>server.close(ok));}
})().catch(e=>{console.error(e);process.exitCode=1;});
