'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const puppeteer=require('puppeteer-core');
const root=path.resolve(__dirname,'../..');

for(const [device,viewportWidth,viewportHeight] of [['desktop',1440,900],['iPad',820,1180],['iPhone',390,844]])
test(device+' public registration, shared link and pending edit',async()=>{
  const registrations=[];
  const pages={
    'first-event':{slug:'first-event',content:{title:'【系统测试·勿联系】第一场',intro:'第一场说明',coverUrl:'',blocks:[]},formSchema:[],
      activity:{id:940101,name:'【系统测试·勿联系】第一场',activity_date:'2026-11-20',location:'地点一'}},
    'second-event':{slug:'second-event',content:{title:'【系统测试·勿联系】第二场',intro:'第二场说明',coverUrl:'',blocks:[]},formSchema:[],
      activity:{id:940102,name:'【系统测试·勿联系】第二场',activity_date:'2026-11-21',location:'地点二'}},
  };
  const mock=`(()=>{const pages=${JSON.stringify(pages)};const rows=JSON.parse(localStorage.getItem('ar_rows')||'[]');
    const token=localStorage.getItem('ar_token')||'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_AB';
    localStorage.setItem('ar_token',token);window.__ar={rows,calls:[],token};
    window.cloudbase={init:()=>({callFunction:async({name,data})=>{
      if(name!=='activity_registration_public')throw Error('Wrong public function');
      if(data.action==='getRegistrationTransportKey')return {result:await window.openRequest(data)};
      if(data.action!=='getPublishedPage')data=await window.openRequest(data);
      window.__ar.calls.push({name,data});let value;
      if(data.action==='getPublishedPage')value={page:pages[data.slug]};
      else if(data.action==='submit'){
        const token=data.managementToken||window.__ar.token;
        const row={id:'reg-'+(rows.length+1),slug:data.slug,attendeeName:data.attendeeName,phone:data.phone,wechat:data.wechat,
          answers:data.answers,status:'pending',notificationStatus:'not_sent',activityName:pages[data.slug].activity.name,
          activity:pages[data.slug].activity,content:pages[data.slug].content,formSchema:[]};
        rows.push({...row,token});localStorage.setItem('ar_rows',JSON.stringify(rows));value={ok:true,status:'pending',managementToken:token,submissionId:row.id,activityName:row.activityName};
      }else if(data.action==='getMyRegistration'){
        const mine=rows.filter(row=>row.token===data.managementToken).map(({token,...row})=>row);value={registrations:mine};
      }else if(data.action==='updateMyRegistration'){
        const row=rows.find(row=>row.id===data.submissionId&&row.token===data.managementToken);
        if(!row)throw Error('REGISTRATION_NOT_FOUND');Object.assign(row,{attendeeName:data.attendeeName,phone:data.phone,wechat:data.wechat,answers:data.answers});localStorage.setItem('ar_rows',JSON.stringify(rows));
        value={ok:true,status:row.status,submissionId:row.id};
      }else throw Error('Unexpected action '+data.action);
      return {result:data.action==='getPublishedPage'?value:await window.sealReply(data.replyKey,value)};
    }})};
  })();`;
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    let file;
    if(url.pathname==='/cloudbase.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(mock);return;}
    if(url.pathname==='/crm/activity-registration.html'){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
      res.end(fs.readFileSync(path.join(root,'crm/activity-registration.html'),'utf8').replace(
        '<script src="https://static.cloudbase.net/cloudbase-js-sdk/3.10.1/cloudbase.full.js"></script>',
        '<script src="/cloudbase.js"></script>'));return;
    }
    const rel=url.pathname.replace(/^\//,'');file=path.resolve(root,rel);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
    const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream';
    res.writeHead(200,{'Content-Type':type});res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await puppeteer.launch({executablePath:process.env.CRM_TEST_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      headless:true,args:['--no-first-run','--disable-sync']});
    const page=await browser.newPage();
    await page.setViewport({width:viewportWidth,height:viewportHeight,isMobile:device==='iPhone',deviceScaleFactor:1});
    const {recipient,seal}=require('../../cloudfunctions/activity_registration_public/registration-reply');
    const transport=require('./transport-fixture.cjs');
    await page.exposeFunction('openRequest',data=>data.action==='getRegistrationTransportKey'?{publicKey:transport.publicKey}:transport.open(data.action,data.sealedRequest));
    await page.exposeFunction('sealReply',(key,value)=>seal(value,recipient(key)));
    const browserErrors=[];
    page.on('pageerror',error=>browserErrors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')browserErrors.push(message.text());});
    const origin='http://127.0.0.1:'+server.address().port;
    await page.goto(origin+'/crm/activity-registration.html?slug=first-event',{waitUntil:'networkidle0'});
    try{await page.waitForSelector('input[name="existingManagementLink"]',{timeout:7000});}
    catch{throw new Error(JSON.stringify({text:(await page.evaluate(()=>document.body.innerText)).slice(0,1200),browserErrors}));}
    await page.type('input[name="attendeeName"]','【系统测试·勿联系】报名人');
    await page.type('input[name="phone"]','TEST-0001');
    await page.click('button[type="submit"]');
    await page.waitForFunction(()=>window.__ar.rows.length===1&&document.querySelectorAll('.ar-registration-history-item').length===1);
    const firstLink=await page.evaluate(()=>location.href);

    await page.goto(origin+'/crm/activity-registration.html?slug=second-event',{waitUntil:'networkidle0'});
    await page.type('input[name="attendeeName"]','【系统测试·勿联系】第二场报名');
    await page.type('input[name="phone"]','TEST-0002');
    await page.type('input[name="existingManagementLink"]',firstLink);
    await page.click('button[type="submit"]');
    await page.waitForFunction(()=>window.__ar.rows.length===2&&document.querySelectorAll('.ar-registration-history-item').length===2);
    const tokenResult=await page.evaluate(()=>({
      sameToken:window.__ar.rows[0].token===window.__ar.rows[1].token,
      calls:window.__ar.calls.map(x=>({name:x.name,action:x.data.action})),
      editId:document.querySelector('.ar-form input[name="attendeeName"]')?.value
    }));
    assert.equal(tokenResult.sameToken,true);
    assert.equal(tokenResult.editId,'【系统测试·勿联系】第二场报名');
    await page.evaluate(()=>{const i=document.querySelector('input[name="attendeeName"]');i.value='【系统测试·勿联系】已修改';i.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.click('button[type="submit"]');
    await page.waitForFunction(()=>window.__ar.calls.some(x=>x.data.action==='updateMyRegistration'));
    const state=await page.evaluate(()=>({updated:window.__ar.rows[1].attendeeName,
      browserAuthMethods:Object.keys(window.cloudbase).filter(k=>/auth|sign/i.test(k)),
      history:document.querySelectorAll('.ar-registration-history-item').length}));
    assert.equal(state.updated,'【系统测试·勿联系】已修改');
    assert.deepEqual(state.browserAuthMethods,[]);
    assert.equal(state.history,2);
    for(const [width,height,mobile] of [[390,844,true],[820,1180,false],[1180,820,false],[1440,900,false]]){
      await page.setViewport({width,height,isMobile:mobile,deviceScaleFactor:1});
      await page.waitForSelector('.ar-layout .ar-registration-history-item');
      const layout=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth,
        display:getComputedStyle(document.querySelector('.ar-layout')).display,columns:getComputedStyle(document.querySelector('.ar-layout')).gridTemplateColumns}));
      assert.ok(layout.scroll<=layout.width+1,`horizontal overflow at ${width}px: ${JSON.stringify(layout)}`);
      if(mobile)assert.equal(layout.display,'flex');
      else assert.equal(layout.display,'grid');
    }
  }finally{
    if(browser)await browser.close();
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
});
