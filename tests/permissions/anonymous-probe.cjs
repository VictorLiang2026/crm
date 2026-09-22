// GET only; exact synthetic records; explicit public PostgREST profile.
const fs=require('node:fs');const path=require('node:path');
async function main(){
 const dir=path.join(__dirname,'.results');const key=fs.readFileSync(path.join(dir,'public-key.txt'),'utf8').trim();
 const plan=JSON.parse(fs.readFileSync(path.join(dir,'probe-plan.json')));
 const results=[];
 for(const [table,column] of [['customers','Id'],['policy_review_reports','id'],['customers_view','Id']]){
  const url=new URL('https://crm-d1gkae8ddc930d151.api.tcloudbasegateway.com/v1/rdb/rest/'+table);
  url.search=new URLSearchParams({select:column,[column]:'eq.-2026092101',limit:'1'});
  const r=await fetch(url,{headers:{Authorization:'Bearer '+key,'Accept-Profile':'public'},signal:AbortSignal.timeout(15000)});
  const data=await r.json();results.push({table,status:r.status,count:Array.isArray(data)?data.length:null,errorCode:data.code||data.error?.code||null});
 }
 const report={schema:'public',credential:'publishable key',version:plan.version,results};
 fs.writeFileSync(path.join(dir,'anonymous-'+plan.version+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
