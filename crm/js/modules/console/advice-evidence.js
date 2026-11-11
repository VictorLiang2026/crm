import { h } from './dom.js';
import { t } from './i18n.js';
import { data } from './data.js';

const label = key => t('advice_review_'+key);
const button = (key, click) => h('button',{class:'btn btn-ghost btn-sm',type:'button',onclick:click},label(key));
const items = values => values?.length ? h('ul',{},values.map(v=>h('li',{},v))) : h('p',{class:'row-sub'},label('not_recorded'));

export function knowledgeLine(source) {
  const entry=typeof source==='object'?source:{id:source};
  return [entry.title, '#'+entry.id, entry.sourceDate||label('undated'),
    entry.reviewStatus==='verified'&&entry.checkedOn ? label('verified')+' '+entry.checkedOn : label('unknown_review')].filter(Boolean).join(' · ');
}

// Keep historical prose intact. Only explicit question/next-step headings can be classified.
export function strategyEvidence(strategy) {
  const evidence={inference:[],unknown:[],next:[]};
  let section='inference';
  for(const raw of String(strategy||'').split(/\r?\n/)){
    const line=raw.trim();if(!line)continue;
    const match=line.match(/^(?:[-*]\s*)?(下一步(?:建议)?|建议下一步|next steps?|待核实(?:事项)?|待确认(?:问题)?|questions? to confirm|unknowns?|AI\s*推断|整体跟进策略|overall strategy|inference)\s*[：:]\s*(.*)$/i);
    if(match){
      section=/^(下一步|建议下一步|next)/i.test(match[1])?'next':/^(待|question|unknown)/i.test(match[1])?'unknown':'inference';
      if(match[2])evidence[section].push(match[2]);
    }else evidence[section].push(line);
  }
  return evidence;
}

export function evidencePanel({facts,inference,unknown,next,knowledge}) {
  const block=(key,values)=>h('section',{},[h('strong',{},label(key)),items(values)]);
  return h('details',{class:'fa-section'},[h('summary',{},label('basis')),block('facts',facts),
    block('inference',inference),block('unknown',unknown),block('next',next),
    knowledge ? h('section',{},[h('strong',{},label('knowledge')),knowledge.sources?.length
      ? items(knowledge.sources.map(knowledgeLine)) : h('p',{class:'row-sub'},label(knowledge.status==='referenced'?'not_recorded':knowledge.status==='checked'?'empty':'unavailable'))]) : null]);
}

export function versionFeedback(ctx,target,classification) {
  const host=h('div',{class:'tab-stack'});
  let loaded=false;
  const details=h('details',{class:'fa-section',ontoggle:async()=>{
    if(details.open && !loaded){loaded=true;await load();}
  }},[h('summary',{},label('version_feedback')),host]);
  const status=h('p',{role:'status',class:'row-sub'});
  async function load(){
    host.replaceChildren(status);status.textContent=label('loading');
    try {
      const result=await data.adviceFeedback(ctx,'read',target);
      if(!result.ok || !Array.isArray(result.rows))throw Error();
      status.textContent='';
      const records=result.rows;
      const decision=h('select',{'aria-label':label('decision')},['accepted','modified','rejected','outcome'].map(v=>h('option',{value:v},label(v))));
      const note=h('textarea',{rows:2,maxlength:2000,'aria-label':label('note'),placeholder:label('note')});
      const evidence=h('textarea',{rows:2,maxlength:2000,'aria-label':label('evidence'),placeholder:label('evidence')});
      const prior=h('select',{'aria-label':label('version')},[h('option',{value:''},label('current')),
        ...records.filter(r=>['accepted','modified'].includes(r.decision)).map(r=>h('option',{value:r.id},[r.title,'v'+r.version,r.confirmed_at?.slice(0,16)].join(' · ')))]);
      const outcomeOnly=h('div',{class:'tab-stack',hidden:true},[prior,evidence]);
      decision.onchange=()=>{outcomeOnly.hidden=decision.value!=='outcome';};
      const preview=button('preview',async()=>{
        preview.disabled=true;
        try {
          const p=await data.adviceFeedback(ctx,'preview',{...target,versionKey:result.versionKey,decision:decision.value,
            note:note.value,evidence:decision.value==='outcome'?evidence.value:'',priorId:decision.value==='outcome'&&prior.value?prior.value:null});
          if(!p.previewId)throw Error();
          const confirm=button('confirm',async()=>{
            confirm.disabled=true;
            try{const done=await data.adviceFeedback(ctx,'confirm',{previewId:p.previewId});if(!done.ok)throw Error();await load();}
            catch{status.textContent=label('failed');confirm.disabled=false;}
          });
          host.replaceChildren(h('strong',{},label(p.decision)),h('p',{},[p.title,'v'+p.version,p.note,p.evidence].filter(Boolean).join(' · ')),
            confirm,button('back',load),status);status.textContent='';
        }catch{status.textContent=label('failed');preview.disabled=false;}
      });
      const history=records.map(r=>[r.confirmed_at?.slice(0,10),r.title,'v'+r.version,label(r.decision),r.note,r.evidence].filter(Boolean).join(' · '));
      host.replaceChildren(...(classification?[evidencePanel({...classification,facts:(result.facts||[]).map(f=>[f.ref,f.date,f.text].filter(Boolean).join(' · '))})]:[]),
        decision,note,outcomeOnly,preview,items(history),status);
    } catch {
      loaded=false;status.textContent=label('failed');
    }
  }
  return details;
}
