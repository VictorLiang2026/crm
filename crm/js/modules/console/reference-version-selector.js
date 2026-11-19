import {h} from './dom.js';
import {t,getLang} from './i18n.js';

let pending=0,sequence=0,allowedHash='';
const leave=()=>window.confirm(t('ro_selector_leave'));
const beforeUnload=e=>{if(pending){e.preventDefault();e.returnValue='';}};
const linkLeave=e=>{
 const link=e.target.closest?.('a[href]');if(!pending||!link||link.target==='_blank')return;
 const target=new URL(link.href);
 if(target.origin!==location.origin||target.pathname!==location.pathname||target.search!==location.search)return;
 if(link.href!==location.href){if(!leave()){e.preventDefault();e.stopImmediatePropagation();}else allowedHash=link.href;}
};
const hashLeave=e=>{
 if(e.newURL===allowedHash){allowedHash='';return;}
 if(pending&&e.oldURL!==e.newURL&&!leave()){
  history.replaceState(null,'',e.oldURL);e.stopImmediatePropagation();
 }
};
function track(delta){
 pending+=delta;
 if(pending===1&&delta>0){window.addEventListener('beforeunload',beforeUnload);document.addEventListener('click',linkLeave,true);window.addEventListener('hashchange',hashLeave,true);}
 if(!pending){allowedHash='';window.removeEventListener('beforeunload',beforeUnload);document.removeEventListener('click',linkLeave,true);window.removeEventListener('hashchange',hashLeave,true);}
}
const same=(a,b)=>String(a)===String(b);
const modeLabel=mode=>t('ro_selector_'+mode);
const versionLabel=v=>v?.id?`${t('ro_source_'+v.source)} · #${v.id} · ${new Date(v.created_at).toLocaleDateString(getLang()==='en'?'en-US':'zh-CN')}`:t('ro_selector_unavailable');

export function versionSelector({call,onSaved,setState}){
 const busy=new Set(),messages=new Map();let closePopup=()=>{};
 function cell(row,state){
  const id=String(row.id),mode=state.selection_mode||'current';
  const host=h('div',{class:'ro-selector','data-selector-id':id});
  const button=h('button',{type:'button',class:'ro-selector-toggle','aria-haspopup':'dialog','aria-expanded':'false',
   'aria-label':`${t('ro_selector_heading')}: ${row.scenario}`,title:modeLabel(mode),disabled:busy.has(id),onclick:()=>button.getAttribute('aria-expanded')==='true'?closePopup():open(row,button,host)},[
   h('span',{},modeLabel(mode)),h('span',{'aria-hidden':'true'},'▾')]);
  const current=state.current_version;
  const newer=['gpt','system'].includes(mode)&&state[mode+'_version']&&!same(state[mode+'_version'].id,state.current_id);
  host.append(button,h('small',{class:'ro-selector-meta',title:versionLabel(current)},versionLabel(current)));
  if(newer)host.append(h('small',{class:'ro-selector-new'},t('ro_selector_new')));
  const message=messages.get(id);
  host.append(h('small',{class:'ro-selector-feedback',role:'status'},busy.has(id)?t('ro_selector_saving'):message?.text||''));
  if(message?.retry&&!busy.has(id))host.append(h('button',{type:'button',class:'btn btn-ghost',onclick:()=>open(row,button,host)},t('ro_retry')));
  return host;
 }
 function renderFeedback(host,text){const node=host.querySelector('[role=status]');if(node)node.textContent=text;}
 async function open(row,button,host){
  if(busy.has(String(row.id)))return;closePopup();
  const panel=h('section',{class:'ro-selector-popup',role:'dialog','aria-label':t('ro_selector_heading'),id:'ro-selector-popup-'+(++sequence)});
  const body=h('div',{class:'ro-selector-options',role:'group','aria-label':t('ro_selector_heading')});
  panel.append(h('p',{class:'ro-selector-help'},t('ro_selector_hint')),body);
  body.append(h('p',{role:'status'},t('ro_selector_loading')));
  document.body.append(panel);button.setAttribute('aria-expanded','true');button.setAttribute('aria-controls',panel.id);
  let closed=false;
  const close=(focus=false)=>{
   if(closed)return;closed=true;panel.remove();button.setAttribute('aria-expanded','false');button.removeAttribute('aria-controls');
   document.removeEventListener('pointerdown',outside,true);window.removeEventListener('resize',move);window.removeEventListener('scroll',move,true);observer.disconnect();
   if(focus&&button.isConnected)button.focus();
  };
  const outside=e=>{if(!panel.contains(e.target)&&!button.contains(e.target))close();};
  const move=e=>{if(e.type!=='scroll'||!panel.contains(e.target))close();};
  const observer=new MutationObserver(()=>{if(!button.isConnected)close();});observer.observe(document.body,{childList:true,subtree:true});
  document.addEventListener('pointerdown',outside,true);window.addEventListener('resize',move);window.addEventListener('scroll',move,true);
  closePopup=close;
  const position=()=>{
   const r=button.getBoundingClientRect(),width=Math.min(340,innerWidth-24);
   panel.style.width=width+'px';panel.style.left=Math.max(12,Math.min(r.left,innerWidth-width-12))+'px';
   const spaceBelow=innerHeight-r.bottom-12,spaceAbove=r.top-12,below=spaceBelow>=Math.min(420,spaceAbove);
   panel.style.maxHeight=Math.max(120,below?spaceBelow:spaceAbove)+'px';
   panel.style.top=below?(r.bottom+4)+'px':'auto';panel.style.bottom=below?'auto':(innerHeight-r.top+4)+'px';
  };
  panel.onkeydown=e=>{
   if(e.key==='Escape'){e.preventDefault();close(true);return;}
   const buttons=[...panel.querySelectorAll('button:not(:disabled)')],at=buttons.indexOf(document.activeElement);
   if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)&&buttons.length){e.preventDefault();buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(at+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length].focus();}
  };
  panel.onfocusout=()=>queueMicrotask(()=>{if(!closed&&!panel.contains(document.activeElement)&&document.activeElement!==button)close();});
  position();
  try{
   const r=await call('states',{id:row.id});if(closed)return;
   const current=r.rows.find(s=>same(s.entry_id,row.id));if(!current)throw Error('Missing reference state');setState(current);
   body.replaceChildren();
   for(const mode of ['gpt','system','current']){
    const version=current[mode==='current'?'manual_version':mode+'_version'];
    const choice=h('button',{type:'button',class:'ro-selector-choice',disabled:!version?.id,'data-mode':mode,
     title:modeLabel(mode),onclick:()=>save(row,current,mode,version,host,button,close)},[
     h('strong',{},modeLabel(mode)),h('small',{},version?.id?versionLabel(version):t('ro_selector_missing_'+mode)),
     ...(version?.id?[h('span',{class:'ro-selector-preview'},version.preview||version.title)]:[])]);
    if(current.selection_mode===mode)choice.setAttribute('aria-current','true');body.append(choice);
   }
   position();body.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
  }catch{
   if(!closed){body.replaceChildren(h('p',{role:'status'},t('ro_selector_load_failed')),h('button',{type:'button',class:'btn btn-ghost',onclick:()=>{close();open(row,button,host);}},t('ro_retry')));position();}
  }
 }
 async function save(row,state,mode,version,host,button,close){
  const id=String(row.id);if(busy.has(id))return;
  close(true);busy.add(id);track(1);button.disabled=true;messages.delete(id);renderFeedback(host,t('ro_selector_saving'));
  try{
   const result=await call('selectMode',{id:row.id,mode,versionId:version.id,expectedCurrentId:state.current_id,expectedUpdatedAt:state.updated_at});
   if(!result.state||!result.row)throw Error('Incomplete selector response');
   setState(result.state);messages.set(id,{text:t('ro_saved')});
   busy.delete(id);onSaved(result.row,result.state);
   setTimeout(()=>{if(messages.get(id)?.text===t('ro_saved')){messages.delete(id);const current=document.querySelector(`[data-selector-id="${id}"] [role=status]`);if(current?.textContent===t('ro_saved'))current.textContent='';}},2200);
  }catch(error){
   const stale=['REFERENCE_STALE','REFERENCE_SELECTION_CHANGED'].includes(error?.code);
   const message={text:t(stale?'ro_selector_stale':'ro_selector_failed'),retry:true};messages.set(id,message);renderFeedback(host,message.text);
   if(host.isConnected&&!host.querySelector('.ro-selector-retry'))host.append(h('button',{type:'button',class:'btn btn-ghost ro-selector-retry',onclick:()=>open(row,button,host)},t('ro_retry')));
  }finally{busy.delete(id);button.disabled=false;track(-1);}
 }
 return {cell};
}
