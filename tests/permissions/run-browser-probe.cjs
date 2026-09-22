// Reuse the manually authenticated, isolated browser. Never export credentials.
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '.results');
async function main() {
  const plan = JSON.parse(fs.readFileSync(path.join(dir, 'probe-plan.json')));
  if (plan.envId !== 'crm-d1gkae8ddc930d151' || plan.reportId !== -2026092101 || plan.marker !== '[CRM_PERMISSION_TEST]20260921-rls-a') throw new Error('Invalid fixture');
  const allowed = new Set(['customers','policy_review_reports','customers_view','followups_view','gifts_view','photos_view','products_view','ai_recommendations_view','v_recruit_candidates','v_recruit_candidates_trash','v_action_center','v_funnel_stats']);
  for (const q of plan.queries) if (!allowed.has(q.table) || q.columns !== q.key || !/^[A-Za-z_][A-Za-z_0-9]*$/.test(q.key) || ![plan.reportId,plan.marker].includes(q.value)) throw new Error('Unsafe query');
  const control = JSON.parse(fs.readFileSync(path.join(dir,'browser-control.json')));
  const server = JSON.parse(fs.readFileSync(path.join(dir,'server.json')));
  const port = fs.readFileSync(path.join(control.profile,'DevToolsActivePort'),'utf8').split('\n')[0].trim();
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = pages.find(p => p.url === server.url);
  if (!page) throw new Error('Manual login window missing');
  const expression = `(async()=>{const plan=${JSON.stringify(plan)}; const results=[];
    async function callFn(name,data){const r=await app.callFunction({name,data});const value=typeof r.result==='string'?JSON.parse(r.result):r.result;if(value?.error)throw Error(String(value.error));return value;}
    for(const q of plan.queries){const r=await app.rdb().schema('public').from(q.table).select(q.columns).eq(q.key,q.value).limit(1);results.push({table:q.table,count:Array.isArray(r.data)?r.data.length:null,errorCode:r.error?.code||null,errorMessage:r.error?String(r.error.message||'').slice(0,180):null});}
    const r=await callFn('policy_review_reports',{action:'get',id:plan.reportId});results.push({function:'policy_review_reports',action:'get',found:r?.report?.id===plan.reportId,markerMatches:r?.report?.customer_name===plan.marker});
    if (${JSON.stringify(process.argv.includes('--fixture-write'))}) {
      if(r?.report?.id!==plan.reportId||r?.report?.customer_name!==plan.marker||r?.report?.customer_id!==plan.reportId)throw Error('Fixture ownership check failed');
      const c=await callFn('customers',{action:'update',id:plan.reportId,data:{additional_info:plan.marker+' cloud function compatibility probe'}});
      results.push({function:'customers',action:'update',ok:c?.ok===true,updated:c?.updated,error:c?.error||null});
      const u=await callFn('policy_review_reports',{action:'update',id:plan.reportId,data:{edited_summary:plan.marker+' cloud function compatibility probe'}});
      const v=await callFn('policy_review_reports',{action:'get',id:plan.reportId});
      results.push({function:'policy_review_reports',action:'update-readback',ok:u?.ok===true&&v?.report?.edited_summary===plan.marker+' cloud function compatibility probe',error:u?.error||null});
    }
    if (${JSON.stringify(process.argv.includes('--readonly-smoke'))}) {
      for(const [name,action] of [['customers','list'],['customers','trashList'],['recruit_candidates','list'],['recruit_candidates','trashList'],['funnel_insight','stats'],['today_coach','cockpit'],['activities','list']]) {
        const v=await callFn(name,{action,keyword:plan.marker,pageSize:1});
        results.push({function:name,action,ok:!!v&&!v.error&&(v.ok!==false),responseKeys:Object.keys(v||{})});
      }
    }
    return {schema:'public',version:plan.version,results};})()`;
  const result = await new Promise((resolve,reject)=>{
    const ws=new WebSocket(page.webSocketDebuggerUrl);const timer=setTimeout(()=>{ws.close();reject(new Error('Probe timed out'));},60000);
    ws.onopen=()=>ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
    ws.onerror=()=>reject(new Error('Browser connection failed'));
    ws.onmessage=e=>{const r=JSON.parse(e.data);if(r.id!==1)return;clearTimeout(timer);ws.close();if(r.error||r.result?.exceptionDetails)return reject(new Error('Browser probe failed'));resolve(r.result.result.value);};
  });
  fs.writeFileSync(path.join(dir,'verified-browser-'+plan.version+'.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
