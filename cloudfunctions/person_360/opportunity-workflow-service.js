'use strict';

const { disclose, refsForRows } = require('./test-data');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[1-9][0-9]*$/;
const TYPES = new Set(['insurance','recruit','referral','activity','speaker',
  'partnership','service','relationship']);
const OPERATIONS = new Set(['create','edit','stage','close','link_action']);
function id(value) {
  if (!ID.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error('Invalid Opportunity ID');
  return Number(value);
}
function plain(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function draft(operation, value) {
  if (!plain(value)) throw new Error('Invalid Opportunity draft');
  const keys = Object.keys(value).sort().join(',');
  if (operation === 'create' || operation === 'edit') {
    if (keys !== 'nextAction,nextActionDate,progress,type' || !TYPES.has(value.type) ||
        typeof value.progress !== 'string' || value.progress.length > 4000 ||
        typeof value.nextAction !== 'string' || value.nextAction.length > 1000 ||
        (value.nextActionDate != null && (typeof value.nextActionDate !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(value.nextActionDate) ||
          Number.isNaN(Date.parse(`${value.nextActionDate}T00:00:00Z`))))) {
      throw new Error('Invalid Opportunity draft');
    }
    return { type:value.type,progress:value.progress.trim(),nextAction:value.nextAction.trim(),
      nextActionDate:value.nextActionDate || null };
  }
  if (operation === 'stage') {
    if (keys !== 'status' || typeof value.status !== 'string' ||
        !['发现','沟通','方案','潜在线索','已介绍','已联系','已建立关系'].includes(value.status)) {
      throw new Error('Invalid Opportunity stage');
    }
    return {status:value.status};
  }
  if (operation === 'close') {
    if (keys !== 'actionId,result,status' || !['成交','关闭'].includes(value.status) ||
        typeof value.result !== 'string' || !value.result.trim() || value.result.trim().length > 4000) {
      throw new Error('Invalid Opportunity closing result');
    }
    return {status:value.status,result:value.result.trim(),
      actionId:value.actionId == null ? null : id(value.actionId)};
  }
  if (keys !== 'actionId') throw new Error('Invalid Action link');
  return {actionId:id(value.actionId)};
}

class OpportunityWorkflowService {
  constructor({request,rpc,disclosure=disclose}={}) {
    if (typeof request !== 'function' || typeof rpc !== 'function')
      throw new Error('Authorized Opportunity access is required');
    this.request=request;this.rpc=rpc;this.disclosure=disclosure;
  }
  async testBatchKeys(actorUid) {
    if (typeof actorUid!=='string' || !actorUid.trim()) throw new Error('Login required');
    const batches=await this.request('crm_test_batches','GET',{
      select:'batch_key',created_by_uid:`eq.${actorUid}`,limit:10,
    });
    return batches.map(row=>row.batch_key).filter(key=>/^crm_test_[a-z0-9_]+$/.test(key));
  }
  async assertTrackedPerson(personId,actorUid) {
    const keys=await this.testBatchKeys(actorUid);
    if (!keys.length) return;
    const rows=await this.request('crm_test_records','GET',{
      select:'record_id',batch_key:`in.(${keys.join(',')})`,
      record_table:'eq.persons',record_id:`eq.${personId}`,limit:1,
    });
    if (!rows.length) throw new Error('Test account requires tracked fictional Person');
  }
  async listPending(actorUid) {
    const keys=await this.testBatchKeys(actorUid);
    let candidateFilter={};
    if(keys.length){
      const tracked=await this.request('crm_test_records','GET',{
        select:'record_id',batch_key:`in.(${keys.join(',')})`,
        record_table:'eq.opportunity_candidates',limit:100,
      });
      const ids=tracked.map(row=>row.record_id).filter(value=>ID.test(String(value)));
      if(!ids.length)return {rows:[],hasMore:false,testData:await this.disclosure([])};
      candidateFilter={id:`in.(${ids.join(',')})`};
    }
    const rows=await this.request('opportunity_candidates','GET',{
      select:'id,person_id,draft,evidence,status,updated_at',
      ...candidateFilter,status:'in.(draft,previewed,confirmed)',
      order:'updated_at.desc,id.desc',limit:21,
    });
    const page=rows.slice(0,20);
    const ids=[...new Set(page.map(x=>id(x.person_id)))];
    const people=ids.length?await this.request('persons','GET',{
      select:'id,display_name',id:`in.(${ids.join(',')})`,deleted_at:'is.null',limit:20,
    }):[];
    const names=new Map(people.map(x=>[String(x.id),x.display_name]));
    return {rows:page.filter(x=>names.has(String(x.person_id)))
      .map(x=>({...x,personName:names.get(String(x.person_id))})),
    hasMore:rows.length>20,testData:await this.disclosure([
      ...refsForRows('opportunity_candidates',page),...refsForRows('persons',people)])};
  }
  async linked(personId,opportunityId,actorUid) {
    const person=id(personId),opp=id(opportunityId);
    if(actorUid)await this.assertTrackedPerson(person,actorUid);
    const rows=await this.request('opportunities','GET',{
      select:'id,person_id,customer_id,status',id:`eq.${opp}`,person_id:`eq.${person}`,
      customer_id:'is.null',deleted_at:'is.null',limit:1,
    });
    if (!rows.length) throw new Error('Person-only Opportunity unavailable');
    const [direct,links,outcomes]=await Promise.all([
      this.request('actions','GET',{
        select:'id,person_id,opportunity_id,title,status,due_at,source',
        person_id:`eq.${person}`,opportunity_id:`eq.${opp}`,
        order:'updated_at.desc,id.desc',limit:50,
      }),
      this.request('crm_opportunity_action_links','GET',{
        select:'action_id',person_id:`eq.${person}`,opportunity_id:`eq.${opp}`,limit:50,
      }),
      this.request('outcomes','GET',{
        select:'id,opportunity_id,action_id,outcome_type,result,occurred_at',
        opportunity_id:`eq.${opp}`,order:'occurred_at.desc,id.desc',limit:20,
      }),
    ]);
    const linkedIds=links.map(row=>id(row.action_id));
    const extra=linkedIds.length?await this.request('actions','GET',{
      select:'id,person_id,opportunity_id,title,status,due_at,source',
      person_id:`eq.${person}`,id:`in.(${linkedIds.join(',')})`,limit:50,
    }):[];
    const actions=[...new Map([...direct,...extra].map(row=>[String(row.id),row])).values()];
    return {opportunityId:opp,actions,outcomes,testData:await this.disclosure([
      ...refsForRows('opportunities',rows),...refsForRows('actions',actions),
      ...refsForRows('outcomes',outcomes)])};
  }
  async availableActions(personId,actorUid) {
    const person=id(personId);
    if(actorUid)await this.assertTrackedPerson(person,actorUid);
    const links=await this.request('crm_opportunity_action_links','GET',{
      select:'action_id',person_id:`eq.${person}`,limit:100,
    });
    const linkedIds=links.map(row=>id(row.action_id));
    const rows=await this.request('actions','GET',{
      select:'id,person_id,title,status,due_at',person_id:`eq.${person}`,
      opportunity_id:'is.null',
      ...(linkedIds.length?{id:`not.in.(${linkedIds.join(',')})`}:{}),
      order:'updated_at.desc,id.desc',limit:30,
    });
    return {rows,testData:await this.disclosure(refsForRows('actions',rows))};
  }
  async preview(data,actorUid) {
    if (typeof actorUid!=='string' || !actorUid.trim() || !plain(data) ||
        Object.keys(data).some(key=>!['idempotencyKey','operation','personId','opportunityId','draft'].includes(key)) ||
        !UUID.test(String(data.idempotencyKey||'')) || !OPERATIONS.has(data.operation)) {
      throw new Error('Invalid Opportunity preview');
    }
    const personId=id(data.personId);
    const opportunityId=data.operation==='create'?null:id(data.opportunityId);
    if (data.operation==='create' && data.opportunityId!=null) throw new Error('Invalid Opportunity ID');
    return this.rpc('crm_opportunity_preview_v1',{
      p_actor_uid:actorUid,p_idempotency_key:data.idempotencyKey,
      p_operation:data.operation,p_person_id:personId,p_opportunity_id:opportunityId,
      p_payload:draft(data.operation,data.draft),
    });
  }
  async execute(previewId,actorUid) {
    if (typeof actorUid!=='string' || !actorUid.trim() || !UUID.test(String(previewId||'')))
      throw new Error('Invalid Opportunity execution');
    return this.rpc('crm_opportunity_execute_v1',{
      p_actor_uid:actorUid,p_preview_id:previewId,
    });
  }
}
module.exports={OpportunityWorkflowService,draft};
