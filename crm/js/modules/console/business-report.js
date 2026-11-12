import { h } from './dom.js';
import { data } from './data.js';
import { getLang, t, translateEnum } from './i18n.js';
import { card, emptyNote, loadInto, pageHead } from './ui.js';
import { stageLabel } from './pipeline-stage.js';
import { openOpportunityDetails } from './pages/opportunities.js';

const queueKeys=['today','overdue','protection','recruitment','event','review','renewal','verify'];
const queueTitle=k=>t('business_queue_'+k);
const note=text=>h('p',{class:'foot-note'},text);
const button=(key,fn,disabled=false)=>h('button',{type:'button',class:'btn btn-soft btn-sm',disabled,onclick:fn},t(key));
function route(key){
  if(key==='today'||key==='overdue')return '#/actions/'+key;
  if(['review','renewal','verify'].includes(key))return '#/people/customer/'+key;
  return '#/today/list/'+key;
}

export function homeFollowups(ctx) {
  const host=h('div',{'data-business-home':''});
  loadInto(host,async()=>{
    const result=await data.businessReport(ctx,{mode:'home'});
    return h('div',{},[h('div',{class:'mini-grid business-queues'},queueKeys.map(key=>h('a',{
      class:'mini',href:route(key),'data-queue':key,
    },[h('span',{},queueTitle(key)),h('b',{},String(result.counts[key]))]))),
    note(t('business_home_basis')+' · '+result.asOf)]);
  });
  return card({title:t('business_home'),icon:'calendar',body:host});
}

export function renderFollowupList(ctx,key) {
  let page=1,cancel=()=>{};
  const host=h('div',{'data-business-list':key});
  function load(){
    cancel();
    cancel=loadInto(host,async()=>{
      const res=await data.businessReport(ctx,{mode:'list',queue:key,page});
      if(!res.rows.length && page>1){page--;load();return h('div');}
      return h('div',{},[
        note(t('business_basis_'+key)+' · '+res.asOf),
        ...res.rows.map(row=>{
          const label=row.person_name || t('unnamed');
          const link=key==='protection'?h('button',{class:'btn btn-ghost',type:'button',onclick:()=>openOpportunityDetails(ctx,{
            id:row.id,opportunity_type:row.record_type,person:{id:row.person_id,display_name:label}},load)},label)
            :h('a',{class:'row-title',href:key==='event'?'#/activity/'+row.id:'#/person/'+row.person_id+'/team'},key==='event'?row.description:label);
          return h('article',{class:'list-row',style:'flex-wrap:wrap'},[h('div',{style:'flex:1 1 14rem;min-width:0;overflow-wrap:anywhere'},[
            link,h('p',{class:'row-sub'},[key==='event'?label:stageLabel(key,row.description),row.day].filter(Boolean).join(' · ')),
          ]),row.action_id?h('a',{href:'#/actions/'+row.action_id},t('label_action')+' #'+row.action_id):null]);
        }),res.rows.length?null:emptyNote(t('business_empty')),
        h('div',{class:'opp-pagination'},[h('span',{},t('opp_total_count')+' '+res.total+' · '+t('opp_page')+' '+page),
          h('div',{},[button('btn_prev',()=>{page--;load();},page<=1),button('btn_next',()=>{page++;load();},!res.hasMore)])]),
      ]);
    });
  }
  ctx.main.replaceChildren(pageHead({title:queueTitle(key),actions:[h('a',{class:'btn btn-soft',href:'#/today'},t('nav_today'))]}),card({body:host}));
  load();
}

const label=key=>t('business_'+key);
function metric(key,value){return h('div',{class:'list-row'},[h('span',{style:'flex:1;min-width:0'},label(key)),h('span',{},String(value))]);}
function rate(n,d){
  if(!d)return t('business_insufficient')+' (0/0)';
  return new Intl.NumberFormat(getLang(),{style:'percent',maximumFractionDigits:1}).format(n/d)+' ('+n+'/'+d+')';
}
function breakdown(key,items){
  return h('details',{},[h('summary',{},label(key)),...(items.length?items.map(([name,value])=>
    h('div',{class:'list-row'},[h('span',{style:'flex:1;min-width:0;overflow-wrap:anywhere'},name),h('span',{},String(value))])):[note(label('no_records'))])]);
}
function group(key,body){
  return h('section',{'data-business-group':key,class:'card'},[
    h('div',{class:'card-head'},h('b',{},label(key))),h('div',{class:'card-body'},body),
  ]);
}
function pipelineGroup(key,p,report){
  return group(key,[note(label('pipeline_basis')),metric('records',p.total),metric('active',p.active),
    breakdown('stage_distribution',p.stages.map(s=>[stageLabel(key,s.stage),s.n])),
    metric('referrals',p.referral),metric('unknown_source',p.unknownSource),
    metric('overdue_dated',rate(p.overdue,p.dueDated)),metric('due_queue',report.counts[key]),
    metric('moves',p.moves),metric('moved_records',p.movedRecords),
    metric('cohort',p.unverifiedCohort?label('insufficient'):rate(p.converted,p.cohort)),
    metric('dwell',p.dwellN?p.dwellDays+' '+label('days')+' (n='+p.dwellN+')':label('insufficient')),
    breakdown('outcomes',p.outcomes.map(s=>[stageLabel(key,s.stage),s.n])),
    p.recentReasons.length?breakdown('reasons',p.recentReasons.map(s=>[s.reason,stageLabel(key,s.stage)])):null,
    key==='recruitment'?breakdown('milestones',['新增人才','互动暖客','初次面谈','增员活动','精准面谈','入职申请','签约入司'].map(s=>[translateEnum('recruit_stage',s),report.milestones[s]||0])):null,
    note(label('history_basis')),key==='recruitment'?note(label('milestone_basis')):null]);
}
function groups(r) {
  const roles=['customer','recruit','referrer','speaker','participant'];
  const a=r.actions,e=r.events,p=r.policy,c=r.counts;
  return [
    pipelineGroup('protection',r.pipeline.protection,r),pipelineGroup('recruitment',r.pipeline.recruitment,r),
    group('people',[note(label('people_basis')),metric('persons',r.roles.total),...roles.map(k=>metric('role_'+k,rate(r.roles.coverage[k]||0,r.roles.total))),
      metric('multi',rate(r.roles.multi,r.roles.total))]),
    group('events',[note(t('roster_unknown')),metric('held_dates',e.heldDates),metric('participants',e.heldDates>0&&e.heldDates===e.missingLists?t('roster_empty'):e.entries),h('div',{class:'list-row'},[t('roster_missingCount')+' · '+(e.missingLists??'—')]),

      metric('followups',e.interactions),metric('event_completed',e.completed),metric('accepted_candidates',e.acceptedCandidates),metric('accepted_actions',e.acceptedActions)]),
    group('actions',[note(label('actions_basis')),metric('completion',rate(a.completed,a.due)),metric('overdue_open',rate(c.overdue,a.dated)),
      metric('waiting',c.waiting),metric('unlinked',rate(a.unlinked,a.open)),
      breakdown('workload',['opportunity','candidate','activity','policy','interaction'].map(k=>[label('context_'+k),a.workload[k]||0]))]),
    group('policy',[note(label('policy_basis')),metric('product_coverage',rate(p.withProduct,p.customers)),
      metric('policy_description',rate(p.described,p.withProduct)),metric('policy_items',rate(p.completeItems,p.startedItems)),metric('review_coverage',rate(p.withCurrent,p.customers)),
      metric('current_reports',rate(p.current,p.valid)),...['review','renewal','verify'].map(k=>metric('queue_'+k,c[k]))]),
  ];
}

export function businessAnalytics(ctx) {
  let days=30,activeGroup='protection',cancel=()=>{};
  const host=h('div',{class:'tab-stack','data-business-report':''});
  const tabs=h('div',{class:'toolbar',role:'group','aria-label':label('period')});
  const groupsNav=h('div',{class:'toolbar',role:'group','aria-label':t('m16_title')});
  function selectGroup(key){
    activeGroup=key;
    for(const tab of groupsNav.children)tab.setAttribute('aria-pressed',String(tab.dataset.group===key));
    for(const section of host.querySelectorAll('[data-business-group]'))section.hidden=section.dataset.businessGroup!==key;
  }
  for(const key of ['protection','recruitment','people','events','actions','policy'])groupsNav.append(h('button',{class:'btn btn-soft',type:'button','data-group':key,onclick:()=>selectGroup(key)},label(key)));
  selectGroup(activeGroup);
  function load(){
    cancel();
    for(const tab of tabs.children)tab.setAttribute('aria-pressed',String(Number(tab.dataset.days)===days));
    cancel=loadInto(host,async()=>{
      const r=await data.businessReport(ctx,{mode:'report',days});
      const sections=groups(r);
      for(const section of sections)section.hidden=section.dataset.businessGroup!==activeGroup;
      return h('div',{class:'tab-stack'},[note(r.startDay+' – '+r.asOf+' · '+label('time_basis')),...sections]);
    });
  }
  for(const n of [7,30,90])tabs.append(h('button',{type:'button',class:'btn btn-soft','data-days':n,onclick:()=>{days=n;load();}},n+' '+label('days')));
  const node=h('div',{},[tabs,groupsNav,host]);load();return {node,refresh:load};
}
