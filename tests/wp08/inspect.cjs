'use strict';
// Inspect only the fictional work-item UI state in the existing test window.
const fs=require('node:fs');
const path=require('node:path');
const {Cdp}=require('../wp03/readonly-live.cjs');
async function main(){
  const info=JSON.parse(fs.readFileSync(path.resolve(__dirname,
    '../security/.results/wp03-live-window.json'),'utf8'));
  const base=new URL(info.url);
  if(base.hostname!=='127.0.0.1'||base.pathname!=='/crm/admin.html') throw Error('Unexpected test window');
  const port=fs.readFileSync(path.join(info.profile,'DevToolsActivePort'),'utf8').split(/\r?\n/)[0];
  const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const tab=pages.find(x=>x.type==='page'&&x.url.startsWith(base.origin+base.pathname));
  if(!tab) throw Error('Test window closed');
  const c=new Cdp();
  try{
    await c.open(tab.webSocketDebuggerUrl);
    const state=await c.evaluate(`(()=>({hash:location.hash,
      locked:!!document.querySelector('input[type=password]')?.offsetParent,
      workSection:!!document.querySelector('.person360-work-items'),
      preview:!!document.querySelector('.wi-preview'),
      previewHasTestMarker:(document.querySelector('.wi-preview')?.innerText||'').includes('【系统测试·勿联系】'),
      previewHasComplete:(document.querySelector('.wi-preview')?.innerText||'').includes('完成'),
      error:!!document.querySelector('.wi-error:not(:empty)'),
      overdueAction8:(document.getElementById('work-action-8')?.innerText||'').includes('已逾期'),
      overdueCommitment2:(document.getElementById('work-commitment-2')?.innerText||'').includes('已逾期'),
      sourceAction7:document.querySelector('#work-action-7 .wi-source')?.getAttribute('href')||null,
      sourceCommitment1:document.querySelector('#work-commitment-1 .wi-source')?.getAttribute('href')||null,
      timelineTarget:!!document.querySelector('.person360-timeline'),
      actions:[...document.querySelectorAll('.wi-row')].filter(x=>x.id.startsWith('work-action-')).map(x=>x.id)
    }))()`);
    console.log(JSON.stringify(state));
  }finally{c.close();}
}
main().catch(error=>{console.error(String(error.message||error));process.exitCode=1;});
