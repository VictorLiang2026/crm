import { renderTestDataNotice } from './test-data-notice.js';

const MARKER='【系统测试·勿联系】';
const TYPES={insurance:'保险',recruit:'增员',referral:'转介绍',activity:'活动',
  speaker:'嘉宾',partnership:'合作',service:'服务',relationship:'关系'};
const make=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;
  if(text!=null)e.textContent=String(text);return e;};
const button=(label,fn,cls='')=>{const e=make('button',`btn ${cls}`,label);e.type='button';
  e.addEventListener('click',fn);return e;};
const field=(label,control)=>{const e=make('label','person360-opportunity-field');
  e.append(make('span','',label),control);return e;};
const requestError=result=>result?.error || '请求失败';

export function mountOpportunityWorkflow({root,personId,personName='',callFn,
  isCurrent=()=>true,onChanged=()=>{}}) {
  const shell=make('section','card person360-card person360-opportunities');
  const heading=make('div','person360-row');
  heading.append(make('h3','','经营机会'),button('新增 Person 机会',()=>showEditor('create'),'btn-primary'));
  const notice=make('p','person360-muted');
  const list=make('div','person360-opportunity-list');
  const editor=make('div','person360-opportunity-form-host');
  shell.append(heading,notice,list,editor);root.replaceChildren(shell);
  let rows=[],serial=0;
  const call=async(action,fields={})=>{
    const result=await callFn('person_360',{action,...fields});
    if(!result||result.error)throw new Error(requestError(result));return result;
  };
  async function load() {
    const mine=++serial;notice.textContent='正在读取机会…';
    try {
      const result=await call('listOpportunities',{personId});
      if(mine!==serial||!isCurrent())return;
      if(!Array.isArray(result.rows))throw new Error('机会数据格式异常');
      rows=result.rows;list.replaceChildren();notice.textContent='';
      renderTestDataNotice(notice,result.testData);
      if(!rows.length)list.append(make('p','person360-muted','暂无经营机会。'));
      for(const row of rows) {
        const card=make('div','person360-opportunity');
        card.append(make('strong','',`${TYPES[row.opportunity_type]||row.opportunity_type} · ${row.status}`),
          make('span','person360-muted',` #${row.id} · ${row.customer_id==null?'Person 专属':'旧客户机会'}`));
        if(row.last_progress)card.append(make('p','',`进展：${row.last_progress}`));
        if(row.next_action)card.append(make('p','',`下一步：${row.next_action}`));
        if(row.next_action_date)card.append(make('small','person360-muted',`日期：${row.next_action_date}`));
        const controls=make('div','person360-row');
        if(row.customer_id!=null) {
          const link=make('a','','到旧客户详情');link.href=`#/customer/${row.customer_id}`;
          controls.append(link);
        } else {
          controls.append(button('编辑',()=>showEditor('edit',row)),
            button('阶段',()=>showEditor('stage',row)),
            button('行动与结果',()=>showLinks(row)));
          if(!['成交','关闭'].includes(row.status))
            controls.append(button('成交／关闭',()=>showEditor('close',row)));
        }
        card.append(controls);list.append(card);
      }
    } catch(error) {
      if(mine===serial&&isCurrent())notice.textContent=`机会加载失败：${error.message}`;
    }
  }
  async function preview(operation,opportunity,draft) {
    editor.replaceChildren(make('p','person360-muted','正在生成服务端预览…'));
    try {
      const result=await call('previewOpportunity',{data:{idempotencyKey:crypto.randomUUID(),
        operation,personId,opportunityId:opportunity?.id||null,draft}});
      if(!isCurrent())return;
      const panel=make('div','person360-opportunity-form');
      panel.append(make('h4','','服务端预览'),
        make('p','',`人物：${result.preview.personName} · Person #${result.preview.personId}`),
        make('p','',`操作：${{create:'新增',edit:'编辑',stage:'阶段',close:'成交／关闭并记录结果',link_action:'关联行动'}[operation]}`),
        make('p','person360-muted',`来源：${result.preview.source} · 有效至 ${new Date(result.expiresAt).toLocaleString()}`));
      if(result.preview.before)panel.append(make('p','',`原状态：${result.preview.before.status}`));
      for(const [key,label] of [['type','类型'],['status','阶段'],['progress','进展'],
        ['nextAction','下一步'],['nextActionDate','下一步日期'],['actionId','行动 ID'],['result','实际结果']]) {
        const value=result.preview.after?.[key];
        if(value!=null&&value!=='')panel.append(make('p','',`${label}：${value}`));
      }
      const message=make('p','person360-muted','核对后人工确认；关闭预览不会写入。');
      const confirm=button('确认以上内容并执行',async()=>{
        confirm.disabled=true;message.textContent='正在执行…';
        try {
          const saved=await call('executeOpportunity',{previewId:result.previewId});
          message.textContent=`已保存机会 #${saved.opportunityId}${saved.outcomeId?`；结果 #${saved.outcomeId}`:''}${saved.replayed?'（幂等重放）':''}`;
          await load();onChanged(saved);
        } catch(error) {message.textContent=`执行失败：${error.message}。请重新预览。`;confirm.disabled=false;}
      },'btn-primary');
      panel.append(confirm,button('取消',()=>editor.replaceChildren()),message);
      editor.replaceChildren(panel);panel.scrollIntoView({block:'nearest'});
    } catch(error) {editor.replaceChildren(make('p','person360-error',`预览失败：${error.message}`));}
  }
  function showEditor(operation,row=null) {
    const form=make('form','person360-opportunity-form');
    form.append(make('h4','',({create:'新增 Person 机会',edit:'编辑机会',stage:'变更阶段',close:'成交／关闭并记录结果'})[operation]));
    const controls={};
    if(operation==='create'||operation==='edit') {
      const type=make('select');for(const [value,label] of Object.entries(TYPES)) {
        const opt=make('option','',label);opt.value=value;type.append(opt);
      } type.value=row?.opportunity_type||'insurance';controls.type=type;
      const progress=make('textarea');progress.maxLength=4000;
      progress.value=row?.last_progress||(operation==='create'&&personName.includes(MARKER)?
        `${MARKER}虚构机会进展，仅作系统测试。`:'');
      const next=make('input');next.type='text';next.maxLength=1000;
      next.value=row?.next_action||(operation==='create'&&personName.includes(MARKER)?
        `${MARKER}人工核对虚构机会下一步，不联系任何人。`:'');
      const date=make('input');date.type='date';date.value=row?.next_action_date||'';
      form.append(field('机会类型',type),field('进展／依据',progress),
        field('下一步',next),field('下一步日期',date));
      Object.assign(controls,{progress,next,date});
    } else if(operation==='stage'||operation==='close') {
      const status=make('select');
      const statuses=operation==='close'?['成交','关闭']:
        row.opportunity_type==='referral'?['潜在线索','已介绍','已联系','已建立关系']:
          ['发现','沟通','方案'];
      for(const value of statuses){const opt=make('option','',value);opt.value=value;status.append(opt);}
      if(operation==='stage')status.value=row.status;
      form.append(field('阶段',status));controls.status=status;
      if(operation==='close'){
        const result=make('textarea');result.maxLength=4000;
        if(row.last_progress?.includes(MARKER))result.value=`${MARKER}虚构机会结果，仅作系统测试。`;
        form.append(field('实际结果',result));controls.result=result;
        const action=make('select');
        const none=make('option','','不关联行动');none.value='';action.append(none);
        action.disabled=true;
        form.append(field('关联已有行动（可选）',action));controls.action=action;
        void call('getOpportunityLinks',{personId,id:row.id}).then(linked=>{
          if(!form.isConnected)return;
          for(const item of linked.actions){
            const option=make('option','',`行动 #${item.id} · ${item.title}`);
            option.value=item.id;action.append(option);
          }
          action.disabled=false;
        }).catch(error=>{message.textContent=`行动读取失败：${error.message}`;});
      }
    }
    const message=make('p','person360-error');
    const submit=make('button','btn btn-primary','生成服务端预览');submit.type='submit';
    form.append(submit,button('取消',()=>editor.replaceChildren()),message);
    form.addEventListener('submit',event=>{
      event.preventDefault();let data;
      if(operation==='create'||operation==='edit')data={type:controls.type.value,
        progress:controls.progress.value.trim(),nextAction:controls.next.value.trim(),
        nextActionDate:controls.date.value||null};
      else if(operation==='stage')data={status:controls.status.value};
      else data={status:controls.status.value,result:controls.result.value.trim(),
        actionId:controls.action.value?Number(controls.action.value):null};
      void preview(operation,row,data);
    });
    editor.replaceChildren(form);form.scrollIntoView({block:'nearest'});
  }
  async function showLinks(row) {
    editor.replaceChildren(make('p','person360-muted','正在读取关联行动与结果…'));
    try {
      const [linked,available]=await Promise.all([
        call('getOpportunityLinks',{personId,id:row.id}),
        ['成交','关闭'].includes(row.status)?Promise.resolve({rows:[]}):
          call('listUnlinkedOpportunityActions',{personId}),
      ]);
      if(!isCurrent())return;
      const panel=make('div','person360-opportunity-form');
      panel.append(make('h4','',`机会 #${row.id} · 行动与结果`));
      renderTestDataNotice(panel,linked.testData);
      if(!linked.actions.length)panel.append(make('p','person360-muted','暂无关联行动。'));
      for(const action of linked.actions){
        const a=make('a','',`行动 #${action.id} · ${action.title} · ${action.status}`);
        a.href=`#/person/${personId}`;
        a.addEventListener('click',()=>{try{sessionStorage.setItem('crm_work_item_focus',
          JSON.stringify({personId:String(personId),focus:`action:${action.id}`}));}catch{}});
        panel.append(a);
      }
      if(!linked.outcomes.length)panel.append(make('p','person360-muted','暂无实际结果。'));
      for(const outcome of linked.outcomes)panel.append(make('p','',
        `结果 #${outcome.id} · ${outcome.result} · ${new Date(outcome.occurred_at).toLocaleString()}`));
      if(available.rows.length){
        const select=make('select');for(const action of available.rows){
          const opt=make('option','',`行动 #${action.id} · ${action.title}`);opt.value=action.id;select.append(opt);
        }
        panel.append(field('关联已有行动',select),button('生成关联预览',()=>
          void preview('link_action',row,{actionId:Number(select.value)})));
      }
      panel.append(button('关闭',()=>editor.replaceChildren()));
      editor.replaceChildren(panel);
    }catch(error){editor.replaceChildren(make('p','person360-error',`关联加载失败：${error.message}`));}
  }
  void load();
  return {refresh:load};
}
