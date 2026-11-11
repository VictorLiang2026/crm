import { h } from './dom.js';
import { data } from './data.js';
import { t, translateEnum } from './i18n.js';
import { card, emptyNote, loadInto, pageHead } from './ui.js';
import { openSheet, openWorkItemEditor, openWorkItemTransition } from './write.js';

const views = ['today','week','overdue','waiting','completed'];
const dateFormat = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
export function actionDay(value) {
  if (!value) return '';
  const date=new Date(value);
  return Number.isFinite(date.getTime()) ? dateFormat.format(date) : '';
}
const button=(label,click,cls='btn btn-soft btn-sm')=>h('button',{class:cls,type:'button',onclick:click},t(label));
const titleLink=row=>h('a',{href:'#/actions/'+row.id},row.title || t('unnamed_action'));

function contextError(err) {
  if (/Action context (changed|preview expired)|Action already linked|P0002/.test(err.message)) return t('ac_review_again');
  return err.message || t('write_failed');
}

async function previewContext(ctx,sheet,input,done,back) {
  sheet.swap(h('p',{role:'status'},t('loading')));
  try {
    const res=await data.previewActionContext(ctx,{...input,requestId:crypto.randomUUID()});
    const p=res.preview;
    const confirm=button('confirm_execute',async()=>{
      confirm.disabled=true;
      try {
        await data.confirmActionContext(ctx,res.previewId);
        sheet.overlay.remove();done();
      } catch(err){sheet.showErr(contextError(err));confirm.disabled=false;}
    },'btn btn-primary');
    sheet.swap(h('div',{class:'sheet-preview'},[
      h('b',{},t('ac_op_'+p.operation)),h('p',{},p.personName+' · '+p.title+' #'+p.actionId),
      p.kind ? h('p',{},t('ac_kind_'+p.kind)+' #'+p.targetId+' · '+(p.targetName||'')) : null,
      h('p',{},translateEnum('work_status',p.status)+' · '+(actionDay(p.dueAt)||t('no_date'))),
      p.waitingFor?h('p',{},p.waitingFor):null,
      h('div',{class:'sheet-actions'},[button('back_to_edit',back),confirm]),
    ]));
  } catch(err){sheet.swap(button('back_to_edit',back));sheet.showErr(contextError(err));}
}
function waiting(ctx,row,done) {
  const op=row.waiting_for?'resume':'wait';
  const sheet=openSheet({title:t('ac_op_'+op),sub:row.title,body:h('div')});
  document.body.append(sheet.overlay);
  const input=h('input',{class:'sheet-input',maxlength:200});
  function edit() {
    sheet.swap(h('div',{},[
      op==='wait'?h('label',{class:'sheet-field'},[t('ac_waiting_for'),input]):null,
      button('pipeline_preview',()=>{
        if(op==='wait'&&!input.value.trim()){sheet.showErr(t('ac_wait_required'));return;}
        previewContext(ctx,sheet,{operation:op,actionId:row.id,waitingFor:input.value.trim()},done,edit);
      }),
    ]));
  }
  edit();
}
function actionRow(ctx,row,refresh,controls) {
  const active=['open','in_progress'].includes(row.status);
  return h('article',{class:'list-row',style:'flex-wrap:wrap;overflow-wrap:anywhere','data-action-id':row.id},[
    h('div',{style:'flex:1 1 14rem;min-width:0'},[
      h('div',{class:'row-title'},titleLink(row)),
      h('div',{class:'row-sub'},[row.person_name,actionDay(row.due_at)||t('no_date'),
        translateEnum('work_status',row.status)].filter(Boolean).join(' · ')),
      row.waiting_for?h('p',{class:'row-sub'},t('ac_waiting_for')+' · '+row.waiting_for):null,
    ]),
    controls?h('div',{class:'sheet-actions'},[
      active?button('btn_edit',()=>openWorkItemEditor(ctx,{kind:'action',row,personId:row.person_id,personName:row.person_name,onDone:refresh})):null,
      active?button(row.waiting_for?'ac_op_resume':'ac_op_wait',()=>waiting(ctx,row,refresh)):null,
      button(active?'work_complete':'work_reopen',()=>openWorkItemTransition(ctx,{row,operation:active?'complete':'reopen',onDone:refresh})),
    ]):null,
  ]);
}
function pager(res,page,go) {
  return h('div',{class:'opp-pagination'},[
    h('span',{},t('opp_total_count')+' '+res.total+' · '+t('opp_page')+' '+page),
    h('div',{},[h('button',{type:'button',class:'btn btn-ghost',disabled:page<=1,onclick:()=>go(page-1)},t('btn_prev')),
      h('button',{type:'button',class:'btn btn-ghost',disabled:!res.hasMore,onclick:()=>go(page+1)},t('btn_next'))]),
  ]);
}
function chooseAction(ctx,scope,done) {
  const sheet=openSheet({title:t('ac_link'),body:h('div')});
  document.body.append(sheet.overlay);
  const keyword=h('input',{class:'sheet-input',type:'search',placeholder:t('ac_search'),maxlength:100});
  const host=h('div',{});let page=1,query='',cancel=()=>{};
  function load() {
    cancel();
    cancel=loadInto(host,async()=>{
      const res=await data.actionCenter(ctx,{...scope,view:'choose',page,keyword:query});
      return h('div',{},[
        ...res.rows.map(row=>h('button',{type:'button',class:'btn btn-soft',onclick:()=>{
          cancel();previewContext(ctx,sheet,{operation:'link',actionId:row.id,...scope},done,edit);
        }},row.person_name+' · '+row.title+' #'+row.id)),
        !res.rows.length?emptyNote(t('ac_empty')):null,pager(res,page,p=>{page=p;load();}),
      ]);
    });
  }
  function search(){query=keyword.value.trim();page=1;load();}
  keyword.onkeydown=e=>{if(e.key==='Enter')search();};
  function edit(){sheet.swap(h('div',{},[h('div',{class:'toolbar'},[keyword,button('btn_search',search)]),host]));load();}
  edit();
}

export function actionContextPanel(ctx,scope,onChanged,originalPlan) {
  const host=h('div',{}); let page=1,cancel=()=>{};
  function done(){load();onChanged?.();}
  function load(){
    cancel();
    cancel=loadInto(host,async()=>{
      const res=await data.actionCenter(ctx,{...scope,view:'linked',page});
      const create=()=>openWorkItemEditor(ctx,{kind:'action',personId:res.personId || null,
        personName:res.personName || '',onDone:saved=>{
          done();
          if(!saved?.itemId || scope.kind==='person')return;
          const sheet=openSheet({title:t('ac_created_link'),body:h('div')});
          document.body.append(sheet.overlay);
          const review=()=>previewContext(ctx,sheet,{operation:'link',actionId:saved.itemId,...scope},done,review);
          review();
        }});
      return h('div',{},[
        h('div',{class:'toolbar'},[button('create_action',create),scope.kind==='person'?null:button('ac_link',()=>chooseAction(ctx,scope,done))]),
        ...(res.rows.length?res.rows.map(r=>actionRow(ctx,r,done,true)):[
          emptyNote(t('ac_no_linked'), originalPlan ? [originalPlan.next_action,originalPlan.next_action_date].filter(Boolean).join(' · ') : ''),
        ]),
        res.total>20?pager(res,page,p=>{page=p;load();}):null,
      ]);
    });
  }
  load();return card({title:t('ac_related'),icon:'check',body:host});
}

export function renderActionCenter(ctx,section) {
  const host=h('div',{}), tabs=h('div',{class:'toolbar',role:'group','aria-label':t('ac_title')});
  const actionId=/^[1-9]\d*$/.test(section||'') ? section : null;
  const view=actionId?'item':views.includes(section)?section:'today';
  let page=1,cancel=()=>{};
  function load() {
    cancel();
    for(const tab of tabs.children)tab.setAttribute('aria-pressed',String(tab.dataset.view===view));
    cancel=loadInto(host,async()=>{
      const res=await data.actionCenter(ctx,{view,page,...(view==='item'?{actionId}:{})});
      if(!res.rows.length && page>1){page--;load();return h('div');}
      return h('div',{},[...(res.rows.length?res.rows.map(r=>actionRow(ctx,r,load,true)):[emptyNote(t('ac_empty'))]),
        pager(res,page,p=>{page=p;load();})]);
    });
  }
  for(const key of views)tabs.append(h('button',{class:'btn btn-soft',type:'button','data-view':key,
    onclick:()=>{location.hash='#/actions/'+key;}},t('ac_'+key)));
  ctx.main.replaceChildren(pageHead({title:t('ac_title'),actions:[button('create_action',()=>openWorkItemEditor(ctx,{kind:'action',onDone:load}))]}),
    tabs,card({body:host}));
  load();
}
