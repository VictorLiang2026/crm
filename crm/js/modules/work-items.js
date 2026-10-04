import { renderTestDataNotice } from './test-data-notice.js';

const MARKER = '【系统测试·勿联系】';
const KIND = {action:'行动',commitment:'承诺'};
const STATE = {open:'进行中',in_progress:'进行中',completed:'已完成',cancelled:'已撤销'};
const TYPE = {I_PROMISED:'我承诺',THEY_PROMISED:'对方承诺',MUTUAL:'共同承诺'};
const SOURCE = {manual:'人工新增',ai_quick_capture_v2:'快速记录 V2',ai_assistant:'AI 助手'};
const node = (tag, cls, text) => {
  const element = document.createElement(tag);
  if (cls) element.className = cls;
  if (text != null) element.textContent = String(text);
  return element;
};
const button = (label, fn, cls = '') => {
  const element = node('button',`btn ${cls}`,label);
  element.type = 'button'; element.addEventListener('click',fn); return element;
};
const field = (label, input) => {
  const wrap = node('label','wi-field'); wrap.append(node('span','',label),input); return wrap;
};
const isOpen = row => row.status === 'open' || row.status === 'in_progress';
const asBeijingInput = value => {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  return new Date(Date.parse(value) + 8*60*60*1000).toISOString().slice(0,16);
};
const fromBeijingInput = value => value ? new Date(`${value}:00+08:00`).toISOString() : null;
const clock = value => value && Number.isFinite(Date.parse(value)) ?
  new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}) : '未排期';
const dueState = row => {
  if (!isOpen(row) || !row.due_at) return '';
  const due = Date.parse(row.due_at);
  if (!Number.isFinite(due)) return '';
  if (due < Date.now()) return '已逾期';
  const day = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
  return day.format(due) === day.format(Date.now()) ? '今天到期' : '待到期';
};
const compare = (a,b) => {
  if (isOpen(a) !== isOpen(b)) return isOpen(a) ? -1 : 1;
  if (isOpen(a)) return (a.due_at == null) - (b.due_at == null) ||
    String(a.due_at || '').localeCompare(String(b.due_at || '')) || Number(b.id)-Number(a.id);
  return String(b.updated_at || '').localeCompare(String(a.updated_at || '')) || Number(b.id)-Number(a.id);
};
function sourceLink(row) {
  let href = null, label = null, focus = null;
  if (row.kind === 'action' && row.activity_id) {
    href = `#/activity/${row.activity_id}`; label = '查看来源活动';
  } else if (row.interaction_id) {
    href = `#/person/${row.person_id}`; label = '查看来源互动'; focus = 'timeline';
  } else if (row.kind === 'action' && row.opportunity_id) {
    href = `#/person/${row.person_id}`; label = '查看关联机会'; focus = 'opportunities';
  }
  if (!href) return node('span','wi-muted',`来源：${SOURCE[row.source] || row.source || '未记录'}`);
  const link = node('a','wi-source',`${label} · ${SOURCE[row.source] || row.source || '原始记录'}`);
  link.href = href;
  if (focus) link.addEventListener('click',event => {
    if (location.hash === href) {
      const target = document.querySelector(focus === 'timeline' ? '.person360-timeline' : '.person360-opportunities');
      if (target) { event.preventDefault(); target.scrollIntoView({block:'center'}); return; }
    }
    try { sessionStorage.setItem('crm_work_item_focus',JSON.stringify({personId:String(row.person_id),focus})); } catch {}
  });
  return link;
}
function clearCoachCache() {
  try { localStorage.removeItem('todayCoachCache'); } catch {}
  window.dispatchEvent(new CustomEvent('crm:work-item-changed'));
}

function mount({root,callFn,personId = null,isCurrent = () => true}) {
  if (!root || typeof callFn !== 'function') throw new TypeError('行动与承诺需要登录接口');
  let rows = [], selectedPerson = null, serial = 0;
  const request = async (action, data = {}) => {
    const response = await callFn('person_360',{action,...data});
    if (!response || response.error) throw new Error(response?.error || '请求失败');
    return response;
  };
  const heading = node('div','wi-head');
  heading.append(node('h3','',personId ? '行动与承诺' : '行动与承诺 · 统一记录'));
  const addAction = button('＋ 新增行动',() => showForm('action',null),'btn-primary');
  const addCommitment = button('＋ 新增承诺',() => showForm('commitment',null));
  heading.append(addAction,addCommitment,button('刷新',load));
  const message = node('p','wi-muted');
  const list = node('div','wi-list');
  const editor = node('div','wi-editor');
  root.replaceChildren(heading,message,list,editor);

  function render(data) {
    if (!isCurrent()) return;
    rows = [...(data.rows || [])].sort(compare);
    list.replaceChildren();
    renderTestDataNotice(list,data.testData);
    if (!rows.length) list.append(node('p','wi-muted','暂无行动或承诺。'));
    for (const row of rows) {
      const card = node('article','wi-row');
      card.id = `work-${row.kind}-${row.id}`;
      const title = node('div','wi-row-title');
      title.append(node('strong','',row.kind === 'action' ? row.title : row.content));
      title.append(node('span',`wi-status ${isOpen(row) ? 'wi-open' : ''}`,
        `${KIND[row.kind]} · ${STATE[row.status] || row.status}${dueState(row) ? ' · ' + dueState(row) : ''}`));
      card.append(title);
      if (!personId) {
        const person = node('a','wi-person',row.person_name || `Person #${row.person_id}`);
        person.href = `#/person/${row.person_id}`;
        person.addEventListener('click',() => {
          try { sessionStorage.setItem('crm_work_item_focus',JSON.stringify({personId:String(row.person_id),focus:`${row.kind}:${row.id}`})); } catch {}
        });
        card.append(person);
      }
      card.append(node('p','wi-muted',`编号 #${row.id} · 到期：${clock(row.due_at)}${
        row.kind === 'action' ? ' · 优先级：' + row.priority : ' · ' + (TYPE[row.commitment_type] || row.commitment_type)}`));
      if (row.description) card.append(node('p','',row.description));
      if (row.completed_at) card.append(node('p','wi-muted',`完成于 ${clock(row.completed_at)}`));
      card.append(sourceLink(row));
      const controls = node('div','wi-controls');
      if (isOpen(row)) {
        controls.append(button('编辑',() => showForm(row.kind,row)),
          button('完成',() => preview(row.kind,'complete',row,{})),
          button('撤销',() => preview(row.kind,'cancel',row,{})));
      } else controls.append(button('重新打开',() => preview(row.kind,'reopen',row,{})));
      card.append(controls); list.append(card);
    }
    message.textContent = data.hasMore ? '每类优先显示最早到期的 50 条未完成记录和最近 10 条已结束记录；更多内容请到对应人物查看。' :
      '状态来自当前业务记录；编辑、完成和撤销均需先核对预览。';
    if (personId) {
      try {
        const focus = JSON.parse(sessionStorage.getItem('crm_work_item_focus') || 'null');
        if (focus?.personId === String(personId)) {
          sessionStorage.removeItem('crm_work_item_focus');
          const target = focus.focus === 'timeline' ? document.querySelector('.person360-timeline') :
            focus.focus === 'opportunities' ? document.querySelector('.person360-opportunities') :
            document.getElementById(`work-${focus.focus?.replace(':','-')}`);
          if (target) setTimeout(() => target.scrollIntoView({block:'center'}),0);
        }
      } catch {}
    }
  }
  async function load() {
    const current = ++serial;
    message.textContent = '正在读取最新行动与承诺…';
    try {
      const data = await request(personId ? 'listPersonWorkItems' : 'listTodayWorkItems',
        personId ? {personId} : {});
      if (current === serial && isCurrent()) render(data);
    } catch (error) {
      if (current === serial && isCurrent()) message.textContent = `读取失败：${error.message}`;
    }
  }

  function showForm(kind,row) {
    editor.replaceChildren();
    selectedPerson = row ? {id:row.person_id,display_name:row.person_name} : null;
    const form = node('form','wi-form');
    form.append(node('h4','',`${row ? '编辑' : '新增'}${KIND[kind]}`));
    if (!personId && !row) {
      const search = node('input'); search.type='search'; search.maxLength=40;
      search.placeholder='先查找并人工选择 Person';
      const matches = node('div','wi-matches');
      const chosen = node('p','wi-muted','尚未选择 Person');
      const searchButton = button('查找 Person',async () => {
        matches.replaceChildren(node('p','wi-muted','查找中…'));
        try {
          const result = await request('listPeople',{keyword:search.value.trim(),page:1,pageSize:20});
          matches.replaceChildren();
          if (!result.rows?.length) matches.append(node('p','wi-muted','没有匹配人物，请到“人”页核对后新增。'));
          for (const candidate of result.rows || []) {
            matches.append(button(`${candidate.display_name} · #${candidate.id}`,() => {
              selectedPerson = candidate;
              chosen.textContent = `已人工选择：${candidate.display_name} · #${candidate.id}`;
              matches.replaceChildren();
              if (!row && candidate.display_name.includes(MARKER)) {
                text.value = kind === 'action' ? `${MARKER}核对体验行动` : `${MARKER}核对体验承诺`;
              }
            }));
          }
          if (result.hasMore || result.total > result.rows.length) {
            matches.append(node('p','wi-muted','结果较多，请缩小搜索后人工选择。'));
          }
        } catch (error) { matches.replaceChildren(node('p','wi-error',`查找失败：${error.message}`)); }
      });
      form.append(field('人物姓名',search),searchButton,chosen,matches);
    }
    const text = kind === 'action' ? node('input') : node('textarea');
    if (kind === 'action') { text.type='text'; text.maxLength=200; }
    else { text.maxLength=4000; text.rows=3; }
    text.required=true;
    text.value = row ? kind === 'action' ? row.title : row.content :
      (personId && root.dataset.personName?.includes(MARKER) ?
        `${MARKER}${kind === 'action' ? '核对体验行动' : '核对体验承诺'}` : '');
    form.append(field(kind === 'action' ? '行动标题' : '承诺内容',text));
    let description=null,priority=null,type=null;
    if (kind === 'action') {
      description=node('textarea'); description.maxLength=4000; description.rows=2;
      description.value=row?.description || '';
      priority=node('select');
      for (const [value,label] of [['low','低'],['medium','中'],['high','高'],['urgent','紧急']]) {
        const option=node('option','',label); option.value=value; priority.append(option);
      }
      priority.value=row?.priority || 'medium';
      form.append(field('说明',description),field('优先级',priority));
    } else {
      type=node('select');
      for (const [value,label] of Object.entries(TYPE)) {
        const option=node('option','',label); option.value=value; type.append(option);
      }
      type.value=row?.commitment_type || 'I_PROMISED';
      form.append(field('承诺方',type));
    }
    const due=node('input'); due.type='datetime-local'; due.value=asBeijingInput(row?.due_at);
    form.append(field('到期时间（北京时间，可留空）',due));
    const error=node('p','wi-error'); error.setAttribute('role','alert');
    const controls=node('div','wi-controls');
    const submit=node('button','btn btn-primary','生成服务端预览'); submit.type='submit';
    controls.append(submit,button('取消',() => editor.replaceChildren()));
    form.append(error,controls);
    form.addEventListener('submit',event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const targetId = row?.person_id || personId || selectedPerson?.id;
      if (!targetId) { error.textContent='请人工选择 Person。'; return; }
      let dueAt;
      try { dueAt=fromBeijingInput(due.value); }
      catch { error.textContent='到期时间无效。'; return; }
      const draft=kind === 'action' ? {title:text.value,description:description.value,
        dueAt,priority:priority.value} : {content:text.value,dueAt,commitmentType:type.value};
      void preview(kind,row ? 'edit' : 'create',row,draft,targetId);
    });
    editor.append(form); form.scrollIntoView({block:'nearest'});
  }

  async function preview(kind,operation,row,draft,targetId = null) {
    editor.replaceChildren(node('p','wi-muted','正在生成服务端预览…'));
    try {
      const person = targetId || row?.person_id || personId;
      const result=await request('previewWorkItem',{data:{kind,operation,personId:person,
        itemId:row?.id || null,idempotencyKey:crypto.randomUUID(),draft}});
      if (!isCurrent()) return;
      if (result.status === 'executed') { editor.replaceChildren(node('p','wi-muted','这项操作已执行。'));
        await load(); return; }
      const before=result.preview?.before;
      const after=result.preview?.after;
      const box=node('section','wi-preview');
      box.append(node('h4','','服务端预览'),node('p','',`${KIND[kind]} · ${
        {create:'新建',edit:'编辑',complete:'完成',cancel:'撤销',reopen:'重新打开'}[operation]} · ${result.preview?.personName || ''}`));
      if (before) box.append(node('p','wi-muted',`原状态：${STATE[before.status] || before.status} · ${
        before.title || before.content} · 到期 ${clock(before.dueAt)}`));
      box.append(node('p','',`执行后：${after?.title || after?.content ||
        STATE[after?.status] || ''} · ${after?.dueAt !== undefined ? '到期 ' + clock(after.dueAt) : ''}`));
      box.append(node('p','wi-muted',`预览有效至 ${clock(result.expiresAt)}；确认后写入当前业务记录。`));
      if (result.preview?.personName?.includes(MARKER)) box.append(node('p','wi-test','含测试数据 · 禁止真实外发'));
      const feedback=node('p','wi-error'); feedback.setAttribute('role','alert');
      const confirm=button('确认以上内容并执行',async () => {
        confirm.disabled=true; feedback.textContent='正在保存…';
        try {
          const saved=await request('executeWorkItem',{previewId:result.previewId});
          clearCoachCache();
          editor.replaceChildren(node('p','wi-success',`${KIND[kind]} #${saved.itemId} 已保存${saved.replayed ? '（重复执行返回原结果）' : ''}。`));
          await load();
        } catch (error) { feedback.textContent=`保存失败：${error.message}`; confirm.disabled=false; }
      },'btn-primary');
      box.append(feedback,confirm,button('放弃本次预览',() => editor.replaceChildren()));
      editor.replaceChildren(box); box.scrollIntoView({block:'nearest'});
    } catch (error) { editor.replaceChildren(node('p','wi-error',`预览失败：${error.message}`)); }
  }
  void load();
}

export function mountPersonWorkItems({root,personId,personName,callFn,isCurrent}) {
  root.dataset.personName=personName || '';
  return mount({root,personId,callFn,isCurrent});
}
export function mountTodayWorkItems({root,callFn}) {
  return mount({root,callFn,isCurrent:() => location.hash === '#/today'});
}
