import {h} from './dom.js';
import {t} from './i18n.js';
import {data} from './data.js';

export function wordImport(ctx,results,status,onChange){
 const label=key=>t('dw_'+key);
 const call=(op,input)=>data.knowledgeLibrary(ctx,'manualDocx',{manualOperation:op,data:input});
 let generation=0;
 function reset(){generation++;results.replaceChildren();status.textContent='';}
 function action(key,handler){
  return h('button',{type:'button',class:'btn btn-ghost',onclick:async event=>{
   const btn=event.currentTarget;btn.disabled=true;
   try{await handler();}catch{status.textContent=label('error');}finally{btn.disabled=false;}
  }},label(key));
 }
 async function review(id){
  reset();
  const ticket=generation;status.textContent=label('processing');
  const preview=await call('preview',{id});
  if(ticket!==generation)return;
  if(preview.status==='pending'){
   status.textContent=label('pending_'+preview.reason);
   results.append(action('retry',()=>review(id)));return;
  }
  const rows=preview.rows,counts={new:0,update:0,skip:0,ambiguous:0};
  rows.forEach(row=>counts[row.action]++);
  status.textContent=[label(preview.mode),...Object.entries(counts).map(([key,n])=>label(key)+' '+n),
    label('uncovered')+' '+preview.uncovered].join(' · ');
  const selected=new Map();
  for(const [index,row] of rows.entries()){
   const previous=h('div',{}),incoming=h('div',{},[h('strong',{},label('incoming')),h('pre',{},row.entry.content)]);
   const comparison=row.action!=='skip'&&row.matches.length?h('div',{class:'kc-edit-grid'},[previous,incoming]):incoming;
   const section=h('details',{},[h('summary',{},label(row.action)+' · '+row.entry.title),h('p',{},row.entry.origin),
    h('p',{},[t('kr_'+row.entry.kind),...(row.entry.keywords||[])].join(' · ')),comparison]);
   if(row.action!=='skip'){
    const select=h('select',{'aria-label':label('decision')+' '+row.entry.title,onchange:()=>{
     if(select.value)selected.set(index,select.value);else selected.delete(index);
    }},h('option',{value:''},label('omit')));
    if(row.action!=='update')select.append(h('option',{value:'new'},label('new')));
    for(const match of row.matches){
     select.append(h('option',{value:match.id},label('update')+' #'+match.id+' '+match.title));
     previous.append(h('strong',{},label('existing')+' #'+match.id+' '+match.title),h('pre',{},match.content));
    }
    if(row.action!=='ambiguous'){
     select.value=row.action==='new'?'new':row.matches[0].id;
     selected.set(index,select.value);
    }
    section.append(h('label',{},[label('decision'),select]));
   }
   results.append(section);
  }
  if(counts.skip===rows.length)return;
  results.append(action('confirm',async()=>{
   const choices=[...selected].map(([index,target])=>({index,target}));
   if(!choices.length){status.textContent=label('empty');return;}
   if(!window.confirm(label('confirm_count').replace('{count}',String(choices.length))))return;
   try{
    const saved=await call('confirm',{id,previewId:preview.previewId,choices});
    if(ticket!==generation)return;
    reset();status.textContent=label('done').replace('{added}',saved.added).replace('{revised}',saved.revised);
    await onChange();
   }catch{
    if(ticket!==generation)return;
    status.textContent=label('stale');results.replaceChildren(action('retry',()=>review(id)));
   }
  }));
 }
 async function upload(file){
  reset();
  const ticket=generation;
  if(!file.size||file.size>2*1024*1024){status.textContent=label('limit');return;}
  status.textContent=label('processing');
  const original=await new Promise((resolve,reject)=>{
   const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);
   reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);
  });
  const job=await call('stage',{filename:file.name,original});
  if(ticket===generation)await review(job.id);
 }
 const recent=action('recent',async()=>{
  reset();const ticket=generation,reply=await call('recent',{});
  if(ticket!==generation)return;
  if(!reply.rows.length){status.textContent=label('none');return;}
  for(const row of reply.rows){
   const btn=action('retry',()=>review(row.id));btn.textContent=row.filename;
   results.append(btn);
  }
 });
 return {upload,recent,reset};
}
