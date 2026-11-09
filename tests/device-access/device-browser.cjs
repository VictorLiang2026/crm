'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const puppeteer=require('puppeteer-core'),{randomUUID}=require('node:crypto'),{deviceProtocol}=require('../../cloudfunctions/_shared/device-proof.js');
(async()=>{
 const server=http.createServer((req,res)=>{if(req.url==='/device-client.mjs'){res.writeHead(200,{'content-type':'text/javascript'});res.end(fs.readFileSync(path.join(__dirname,'../../crm/js/modules/device-access/client.js')));}else{res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><title>Device test</title>');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let b;
 try{b=await puppeteer.launch({executablePath:process.env.CRM_TEST_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-first-run','--disable-sync']});const page=await b.newPage(),origin='http://127.0.0.1:'+server.address().port;
 const keys=new Map(),tickets=new Map(),owner={uid:'synthetic'},auth=deviceProtocol({env:'browser-test',permitted:new Set(['customers']),rpc:async(op,uid,fp,args)=>{
 if(op==='request'){keys.set(fp,args.public_key);return {state:'pending'}}if(op==='issue'){const challenge=randomUUID();tickets.set(challenge,{fp,...args});return {challenge}}const t=tickets.get(args.challenge);if(!t||t.fp!==fp||t.audience!==args.audience||t.payload_hash!==args.payload_hash)throw Error('replay');
 if(op==='inspect')return {public_key:keys.get(fp)};tickets.delete(args.challenge);return {ok:true}
 }});
 await page.exposeFunction('control',a=>a.action==='request'?auth.enroll(owner,a):auth.issue(owner,a));
 await page.goto(origin);const run=()=>page.evaluate(async()=>{const c=(await import('/device-client.mjs')).createDeviceClient('browser-test',window.control);const id=await c.enroll('Browser test');return {fp:id.fingerprint,req:await c.sign('customers',{action:'get',id:7})}});
 const a=await run();assert.deepEqual(await auth.authorize(owner,'customers',a.req),{action:'get',id:7});await page.reload();const after=await run();assert.equal(a.fp,after.fp);
 await page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase('crm.devices.v1:browser-test');r.onsuccess=resolve;r.onerror=()=>reject(r.error);}));await page.reload();const fresh=await run();assert.notEqual(fresh.fp,a.fp);
 console.log('PASS: browser SDK parity, signature verified in Node, reload retains device, cleared storage rotates key');
 }finally{if(b)await b.close();await new Promise(res=>server.close(res));}
})().catch(e=>{console.error(e.message);process.exitCode=1});
