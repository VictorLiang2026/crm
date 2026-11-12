'use strict';
// Existing verified CloudBase device context authorizes this fixed Person 360 read.
async function rosterFacts(query){
 const app=require('./db').app;const rows=[];let after=0;
 for(;;){
  const reply=await require('./device-runtime').internalCall(app,{name:'person_360',data:{action:'getRosterFacts',query:{...query,after}}});
  const page=reply?.result?.rows;
  if(!Array.isArray(page))throw Error('ROSTER_READ_FAILED');
  rows.push(...page.slice(0,200));
  if(page.length<=200)return rows;
  after=rows[rows.length-1].id;
 }
}
module.exports={rosterFacts};
