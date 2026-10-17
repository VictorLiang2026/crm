import { createApi } from '../core/api.js';
import { getLang, t } from './console/i18n.js';

const PAGE='#/assistant/opportunities/change';
const FIELDS=['type','status','progress','nextAction','nextActionDate','result'];
const LABELS={type:'opp_change_type',status:'opp_change_status',progress:'opp_change_progress',
  nextAction:'opp_change_next_action',nextActionDate:'opp_change_next_date',result:'opp_change_result'};
const el=(tag,cls,value)=>{const node=document.createElement(tag);if(cls)node.className=cls;
  if(value!==undefined)node.textContent=String(value);return node;};
const text=value=>value==null||value===''?t('opp_change_empty'):String(value);
function addCss(){if(document.getElementById('crm-opp-change-css'))return;
  const link=document.createElement('link');link.id='crm-opp-change-css';link.rel='stylesheet';
  link.href='/crm/css/assistant-opportunity-change.css';document.head.append(link);}
function snapshot(title,data){const column=el('section','crm-opp-change-column');
  column.append(el('h4','',title));const list=el('dl','crm-opp-change-snapshot');
  for(const key of FIELDS)if(data&&Object.hasOwn(data,key)){
    let value=data[key];if(key==='nextActionDate'&&value){const date=new Date(`${value}T00:00:00`);if(!Number.isNaN(date.valueOf()))value=date.toLocaleDateString();}
    list.append(el('dt','',t(LABELS[key])),el('dd','',text(value)));
  }
  column.append(list);return column;}

export function renderAssistantOpportunityChange({root,callFn}){
  addCss();const api=createApi(callFn);const page=el('section','crm-opp-change');
  const back=el('a','crm-opp-change-back',t('opp_change_back'));back.href='#/ai';
  page.append(back,el('h2','',t('opp_change_title')),el('p','crm-opp-change-help',t('opp_change_help')));
  const notice=el('p','crm-opp-change-notice');notice.setAttribute('aria-live','polite');
  const form=el('form','crm-opp-change-request');const queryLabel=el('label','crm-opp-change-query');
  queryLabel.append(el('span','',t('opp_change_query')));const query=el('textarea');query.required=true;query.maxLength=1200;
  query.placeholder=t('opp_change_query_placeholder');queryLabel.append(query);
  const interpret=el('button','btn btn-primary',t('opp_change_interpret'));interpret.type='submit';form.append(queryLabel,interpret);
  const proposal=el('section','crm-opp-change-proposal');const people=el('div','crm-opp-change-choices');
  const opportunities=el('div','crm-opp-change-choices');const closeFields=el('div','crm-opp-change-close-fields');
  const closeStatusLabel=el('label','crm-opp-change-field',t('opp_change_close_status'));
  const closeStatus=el('select');closeStatus.setAttribute('aria-label',t('opp_change_close_status'));
  closeStatus.append(new Option(t('opp_change_choose_status'),''),new Option(t('opp_change_won'),'成交'),new Option(t('opp_change_lost'),'关闭'));
  closeStatusLabel.append(closeStatus);
  const resultLabel=el('label','crm-opp-change-field',t('opp_change_result'));
  const resultInput=el('textarea');resultInput.maxLength=4000;resultInput.required=true;
  resultInput.placeholder=t('opp_change_result_placeholder');resultLabel.append(resultInput);
  closeFields.append(closeStatusLabel,resultLabel);
  const testNotice=el('p','crm-opp-change-test-notice');testNotice.setAttribute('role','status');
  const controls=el('div','crm-opp-change-controls');
  const plan=el('button','btn btn-primary',t('opp_change_plan'));plan.type='button';plan.disabled=true;
  const review=el('button','btn',t('opp_change_review'));review.type='button';review.disabled=true;
  const confirm=el('button','btn',t('opp_change_confirm'));confirm.type='button';confirm.disabled=true;
  const execute=el('button','btn btn-primary',t('opp_change_execute'));execute.type='button';execute.disabled=true;
  controls.append(plan,review,confirm,execute);const preview=el('section','crm-opp-change-preview');
  page.append(notice,form,proposal,el('h3','',t('opp_change_person')),people,testNotice,
    el('h3','',t('opp_change_opportunity')),opportunities,closeFields,controls,preview);
  root.replaceChildren(page);

  let parsed=null,person=null,target=null,commandId=null,previewHash=null,busy=false,completed=false;
  const active=()=>location.hash===PAGE;
  function status(message,error=false){notice.textContent=message;notice.classList.toggle('error',error);}
  function clearCommand(){commandId=null;previewHash=null;preview.replaceChildren();
    review.disabled=confirm.disabled=execute.disabled=true;syncPlan();}
  function syncPlan(){const closeReady=parsed?.proposal.operation!=='close'||
    (closeStatus.value&&resultInput.value.trim());plan.disabled=!(parsed&&person&&target&&closeReady)||busy;}
  function reset(){parsed=person=target=null;proposal.replaceChildren();people.replaceChildren();
    opportunities.replaceChildren();closeFields.hidden=true;testNotice.textContent='';
    plan.disabled=review.disabled=confirm.disabled=execute.disabled=true;clearCommand();}
  async function work(button,fn){if(busy||!active()||completed)return;busy=true;button.disabled=true;
    try{await fn();}catch(_){if(active())status(t('opp_change_error'),true);}
    finally{busy=false;if(active()&&!completed){button.disabled=false;syncPlan();}}}
  function chooseOpportunity(item,button){if(busy)return;target={id:String(item.id),title:item.next_action||item.opportunity_type||''};
    clearCommand();for(const row of opportunities.querySelectorAll('button'))row.classList.toggle('selected',row===button);
    status(t('opp_change_choose_opportunity'));}
  async function choosePerson(candidate,button){if(busy)return;person={id:String(candidate.id),displayName:candidate.displayName};
    target=null;clearCommand();opportunities.replaceChildren();status(t('opp_change_pending'));
    await work(button,async()=>{const response=await api.call('assistant',{action:'opportunityCommandTargets',
      personMention:parsed.proposal.personMention,selectedPersonId:person.id});
      if(!active()||!response?.ok)throw new Error('targets');person=response.person;
      if(response.testData?.status!=='verified')testNotice.textContent=t('opp_change_test_unknown');
      else if(response.testData.containsTestData)testNotice.textContent=`${t('opp_change_test_notice')} ${t('opp_change_test_result_hint')}`;
      else testNotice.textContent='';
      if(!Array.isArray(response.opportunities)||!response.opportunities.length){status(t('opp_change_no_opportunity'),true);return;}
      if(response.hasMore){status(t('opp_change_refine'),true);return;}
      for(const item of response.opportunities){
        const caption=`#${item.id} · ${item.opportunity_type||t('opp_change_empty')} · ${item.status||t('opp_change_empty')} · ${item.next_action||t('opp_change_empty')}`;
        const option=el('button','btn crm-opp-change-choice',caption);option.type='button';
        option.addEventListener('click',()=>chooseOpportunity(item,option));opportunities.append(option);
      }
      status(t('opp_change_choose_opportunity'));closeFields.hidden=parsed.proposal.operation!=='close';syncPlan();
    });}

  closeStatus.addEventListener('change',syncPlan);resultInput.addEventListener('input',syncPlan);
  form.addEventListener('submit',event=>{event.preventDefault();void work(interpret,async()=>{
    reset();status(t('opp_change_pending'));
    const response=await api.call('assistant',{action:'opportunityCommandInterpret',query:query.value.trim(),
      language:getLang()==='en'?'en':'zh-CN'});
    if(!active()||!response?.ok)throw new Error('interpret');parsed=response;
    if(response.status==='unsupported'){status(t('opp_change_unsupported'),true);return;}
    if(response.status==='needs_clarification'){status(t('opp_change_clarify'),true);return;}
    if(response.status==='person_not_found'){status(t('opp_change_no_person'),true);return;}
    proposal.append(el('p','',response.proposal.interpretation),
      el('p','',t(`opp_change_operation_${response.proposal.operation}`)),
      el('p','crm-opp-change-target-hint',`${t('opp_change_target_hint')} ${response.proposal.opportunityMention||''}`));
    if(response.status!=='needs_person_selection'||!Array.isArray(response.candidates))throw new Error('proposal');
    if(response.hasMore){status(t('opp_change_refine'),true);return;}
    for(const candidate of response.candidates){const detail=[candidate.organization,candidate.occupation].filter(Boolean).join(' · ');
      const option=el('button','btn crm-opp-change-choice',`#${candidate.id} · ${candidate.displayName}${detail?` · ${detail}`:''}`);
      option.type='button';option.addEventListener('click',()=>void choosePerson(candidate,option));people.append(option);}
    closeFields.hidden=response.proposal.operation!=='close';status(t('opp_change_choose_person'));
  });});

  plan.addEventListener('click',()=>void work(plan,async()=>{
    if(!parsed||!person||!target)return;
    let changes=parsed.proposal.changes;
    if(parsed.proposal.operation==='close'){
      if(!closeStatus.value||!resultInput.value.trim())return;
      changes={status:closeStatus.value,result:resultInput.value.trim()};
    }
    const response=await api.call('assistant',{action:'opportunityCommand',stage:'plan',
      idempotencyKey:crypto.randomUUID(),command:{resource:'opportunities',operation:parsed.proposal.operation,
        personId:person.id,opportunityId:target.id,changes}});
    if(!active()||!response?.ok)throw new Error('plan');commandId=response.commandId;
    review.disabled=false;status(t('opp_change_pending'));
  }));
  review.addEventListener('click',()=>void work(review,async()=>{
    if(!commandId)return;const response=await api.call('assistant',{action:'opportunityCommand',stage:'preview',commandId});
    if(!active()||!response?.ok||response.status!=='previewed'||!response.previewHash||!response.preview)throw new Error('preview');
    previewHash=response.previewHash;const data=response.preview;preview.replaceChildren();
    const summary=el('p','crm-opp-change-preview-scope',`${t('opp_change_scope')} ${person.displayName} · ${t('opp_change_opportunity_id')} #${target.id}`);
    const columns=el('div','crm-opp-change-columns');columns.append(snapshot(t('opp_change_before'),data.before),snapshot(t('opp_change_after'),data.after));
    preview.append(summary,columns);
    if(data.outcomeCreated)preview.append(el('p','crm-opp-change-outcome',`${t('opp_change_outcome_notice')} ${t(data.outcomeType==='opportunity_sale'?'opp_change_outcome_sale':'opp_change_outcome_closed')}`));
    if(data.outcomeResult)preview.append(el('p','crm-opp-change-outcome',`${t('opp_change_result')}: ${data.outcomeResult}`));
    preview.append(el('p','crm-opp-change-expiry',`${t('opp_change_expires')} ${new Date(response.expiresAt).toLocaleString()}`));
    confirm.disabled=false;status(t('opp_change_review_notice'));
  }));
  confirm.addEventListener('click',()=>void work(confirm,async()=>{
    if(!commandId||!previewHash)return;const response=await api.call('assistant',{action:'opportunityCommand',stage:'confirm',commandId,previewHash});
    if(!active()||!response?.ok||response.status!=='confirmed')throw new Error('confirm');
    execute.disabled=false;confirm.disabled=true;status(t('opp_change_confirmed'));
  }));
  execute.addEventListener('click',()=>void work(execute,async()=>{
    if(!commandId)return;const response=await api.call('assistant',{action:'opportunityCommand',stage:'execute',commandId});
    if(!active()||!response?.ok||response.status!=='executed')throw new Error('execute');
    completed=true;execute.disabled=true;status(t('opp_change_success'));
  }));
}
