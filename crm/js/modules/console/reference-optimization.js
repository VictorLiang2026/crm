import {h} from './dom.js';
import {t} from './i18n.js';
import {data} from './data.js';
import {versionSelector} from './reference-version-selector.js';
const label=key=>t('ro_'+key);
export function referenceOptimization(ctx,{dialog,onChange,onRowChange,status,legacyHistory}){
 const call=(op,payload={})=>data.knowledgeLibrary(ctx,'referenceOptimization',{referenceOperation:op,data:payload});
 let states=new Map(),selected=new Set();
 const selector=versionSelector({call,onSaved:onRowChange,setState:s=>states.set(String(s.entry_id),s)});
 const action=(key,work,primary=false)=>h('button',{type:'button',class:'btn '+(primary?'btn-primary':'btn-ghost'),title:label(key),onclick:async e=>{
  const btn=e.currentTarget,prior=btn.textContent;btn.disabled=true;btn.textContent=label('working');
  try{await work();}catch{status.textContent=label('error');}finally{btn.disabled=false;btn.textContent=prior;}
 }},label(key));
 const field=(key,input)=>h('label',{class:'kr-field'},[h('span',{},label(key)),input]);
 const feedback=async(panel,work)=>{const note=h('p',{role:'status'});panel.append(note);try{await work();}catch{note.textContent=label('error');}};
 async function load(){const r=await call('states');states=new Map(r.rows.map(row=>[String(row.entry_id),row]));}
 const state=row=>states.get(String(row.id))||{};
 const flag=(row,lane)=>{
  const input=h('input',{type:'checkbox',checked:!!state(row)['want_'+lane],onchange:async()=>{
   input.disabled=true;try{await call('flags',{ids:[row.id],lane,enabled:input.checked});await onChange();}catch{input.checked=!input.checked;status.textContent=label('error');}finally{input.disabled=false;}
  }});
  return h('label',{class:'ro-flag',title:label('flag_hint')},[input,h('span',{},label(lane))]);
 };
 function cell(row){const s=state(row);return h('div',{class:'ro-flags'},[flag(row,'system'),flag(row,'gpt'),
  ...(s.pinned?[h('small',{},label('pinned'))]:[]),...(Number(s.newCount)>0?[h('small',{class:'ro-new'},label('candidates').replace('{n}',s.newCount))]:[])]);}
 function select(row){return h('input',{type:'checkbox','aria-label':label('choose')+' '+row.scenario,checked:selected.has(row.id),onchange:e=>{
  if(e.target.checked)selected.add(row.id);else selected.delete(row.id);drawBulk();
 }});}
 const bulk=h('div',{class:'ro-bulk'});
 function drawBulk(){bulk.replaceChildren();if(!selected.size)return;
  bulk.append(h('span',{},label('selected').replace('{n}',selected.size)));
  for(const lane of ['system','gpt'])for(const enabled of [true,false])bulk.append(action((enabled?'mark_':'clear_')+lane,async()=>{
   const ids=[...selected];for(let at=0;at<ids.length;at+=500)await call('flags',{ids:ids.slice(at,at+500),lane,enabled});await onChange();
  }));
 }
 async function preferences(){const {panel}=dialog(label('preferences')),r=await call('preferences');
  const input=h('textarea',{rows:6,maxlength:3000},r.body);panel.append(field('preferences_hint',input),action('save',()=>feedback(panel,async()=>{await call('preferences',{body:input.value});panel.append(h('p',{role:'status'},label('saved')));})));
 }
 async function versions(row){
  const {panel}=dialog(row.scenario+' · '+label('versions')),list=h('div',{});panel.append(h('p',{},label('version_hint')),list);
  let beforeId,hasMore,current;
  async function draw(reset=false){
   if(reset){beforeId=undefined;list.replaceChildren();}
   const r=await call('versions',{id:row.id,...(beforeId?{beforeId}:{})});current=r.state;hasMore=r.hasMore;beforeId=r.beforeId;
   for(const v of r.rows){
    const item=h('details',{},[h('summary',{},`${label('source_'+v.source)} · #${v.id} · ${new Date(v.created_at).toLocaleString()}${String(v.id)===String(current.current_id)?' · '+label('current'):!v.confirmed?' · '+label('candidate'):''}`),
     h('h3',{},v.title),h('pre',{},v.content),h('p',{},v.note||''),h('small',{},v.origin||'')]);
    const choose=action('use_version',()=>feedback(panel,async()=>{await call('select',{versionId:v.id,expectedCurrentId:current.current_id,pin:true});await onChange();await draw(true);}));
    choose.disabled=String(v.id)===String(current.current_id);
    item.append(choose,action('edit_version',async()=>{
     const edit=dialog(label('edit_version')),title=h('input',{maxlength:160,value:v.title,required:true}),content=h('textarea',{rows:12,maxlength:4000,required:true},v.content),note=h('textarea',{rows:2,maxlength:2000});
     const expected=current.current_id;
     edit.panel.append(field('title',title),field('content',content),field('note',note),h('p',{},label('edit_hint')),action('save_use',()=>feedback(edit.panel,async()=>{
      await call('edit',{versionId:v.id,expectedCurrentId:expected,title:title.value,content:content.value,note:note.value});edit.close();await onChange();await draw(true);
     }),true));
    }));list.append(item);
   }
   more.hidden=!hasMore;
  }
  const more=action('more',()=>draw()),instruction=h('textarea',{rows:3,maxlength:1000},state(row).instruction||'');
  panel.append(more,action('latest',()=>feedback(panel,async()=>{await call('select',{versionId:current.current_id,expectedCurrentId:current.current_id,latest:true,pin:false});await onChange();await draw(true);})),
   field('instruction',instruction),action('save_instruction',()=>feedback(panel,async()=>{await call('instruction',{id:row.id,body:instruction.value});await onChange();})),
   action('legacy_history',()=>legacyHistory(row)));
  await draw();
 }
 async function review(){
  const r=await call('adoptPreview'),{panel,close}=dialog(label('review'));
  panel.append(h('p',{},label('review_hint')));
  if(!r.rows.length){panel.append(h('p',{},label('no_candidates')));return;}
  const ids=new Set(r.rows.map(row=>row.versionId));
  for(const row of r.rows){const checked=h('input',{type:'checkbox',checked:true,onchange:()=>{if(checked.checked)ids.add(row.versionId);else ids.delete(row.versionId);}});
   panel.append(h('details',{},[h('summary',{},[checked,h('span',{},row.title)]),h('div',{class:'kc-edit-grid'},[
    h('div',{},[h('strong',{},label('before')),h('pre',{},row.before)]),h('div',{},[h('strong',{},label('after')),h('pre',{},row.after)])]),h('p',{},row.note||'')]));
  }
  panel.append(action('adopt',()=>feedback(panel,async()=>{
   if(!ids.size)return;
   await call('adoptConfirm',{previewId:r.previewId,ids:[...ids]});await onChange();close();status.textContent=label('adopted');
  }),true));
 }
 async function jobs(){
  const {panel}=dialog(label('jobs')),body=h('div',{});panel.append(body);let offset=0;
  async function refresh(reset=true){if(reset){offset=0;body.replaceChildren();}const r=await call('jobs',{offset});
   body.append(h('p',{},Object.entries(r.counts||{}).map(([key,n])=>label('job_'+key)+' '+n).join(' · ')));
   for(const row of r.rows)body.append(h('div',{class:'ro-job'},[h('span',{},`${row.entry_id?'#'+row.entry_id+' · ':''}${label('lane_'+row.lane)} · ${label('job_'+row.status)}`),
    ...(row.last_error?[h('small',{},row.last_error)]:[]),...(row.status==='failed'?[action('retry',async()=>{await call('retry',{jobId:row.id});await refresh();})]:[])]));
   offset=r.nextOffset;more.hidden=!r.hasMore;
  }
  const more=action('more',()=>refresh(false));panel.append(action('refresh',()=>refresh()),more);await refresh();
 }
 const tools=h('div',{class:'ro-tools'},[action('optimize',async()=>{
  const r=await call('start',{lane:'system',requestId:crypto.randomUUID()});status.textContent=label('started').replace('{n}',r.selected);await onChange();
 },true),action('review',review),action('jobs',jobs),h('details',{class:'ro-options'},[h('summary',{},label('options')),
  action('preferences',preferences),h('p',{},label('gpt_hint'))]),bulk]);
  return {load,tools,cell,select,versionCell:row=>selector.cell(row,state(row)),versions:row=>versions(row)};
}
