import {h} from './dom.js';
import {t} from './i18n.js';
import {readRosterFile,mapMappedValues,toCsv} from './person-list-transfer-file.js';
const fields=['display_name','school','wechat','phone','organization','industry','graduation_year','other_info'];
const shared=['display_name','wechat','phone','organization'];
const tr=k=>t('roster_'+k);
const btn=(label,fn,primary=false)=>h('button',{type:'button',class:'btn '+(primary?'btn-primary':'btn-ghost'),onclick:fn},label);
const sel=(items,value='')=>h('select',{},items.map(([v,label])=>h('option',{value:v,selected:String(v)===String(value)},label)));
const stack=(...nodes)=>h('div',{class:'tab-stack'},nodes);
const bar=(...nodes)=>h('div',{class:'button-row'},nodes);
const box=(label,node)=>h('label',{class:'field-stack'},[h('span',{},label),node]);
const card=(...nodes)=>h('div',{class:'card card-body'},nodes);
const aliases={display_name:['姓名','姓名或称呼','名字','name','full name','display_name'],school:['学校','毕业学校','院校','university','school'],wechat:['微信','微信号','wechat'],phone:['手机','手机号码','电话','手机号','联系电话','phone','mobile'],organization:['公司','工作单位','单位','company','organization'],industry:['行业','industry'],graduation_year:['毕业年份','毕业年','graduation year'],other_info:['备注','其他信息','notes','other information']};
const errors={ROSTER_INVALID:'invalid',ROSTER_YEAR:'year',ROSTER_CONFLICT:'conflict',ROSTER_DUPLICATE_ROW:'dup',ROSTER_IDENTITY:'chooseIdentity',ROSTER_EMPTY:'noneSelected',ROSTER_ALREADY_LINKED:'otherLinked',ROSTER_ACTIVITY:'activityMissing',ROSTER_EXPIRED:'expired',INVALID_NAME:'invalid',FILE_NO_HEADERS:'invalid'};
function call(ctx,operation,data){return ctx.api.call('person_360',{action:'activityRoster',operation,data}).then(r=>{if(r?.error)throw Error(r.error);return r;});}
function safe(fn,err){return async e=>{const button=e?.currentTarget;if(button)button.disabled=true;try{err.textContent='';await fn();}catch(x){err.textContent=tr(errors[x.message]||'failed');}finally{if(button)button.disabled=false;}};}
function pager(page,total,load){return bar(page>1?btn(tr('prev'),()=>load(page-1)):null,page*50<total?btn(tr('next'),()=>load(page+1)):null);}
export function rosterHistory(ctx,id,person=false){
 const host=stack();const load=async(page=1)=>{try{const r=await call(ctx,person?'personHistory':'history',person?{personId:id,page}:{id,page});host.replaceChildren(h('h3',{},tr('eventHistory')+' · '+r.total),...r.rows.map(a=>h('div',{class:'list-row'},[h('a',{href:'#/activity/'+a.id},a.name),h('span',{class:'row-sub'},[a.activity_date,a.location].filter(Boolean).join(' · '))])),pager(page,r.total,load));}catch{host.textContent=tr('failed');}};load();return host;
}
export function renderRoster(ctx,preset=''){
 const host=stack(),nav=bar(),body=stack(),err=h('p',{role:'status',class:'foot-note'});let mode='event',activity=String(preset||''),events=[],term='',filter='',serial=0;
 const activityName=()=>events.find(a=>String(a.id)===activity)?.name||'';
 function showNav(){nav.replaceChildren(btn(tr('byEvent'),()=>{mode='event';list();},mode==='event'),btn(tr('directory'),()=>{mode='directory';list();},mode==='directory'));}
 async function preview(operation,rows,file='',back=()=>list()){
  const aid=['import','remove'].includes(operation)?activity:null;const p=await call(ctx,'prepare',{operation,rows,file,activityId:aid});
  const summary=p.rows.map(r=>h('div',{class:'list-row'},[h('strong',{},r.values.display_name),h('span',{class:'row-sub'},[r.personId?'Person #'+r.personId:r.id?tr('reuse')+' #'+r.id:r.choice==='different'?tr('differentPerson'):tr('independent'),...Object.entries(r.changes||{}).map(([k,v])=>tr(k)+' · '+v),...(r.renameExisting||[]).map(x=>tr('renameExisting')+' · '+x.displayName)].join(' · '))]));
  body.replaceChildren(card(h('h3',{},tr('review')+' · '+tr(({import:'importAction',edit:'editAction',remove:'remove',createPerson:'createPerson',link:'link',unlink:'unlink'})[operation])),aid?h('p',{},activityName()+' #'+aid):null,h('p',{},[file,p.rows.length].filter(Boolean).join(' · ')),operation==='import'?h('p',{},tr('added')+' '+p.newCount+' · '+tr('existing')+' '+p.existing):null,...summary,bar(btn(tr('cancel'),back),btn(tr('confirm'),safe(async()=>{const result=await call(ctx,'confirm',{previewId:p.previewId});await list();err.textContent=tr('done')+(operation==='import'?' · '+tr('added')+' '+result.added+' · '+tr('existing')+' '+(result.processed-result.added):'');},err),true))));
 }
  async function detail(id){
  const r=await call(ctx,'profile',{id});if(!r)throw Error('ROSTER_CONFLICT');
  const inputs=Object.fromEntries(fields.map(f=>{const node=h(f==='other_info'?'textarea':'input',{disabled:r.person_id&&shared.includes(f),inputmode:f==='graduation_year'?'numeric':undefined});node.value=r[f]??'';return [f,node];}));
  const draft=()=>Object.fromEntries(fields.map(f=>[f,inputs[f].value]));
  const row=v=>({id:r.id,version:r.version,values:v});const actions=bar();
  const editor=card(h('h3',{},tr('edit')),h('div',{class:'grid-2'},fields.map(f=>box(tr(f),inputs[f]))),btn(tr('preview'),safe(()=>preview('edit',[row(draft())],'',()=>detail(id)),err),true),actions);
  if(r.person_id)actions.append(h('a',{class:'btn btn-ghost',href:'#/person/'+r.person_id},tr('personEdit')+' #'+r.person_id),btn(tr('unlink'),safe(()=>preview('unlink',[row(r)],'',()=>detail(id)),err)));
  else{
   const query=h('input',{value:r.display_name}),matches=stack();
   actions.append(box(tr('qualify'),query),btn(tr('lookup'),safe(async()=>{const value={...r,display_name:query.value};const found=await call(ctx,'analyze',{rows:[row(value)]});const item=found.rows[0];matches.replaceChildren(...item.candidates.map(p=>btn(tr('link')+' · '+p.display_name+' #'+p.id+' '+(p.organization||''),safe(()=>preview('link',[{...row(value),personId:p.id}],'',()=>detail(id)),err))),btn(tr('createPerson'),safe(()=>preview('createPerson',[row(value)],'',()=>detail(id)),err)));},err)),matches);
  }
  body.replaceChildren(btn(tr('back'),()=>list()),editor,rosterHistory(ctx,id));
 }
 async function importFile(file){
  const table=await readRosterFile(file);const mappings=table.headers.map(header=>sel([['__skip__',tr('ignore')],...fields.map(f=>[f,tr(f)])],fields.find(f=>aliases[f].includes(header.trim().toLowerCase()))||'__skip__'));
  const mapUI=card(h('h3',{},tr('mapping')+' · '+activityName()),h('p',{},file.name+' · '+table.rows.length),h('div',{class:'grid-2'},table.headers.map((header,i)=>box(header,mappings[i]))));
  const matches=stack();
  async function analyze(rows){
   const analysis=await call(ctx,'analyze',{activityId:activity,rows});const decisions=[];
   const normalizeName=value=>String(value||'').replace(/[（]/g,'(').replace(/[）]/g,')').replace(/\s+/g,' ').trim().toLowerCase();
   const fileNameCounts=new Map();for(const row of rows){const key=normalizeName(row.values?.display_name);fileNameCounts.set(key,(fileNameCounts.get(key)||0)+1);}
   const nodes=analysis.rows.map((r,rowIndex)=>{
    const fullName=normalizeName(r.values.display_name),duplicateFile=(fileNameCounts.get(fullName)||0)>1;
    const relatedProfiles=r.profiles.filter(p=>p.person_id==null),exactProfiles=relatedProfiles.filter(p=>normalizeName(p.display_name)===fullName);
    const exactCandidates=r.candidates.filter(p=>normalizeName(p.display_name)===fullName);
    const exactCount=exactCandidates.length+exactProfiles.length;
    const uniqueExact=exactCount===1?(exactCandidates.length?{type:'person',row:exactCandidates[0]}:{type:'profile',row:exactProfiles[0]}):null;
    const initial=!duplicateFile&&uniqueExact?(uniqueExact.type==='person'?'p':'r')+uniqueExact.row.id:(r.candidates.length||relatedProfiles.length?'':'new');
    const choices=sel([...relatedProfiles.map(p=>['r'+p.id,tr('reuse')+' #'+p.id+' '+[p.display_name,p.school,p.organization,p.wechat,p.phone].filter(Boolean).join(' · ')]),...r.candidates.map(p=>['p'+p.id,'Person #'+p.id+' '+[p.display_name,p.organization,p.phone,p.wechat].filter(Boolean).join(' · ')]),['new',tr('independent')],['skip',tr('skip')]],initial);
    const exact=r.hasMore?h('input',{type:'text',inputmode:'numeric',placeholder:tr('personId')}):null;
    const changed=stack(),decisionHelp=stack();let picks=[];const sameConfirmed=h('input',{type:'checkbox',checked:!!uniqueExact&&!duplicateFile});
    const compare=()=>{picks=[];changed.replaceChildren();decisionHelp.replaceChildren();let p=choices.value[0]==='r'?r.profiles.find(x=>String(x.id)===choices.value.slice(1)):r.profiles.find(x=>x.person_id&&'p'+x.person_id===choices.value);if(!p)return;
     for(const f of fields.filter(k=>k!=='display_name'&&r.values[k]&&String(p[k]??'')!==r.values[k])){const cb=h('input',{type:'checkbox',disabled:p.person_id&&shared.includes(f)});changed.append(box(tr(f)+' · '+(p[f]||'—')+' → '+r.values[f],bar(cb,h('span',{},p.person_id&&shared.includes(f)?tr('personEdit'):tr('accept')))));picks.push([f,cb]);}};
    const hasRelated=relatedProfiles.length>0||r.candidates.length>0;
    const manualConfirmed=h('input',{type:'checkbox'});
    const renderDecision=()=>{decisionHelp.replaceChildren();if(duplicateFile)decisionHelp.append(h('p',{class:'act-warning'},tr('duplicateFile')));if(hasRelated&&!uniqueExact)decisionHelp.append(h('p',{class:'act-warning'},tr('ambiguousName')));if((duplicateFile||(hasRelated&&!uniqueExact))&&choices.value!=='skip')decisionHelp.append(box(tr('confirmManualReview'),manualConfirmed));if(['p','r'].includes(choices.value[0]))decisionHelp.append(h('p',{class:'row-sub'},tr('samePersonPrompt')),box(tr('confirmSame'),sameConfirmed));};
    choices.onchange=()=>{sameConfirmed.checked=false;compare();renderDecision();};compare();renderDecision();
    decisions.push(()=>{const v=exact?.value.trim()?'p'+exact.value.trim():choices.value;if(!v)throw Error('ROSTER_IDENTITY');if(v!=='skip'&&(duplicateFile||(hasRelated&&!uniqueExact))&&!manualConfirmed.checked)throw Error('ROSTER_IDENTITY');const base={number:r.number,values:r.values,updateFields:picks.filter(([,c])=>c.checked).map(([k])=>k)};
     if(['p','r'].includes(v[0])){if(!sameConfirmed.checked)throw Error('ROSTER_IDENTITY');return {...base,choice:v[0]==='r'?'profile':'person',...(v[0]==='r'?{id:v.slice(1)}:{personId:v.slice(1)})};}
     return {...base,choice:v==='new'?'independent':'skip'};});
    const rename=h('input',{value:r.values.display_name,'aria-label':tr('qualify')});
    return card(h('strong',{},tr('row')+' '+r.number+' · '+r.values.display_name),r.hasMore?h('p',{class:'act-warning'},tr('more')):null,bar(rename,btn(tr('lookup'),safe(()=>analyze(rows.map((item,index)=>index===rowIndex?{...item,values:{...item.values,display_name:rename.value}}:item)),err))),h('p',{class:'row-sub'},fields.slice(1).map(f=>r.values[f]).filter(Boolean).join(' · ')),choices,exact,decisionHelp,changed);
   });
   matches.replaceChildren(...nodes,btn(tr('preview'),safe(()=>preview('import',decisions.map(fn=>fn()),file.name,()=>body.replaceChildren(mapUI,matches)),err),true));
  }
  mapUI.append(btn(tr('analyze'),safe(async()=>{const keys=mappings.map(m=>m.value==='other_info'?'notes':m.value),unique=keys.filter(k=>!['__skip__','notes'].includes(k));if(!unique.includes('display_name'))throw Error('ROSTER_INVALID');if(new Set(unique).size!==unique.length)throw Error('ROSTER_DUPLICATE_ROW');
    await analyze(table.rows.map(r=>{const v=mapMappedValues(r,table.headers,keys);const {notes,...values}=v;return {number:r.rowNumber,values:{...values,other_info:notes||''}};}));},err),true));
  body.replaceChildren(btn(tr('back'),()=>list()),mapUI,matches);
 }
 async function list(page=1){
  const run=++serial;showNav();err.textContent='';const toolbar=bar(),results=stack();body.replaceChildren(toolbar,results);
  if(mode==='event'){const eventSelect=sel([['',tr('event')],...events.map(a=>[a.id,[a.name,a.activity_date].filter(Boolean).join(' · ')])],activity);eventSelect.onchange=()=>{activity=eventSelect.value;list();};toolbar.append(box(tr('event'),eventSelect));if(!activity){results.textContent=tr('choose');return;}
   const input=h('input',{type:'file',accept:'.xlsx,.csv',onchange:safe(async()=>{if(input.files[0])await importFile(input.files[0]);},err)});
   toolbar.append(box(tr('import'),input),btn(tr('template'),()=>{const url=URL.createObjectURL(new Blob([toCsv(fields.map(tr),[])],{type:'text/csv;charset=utf-8'}));const a=h('a',{href:url,download:'activity-roster.csv'});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}));
  }
  const search=h('input',{value:term,placeholder:tr('search')});const filters=sel([['',tr('all')],['linked',tr('linked')],['unlinked',tr('unlinked')]],filter);
  filters.onchange=()=>{filter=filters.value;list();};toolbar.append(search,btn(tr('find'),()=>{term=search.value.trim();list();}),filters);
  try{const r=await call(ctx,'list',{activityId:mode==='event'?activity:null,page,term,filter});if(run!==serial)return;
   results.replaceChildren(h('h3',{},(mode==='event'&&!r.imported?tr('empty'):(term||filter?tr('matches'):tr('count'))+' · '+r.total)),
    ...r.rows.map(p=>card(bar(btn(p.display_name,safe(()=>detail(p.id),err)),p.person_id?h('a',{href:'#/person/'+p.person_id},'Person #'+p.person_id):h('span',{},tr('unlinked'))),
     h('p',{class:'row-sub'},[p.organization,p.school,tr('times')+' '+p.times,p.latest].filter(Boolean).join(' · ')),
     mode==='event'?btn(tr('remove'),safe(()=>preview('remove',[{id:p.id,version:p.version,values:p}]),err)):null)),pager(page,r.total,list));
  }catch(x){err.textContent=tr(errors[x.message]||'failed');}
 }
 host.append(h('h2',{},tr('title')),nav,err,body);ctx.main.replaceChildren(host);
 (async()=>{let page=1;for(;;){const r=await ctx.api.call('activities',{action:'directory',page,pageSize:50});if(r.error)throw Error();events.push(...(r.rows||[]));if(!r.hasMore)break;page++;}return list();})().catch(()=>{err.textContent=tr('failed');});
}
