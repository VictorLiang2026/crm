'use strict';
async function rosterFacts(query){
 const env=process.env.TCB_ENV,key=process.env.CRM_ACTIVITY_REVIEW_DB_API_KEY;
 if(!/^crm-[a-z0-9]+$/.test(env||'')||!key)throw Error('ROSTER_READ_FAILED');
 const rows=[];let after=0;
 for(;;){
 const r=await fetch('https://'+env+'.api.tcloudbasegateway.com/v1/rdb/rest/rpc/crm_activity_roster_v1',{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+key,'Accept-Profile':'public','Content-Profile':'public','Content-Type':'application/json'},
  body:JSON.stringify({p_actor:'ai_activity',p_op:'facts',p_input:{...query,after}})});
 if(!r.ok)throw Error('ROSTER_READ_FAILED');
 const result=await r.json(),page=result.rows;if(!Array.isArray(page))throw Error('ROSTER_READ_FAILED');
 rows.push(...page.slice(0,200));if(page.length<=200)return rows;after=rows[rows.length-1].id;
 }
}
module.exports={rosterFacts};