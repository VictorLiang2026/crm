import { h } from './dom.js';
import { data } from './data.js';
import { openSheet } from './write.js';
import { t, translateEnum } from './i18n.js';

const LEGACY_TYPES={医疗保障:'legacy_opp_medical',重疾保障:'legacy_opp_critical',养老规划:'legacy_opp_retirement',
  教育规划:'legacy_opp_education',财富规划:'legacy_opp_wealth',家庭保障:'legacy_opp_family',转介绍:'legacy_opp_referral'};
const TYPES=[...Object.keys(LEGACY_TYPES),'insurance','recruit','referral','activity','speaker','partnership','service','relationship'];
const stages=type=>['转介绍','referral'].includes(type)?['潜在线索','已介绍','已联系','已建立关系']:['发现','沟通','方案'];
const terminal=status=>['成交','关闭'].includes(status);
const LABELS={type:'legacy_opp_type',status:'legacy_opp_stage',progress:'opp_detail_progress',nextAction:'opp_detail_next_action',
  nextActionDate:'opp_detail_next_date',discoveredAt:'opp_detail_discovered',referredName:'opp_referred_name',
  referredRelation:'opp_referred_relation',result:'legacy_opp_result',actionId:'legacy_opp_action'};
export const legacyOpportunityTypeLabel=value=>LEGACY_TYPES[value]?t(LEGACY_TYPES[value]):translateEnum('opportunity_type',value);
function display(key,value){if(value==null||value==='')return t('label_none');
  return key==='type'?legacyOpportunityTypeLabel(value):key==='status'?translateEnum('opportunity_stage',value):String(value);}
function control(name,value,{options,type='text',max=4000}={}){
 const node=options?h('select',{class:'sheet-select',name},options.map(([v,label])=>h('option',{value:v},label))):
   h(type==='textarea'?'textarea':'input',{class:type==='textarea'?'sheet-textarea':'sheet-input',name,
     type:type==='textarea'?undefined:type,rows:type==='textarea'?3:undefined,maxlength:max});
 node.value=value??'';return node;
}
function field(key,node){return h('label',{class:'sheet-field'},[h('span',{},t(LABELS[key])),node]);}
function uuid(){if(!globalThis.crypto?.randomUUID)throw Error(t('ocr_secure_ids_unavailable'));return crypto.randomUUID();}

export function openLegacyOpportunity(ctx,{opportunity,person,actions=[],mode='edit',onDone}={}){
 const personId=String(person?.id??opportunity.person?.id??'');
 const customerId=String(opportunity.customer_id??'');
 const opportunityId=String(opportunity.id??'');
 if(![personId,customerId,opportunityId].every(x=>/^[1-9][0-9]*$/.test(x)&&Number.isSafeInteger(Number(x)))||terminal(opportunity.status)){
   ctx.toast?.(t('legacy_opp_unavailable'),'err');return;
 }
 const body=h('div',{class:'legacy-opportunity-form'});
 const form=h('div',{class:'legacy-opportunity-fields'});
 const controls={};const previewHost=h('div',{class:'legacy-opportunity-preview'});
 const receiptHost=h('div',{class:'legacy-opportunity-receipt',role:'status'});
 const errorHost=h('p',{class:'sheet-err',role:'alert',style:'display:none'});
 const previewButton=h('button',{class:'btn btn-primary',type:'button'},t('legacy_opp_preview'));
 let busy=false,requestKey=null,preview=null,executed=null,notified=false,reading=false;
 const typeValue=opportunity.opportunity_type;
 controls.status=control('status',opportunity.status,{options:[...stages(typeValue),...(mode==='advance'?['成交','关闭']:[])].map(s=>[s,translateEnum('opportunity_stage',s)])});
 let resultFields;
 if(mode==='edit'){
   controls.type=control('type',typeValue,{options:TYPES.map(x=>[x,legacyOpportunityTypeLabel(x)])});
   controls.progress=control('progress',opportunity.last_progress||'',{type:'textarea'});
   controls.nextAction=control('nextAction',opportunity.next_action||'',{type:'textarea',max:1000});
   controls.nextActionDate=control('nextActionDate',opportunity.next_action_date?.slice(0,10)||'',{type:'date'});
   controls.discoveredAt=control('discoveredAt',opportunity.discovered_at?.slice(0,10)||'',{type:'date'});
   controls.referredName=control('referredName',opportunity.referred_name||'',{max:160});
   controls.referredRelation=control('referredRelation',opportunity.referred_relation||'',{max:200});
   for(const key of ['type','status','progress','nextAction','nextActionDate','discoveredAt','referredName','referredRelation'])form.append(field(key,controls[key]));
   controls.type.addEventListener('change',()=>{
     const previous=controls.status.value,allowed=stages(controls.type.value);
     controls.status.replaceChildren(...allowed.map(s=>h('option',{value:s},translateEnum('opportunity_stage',s))));
     controls.status.value=allowed.includes(previous)?previous:allowed[0];
   });
 }else{
   controls.result=control('result','',{type:'textarea'});
   controls.actionId=control('actionId','',{options:[['',t('label_none')],...actions.filter(a=>String(a.person_id)===personId&&String(a.opportunity_id)===opportunityId)
     .map(a=>[String(a.id),a.title||`#${a.id}`])]});
   resultFields=h('div',{style:'display:none'},[field('result',controls.result),field('actionId',controls.actionId)]);
   form.append(field('status',controls.status),resultFields);
   controls.status.addEventListener('change',()=>{resultFields.style.display=terminal(controls.status.value)?'':'none';});
 }
 function showError(key){errorHost.textContent=t(key);errorHost.style.display='';}
 function setBusy(value){busy=value;Object.values(controls).forEach(x=>{x.disabled=value||!!executed;});previewButton.disabled=value||!!executed;}
 function invalidate(){if(busy||executed)return;requestKey=null;preview=null;previewHost.replaceChildren();errorHost.style.display='none';}
 for(const node of Object.values(controls)){node.addEventListener('input',invalidate);node.addEventListener('change',invalidate);}
 function payload(){
   const isClose=mode==='advance'&&terminal(controls.status.value);
   const draft=mode==='edit'?Object.fromEntries(Object.entries(controls).map(([k,v])=>[k,
     ['nextActionDate','discoveredAt'].includes(k)?v.value||null:v.value])):
     isClose?{status:controls.status.value,result:controls.result.value.trim(),actionId:controls.actionId.value||null}:{status:controls.status.value};
   if(isClose&&!draft.result)throw Error('RESULT_REQUIRED');
   requestKey ||= uuid();
   return {personId,customerId,opportunityId,idempotencyKey:requestKey,operation:mode==='edit'?'edit':isClose?'close':'stage',draft};
 }
 async function readBack(){
   if(reading)return;reading=true;
   receiptHost.replaceChildren(h('p',{},t('legacy_opp_reading')));
   try{
     const result=await data.opportunityDetails(ctx,opportunityId);const current=result.opportunity;
     if(String(current?.id)!==opportunityId)throw Error('Invalid readback');
     receiptHost.replaceChildren(h('p',{},t('legacy_opp_saved')),h('p',{},`${t('legacy_opp_record')} #${opportunityId}`),
       h('p',{},`${t('legacy_opp_stage')}: ${display('status',current.status)}`),
       h('p',{},`${t('opp_detail_progress')}: ${display('progress',current.last_progress)}`));
     if(executed.outcomeId)receiptHost.append(h('p',{},`${t('legacy_opp_outcome')} #${executed.outcomeId}`));
     if(!notified){notified=true;try{await onDone?.();}catch{ctx.toast?.(t('legacy_opp_directory_refresh_failed'),'err');}}
   }catch{
     const retry=h('button',{class:'btn btn-soft',type:'button'},t('legacy_opp_read_again'));
     retry.addEventListener('click',readBack);
     receiptHost.replaceChildren(h('p',{},t('legacy_opp_read_failed')),h('p',{},`${t('legacy_opp_record')} #${opportunityId}`),retry);
   }finally{reading=false;}
 }
 function renderPreview(result){
   preview=result;const before=result.preview.before||{},after=result.preview.after||{};
   const changes=Object.keys(after).filter(k=>Object.hasOwn(LABELS,k)&&JSON.stringify(before[k])!==JSON.stringify(after[k]));
   const checkbox=h('input',{type:'checkbox'});
   const execute=h('button',{class:'btn btn-primary',type:'button',disabled:true},t('legacy_opp_execute'));
   checkbox.addEventListener('change',()=>{execute.disabled=!checkbox.checked||busy;});
   execute.addEventListener('click',async()=>{
     if(busy||!checkbox.checked||!preview?.previewId||executed)return;
     setBusy(true);execute.disabled=true;checkbox.disabled=true;errorHost.style.display='none';
     try{
       const done=await data.executeLegacyOpportunity(ctx,preview.previewId);
       if(String(done.opportunityId)!==opportunityId)throw Error('Invalid execution receipt');
       executed=done;previewHost.replaceChildren(h('p',{},t('legacy_opp_executed')));await readBack();
     }catch(error){const stale=/changed|expired|association|already closed/i.test(error.message);
       if(stale){requestKey=null;preview=null;previewHost.replaceChildren();}
       showError(stale?'legacy_opp_stale':'legacy_opp_execute_failed');}
     finally {setBusy(false);if(!executed){checkbox.disabled=false;execute.disabled=!checkbox.checked;}}
   });
   previewHost.replaceChildren(h('div',{class:'sheet-preview'},[
     h('p',{},`${t('legacy_opp_record')} #${opportunityId} · ${result.preview.personName||person?.display_name||''}`),
     ...changes.map(key=>h('div',{class:'ocr-diff-row'},[h('strong',{},t(LABELS[key])),
       h('span',{},`${t('ocr_before')}: ${display(key,before[key])}`),h('span',{},`${t('ocr_after')}: ${display(key,after[key])}`)])),
     !changes.length?h('p',{},t('legacy_opp_no_changes')):null,
     h('label',{class:'ocr-confirm-row'},[checkbox,h('span',{},t('legacy_opp_confirm'))]),execute,
   ]));
 }
 previewButton.addEventListener('click',async()=>{
   if(busy||executed)return;errorHost.style.display='none';let request;
   try{request=payload();}catch(error){showError(error.message==='RESULT_REQUIRED'?'legacy_opp_result_required':'legacy_opp_invalid');return;}
   setBusy(true);preview=null;previewHost.replaceChildren(h('p',{},t('legacy_opp_previewing')));
   try{
     const result=await data.previewLegacyOpportunity(ctx,request);
     if(result.status==='executed'&&String(result.result?.opportunityId)===opportunityId){executed=result.result;previewHost.replaceChildren();await readBack();}
     else {if(!result.previewId||!result.preview?.before||!result.preview?.after||String(result.preview.opportunityId)!==opportunityId)throw Error('Invalid preview');renderPreview(result);}
   }catch{previewHost.replaceChildren();showError('legacy_opp_preview_failed');}
   finally{setBusy(false);}
 });
 body.append(h('p',{class:'sheet-note'},t('legacy_opp_note')),form,errorHost,previewButton,previewHost,receiptHost);
 const sheet=openSheet({title:t(mode==='edit'?'opp_edit_title':'opp_btn_advance_close'),
   sub:`${person?.display_name||opportunity.person?.display_name||''} · #${opportunityId}`,body});
 document.body.appendChild(sheet.overlay);return sheet;
}
