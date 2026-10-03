'use strict';
// Real UI acceptance: one ordinary Today generation. Never alters auth/cache or business records.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Cdp}=require('./readonly-live.cjs');
const root=path.resolve(__dirname,'../..'),dir=path.join(root,'tests/security/.results');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
async function main(){
 const info=JSON.parse(fs.readFileSync(path.join(dir,'wp03-live-window.json'),'utf8'));
 const base=new URL(info.url);
 if(base.hostname!=='127.0.0.1'||base.pathname!=='/crm/admin.html')throw Error('Unexpected test window');
 const port=fs.readFileSync(path.join(info.profile,'DevToolsActivePort'),'utf8').split(/\r?\n/)[0];
 if(!/^\d+$/.test(port))throw Error('Invalid debugger port');
 const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
 const target=pages.find(t=>t.type==='page'&&t.url.startsWith(base.origin+base.pathname));
 if(!target)throw Error('Test window is closed');
 const c=new Cdp(),report={environment:'crm-d1gkae8ddc930d151',observedAt:new Date().toISOString(),status:'UNVERIFIED',
  scope:'Real local-served CRM page calling deployed Today; static cloud consistency checked separately',
  adminHash:hash('admin.html'),functionHashes:Object.fromEntries(['index.js','ai-wait.js'].map(f=>[f,hash('cloudfunctions/today_coach/'+f)]))};
 try{
  await c.open(target.webSocketDebuggerUrl);await c.call('Page.bringToFront');
  const unlocked=await c.evaluate(`!document.querySelector('input[type=password]')?.offsetParent && Number(localStorage.getItem('crm_last_activity'))>0 && Date.now()-Number(localStorage.getItem('crm_last_activity'))<300000`);
  if(!unlocked){report.status='MANUAL_LOGIN';return;}
  const before=await c.evaluate(`JSON.parse(localStorage.getItem('todayCoachCache')||'null')?.data?.generated_at||null`);
  let started=Date.now(),clicked=false;
  await c.evaluate("location.hash='#/today'");
  await pause(300);
  for(let i=0;i<140;i++){
   const state=await c.evaluate(`(()=>{const text=document.getElementById('view')?.innerText||'';const data=JSON.parse(localStorage.getItem('todayCoachCache')||'null')?.data;return {
    login:!!document.querySelector('input[type=password]')?.offsetParent,error:/今日建议生成失败/.test(text),
    regenerate:!!document.getElementById('coach-regen'),generatedAt:data?.generated_at,source:data?.source,
    deadlineFallback:String(data?.ai_error||'').includes('TODAY_AI_TIMEOUT'),notice:text.includes('含测试数据'),
    containsTestData:data?.testData?.status==='verified'&&data.testData.containsTestData===true,
    batch:data?.testData?.sources?.some(s=>s.batchKey==='crm_test_main_v1'),
    sampleIncluded:JSON.stringify(data?.all_actions||[]).includes('【系统测试·勿联系】'),
    items:data?.items?.length||0,today5:data?.today5?.length||0};})()`);
   if(state.login){report.status='MANUAL_LOGIN';break;}
   if(state.error){report.status='FAIL';report.reason='Today UI generation failed';break;}
   if(state.generatedAt && state.generatedAt!==before && state.regenerate && state.notice){
    report.elapsedMs=Date.now()-started;report.result=state;
    report.status=state.containsTestData&&state.batch&&state.sampleIncluded&&state.items>0&&state.today5>0&&report.elapsedMs<60000?'PASS':'FAIL';break;
   }
   // A same-day cache is refreshed through the existing UI, never edited or deleted.
   if(state.regenerate && !clicked){await c.evaluate("document.getElementById('coach-regen').click()");clicked=true;started=Date.now();}
   await pause(500);
  }
  if(report.status==='UNVERIFIED'){report.status='FAIL';report.reason='Fresh Today result was not rendered within the observation window';}
 }finally{
  c.close();const body=JSON.stringify(report,null,2)+'\n';
  fs.writeFileSync(path.join(dir,'wp03-today-live-'+report.observedAt.replace(/[:.]/g,'-')+'.json'),body);
  fs.writeFileSync(path.join(dir,'wp03-today-live.json'),body);
  console.log(body);process.exitCode=report.status==='PASS'?0:report.status==='MANUAL_LOGIN'?2:1;
 }
}
if(require.main===module)main().catch(()=>{console.error('Today real acceptance incomplete; no success inferred');process.exitCode=1;});
