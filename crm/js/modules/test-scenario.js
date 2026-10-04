import { createApi } from '../core/api.js';
const ROUTE='#/test-scenario';
const LABELS={persons:'人物',customers:'客户',person_roles:'角色',followups:'跟进',interactions:'互动',opportunities:'机会',actions:'行动',activities:'活动',activity_participants:'到场记录'};
const ERRORS={SEED_FORBIDDEN:'此入口仅供已授权测试账号使用。',UNAUTHORIZED:'请先登录测试账号。',SEED_NOT_CONFIGURED:'测试入口尚未配置，请联系管理员。',PREVIEW_STALE:'预览已过期或数据发生变化，请重新预览。',CONFIRMATION_REQUIRED:'请先核对并确认当前预览。',SEED_IDENTITY_CONFLICT:'发现同名身份冲突，已停止生成，请核对已有记录。',SEED_CONFLICT:'样本台账或关联记录发生变化，已停止生成，请核对。'};
function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;}
function link(text,href){const n=el('a',text,'btn');n.href=href;return n;}
export function renderTestScenario({root,callFn}) {
 const api=createApi(callFn),page=el('section',undefined,'phase14-page');
 page.append(link('← 更多','#/more'),el('h2','生成 / 打开测试场景'),
  el('p','【系统测试·勿联系】仅使用虚构内容，样本参与真实看板计算；禁止联系、外发和填写真实保单。','phase14-intro'));
 const notice=el('p');notice.setAttribute('role','status');
 const counts=el('p'),preview=el('section'),controls=el('div',undefined,'phase14-search'),destinations=el('div',undefined,'phase14-search');
 const dry=el('button','1. 预览生成计划','btn btn-primary'),confirm=el('button','2. 确认身份与预览','btn'),execute=el('button','3. 生成测试场景','btn btn-primary');
 for(const b of [dry,confirm,execute])b.type='button';
 controls.append(dry,confirm,execute);page.append(notice,counts,controls,preview,destinations);root.replaceChildren(page);
 let busy=false,receipt=null,confirmed=false,authorized=false;
 const active=()=>location.hash===ROUTE;
 const buttons=()=>{dry.disabled=busy||!authorized;confirm.disabled=busy||!receipt||confirmed;execute.disabled=busy||!confirmed;};
 async function request(stage,extra={}){const r=await api.call('assistant',{action:'testSamples',stage,...extra});if(!r?.ok)throw Error(r?.error?.code||'SEED_DATABASE_ERROR');return r;}
 function showState(state){
  counts.textContent=`初始样本 ${state.initialCount} / 10 行 · 后续业务 ${state.derivedCount} 行 · AI 审计 ${state.auditCount} 行`;
  destinations.replaceChildren();
  if(!state.ready)return;
  const {personId,customerId,activityId}=state.targets||{};
  if(![personId,customerId,activityId].every(id=>/^[1-9][0-9]*$/.test(String(id))))throw Error('SEED_DATABASE_ERROR');
  const agenda=link('一键打开测试日程','#/today');
  agenda.addEventListener('click',()=>{try{sessionStorage.setItem('crm_open_test_agenda','1');}catch{}});
  destinations.append(link('打开虚构人物',`#/person/${personId}`),link('打开客户',`#/customer/${customerId}`),
   agenda,link('经营漏斗','#/funnels'),link('AI 搜索','#/ai/search'),
   link('预填下一步行动','#/test-scenario/action'));
  destinations.append(el('p','含测试数据。AI 搜索可点击“最近三个月参加过活动但没有继续跟进的人”，再搜索；无需输入业务文字。','phase14-row-note'));
 }
 async function run(work){if(busy||!active())return;busy=true;buttons();try{await work();}catch(e){if(active()){notice.textContent=ERRORS[e.message]||'操作未完成，请刷新并重新核对。';notice.className='phase14-error';receipt=null;confirmed=false;}}finally{busy=false;if(active())buttons();}}
 dry.addEventListener('click',()=>run(async()=>{
  receipt=null;confirmed=false;preview.replaceChildren();destinations.replaceChildren();
  const r=await request('dryRun');if(!active())return;receipt=r;showState(r);
  const p=r.preview;preview.append(el('h3','生成前预览'),el('p',r.identity.name),
   el('p',r.identity.decision==='confirm_registered'?'将复用已登记的虚构人物。':'将新建此虚构人物；请确认身份。'));
  const table=el('table');const head=el('tr');head.append(el('th','业务记录'),el('th','已有 / 新增'));table.append(head);
  for(const row of p.rows){const tr=el('tr');tr.append(el('td',LABELS[row.table]||row.table),el('td',`${r.ready?row.count:0} / ${r.ready?0:row.count}`));table.append(tr);}
  preview.append(table,el('p',`同步触发器额外业务行：${p.triggerBusinessRows}；新增 ${p.initialNew} 行，初始合计 ${p.initialTotal} / ${p.maximum} 行。`),
   el('p','预览未写入业务样本；系统仅保存短期确认凭据。重复生成复用同一批次，不补建被删除的样本。','phase14-muted'));
  notice.className='';notice.textContent='请核对人物与逐表数量，再确认。';
 }));
 confirm.addEventListener('click',()=>run(async()=>{
  if(!receipt)return;await request('confirm',{previewId:receipt.previewId,previewHash:receipt.previewHash});if(!active())return;
  confirmed=true;notice.textContent='已确认。点击“生成测试场景”后才写入业务记录。';
 }));
 execute.addEventListener('click',()=>run(async()=>{
  if(!receipt||!confirmed)return;const r=await request('execute',{previewId:receipt.previewId});if(!active())return;
  showState(r);receipt=null;confirmed=false;notice.textContent=r.replayed?'已打开原有场景，初始样本数量未增加。':'测试场景已生成，含测试数据。所有初始记录均已登记。';
 }));
 buttons();void run(async()=>{const state=await request('status');if(!active())return;authorized=true;showState(state);notice.textContent=state.ready?'已有测试场景，可直接打开；重新预览不会增加初始记录。':'点击预览，先核对将生成的记录。';});
}
