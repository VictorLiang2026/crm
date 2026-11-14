'use strict';
const test=require('node:test'), assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const puppeteer=require('puppeteer-core');
const root=path.resolve(__dirname,'../..');
for(const [device,width,height] of [['desktop',1440,900],['iPad',820,1180],['iPhone',390,844]])test(device+' selects event first, maps CSV, confirms and opens unlinked history',async()=>{
 const server=http.createServer((req,res)=>{const p=new URL(req.url,'http://localhost').pathname;
  if(p==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/crm/css/console.css"><main></main>');return;}
  const f=path.resolve(root,'.'+p);if(!f.startsWith(root+path.sep)||!fs.existsSync(f)){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',p.endsWith('.js')?'application/javascript':'text/css');res.end(fs.readFileSync(f));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await puppeteer.launch({executablePath:process.env.CRM_TEST_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-first-run','--disable-sync']});
  const p=await browser.newPage();await p.setViewport({width,height,isMobile:device==='iPhone',deviceScaleFactor:1});await p.goto('http://127.0.0.1:'+server.address().port);
  await p.evaluate(async()=>{
    const {renderRoster}=await import('/crm/js/modules/console/activity-roster.js');let staged=null,saved=null;
    window.calls=[];renderRoster({main:document.querySelector('main'),api:{call:async(name,event)=>{
     window.calls.push([name,event.action,event.operation]);if(name==='activities')return {rows:[{id:1,name:'Fixture activity'}]};
     if(event.operation==='list')return {rows:saved?[saved]:[],total:saved?1:0,imported:!!saved};
     if(event.operation==='analyze')return {rows:event.data.rows.map(r=>({...r,profiles:[],candidates:[]}))};
     if(event.operation==='prepare'){staged=event.data;return {...staged,previewId:'fixture',newCount:1,existing:0};}
     if(event.operation==='confirm'){saved={...staged.rows[0].values,id:3,version:1,person_id:null,times:1};return {added:1,processed:1};}
     if(event.operation==='profile')return saved;
     if(event.operation==='history')return {total:1,rows:[{id:1,name:'Fixture activity'}]};
     throw Error(event.operation);
    }}});
  });
  const wait=txt=>p.waitForFunction(t=>document.querySelector('main').innerText.includes(t),{},txt);
  const click=async txt=>{await p.waitForFunction(t=>[...document.querySelectorAll('main button')].some(b=>b.textContent===t),{},txt);await p.evaluate(t=>[...document.querySelectorAll('main button')].find(b=>b.textContent===t).click(),txt);};
  await wait('请先选择具体活动');assert.equal(await p.$('input[type=file]'),null);
  await p.select('main select','1');await wait('尚未导入名单');
  await p.evaluate(()=>{const file=new File(['姓名,学校,公司\n演示甲,演示学校,示例公司'], 'fixture.csv',{type:'text/csv'}),dt=new DataTransfer();dt.items.add(file);const input=document.querySelector('input[type=file]');input.files=dt.files;input.dispatchEvent(new Event('change'));});
  await click('核对名单');await wait('演示甲');await click('预览变更');await wait('本场已有');
  assert.equal(await p.evaluate(()=>window.calls.some(c=>c[2]==='confirm')),false);await click('确认保存');await click('演示甲');await wait('参加过的活动');await wait('Fixture activity');
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
 }finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('iPad import defaults to Person reuse and requires explicit same or different identity confirmation',async()=>{
 const server=http.createServer((req,res)=>{const p=new URL(req.url,'http://localhost').pathname;
  if(p==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/crm/css/console.css"><main></main>');return;}
  const f=path.resolve(root,'.'+p);if(!f.startsWith(root+path.sep)||!fs.existsSync(f)){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',p.endsWith('.js')?'application/javascript':'text/css');res.end(fs.readFileSync(f));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await puppeteer.launch({executablePath:process.env.CRM_TEST_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-first-run','--disable-sync']});
  const p=await browser.newPage();await p.setViewport({width:820,height:1180});await p.goto('http://127.0.0.1:'+server.address().port);
  await p.evaluate(async()=>{
   const {renderRoster}=await import('/crm/js/modules/console/activity-roster.js');window.prepared=null;
   renderRoster({main:document.querySelector('main'),api:{call:async(name,event)=>{
    if(name==='activities')return {rows:[{id:1,name:'Identity activity'}]};
    if(event.operation==='list')return {rows:[],total:0,imported:false};
    if(event.operation==='analyze')return {rows:event.data.rows.map(r=>({...r,profiles:[],candidates:[{id:11,display_name:'Rae',organization:'Studio',phone:'0011',wechat:'',updated_at:'2026-11-13T01:00:00Z'}]}))};
    if(event.operation==='prepare'){window.prepared=event.data;return {previewId:'identity-preview',rows:event.data.rows,newCount:1,existing:0};}
    if(event.operation==='confirm')return {added:1,processed:1};
    throw Error(event.operation);
   }}});
  });
  const click=async txt=>{await p.waitForFunction(t=>[...document.querySelectorAll('main button')].some(b=>b.textContent===t),{},txt);await p.evaluate(t=>[...document.querySelectorAll('main button')].find(b=>b.textContent===t).click(),txt);};
  await p.select('main select','1');
  await p.evaluate(()=>{const file=new File(['姓名,电话\nRae,0011'], 'identity.csv',{type:'text/csv'}),dt=new DataTransfer();dt.items.add(file);const input=document.querySelector('input[type=file]');input.files=dt.files;input.dispatchEvent(new Event('change'));});
  await click('核对名单');await p.waitForFunction(()=>[...document.querySelectorAll('main select option')].some(o=>o.value==='p11'));
  assert.equal(await p.evaluate(()=>[...document.querySelectorAll('main select')].find(s=>[...s.options].some(o=>o.value==='p11')).value),'p11');
  const confirmSame=await p.$('label input[type=checkbox]');assert.equal(await confirmSame.evaluate(node=>node.checked),true);
  await click('预览变更');await p.waitForFunction(()=>window.prepared!==null);
  let staged=await p.evaluate(()=>window.prepared.rows[0]);assert.equal(staged.choice,'person');assert.equal(staged.personId,'11');
  await click('取消');
  await p.evaluate(()=>{const s=[...document.querySelectorAll('main select')].find(x=>[...x.options].some(o=>o.value==='different'));s.value='different';s.dispatchEvent(new Event('change'));});
  await p.waitForSelector('input[aria-label="本次导入姓名（需加括号限定词）"]');
  await p.$eval('input[aria-label="本次导入姓名（需加括号限定词）"]',n=>{n.value='Rae（讲师）';n.dispatchEvent(new Event('input',{bubbles:true}));});
  await p.$eval('input[aria-label="已有 Person 姓名（需加括号限定词） #11"]',n=>{n.value='Rae（原联系人）';n.dispatchEvent(new Event('input',{bubbles:true}));});
  await p.evaluate(()=>{const label=[...document.querySelectorAll('label')].find(x=>x.textContent.includes('确认不是同一人'));label.querySelector('input').click();});
  await click('预览变更');await p.waitForFunction(()=>window.prepared?.rows?.[0]?.choice==='different');
  staged=await p.evaluate(()=>window.prepared.rows[0]);assert.equal(staged.values.display_name,'Rae（讲师）');assert.deepEqual(staged.personRenames,[{personId:'11',displayName:'Rae（原联系人）'}]);
  assert.equal(await p.evaluate(()=>document.querySelector('main').textContent.includes('Rae（原联系人）')),true);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
 }finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('iPad visibly explains and requires manual review for an ambiguous non-skipped row',async()=>{
 const server=http.createServer((req,res)=>{const p=new URL(req.url,'http://localhost').pathname;
  if(p==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/crm/css/console.css"><main></main>');return;}
  const f=path.resolve(root,'.'+p);if(!f.startsWith(root+path.sep)||!fs.existsSync(f)){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',p.endsWith('.js')?'application/javascript':'text/css');res.end(fs.readFileSync(f));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await puppeteer.launch({executablePath:process.env.CRM_TEST_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-first-run','--disable-sync']});
  const p=await browser.newPage();await p.setViewport({width:820,height:1180});await p.goto('http://127.0.0.1:'+server.address().port);
  await p.evaluate(async()=>{
   const {renderRoster}=await import('/crm/js/modules/console/activity-roster.js');window.prepared=null;
   renderRoster({main:document.querySelector('main'),api:{call:async(name,event)=>{
    if(name==='activities')return {rows:[{id:1,name:'Identity activity'}]};
    if(event.operation==='list')return {rows:[],total:0,imported:false};
    if(event.operation==='analyze')return {rows:event.data.rows.map(r=>({...r,profiles:[],candidates:[{id:11,display_name:'Rae',organization:'Studio'}]}))};
    if(event.operation==='prepare'){window.prepared=event.data;return {previewId:'manual-review-preview',rows:event.data.rows,newCount:1,existing:0};}
    throw Error(event.operation);
   }}});
  });
  const click=async txt=>{await p.waitForFunction(t=>[...document.querySelectorAll('main button')].some(b=>b.textContent===t),{},txt);await p.evaluate(t=>[...document.querySelectorAll('main button')].find(b=>b.textContent===t).click(),txt);};
  await p.select('main select','1');
  await p.evaluate(()=>{const file=new File(['姓名,电话\nRae（新活动） ,0011'], 'ambiguous.csv',{type:'text/csv'}),dt=new DataTransfer();dt.items.add(file);const input=document.querySelector('input[type=file]');input.files=dt.files;input.dispatchEvent(new Event('change'));});
  await click('核对名单');
  await p.waitForFunction(()=>[...document.querySelectorAll('main label')].some(label=>label.textContent.includes('我已人工核对本行身份、同名候选和重复记录')));
  assert.equal(await p.evaluate(()=>[...document.querySelectorAll('main label')].find(label=>label.textContent.includes('我已人工核对本行身份、同名候选和重复记录')).querySelector('input').checked),false);
  await p.evaluate(()=>{const label=[...document.querySelectorAll('main label')].find(x=>x.textContent.includes('确认是同一人并复用'));label.querySelector('input').click();});
  await click('预览变更');await p.waitForFunction(()=>document.querySelector('main').innerText.includes('请确认身份，或跳过待核对行'));
  assert.equal(await p.evaluate(()=>window.prepared),null);
  await p.evaluate(()=>{const label=[...document.querySelectorAll('main label')].find(x=>x.textContent.includes('我已人工核对本行身份、同名候选和重复记录'));label.querySelector('input').click();});
  await click('预览变更');await p.waitForFunction(()=>window.prepared!==null);
  assert.equal(await p.evaluate(()=>window.prepared.rows[0].choice),'person');
 }finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
