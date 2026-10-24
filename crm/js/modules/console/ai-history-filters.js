import { t } from './i18n.js';

const TASKS = [
  ['person_summary','ai_item_person_summary'], ['meeting_prep','btn_meeting_prep_full'],
  ['conversation_playbook','btn_playbook'], ['activity_review','ai_experience_task_activity_review'],
  ['assistant_opportunity_update_v1','ai_experience_task_opportunity_update'],
];
const GOALS = ['建立联系','约见面','邀请活动','获取家庭信息','推进签单','推进招募','推进转介绍'];
export function historyTaskLabel(type) {
  const entry = TASKS.find(([value]) => value === type);
  return entry ? t(entry[1]) : type;
}
export function historyTypeLabel(source,type) {
  if(!type)return t('ai_history_all_types');
  const index=GOALS.indexOf(type);
  return source==='legacy'&&index>=0?t(`ai_history_goal_${index}`):historyTaskLabel(type);
}
const node = (tag, key) => { const n=document.createElement(tag); if(key)n.textContent=t(key); return n; };
function field(key, tag='input', type='text') {
  const label=node('label'); label.className='crm-ai-exp-field'; label.append(node('span',key));
  const input=node(tag); if(tag==='input')input.type=type;
  label.append(input); return {label,input};
}

export function createHistoryFilters({api,onApply,onError}) {
  const form=node('form'); form.className='crm-ai-history-filters';
  const fieldset=node('fieldset'); fieldset.className='crm-ai-exp-form';
  const source=field('ai_history_source','select'); source.input.className='ai-history-source';
  for(const value of ['runtime','legacy'])source.input.add(new Option(t(`ai_history_source_${value}`),value));
  const apply=node('button','ai_history_apply');apply.type='submit';apply.className='btn btn-primary';
  const advanced=node('details');advanced.className='ai-history-advanced';advanced.append(node('summary','ai_history_filters'));
  const fields=node('div');fields.className='crm-ai-exp-form';
  const type=field('ai_history_type','select');type.input.className='ai-history-type';
  function types(){type.input.replaceChildren(new Option(t('ai_history_all_types'),''));
    const entries=source.input.value==='runtime'?TASKS:GOALS.map((value,i)=>[value,`ai_history_goal_${i}`]);
    for(const [value,key]of entries)type.input.add(new Option(t(key),value));}
  source.input.addEventListener('change',types);types();
  const from=field('ai_history_from','input','date'),to=field('ai_history_to','input','date');
  from.input.className='ai-history-from';to.input.className='ai-history-to';
  const name=field('ai_history_person');name.input.maxLength=200;name.input.className='ai-history-person-name';
  const people=field('ai_history_person_choice','select');people.input.className='ai-history-person-choice';
  const clearPeople=()=>people.input.replaceChildren(new Option(t('ai_history_all_people'),''));clearPeople();
  name.input.addEventListener('input',clearPeople);
  const search=node('button','ai_history_find_person');search.type='button';search.className='btn ai-history-find-person';
  search.addEventListener('click',async()=>{
    const query=name.input.value.trim();clearPeople();if(!query)return;
    search.disabled=true;
    try{
      const response=await api.call('person_360',{action:'resolveIdentity',name:query});
      if(name.input.value.trim()!==query)return;
      if(response?.error||!Array.isArray(response?.candidates))throw Error('identity');
      people.input.replaceChildren(new Option(t('ai_history_choose_person'),''));
      for(const person of response.candidates){
        if(!/^[1-9][0-9]*$/.test(String(person.id)))continue;
        people.input.add(new Option(`${person.displayName || ''} · #${person.id}`,String(person.id)));
      }
      if(people.input.options.length===1)onError('ai_history_person_missing');
    }catch(_){onError('ai_history_person_failed');}
    finally{search.disabled=false;}
  });
  const reset=node('button','ai_history_reset');reset.type='button';reset.className='btn';
  reset.addEventListener('click',()=>{type.input.value='';from.input.value='';to.input.value='';name.input.value='';clearPeople();
    onApply({source:source.input.value,page:1,limit:20});});
  fields.append(type.label,from.label,to.label,name.label,search,people.label,reset);
  advanced.append(fields,node('p','ai_history_filter_scope'));
  fieldset.append(source.label,apply,advanced);form.append(fieldset);
  form.addEventListener('submit',event=>{
    event.preventDefault();
    if(name.input.value.trim()&&!people.input.value){onError('ai_history_choose_person');return;}
    if(from.input.value&&to.input.value&&from.input.value>to.input.value){onError('ai_history_invalid_dates');return;}
    onApply({source:source.input.value,page:1,limit:20,
      ...(type.input.value?{type:type.input.value}:{}),...(people.input.value?{personId:people.input.value}:{}),
      ...(from.input.value?{startDate:from.input.value}:{}),...(to.input.value?{endDate:to.input.value}:{})});
  });
  return {node:form,setBusy:busy=>{fieldset.disabled=busy;}};
}
