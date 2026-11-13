import { h } from './dom.js';
import { t } from './i18n.js';
import { data } from './data.js';

const blockSize=393216;
const tr=id=>t('kg_doc_'+id);
const api=(ctx,op,input)=>data.knowledgeLibrary(ctx,op,{data:input});
export const documentOf=row=>row.metadata?.document||row.document||{};
function volumeNumber(number, part) {
  const id = String(number);
  // The registry starts at 100001. Keep later series distinct when four digits run out.
  const prefix = /^10\d{4}$/.test(id) ? id.slice(2) : id.padStart(4, '0');
  return prefix + '-' + String(part).padStart(2, '0');
}
export function documentNumber(row){
  const doc=documentOf(row);
  return doc.part?volumeNumber(doc.number,doc.part):String(doc.number||row.id);
}
export function aliases(row){
  const prefix={knowledge_items:'K',playbooks:'P',knowledge_sources:'S'}[row.table];
  return [prefix+'-'+row.id,...(row.source_id?['S-'+row.source_id]:[])];
}
export function groupRows(rows){
  const result=[],groups=new Map();
  for(const row of rows){
    const doc=documentOf(row);
    if(!doc.total){result.push(row);continue;}
    let group=groups.get(doc.number);
    if(!group){
      group={id:doc.number,table:'document',source:doc.title,document:doc,children:[],updated_at:row.updated_at};
      groups.set(doc.number,group);result.push(group);
    }
    group.children.push(row);
    if((row.updated_at||'')>(group.updated_at||''))group.updated_at=row.updated_at;
  }
  for(const group of groups.values())group.children.sort((a,b)=>documentOf(a).part-documentOf(b).part);
  return result;
}
export async function archivePdf(ctx,file,title,pages){
  const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
  const sha256=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  const doc=await api(ctx,'documentBegin',{sha256,title,name:file.name,size:file.size,pages});
  if(!doc?.documentId)throw Error(tr('unavailable'));
  if(!doc.ready){
    for(let start=0,part=0;start<file.size;start+=blockSize,part++){
      const bytes=new Uint8Array(await file.slice(start,start+blockSize).arrayBuffer());
      let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
      await api(ctx,'documentChunk',{id:doc.documentId,part,data:btoa(raw)});
    }
    await api(ctx,'documentComplete',{id:doc.documentId});
  }
  return doc.documentId;
}
async function download(ctx,id){
  let total,filename,received=0;const chunks=[];
  for(let part=0;total===undefined||received<total;part++){
    const r=await api(ctx,'documentOriginal',{id,part});
    if(!Number.isInteger(r.total)||r.total<=0||r.total>100000000||(total!==undefined&&total!==r.total))throw Error(tr('unavailable'));
    total=r.total;filename=r.name;
    const bytes=Uint8Array.from(atob(r.data),c=>c.charCodeAt(0));
    if(bytes.length!==Math.min(blockSize,total-received))throw Error(tr('unavailable'));
    chunks.push(bytes);received+=bytes.length;
  }
  const url=URL.createObjectURL(new Blob(chunks,{type:'application/pdf'}));
  const link=h('a',{href:url,download:filename});link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
export function groupHeader(ctx,group,expanded,toggle){
  const doc=group.document,parts=new Set(group.children.map(r=>documentOf(r).part));
  const row=h('tr',{'data-document-number':String(doc.number)},[
    h('td',{class:'kg-number-cell'},String(doc.number)),h('td',{},h('b',{},doc.title)),
    h('td',{},tr('type')),h('td',{colspan:4},tr('volumes')+' '+parts.size+'/'+doc.total),
    h('td',{},h('button',{class:'btn btn-ghost btn-sm','aria-expanded':String(expanded),onclick:toggle},tr(expanded?'collapse':'open')))
  ]);return row;
}
export function overviewRow(ctx,id){
  const panel=h('div',{class:'kg-document-overview',role:'region'},tr('loading'));
  const button=(label,fn)=>h('button',{class:'btn btn-ghost btn-sm',onclick:async e=>{
    const b=e.currentTarget;b.disabled=true;try{await fn();}catch(err){ctx.toast(err.message||tr('unavailable'),'error');}finally{b.disabled=false;}
  }},tr(label));
  const draw=overview=>{
    const list=overview.parts||[];
    panel.replaceChildren(h('h3',{},tr('overview')),h('p',{},tr('coverage')+' '+(list.map(r=>r.start+'–'+r.end).join(', ')||'—')+' / '+overview.pages),
      ...list.map(r=>h('p',{},[h('b',{},volumeNumber(id,r.part)+' · '+r.start+'–'+r.end+' '),r.summary])));
    if(overview.originalReady)panel.append(button('original',()=>download(ctx,id)));
    panel.append(h('h3',{},tr('gpt')),h('p',{},overview.needsReview?tr('stale'):(overview.gpt||tr('empty'))));
    const edit=async generate=>{
      const initial=generate?(await api(ctx,'documentDraft',{id,basis:overview.basis})).summary:overview.gpt;
      const field=h('textarea',{rows:'6',maxlength:12000,'aria-label':tr('gpt')});field.value=initial||'';
      const editor=h('div',{},[field,button('saveGpt',async()=>draw(await api(ctx,'documentGpt',{id,basis:overview.basis,version:overview.gptVersion,summary:field.value})))]);
      panel.querySelector('textarea')?.parentElement.remove();panel.append(editor);field.focus();
    };
    if(list.length)panel.append(button('generate',()=>edit(true)),button('editGpt',()=>edit(false)));
  };
  const load=()=>api(ctx,'documentOverview',{id}).then(draw).catch(()=>panel.replaceChildren(button('retry',load)));
  void load();
  return h('tr',{},h('td',{colspan:8},panel));
}
