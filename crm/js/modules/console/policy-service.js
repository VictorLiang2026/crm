import { h } from './dom.js';
import { data } from './data.js';
import { t } from './i18n.js';
import { emptyNote, loadInto } from './ui.js';
import { openSheet } from './write.js';

const request = (ctx,operation,payload) => data.policyService(ctx,operation,payload);
const btn = (key,onclick,primary=false) => h('button',{type:'button',class:'btn btn-sm '+(primary?'btn-primary':'btn-soft'),onclick},t(key));
const note = text => h('p',{class:'sheet-note'},text);
function verify(title,lines,save,done) {
  const confirm=btn('confirm_write',async()=>{
    confirm.disabled=true;
    try {await save(); sheet.overlay.remove(); done();}
    catch(error){sheet.showErr(error.message==='POLICY_REFRESH'?t('policy_changed'):error.message);confirm.disabled=false;}
  },true);
  const sheet=openSheet({title:t(title),body:h('div',{},[...lines.map(note),h('div',{class:'sheet-actions'},[
    btn('cancel',()=>sheet.overlay.remove()),confirm,
  ])])});
  document.body.append(sheet.overlay);
}

export function reviewControls(ctx,report,reload) {
  const host=h('div',{class:'policy-governance'});
  loadInto(host,async()=>{
    const payload={customerId:String(report.customer_id),reportId:String(report.id)};
    const state=await request(ctx,'state',payload);
    if(String(report.review_revision)!==String(state.review_revision)) return h('div',{},[note(t('policy_changed')),btn('insurance_report_reload',reload)]);
    const status=state.is_current?'policy_current':!state.reviewed_at?'policy_unreviewed':!state.product_basis?'policy_no_basis':
      state.review_basis!==state.product_basis?'policy_stale':'policy_reviewed';
    const basis=state.product_basis || t('policy_no_basis');
    function decide(operation,key){
      verify(key,[t('insurance_report_id')+' #'+report.id+' · '+(report.report_date||t('no_date')),
        t('insurance_report_input_version')+' · '+(report.input_products_version??t('insurance_report_not_recorded')),
        t('policy_basis')+' · '+basis, report.edited_summary||report.summary||t('insurance_report_empty')],
        ()=>request(ctx,operation,{...payload,revision:state.review_revision,basis:state.product_basis}),reload);
    }
    return h('div',{},[
      note([t('policy_source')+' · '+t('insurance_report_title')+' #'+report.id,t(status),
        t(state.is_valid?'policy_effective':'policy_inactive')].join(' | ')),
      state.reviewed_at?note(t('policy_reviewed_on')+' · '+String(state.reviewed_at).slice(0,10)):null,
      h('div',{class:'toolbar'},[
        state.is_valid && !state.is_current ? btn('policy_approve',()=>decide('approve','policy_approve')):null,
        btn(state.is_valid?'policy_deactivate':'policy_activate',()=>decide(state.is_valid?'deactivate':'activate',state.is_valid?'policy_deactivate':'policy_activate')),
      ]),
    ]);
  });
  return host;
}

export function policySchedules(ctx,customerId) {
  const host=h('section',{class:'policy-schedules'});
  const day=h('input',{type:'date',class:'sheet-input','aria-label':t('field_due')});
  const kind=h('select',{class:'sheet-select','aria-label':t('policy_service')},['review','renewal'].map(k=>h('option',{value:k},t('policy_'+k))));
  const title=h('input',{type:'text',class:'sheet-input',maxlength:200,placeholder:t('field_title'),'aria-label':t('field_title')});
  const error=note('');
  const preview=btn('generate_preview',async()=>{
    if(!day.value){error.textContent=t('policy_date_required');return;}
    preview.disabled=true;error.textContent='';
    try {
      const result=await request(ctx,'schedule',{customerId,kind:kind.value,day:day.value,title:title.value.trim()||t('policy_'+kind.value),requestId:crypto.randomUUID()});
      verify('policy_service',[result.preview.personName,t('policy_'+result.kind)+' · '+result.day,result.preview.after.title],
        ()=>request(ctx,'confirmSchedule',{previewId:result.previewId}),()=>{title.value='';day.value='';load();});
    } catch(e){error.textContent=e.message;} finally{preview.disabled=false;}
  });
  const rows=h('div',{});
  function load(){loadInto(rows,async()=>{
    const result=await request(ctx,'scheduleList',{customerId});
    return h('div',{},result.rows.map(r=>h('div',{class:'list-row'},h('a',{href:'#/actions/'+r.id},
      t('policy_'+r.service_kind)+' · '+r.title+' · '+(r.due_at?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date(r.due_at)):t('no_date'))))));
  });}
  host.append(h('h3',{},t('policy_service')),rows,h('div',{class:'toolbar'},[kind,day,title,preview]),error);
  load();return host;
}

export function opportunityReports(ctx,opportunityId) {
  const host=h('div',{class:'policy-opportunity-reports'});
  function load(){loadInto(host,async()=>{
    const {rows}=await request(ctx,'options',{opportunityId});
    return h('div',{},[h('h3',{},t('policy_references')),...(rows.length?rows.map(r=>h('div',{class:'list-row'},[
      h('div',{style:'flex:1;min-width:0'},[h('b',{},'#'+r.id+' · '+(r.date||t('no_date'))),note(r.current?r.summary:t('policy_reference_historical'))]),
      r.linked?note(t('policy_linked')):btn('policy_link',()=>verify('policy_link',['#'+r.id+' · '+r.date,r.summary],
        ()=>request(ctx,'link',{opportunityId,reportId:r.id,revision:r.revision,basis:r.basis}),load)),
    ])):[emptyNote(t('policy_no_refs'))])]);
  });}
  load();return host;
}
