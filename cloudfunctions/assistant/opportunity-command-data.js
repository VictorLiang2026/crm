/** Server-only access to the public Person-only Opportunity command boundary. */
'use strict';

function createOpportunityCommandData({env,key,fetchImpl=fetch}={}){
  if(!/^crm-[a-z0-9]+$/.test(env||'')||typeof key!=='string'||!key)
    throw new Error('Opportunity command database is not configured');
  async function request(path,method,filters={},body){
    const url=new URL(`https://${env}.api.tcloudbasegateway.com/v1/rdb/rest/${path}`);
    for(const [name,value] of Object.entries(filters))url.searchParams.set(name,String(value));
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetchImpl(url,{method,headers:{Authorization:`Bearer ${key}`,
        'Accept-Profile':'public','Content-Profile':'public',Accept:'application/json',
        'Content-Type':'application/json',...(method==='POST'?{Prefer:'return=representation'}:{})},
        body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
      if(!response.ok){let pgCode='';try{pgCode=(await response.json()).code||'';}catch(_){}
        const error=new Error('Opportunity command database request failed');
        error.code=pgCode==='40001'?'PREVIEW_STALE':pgCode==='42501'?'CONFIRMATION_REQUIRED':
          pgCode==='22023'||pgCode==='23503'?'INVALID_COMMAND':'OPPORTUNITY_COMMAND_FAILED';throw error;}
      const payload=await response.text();return payload?JSON.parse(payload):null;
    }finally{clearTimeout(timer);}
  }
  async function run(stage,actorUid,args={}){
    const value=await request('rpc/assistant_opportunity_command_v1','POST',{}, {
      p_stage:stage,p_actor_uid:actorUid,p_command_id:args.commandId||null,
      p_idempotency_key:args.idempotencyKey||null,p_person_id:args.personId||null,
      p_opportunity_id:args.opportunityId||null,p_operation:args.operation||null,
      p_draft:args.draft||null,p_preview_hash:args.previewHash||null,
    });
    if(!value||value.ok!==true||!['planned','previewed','confirmed','executed'].includes(value.status))
      throw new Error('Invalid Opportunity command response');
    return value;
  }
  async function listActive(personId,actorUid){
    const person=String(personId);
    if(!/^[1-9][0-9]{0,18}$/.test(person)||!Number.isSafeInteger(Number(person))||
       typeof actorUid!=='string'||!actorUid.trim())throw new Error('Invalid Opportunity target request');
    const batches=await request('crm_test_batches','GET',{select:'batch_key',created_by_uid:`eq.${actorUid}`,limit:'10'});
    let targetIds=null;
    if(!Array.isArray(batches))throw new Error('Invalid test-data scope response');
    if(batches.length){
      const keys=batches.map(row=>row.batch_key).filter(key=>/^crm_test_[a-z0-9_]+$/.test(key||''));
      if(!keys.length)return {rows:[],hasMore:false,trackedPerson:false};
      const personRefs=await request('crm_test_records','GET',{select:'record_id',batch_key:`in.(${keys.join(',')})`,
        record_table:'eq.persons',record_id:`eq.${person}`,limit:'1'});
      if(!Array.isArray(personRefs))throw new Error('Invalid fictional Person scope response');
      if(!personRefs.length)return {rows:[],hasMore:false,trackedPerson:false};
      const refs=await request('crm_test_records','GET',{select:'record_id',batch_key:`in.(${keys.join(',')})`,
        record_table:'eq.opportunities',limit:'100'});
      if(!Array.isArray(refs))throw new Error('Invalid fictional Opportunity scope response');
      targetIds=refs.map(row=>String(row.record_id)).filter(id=>/^[1-9][0-9]{0,18}$/.test(id));
      if(!targetIds.length)return {rows:[],hasMore:false,trackedPerson:true};
    }
    const rows=await request('opportunities','GET',{
      select:'id,person_id,customer_id,opportunity_type,status,last_progress,next_action,next_action_date,updated_at,deleted_at',
      person_id:`eq.${person}`,customer_id:'is.null',deleted_at:'is.null',
      status:'not.in.(成交,关闭)',...(targetIds?{id:`in.(${targetIds.join(',')})`}:{}),
      order:'updated_at.desc,id.desc',limit:'51',
    });
    if(!Array.isArray(rows)||rows.length>51||rows.some(row=>String(row.person_id)!==person||
      row.customer_id!==null||row.deleted_at!==null||['成交','关闭'].includes(row.status)||
      !/^[1-9][0-9]{0,18}$/.test(String(row.id))))throw new Error('Invalid Opportunity targets');
    return {rows:rows.slice(0,50),hasMore:rows.length>50,trackedPerson:true};
  }
  return {run,listActive};
}
module.exports={createOpportunityCommandData};
