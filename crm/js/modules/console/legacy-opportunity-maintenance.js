import { h } from './dom.js';
import { data } from './data.js';
import { openSheet } from './write.js';
import { t, translateEnum } from './i18n.js';
import { legacyOpportunityTypeLabel } from './legacy-opportunity.js';

const TYPES=['医疗保障','重疾保障','养老规划','教育规划','财富规划','家庭保障','转介绍',
  'insurance','recruit','referral','activity','speaker','partnership','service','relationship'];
const FIELDS={type:'legacy_opp_type',status:'legacy_opp_stage',progress:'opp_detail_progress',
  nextAction:'opp_detail_next_action',nextActionDate:'opp_detail_next_date',
  discoveredAt:'opp_detail_discovered',referredName:'opp_referred_name',referredRelation:'opp_referred_relation'};
const terminal=value=>['成交','关闭'].includes(value);
const stages=type=>['转介绍','referral'].includes(type)?
  ['潜在线索','已介绍','已联系','已建立关系','成交','关闭']:
  ['发现','沟通','方案','成交','关闭'];
const validId=value=>/^[1-9][0-9]*$/.test(String(value))&&Number.isSafeInteger(Number(value));
function control(name,value,{options,textarea=false,type='text',max=4000}={}){
  const node=options?h('select',{class:'sheet-select',name},options.map(([v,label])=>h('option',{value:v},label))):
    h(textarea?'textarea':'input',{class:textarea?'sheet-textarea':'sheet-input',name,
      type:textarea?undefined:type,maxlength:max,rows:textarea?3:undefined});
  node.value=value??'';return node;
}
function display(key,value){
  if(value==null||value==='')return t('label_none');
  if(key==='type')return legacyOpportunityTypeLabel(value)||String(value);
  if(key==='status')return translateEnum('opportunity_stage',value)||String(value);
  return String(value);
}
function uuid(){if(!globalThis.crypto?.randomUUID)throw Error(t('ocr_secure_ids_unavailable'));return crypto.randomUUID();}

export function openLegacyOpportunityMaintenance(ctx,{opportunity,mode,onDone}={}){
  const customerId=String(opportunity?.customer_id??''),opportunityId=String(opportunity?.id??'');
  if(!validId(customerId)||!validId(opportunityId)||
    (mode==='terminal_edit'&&!terminal(opportunity.status))||!['terminal_edit','remove'].includes(mode)){
    ctx.toast?.(t('legacy_opp_unavailable'),'err');return;
  }
  const form=h('div',{class:'legacy-opportunity-fields'}),controls={};
  if(mode==='terminal_edit'){
    const items=[
      ['type',opportunity.opportunity_type,{options:TYPES.map(x=>[x,legacyOpportunityTypeLabel(x)||x])}],
      ['status',opportunity.status,{options:stages(opportunity.opportunity_type).map(x=>[x,translateEnum('opportunity_stage',x)])}],
      ['progress',opportunity.last_progress||'',{textarea:true}],
      ['nextAction',opportunity.next_action||'',{textarea:true,max:1000}],
      ['nextActionDate',opportunity.next_action_date?.slice(0,10)||'',{type:'date'}],
      ['discoveredAt',opportunity.discovered_at?.slice(0,10)||'',{type:'date'}],
      ['referredName',opportunity.referred_name||'',{max:160}],
      ['referredRelation',opportunity.referred_relation||'',{max:200}],
    ];
    for(const [key,value,opts] of items){
      controls[key]=control(key,value,opts);
      form.append(h('label',{class:'sheet-field'},[h('span',{},t(FIELDS[key])),controls[key]]));
    }
    controls.type.addEventListener('change',()=>{
      const prior=controls.status.value,allowed=stages(controls.type.value);
      controls.status.replaceChildren(...allowed.map(x=>h('option',{value:x},translateEnum('opportunity_stage',x))));
      controls.status.value=allowed.includes(prior)?prior:allowed[0];
      controls.status.dispatchEvent(new Event('change'));
    });
  }
  const note=h('p',{class:'sheet-note'},t(mode==='remove'?'opp_maintenance_remove_note':'opp_maintenance_edit_note'));
  const errorHost=h('p',{class:'sheet-err',role:'alert',style:'display:none'});
  const previewHost=h('div',{class:'legacy-opportunity-preview'});
  const receiptHost=h('div',{class:'legacy-opportunity-receipt',role:'status'});
  const previewButton=h('button',{class:'btn btn-primary',type:'button'},t('legacy_opp_preview'));
  const body=h('div',{class:'legacy-opportunity-form'},[note,form,errorHost,previewButton,previewHost,receiptHost]);
  const sheet=openSheet({title:t(mode==='remove'?'opp_maintenance_remove':'opp_maintenance_terminal_edit'),
    sub:`#${opportunityId} · ${t('opp_maintenance_customer')} #${customerId}`,body});
  let busy=false,executed=false,requestKey=null,preview=null;
  function setBusy(value){busy=value;previewButton.disabled=value||executed;
    Object.values(controls).forEach(node=>{node.disabled=value||executed;});}
  function invalidate(){if(busy||executed)return;requestKey=null;preview=null;
    previewHost.replaceChildren();errorHost.style.display='none';}
  for(const node of Object.values(controls)){node.addEventListener('input',invalidate);node.addEventListener('change',invalidate);}
  function showError(key){errorHost.textContent=t(key);errorHost.style.display='';}
  function payload(){
    requestKey ||= uuid();
    return {idempotencyKey:requestKey,operation:mode,customerId,opportunityId,
      draft:mode==='remove'?{}:Object.fromEntries(Object.entries(controls).map(([key,node])=>
        [key,['nextActionDate','discoveredAt'].includes(key)?node.value||null:node.value]))};
  }
  async function readBack(){
    if(mode==='remove'){
      try{await data.opportunityDetails(ctx,opportunityId);throw Error('Still visible');}
      catch(error){if(!/Opportunity unavailable/i.test(error.message||'')){
        showError('opp_maintenance_read_failed');return;}}
      receiptHost.replaceChildren(h('p',{},t('opp_maintenance_removed')),
        h('p',{},`${t('legacy_opp_record')} #${opportunityId}`));
    }else{
      try{
        const result=await data.opportunityDetails(ctx,opportunityId);
        if(String(result.opportunity?.id)!==opportunityId)throw Error('Invalid readback');
        receiptHost.replaceChildren(h('p',{},t('legacy_opp_saved')),
          h('p',{},`${t('legacy_opp_record')} #${opportunityId}`),
          h('p',{},`${t('legacy_opp_stage')}: ${display('status',result.opportunity.status)}`));
      }catch{showError('opp_maintenance_read_failed');return;}
    }
    try{await onDone?.();}catch{ctx.toast?.(t('legacy_opp_directory_refresh_failed'),'err');}
  }
  function renderPreview(result){
    preview=result;const details=result.preview;
    const checkbox=h('input',{type:'checkbox'});
    const execute=h('button',{class:'btn btn-primary',type:'button',disabled:true},
      t(mode==='remove'?'opp_maintenance_confirm_remove':'legacy_opp_execute'));
    checkbox.addEventListener('change',()=>{execute.disabled=!checkbox.checked||busy;});
    execute.addEventListener('click',async()=>{
      if(busy||!checkbox.checked||!preview?.previewId||executed)return;
      setBusy(true);execute.disabled=true;checkbox.disabled=true;errorHost.style.display='none';
      try{
        const receipt=await data.executeLegacyOpportunityMaintenance(ctx,preview.previewId);
        if(String(receipt.opportunityId)!==opportunityId||receipt.operation!==mode)throw Error('Invalid receipt');
        executed=true;previewHost.replaceChildren(h('p',{},t('legacy_opp_executed')));await readBack();
      }catch(error){
        if(/changed|expired|unavailable|customer/i.test(error.message)){
          requestKey=null;preview=null;previewHost.replaceChildren();}
        showError('opp_maintenance_execute_failed');
      }finally{setBusy(false);if(!executed){checkbox.disabled=false;execute.disabled=!checkbox.checked;}}
    });
    const changes=mode==='terminal_edit'?Object.keys(FIELDS).filter(key=>
      JSON.stringify(details.before?.[key])!==JSON.stringify(details.after?.[key])):[];
    previewHost.replaceChildren(h('div',{class:'sheet-preview'},[
      h('p',{},`${t('legacy_opp_record')} #${opportunityId} · ${t('opp_maintenance_customer')} #${customerId}`),
      h('p',{},`${t('opp_maintenance_actions')} ${details.linkedActionCount} · ${t('opp_maintenance_outcomes')} ${details.outcomeCount}`),
      ...changes.map(key=>h('div',{class:'ocr-diff-row'},[h('strong',{},t(FIELDS[key])),
        h('span',{},`${t('ocr_before')}: ${display(key,details.before[key])}`),
        h('span',{},`${t('ocr_after')}: ${display(key,details.after[key])}`)])),
      !changes.length&&mode==='terminal_edit'?h('p',{},t('legacy_opp_no_changes')):null,
      h('p',{},t(mode==='remove'?'opp_maintenance_remove_effect':'opp_maintenance_edit_effect')),
      h('label',{class:'ocr-confirm-row'},[checkbox,h('span',{},t('opp_maintenance_confirm'))]),execute,
    ]));
  }
  previewButton.addEventListener('click',async()=>{
    if(busy||executed)return;errorHost.style.display='none';setBusy(true);
    previewHost.replaceChildren(h('p',{},t('legacy_opp_previewing')));
    try{
      const result=await data.previewLegacyOpportunityMaintenance(ctx,payload());
      if(result.status==='executed'&&String(result.result?.opportunityId)===opportunityId){
        executed=true;previewHost.replaceChildren();await readBack();
      }else if(result.previewId&&String(result.preview?.opportunityId)===opportunityId&&
        String(result.preview?.customerId)===customerId&&result.preview?.operation===mode){
        renderPreview(result);
      }else throw Error('Invalid preview');
    }catch{previewHost.replaceChildren();showError('opp_maintenance_preview_failed');}
    finally{setBusy(false);}
  });
  document.body.appendChild(sheet.overlay);return sheet;
}
