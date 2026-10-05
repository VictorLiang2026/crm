/* ============================================================
   路由 · 视图 · 交互（纯前端原型，数据仅存内存）
   ============================================================ */
const DEVICE = document.body.dataset.device || 'iPad';
const IS_P = DEVICE === 'iPhone';

const NAV = [
  {h:'#/today',n:'今日',i:'home'},
  {h:'#/ai',n:'AI助手',i:'spark'},
  {h:'#/people',n:'人',i:'users'},
  {h:'#/opportunities',n:'机会',i:'target'},
  {h:'#/activities',n:'活动',i:'calendar'},
  {h:'#/recruit',n:'招募',i:'award'},
  {h:'#/more',n:'更多',i:'grid'},
];
const TAB_ITEMS = [
  {h:'#/today',n:'今日',i:'home'},
  {h:'#/people',n:'人物',i:'users'},
  {h:'#/capture',n:'',i:'plus',fab:true},
  {h:'#/opportunities',n:'机会',i:'target'},
  {h:'#/more',n:'更多',i:'grid'},
];

function go(hash){ if(location.hash===hash){render()} else location.hash=hash; }
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function toast(msg){
  const host=document.querySelector('.device-screen')||document.body;
  let t=host.querySelector('#toast');
  if(!t){t=document.createElement('div');t.id='toast';t.className='toast';host.appendChild(t);}
  t.innerHTML=ic('check')+'<span>'+msg+'</span>';
  t.classList.add('show');
  clearTimeout(t._tm);t._tm=setTimeout(()=>t.classList.remove('show'),2200);
}
function rerender(){render();}
function openModal(html){
  closeModal();
  const host=document.querySelector('.device-screen')||document.body;
  const m=document.createElement('div');
  m.className='modal-mask';m.id='modal-mask';
  m.innerHTML='<div class="modal" role="dialog" aria-modal="true">'+html+'</div>';
  m.addEventListener('click',e=>{if(e.target===m)closeModal();});
  host.appendChild(m);
}
function closeModal(){document.getElementById('modal-mask')?.remove();document.querySelector('.device-screen')?.querySelector('#modal-mask')?.remove();}

/* ---------------- 顶部/底部框架 ---------------- */
function chrome(active){
  const topNav = NAV.map(n=>`<a href="${n.h}" class="${active===n.h?'active':''}">${ic(n.i)}<span>${n.n}</span></a>`).join('');
  const header = `
  <header class="topbar">
    <div class="brand-row">
      <a class="brand" href="#/today">
        <span class="brand-mark">${ic('spark')}</span>
        <span><b>Victor's CRM</b><span class="brand-sub">RELATIONSHIPS, WITH INTELLIGENCE</span></span>
      </a>
      <nav class="topnav">${topNav}</nav>
      <div class="top-actions">
        <span class="demo-label badge ghost">独立原型 · 虚构数据</span>
        <button class="btn btn-primary btn-sm" data-go="#/capture">${ic('plus')}<span class="lbl">快速记录</span></button>
        <button class="avatar" data-go="#/account" title="账号与应用维护">VL</button>
      </div>
    </div>
  </header>`;
  const statusbar = IS_P ? `
  <div class="statusbar"><span class="tnum">9:41</span><span class="sb-icons">
    <svg viewBox="0 0 24 24"><rect x="2" y="14" width="3.5" height="6" rx="1" fill="currentColor" stroke="none"/><rect x="7.5" y="10" width="3.5" height="10" rx="1" fill="currentColor" stroke="none"/><rect x="13" y="6.5" width="3.5" height="13.5" rx="1" fill="currentColor" stroke="none"/><rect x="18.5" y="3" width="3.5" height="17" rx="1" fill="currentColor" stroke="none"/></svg>
    <svg viewBox="0 0 24 24"><path d="M2 8.5a16 16 0 0 1 20 0M5.5 12a11 11 0 0 1 13 0M9 15.5a6 6 0 0 1 6 0"/><circle cx="12" cy="19" r="1.3" fill="currentColor" stroke="none"/></svg>
    <svg viewBox="0 0 24 24"><rect x="2.5" y="7" width="18" height="10" rx="3" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="4.5" y="9" width="13" height="6" rx="1.5" fill="currentColor" stroke="none"/><rect x="21.5" y="10" width="1.8" height="4" rx="1" fill="currentColor" stroke="none"/></svg>
  </span></div>` : '';
  const tabbar = IS_P ? `
  <nav class="tabbar">
    ${TAB_ITEMS.map(t=>t.fab
      ? `<a class="tab-fab" href="${t.h}"><i>${ic(t.i)}</i><span>记录</span></a>`
      : `<a href="${t.h}" class="${active===t.h?'active':''}">${ic(t.i)}<span>${t.n}</span></a>`).join('')}
  </nav>` : '';
  return {header,statusbar,tabbar};
}

function pageWrap(active, inner, crumbs){
  const {header,statusbar,tabbar} = chrome(active);
  return `${IS_P?statusbar:''}${header}${inner}${IS_P?'':foot()}${tabbar}`;
}
function foot(){return `<div class="page" style="padding-top:0"><div class="pagefoot"><span>VICTOR'S CRM · 以人为中心，让每一次经营有据可循</span><span>原型演示 · 不连接业务服务</span></div></div>`;}
function head(eyebrow,title,sub,actions){
  return `<div class="page-head"><div>
    ${eyebrow?`<div class="eyebrow">${eyebrow}</div>`:''}
    <div class="page-title">${title}</div>
    ${sub?`<div class="page-sub">${sub}</div>`:''}
  </div>${actions?`<div class="btn-row end">${actions}</div>`:''}</div>`;
}

/* ---------------- 登录 ---------------- */
function viewLogin(){
  return `<div class="login">
    <aside class="login-aside">
      <div class="login-brand"><span class="brand-mark">${ic('spark')}</span><b>Victor's CRM</b></div>
      <div class="login-hero">
        <h2>把关系看清，<br>把<em>下一步</em>做好。</h2>
        <p>以人物为中心的保险经营台：今日行动、承诺与机会按优先级排好，每一条 AI 建议都带来源、经你确认。</p>
        <ul class="login-points">
          <li>${ic('check')} 今日 5 件事：2 必做 · 2 应做 · 1 可做</li>
          <li>${ic('check')} 互动、承诺、结果全程可追溯</li>
          <li>${ic('check')} AI 只建议，关键变更由你确认</li>
        </ul>
      </div>
    </aside>
    <main class="login-main">
      <form class="login-card" data-act="login">
        <h1>欢迎回来</h1>
        <div class="sub">演示账号 demo / demo123（任何输入均可进入）</div>
        <label class="field"><span>账号</span><input value="demo" autocomplete="username"></label>
        <label class="field"><span>密码</span><input type="password" value="demo123" autocomplete="current-password"></label>
        <button class="btn btn-primary btn-lg" type="submit">登 录</button>
        <div class="login-foot">5 分钟无操作需重新登录 · 数据与界面均为演示用途</div>
      </form>
    </main>
  </div>`;
}

/* ---------------- 今日 ---------------- */
function viewToday(){
  const openActions = DEMO.actions.filter(a=>!state.done[a.id]);
  const doneActions = DEMO.actions.filter(a=>state.done[a.id]);
  const prioLabel={must:'必做',rec:'应做',opt:'可做'};
  let seq={must:0,rec:0,opt:0};
  const taskRow = a=>{
    seq[a.prio]++;
    const code=a.prio==='must'?'M'+seq.must:a.prio==='rec'?'R'+seq.rec:'O'+seq.opt;
    return `<div class="task ${a.prio}">
      <button class="check" data-act="toggle-task" data-id="${a.id}" aria-label="完成">${ic('check')}</button>
      <div class="task-main">
        <div class="task-top">
          <span class="prio ${a.prio}">${prioLabel[a.prio]} ${code}</span>
          <span class="task-title">${a.t}</span>
        </div>
        <div class="task-meta">${a.person?`<span class="person">${a.person}</span> · `:''}${a.due}${a.state?` · <span class="badge ghost">${a.state}</span>`:''}</div>
        <div class="task-src">${a.src}</div>
        <div class="task-ops">${a.ops.map((o,i)=>`${i?'<span class="dot gray" style="margin:0 2px"></span>':''}<button class="text-link" data-act="noop">${o}</button>`).join('')}</div>
      </div>
      <div class="task-side"><span class="badge red">${a.tag}</span></div>
    </div>`;
  };
  const briefItems = DEMO.brief.items.map((b,i)=>`
    <div class="brief-item"><span class="brief-num">${i+1}</span><div>
      <p>${b.p}</p><span class="src">${b.src}</span>
      <div class="brief-act"><button class="btn btn-soft" data-act="noop">${b.act}</button></div>
    </div></div>`).join('');
  const candCards = DEMO.candidates.map(c=>{
    const s=state.cand[c.id];
    return `<div class="row" style="align-items:flex-start">
      <span class="avatar-md avatar" style="border-radius:11px">${ic('spark')}</span>
      <div class="row-main">
        <div class="row-title">${c.t} <span class="badge gold">${c.kind}</span></div>
        <div class="row-sub"><b style="color:var(--red-600)">${c.person}</b> · ${c.meta}</div>
        <div class="row-sub">${c.desc}</div>
        ${s==='pending'?`<div class="btn-row eq c2" style="margin-top:10px">
          <button class="btn btn-ghost btn-sm" data-act="cand-reject" data-id="${c.id}">暂不采纳</button>
          <button class="btn btn-primary btn-sm" data-act="cand-approve" data-id="${c.id}">逐项审核</button>
        </div>`:`<div style="margin-top:8px"><span class="badge ${s==='ok'?'jade':'gray'}">${s==='ok'?'已送审 · 等待业务确认':'已忽略 · 本次不再提示'}</span></div>`}
      </div>
    </div>`;
  }).join('');
  const stats = DEMO.stats.map(s=>`<div class="stat"><div class="stat-label">${s.l}</div><div class="stat-num tnum ${s.c}">${s.n}</div><div class="stat-hint">${s.h}</div></div>`).join('');
  const rhythm = DEMO.rhythm.map(r=>`<div class="rhythm-item"><div class="rhythm-time">${r.time}</div><div class="rhythm-card"><b>${r.t}</b><button class="text-link">${r.act} ${ic('chevronR')}</button></div></div>`).join('');
  const commits = DEMO.commitments.map(c=>`<div style="padding:11px 0;border-bottom:1px solid var(--line)">
    <div style="display:flex;gap:8px;align-items:flex-start"><span class="dot ${c.kind==='mine'?'jade':'gold'}" style="margin-top:6px"></span><div style="min-width:0">
      <div style="font-size:12.5px;font-weight:600;line-height:1.5">${c.t}</div>
      <div class="row-sub" style="margin-top:3px"><span class="badge ${c.kind==='mine'?'jade':'gold'}">${c.who}</span> ${c.overdue?'<span class="badge red" style="margin-left:5px">已逾期</span>':''}</div>
      <div class="row-sub tnum">${c.due}</div>
    </div></div></div>`).join('');
  const risks = DEMO.risks.map(r=>`<div class="ai-box" style="margin-bottom:10px">
    <div class="ai-head"><span class="ai-ico">${ic('alert')}</span><b>关系与风险提示</b><span class="badge gold" style="margin-left:auto">待确认</span></div>
    <p><b>${r.t}</b>。${r.d}</p><div class="src">依据：${r.src}</div></div>`).join('');
  const opps = DEMO.opportunities.filter(o=>!['成交','关闭'].includes(o.stage)).map(o=>`<div style="padding:10px 0;border-bottom:1px solid var(--line)">
    <div style="display:flex;gap:8px;align-items:flex-start"><span class="dot gold" style="margin-top:6px"></span><div style="min-width:0">
      <div style="font-size:12.5px;font-weight:600">${o.t}</div>
      <div class="row-sub">${o.person} · ${o.stage}</div>
      <button class="text-link" data-go="#/opportunities">查看机会 ${ic('chevronR')}</button>
    </div></div></div>`).join('');

  return pageWrap('#/today', `<main class="page">
    ${head('MONDAY / YOUR DAILY PERSPECTIVE','早安，Victor · 今天先做这两件事',DEMO.dateCN,
      `<button class="btn btn-ghost btn-sm" data-go="#/review-legacy">${ic('list')} 行动与承诺</button>
       <button class="btn btn-soft btn-sm" data-act="toggle-brief">${ic('spark')} 晨间简报</button>`)}

    <div class="layout">
      <div class="stack">
        <section class="brief">
          <div class="brief-head">
            <div class="brief-title">${ic('spark')} 晨间简报<span class="badge">AI · 需你判断</span></div>
            <span class="brief-date tnum">${DEMO.brief.date}</span>
          </div>
          <div class="brief-list">${briefItems}</div>
          <div class="brief-foot">
            <button class="ghost-link" data-act="noop">简报模型最多等待 10 秒，失败自动降级为规则版</button>
            <button class="btn btn-ghost btn-sm" style="background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.2);color:#fff" data-act="noop">展开完整简报 ${ic('chevronD')}</button>
          </div>
        </section>

        <div class="stats">${stats}</div>

        <section class="card">
          <div class="card-head"><h2>${ic('check')} 优先行动 · Today 5</h2><a class="see-all" data-go="#/review-legacy">查看全部 ${ic('chevronR')}</a></div>
          <div class="card-body">
            ${openActions.map(taskRow).join('')}
            ${doneActions.length?`<div class="separator" style="height:1px;background:var(--line);margin:14px 0"></div>`+doneActions.map(a=>`<div class="task done ${a.prio}"><button class="check" data-act="toggle-task" data-id="${a.id}">${ic('check')}</button><div class="task-main"><div class="task-top"><span class="task-title">${a.t}</span></div><div class="task-meta">${a.person?a.person+' · ':''}${a.due}</div></div></div>`).join(''):''}
          </div>
        </section>

        <section class="card">
          <div class="card-head"><h2>${ic('spark')} 需要你确认</h2><span class="badge gold">2 项候选</span></div>
          <div class="card-body">${candCards}</div>
        </section>
      </div>

      <aside class="rail">
        <section class="card">
          <div class="card-head"><h2>${ic('clock')} 今天的节奏</h2><span class="badge">2 项日程</span></div>
          <div class="card-body"><div class="rhythm">${rhythm}</div></div>
        </section>
        <section class="card">
          <div class="card-head"><h2>${ic('flag')} 承诺，也是关系的一部分</h2></div>
          <div class="card-body" style="padding-top:10px;padding-bottom:10px">${commits}</div>
        </section>
        ${risks?`<section class="card"><div class="card-body">${risks}</div></section>`:''}
        <section class="card">
          <div class="card-head"><h2>${ic('target')} 值得继续的机会</h2></div>
          <div class="card-body" style="padding-top:10px">${opps}</div>
        </section>
        <button class="btn btn-ghost btn-block" data-go="#/review-legacy">${ic('refresh')} 回顾今天 / 最近七天</button>
      </aside>
    </div>
  </main>`);
}

/* ---------------- AI 助手 ---------------- */
function viewAI(){
  const caps=[
    {i:'search',t:'AI CRM 搜索',d:'三个受控问题模板，名单由数据库计算，每条带来源',b:'已上线',bc:'jade',go:'#/search'},
    {i:'send',t:'自然语言创建行动',d:'Command → Plan → Preview → Confirm → Execute 五段式',b:'已上线',bc:'jade',go:'#/command'},
    {i:'user',t:'人物摘要',d:'会前快速了解一个人的变化、目标与待确认事项',b:'规划中',bc:'ghost',go:'#/prep/1'},
    {i:'book',t:'会前准备 / 对话策略',d:'切入、顾虑、话术本引用，证据不足时不给建议',b:'规划预览',bc:'gold',go:'#/prep/1'},
    {i:'chart',t:'机会分析',d:'基于互动与事实给出推进建议，不由 AI 改阶段',b:'规划中',bc:'ghost',go:'#/opportunities'},
    {i:'refresh',t:'活动复盘候选',d:'逐人审核到场互动、行动与机会，防重复接受',b:'已上线',bc:'jade',go:'#/activity/501/review'},
  ];
  return pageWrap('#/ai',`<main class="page">
    ${head('AI ASSISTANT','AI 助手：只建议，不替你决定','所有结果可追溯到真实记录；证据不足时明确说“暂不能判断”')}
    <div class="stack">
      <section class="card"><div class="card-body">
        <button class="searchbox" style="max-width:none;cursor:pointer;width:100%" data-go="#/search">${ic('search')}<span style="color:var(--ink-3);font-size:13px">问一个受控问题，例如：上周活动后谁还没跟进？</span><span class="btn btn-soft btn-sm" style="margin-left:auto">去搜索</span></button>
        <div class="chip-row" style="margin-top:12px">
          ${DEMO.searchTemplates.map(t=>`<button class="chip" data-go="#/search">${t.t}</button>`).join('')}
        </div>
      </div></section>
      <div class="tile-grid">${caps.map(c=>`
        <button class="tile" data-go="${c.go}">
          <span class="t-ico">${ic(c.i)}</span>
          <b>${c.t}</b><p>${c.d}</p>
          <span class="tile-foot"><span class="badge ${c.bc}">${c.b}</span><span class="text-link">打开 ${ic('chevronR')}</span></span>
        </button>`).join('')}
      </div>
      <div class="notice info">${ic('alert')}<div>AI 不能选择模板外操作、不能生成 SQL、不能替你合并人物身份。“没有记录”不会被解释成“没有需求”。</div></div>
    </div>
  </main>`);
}

/* ---------------- AI 搜索 ---------------- */
function viewSearch(){
  const ran=state.searchRan;
  return pageWrap('#/ai',`<main class="page">
    <div class="crumb"><a href="#/ai">AI 助手</a>${ic('chevronR')}<span>AI CRM 搜索</span></div>
    ${head('CONTROLLED SEARCH','受控搜索：模型只选模板，名单由数据库计算','支持三类已实现问题；无法归类时直接告知不支持')}
    <section class="card"><div class="card-body">
      <div class="searchbox" style="max-width:none">${ic('search')}<input id="search-input" value="上周沙龙结束后，哪些到场客户还没有跟进？"></div>
      <div class="chip-row" style="margin-top:12px">${DEMO.searchTemplates.map((t,i)=>`<button class="chip ${ran&&i===0?'active':''}" data-act="search-run">${t.t}</button>`).join('')}</div>
      <div class="btn-row end" style="margin-top:14px"><button class="btn btn-ghost btn-sm" data-act="search-reset">清空</button><button class="btn btn-primary btn-sm" data-act="search-run">${ic('search')} 运行查询</button></div>
    </div></section>
    <div style="height:14px"></div>
    ${ran?`<section class="card">
      <div class="card-head"><h2>${ic('users')} 命中名单（2 人）· 最多返回 30 人</h2><span class="badge jade">模板一 · 近 1 个月</span></div>
      <div class="card-body">
        ${DEMO.searchResults.map(p=>`<div class="row row-click" data-go="#/person/${p.id}">
          <span class="avatar-lg ${p.id%2?'':'alt'}">${p.n[0]}</span>
          <div class="row-main"><div class="row-title">${p.n} <span class="badge">Person #${p.id}</span> ${p.tags.map(t=>`<span class="badge red">${t}</span>`).join('')}</div>
          <div class="row-sub">${p.reason}</div></div>
          ${ic('chevronR')}
        </div>`).join('')}
        <div class="notice rose" style="margin:14px 0 0">${ic('spark')}<div>“已到场”只统计实际 attendance，邀请但未到场不计；“未跟进”以互动台账为准。</div></div>
      </div>
    </section>`:`
    <div class="empty">${ic('search')}<h3>选择模板并运行</h3><p>结果只展示可追溯的名单与依据，<br>不拼接模型生成的 SQL，也不做模板外猜测。</p></div>`}
  </main>`);
}

/* ---------------- 五段式创建行动 ---------------- */
function viewCommand(){
  const step=state.commandStep;
  const steps=['Command','Plan','Preview','Confirm','Execute'];
  const stepper=`<div class="stepper">${steps.map((s,i)=>`
    <span class="step ${i===step?'active':i<step?'done':''}"><i>${i<step?ic('check'):i+1}</i>${s}</span>${i<steps.length-1?'<span class="step-line"></span>':''}`).join('')}</div>`;
  let body='';
  if(step===0) body=`
    <div class="notice rose">${ic('spark')}<div>说清楚你想做什么。系统会先生成计划，核对人物与字段后才进入预览；你可以在任意一步返回修改。</div></div>
    <label class="field"><span>想创建的行动</span><textarea id="cmd-text" style="min-height:110px">明天下午提醒我给王宁打个电话，约保单检视的时间，这是活动 #501 之后答应他的。</textarea><span class="hint">尝试输入“删除所有行动”等越权指令，可查看系统拒绝方式。</span></label>
    <div class="btn-row end"><button class="btn btn-ghost btn-sm" data-act="cmd-bad">试一条越权指令</button><button class="btn btn-primary" data-act="cmd-next">${ic('spark')} 生成计划</button></div>`;
  if(step===1) body=`
    <div class="plan-box"><b style="color:var(--ink)">计划草案</b><br>创建一条行动：<b>电话回访王宁，预约保单检视</b>；到期：<b>明天下午</b>；来源：<b>活动 #501 后承诺</b>；人物解析：<b>王宁（Person #2，精确匹配 1 人）</b>。<br><span style="color:var(--ink-3)">未按姓名自动新建人物；如出现同名歧义，将要求你人工选择。</span></div>
    <div class="btn-row eq c3">
      <button class="btn btn-ghost" data-act="cmd-back">返回修改</button>
      <button class="btn btn-ghost" data-act="noop">换一种说法</button>
      <button class="btn btn-primary" data-act="cmd-next">人物与内容无误，生成预览</button>
    </div>`;
  if(step===2) body=`
    <dl class="preview-kv">
      <dt>人物</dt><dd>王宁 · Person #2（精确匹配）</dd>
      <dt>行动标题</dt><dd>电话回访，预约保单检视</dd>
      <dt>类型 / 优先级</dt><dd>电话沟通 · 应做（R）</dd>
      <dt>到期时间</dt><dd>2026-10-06 15:00</dd>
      <dt>关联来源</dt><dd>活动 #501 · 到场 #511 · 互动承诺</dd>
      <dt>写入范围</dt><dd>仅新建 1 条 actions；不改客户阶段、不发消息</dd>
    </dl>
    <div style="height:14px"></div>
    <div class="btn-row eq c3">
      <button class="btn btn-ghost" data-act="cmd-back">返回</button>
      <button class="btn btn-gold">${ic('edit')} 编辑字段</button>
      <button class="btn btn-primary" data-act="cmd-next">进入确认</button>
    </div>`;
  if(step===3) body=`
    <div class="notice">${ic('alert')}<div>预览绑定你的账号，15 分钟内有效。确认后服务端将再次复检人物、来源与权限，再事务执行；同一请求重放不会重复创建。</div></div>
    <dl class="preview-kv">
      <dt>操作账号</dt><dd>Victor 梁（VL）</dd>
      <dt>幂等键</dt><dd class="tnum">cmd-20261005-9f3a（演示）</dd>
      <dt>执行器</dt><dd><span class="badge jade">crm_work_item_commands · 已启用</span></dd>
    </dl>
    <div style="height:14px"></div>
    <div class="btn-row eq c2">
      <button class="btn btn-danger" data-act="cmd-reset">取消，不执行</button>
      <button class="btn btn-primary" data-act="cmd-next">${ic('check')} 确认执行</button>
    </div>`;
  if(step===4) body=`
    <div style="text-align:center;padding:24px 0">
      <span style="width:64px;height:64px;border-radius:50%;background:var(--jade-50);color:var(--jade);display:inline-grid;place-items:center;margin-bottom:14px"><svg width="30" height="30" viewBox="0 0 24 24" style="stroke:var(--jade)"><path d="m4.5 12.5 5 5 10-11"/></svg></span>
      <h2 style="font-size:17px;margin-bottom:6px">行动已创建</h2>
      <p class="page-sub">已写入 actions 台账，可在「今日 · 行动与承诺」与王宁的人物页查看</p>
    </div>
    <div class="btn-row eq c2"><button class="btn btn-ghost" data-act="cmd-reset">再创建一条</button><button class="btn btn-primary" data-go="#/person/2">打开王宁的人物页</button></div>`;
  return pageWrap('#/ai',`<main class="page" style="max-width:760px">
    <div class="crumb"><a href="#/ai">AI 助手</a>${ic('chevronR')}<span>自然语言创建行动</span></div>
    ${head('COMMAND CONTRACT','关键写入：五段式安全契约','计划 · 服务端预览 · 人工确认 · 事务执行 · 幂等重放')}
    <section class="card"><div class="card-body">${stepper}${body}</div></section>
  </main>`);
}

/* ---------------- 快速记录（弹层流程） ---------------- */
function openCapture(){
  const steps=['原始记录','AI 拆解预览','选择人物','确认提交'];
  let step=0;
  const draw=()=>{
    const sp=`<div class="stepper" style="margin-bottom:16px">${steps.map((s,i)=>`<span class="step ${i===step?'active':''}"><i>${i+1}</i>${s}</span>${i<steps.length-1?'<span class="step-line"></span>':''}`).join('')}</div>`;
    let body='';
    if(step===0) body=`
      <label class="field"><span>刚才发生了什么？说人话就行</span>
      <textarea id="cap-text" style="min-height:120px">林悦来电说孩子明年可能去英国读书，预算还要和先生商量，我答应周三前发一份家庭保障整理清单给她。</textarea></label>
      <div class="btn-row eq c2" style="margin-top:6px">
        <button class="btn btn-ghost" data-act="noop">${ic('mic')} 语音转文字（示意）</button>
        <button class="btn btn-ghost" data-act="noop">${ic('camera')} 拍一张名片（示意）</button>
      </div>
      <div class="modal-foot" style="padding:16px 0 0;border:0"><button class="btn btn-ghost" data-act="modal-close">取消</button><button class="btn btn-primary" data-cap-next>AI 拆解</button></div>`;
    if(step===1) body=`${sp}
      <div class="notice rose">${ic('spark')}<div>以下为 AI 草稿（confirmed=false），你可以逐项修改；保存后事实仍标“待核实”，不会直接改变阶段或机会。</div></div>
      <div style="display:grid;gap:10px">
        <div class="ctx-item"><span class="dot jade" style="margin-top:6px"></span><div><b>互动</b>：电话沟通，客户来电，约 12 分钟<br><span class="ctx-src">来源：本次记录 · 重要性建议：高</span></div></div>
        <div class="ctx-item"><span class="dot gold" style="margin-top:6px"></span><div><b>信号候选</b>：子女计划赴英国读书，时间线与预算未定<br><span class="ctx-src">依据：客户原话 · 待核实</span></div></div>
        <div class="ctx-item"><span class="dot red" style="margin-top:6px"></span><div><b>承诺（我承诺）</b>：周三前发送家庭保障整理清单<br><span class="ctx-src">依据：原话“我答应周三前…”</span></div></div>
      </div>
      <div class="modal-foot"><button class="btn btn-ghost" data-cap-back>上一步</button><button class="btn btn-primary" data-cap-next>下一步：核对人物</button></div>`;
    if(step===2) body=`${sp}
      <label class="field"><span>这条记录属于谁？请人工选择（不自动新建）</span></label>
      <div style="display:grid;gap:9px">
        <label class="choice" style="display:flex;gap:10px;align-items:center;padding:12px;border:1.5px solid var(--red);border-radius:10px;background:var(--red-50)">
          <input type="radio" name="capwho" checked style="accent-color:var(--red);width:17px;height:17px">
          <span><b>林悦 · Person #1</b><br><small style="color:var(--ink-3)">上海 · 品牌负责人 · 客户 / 稳定（精确匹配）</small></span></label>
        <label class="choice" style="display:flex;gap:10px;align-items:center;padding:12px;border:1px solid var(--line);border-radius:10px">
          <input type="radio" name="capwho" style="accent-color:var(--red);width:17px;height:17px">
          <span><b>林月 · Person #34</b><br><small style="color:var(--ink-3)">苏州 · 同名近似，谨慎核对</small></span></label>
        <label class="choice" style="display:flex;gap:10px;align-items:center;padding:12px;border:1px solid var(--line);border-radius:10px">
          <input type="radio" name="capwho" style="accent-color:var(--red);width:17px;height:17px">
          <span><b>以上都不是</b>，为新客户新建身份（需再次确认）<br><small style="color:var(--ink-3)">新建走 person_identity_commands 台账</small></span></label>
      </div>
      <div class="modal-foot"><button class="btn btn-ghost" data-cap-back>上一步</button><button class="btn btn-primary" data-cap-next>下一步：确认提交</button></div>`;
    if(step===3) body=`${sp}
      <dl class="preview-kv">
        <dt>人物</dt><dd>林悦 · Person #1</dd>
        <dt>写入</dt><dd>1 条互动 + 1 条信号（待核实）+ 1 条承诺</dd>
        <dt>不写入</dt><dd>不自动建机会、不改阶段、不发消息</dd>
        <dt>提交方式</dt><dd>服务端原子提交；网络超时不自动重试，先到人物页核查</dd>
      </dl>
      <div class="modal-foot"><button class="btn btn-ghost" data-cap-back>上一步</button><button class="btn btn-primary" data-cap-next>${ic('check')} 确认保存</button></div>`;
    if(step===4){closeModal();toast('已保存：1 条互动 + 1 条信号 + 1 条承诺');setTimeout(rerender,400);return;}
    openModal(`<div class="grab"></div><div class="modal-head"><h2>${step===0?'快速记录':steps[step]}</h2><button class="icon-btn" data-act="modal-close">${ic('x')}</button></div><div class="modal-body">${body}</div>`);
  };
  draw();
  document.addEventListener('click',function h(e){
    const n=e.target.closest('[data-cap-next],[data-cap-back]');
    if(!n)return;
    if(n.hasAttribute('data-cap-next'))step++;else step--;
    draw();
  },{once:true});
}

/* ---------------- 人物目录 ---------------- */
function viewPeople(){
  const cards=DEMO.people.map(p=>`
    <button class="row row-click" style="align-items:center" data-go="#/person/${p.id}">
      <span class="avatar-lg ${p.alt}">${p.initial}</span>
      <div class="row-main">
        <div class="row-title">${p.n} <span class="badge ${p.priority==='A'?'red':'ghost'}">${p.priority} 级</span>
          ${p.tags.map(t=>`<span class="badge ${t.includes('招募')?'gold':t.includes('高净值')?'gold':''}">${t}</span>`).join('')}</div>
        <div class="row-sub">${p.city} · ${p.title} · ${p.co}</div>
        <div class="row-sub">客户阶段：${p.stage}</div>
      </div>${ic('chevronR')}
    </button>`).join('');
  return pageWrap('#/people',`<main class="page">
    ${head('PEOPLE','人物目录','客户、增员、嘉宾统一为 Person 身份；按精确 ID 关联，不按姓名自动合并',
      `<button class="btn btn-ghost btn-sm" data-act="noop">${ic('users')} 身份候选</button><button class="btn btn-primary btn-sm" data-act="noop">${ic('plus')} 新建人物</button>`)}
    <div class="toolbar">
      <div class="searchbox">${ic('search')}<input placeholder="搜索姓名 / 城市 / 机构"></div>
      <button class="icon-btn" data-act="noop">${ic('filter')}</button>
    </div>
    <div class="chip-row" style="margin-bottom:14px">
      ${['全部 8','客户 7','招募候选人 1','嘉宾 2','A 级 4','本周有互动 3','待确认身份 0'].map((c,i)=>`<button class="chip ${i===0?'active':''}">${c}</button>`).join('')}
    </div>
    <div class="stack">${cards}
      <div class="notice info">${ic('users')}<div>每页 50 人服务端分页；无 Person 映射的旧客户在人物页显示明确提示，不会在后台暗中建人。</div></div>
    </div>
  </main>`);
}

/* ---------------- Person 360 ---------------- */
const PTABS=['总览','互动时间线','事实与洞察','家庭与关系','保险概览','机会与行动','招募','活动'];
function viewPerson(idStr, tabStr){
  const p=DEMO.people.find(x=>x.id===Number(idStr))||DEMO.people[0];
  const tab=PTABS.indexOf(tabStr)>=0?PTABS.indexOf(tabStr):0;
  state.personTab=tab;
  const tabs=PTABS.map((t,i)=>`<button class="tab ${i===tab?'active':''}" data-go="#/person/${p.id}/${encodeURIComponent(t)}">${t}</button>`).join('');
  let body='';
  if(tab===0) body=`
  <div class="layout">
    <div class="stack">
      <section class="ai-box">
        <div class="ai-head"><span class="ai-ico">${ic('spark')}</span><b>人物摘要</b><span class="badge gold">AI · 待核实</span><button class="text-link" style="margin-left:auto" data-act="noop">全部来源</button></div>
        <p>希望先了解孩子留学的保障需求，<b>年度预算口径尚待核对</b>；配偶仅有社保，家庭医疗与教育金缺口最值得优先澄清。</p>
        <div class="src">示例来源：最近互动与已确认资料 · Person #1 · 未发送完整历史给模型</div>
      </section>
      <section class="card">
        <div class="card-head"><h2>${ic('check')} 正在推进的事</h2><button class="btn btn-soft btn-sm" data-act="noop">${ic('plus')} 创建行动</button></div>
        <div class="card-body">
          ${DEMO.actions.filter(a=>a.person==='林悦').map(a=>`
          <div class="task ${a.prio}">
            <button class="check" data-act="noop">${ic('check')}</button>
            <div class="task-main">
              <div class="task-top"><span class="prio ${a.prio}">${a.prio==='must'?'必做 M1':'应做 R1'}</span><span class="task-title">${a.t}</span></div>
              <div class="task-meta">${p.n} · ${a.due} · <span class="badge ghost">${a.state}</span></div>
              <div class="task-src">${a.src}</div>
              <div class="task-ops"><button class="text-link">编辑</button><button class="text-link">撤销</button><button class="text-link">查看来源</button></div>
            </div><span class="badge ${a.tag.includes('承诺')?'jade':'red'}">${a.tag}</span>
          </div>`).join('')}
        </div>
      </section>
      <section class="card">
        <div class="card-head"><h2>${ic('clock')} 最近的连接</h2><a class="see-all" data-go="#/person/1/${encodeURIComponent('互动时间线')}">全部记录 ${ic('chevronR')}</a></div>
        <div class="card-body"><div class="timeline">
          ${DEMO.timeline.slice(0,3).map(t=>`<div class="tl-item"><span class="tl-dot ${t.dot}"></span><div class="tl-body">
            <div class="tl-title">${t.t} <span class="badge ${t.badgeCls}">${t.badge}</span></div>
            <div class="tl-text">${t.text}</div><div class="tl-time tnum">${t.time}</div>
          </div></div>`).join('')}
        </div></div>
      </section>
    </div>
    <aside class="rail">
      <section class="card"><div class="card-body">
        <h3 style="font-size:14px;margin-bottom:12px">身份与角色</h3>
        <div class="kv-grid">
          <div class="kv"><small>城市</small><div>${p.city}</div></div>
          <div class="kv"><small>职业</small><div>${p.title}</div></div>
          <div class="kv"><small>机构</small><div>${p.co}</div></div>
          <div class="kv"><small>联系</small><div class="tnum">138****0001</div></div>
        </div>
        <div class="tag-row" style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap">${p.tags.map(t=>`<span class="badge ${t==='客户'?'red':''}">${t}</span>`).join('')}</div>
        <div class="btn-row eq c2" style="margin-top:14px"><button class="btn btn-ghost btn-sm" data-act="noop">编辑资料</button><button class="btn btn-ghost btn-sm" data-go="#/person/1/${encodeURIComponent('家庭与关系')}">关系网络</button></div>
      </div></section>
      <section class="card"><div class="card-body">
        <h3 style="font-size:14px;margin-bottom:10px">家庭与关系</h3>
        <div class="row-sub" style="font-size:12.5px;color:var(--ink);margin-bottom:12px">已婚 · 1 位子女 · 配偶有基础社保</div>
        <button class="btn btn-ghost btn-block btn-sm" data-go="#/person/1/${encodeURIComponent('家庭与关系')}">查看关系网络</button>
        <div style="height:9px"></div>
        <button class="btn btn-ghost btn-block btn-sm" data-go="#/person/1/${encodeURIComponent('保险概览')}">${ic('shield')} 查看保险资料</button>
      </div></section>
      <button class="btn btn-soft btn-block" data-act="noop">${ic('spark')} 会前准备 · 规划预览</button>
    </aside>
  </div>`;
  if(tab===1) body=`<section class="card"><div class="card-body"><div class="timeline">
    ${DEMO.timeline.map(t=>`<div class="tl-item"><span class="tl-dot ${t.dot}"></span><div class="tl-body">
      <div class="tl-title">${t.t} <span class="badge ${t.badgeCls}">${t.badge}</span></div>
      <div class="tl-text">${t.text}</div><div class="tl-time tnum">${t.time}</div>
    </div></div>`).join('')}
  </div>
  <div class="notice info" style="margin-top:16px">${ic('list')}<div>旧客户跟进、增员跟进、活动到场以只读方式投影到本时间线，不回填、不改写旧表。</div></div>
  </section>`;
  if(tab===2) body=`<div class="stack">
    ${[['事实 Fact（已确认）','jade',DEMO.context.fact],['信号 Signal（待核实）','gold',DEMO.context.signal],['推断 Inference（需人工评估）','gray',DEMO.context.inference]].map(([title,c,items])=>`
    <section class="card"><div class="card-head"><h2><span class="dot ${c}"></span>${title}</h2><span class="badge">${items.length} 条</span></div>
      <div class="card-body">${items.map(i=>`<div class="ctx-item"><div style="flex:1">${i.t}<div class="ctx-src">${i.src}</div></div>
      <span class="badge ${c==='jade'?'jade':'gold'}">${c==='jade'?'已确认':'待核实'}</span></div>`).join('')}</div>
    </section>`).join('')}
  </div>`;
  if(tab===3) body=`<div class="layout-eq">
    <section class="card"><div class="card-head"><h2>${ic('users')} 家庭成员</h2><button class="btn btn-soft btn-sm">${ic('plus')} 加入成员</button></div>
      <div class="card-body">
        ${[['配偶','张先生 · 基础社保','invited','已确认'],['女儿','10 岁 · 学平险','invited','已确认']].map(([r,n])=>`
        <div class="row"><span class="avatar-lg alt">${r[0]}</span><div class="row-main"><div class="row-title">${r}</div><div class="row-sub">${n}</div></div><span class="badge jade">${'已确认'}</span></div>`).join('')}
      </div></section>
    <section class="card"><div class="card-head"><h2>${ic('link')} 人际关系</h2></div>
      <div class="card-body">
        ${[['王宁','活动嘉宾 · 沙龙同桌','gold'],['李婉','转介绍来源 · 同小区','jade']].map(([n,r,c])=>`
        <div class="row"><span class="avatar-md avatar" style="border-radius:11px">${n[0]}</span><div class="row-main"><div class="row-title">${n}</div><div class="row-sub">${r}</div></div><span class="dot ${c}"></span></div>`).join('')}
        <div class="notice" style="margin-top:14px">${ic('alert')}<div>家庭与关系均为人工确认；AI 不会自动创建关系边。</div></div>
      </div></section>
  </div>`;
  if(tab===4) body=`<div class="stack">
    <section class="card"><div class="card-head"><h2>${ic('shield')} 保障矩阵 · 11 类资料</h2><button class="btn btn-soft btn-sm" data-act="noop">${ic('edit')} 人工编辑</button></div>
      <div class="card-body"><div class="cover-grid">${DEMO.covers.map(c=>`
        <div class="cover"><span>${c.n}</span><span class="badge ${c.c==='jade'?'jade':c.c==='gold'?'gold':'red'}">${c.s}</span></div>`).join('')}
      </div></div></section>
    <section class="card"><div class="card-head"><h2>${ic('file')} 保单检视报告</h2><span class="badge">五段式 · 人工可修订</span></div>
      <div class="card-body"><p class="page-sub" style="font-size:12.5px;color:var(--ink-2);line-height:1.9">现状概览 → 保障缺口（医疗 / 教育金优先）→ 家庭风险优先级 → 建议方向 → 待确认事项。报告由 AI 起草、人工修订后存档，不自动生成投保建议。</p>
      <div class="btn-row end" style="margin-top:12px"><button class="btn btn-ghost btn-sm" data-act="noop">查看历史报告</button><button class="btn btn-primary btn-sm" data-act="noop">生成检视草稿</button></div></div></section>
  </div>`;
  if(tab===5) body=`<div class="layout-eq">
    <section class="card"><div class="card-head"><h2>${ic('target')} 正式机会</h2><button class="btn btn-soft btn-sm">${ic('plus')} 新建机会</button></div>
      <div class="card-body">${state.opps.filter(o=>o.person===p.n).map(o=>`<div class="row"><span class="dot gold" style="margin-top:6px"></span><div class="row-main"><div class="row-title">${o.t}</div><div class="row-sub">${o.stage} · 更新于 ${o.updated}</div></div><span class="badge gold">${o.value}</span></div>`).join('')||'<div class="empty"><h3>暂无正式机会</h3><p>候选经你审核后才会成为正式机会。</p></div>'}</div></section>
    <section class="card"><div class="card-head"><h2>${ic('spark')} 机会候选</h2><span class="badge gold">1 待审</span></div>
      <div class="card-body"><div class="ai-box"><div class="ai-head"><span class="ai-ico">${ic('target')}</span><b>留学保障需求候选</b></div><p>证据：互动 #301 留学表述 + 家庭无教育金记录。证据不足时系统不生成候选。</p><div class="ai-actions"><button class="btn btn-ghost btn-sm">忽略</button><button class="btn btn-primary btn-sm">逐项审核</button></div></div></div></section>
  </div>`;
  if(tab===6) body=`<div class="empty">${ic('award')}<h3>该人物暂无招募角色</h3><p>当同一人成为增员候选人时，这里展示招募阶段、<br>六维评分与跟进时间线；人物可同时拥有多个角色。</p><button class="btn btn-soft" style="margin-top:12px" data-go="#/recruit">去招募工作台</button></div>`;
  if(tab===7) body=`<section class="card"><div class="card-body"><div class="stack" style="gap:10px">
    ${DEMO.activities.map(a=>`<div class="row row-click" data-go="#/activity/${a.id}"><span class="avatar-lg ${a.status==='已结束'?'':'gold'}" style="border-radius:13px">${ic('calendar')}</span><div class="row-main"><div class="row-title">${a.n} <span class="badge ${a.statusCls||'jade'}">${a.status}</span></div><div class="row-sub tnum">${a.date} · ${a.place}</div></div>${ic('chevronR')}</div>`).join('')}
  </div></div></section>`;

  return pageWrap('#/people',`<main class="page">
    <div class="crumb"><a href="#/people">人物目录</a>${ic('chevronR')}<span>Person #${p.id}</span></div>
    <section class="card" style="margin-bottom:14px"><div class="person-hero">
      <span class="avatar-lg ${p.alt}" style="width:60px;height:60px;border-radius:17px;font-size:23px">${p.initial}</span>
      <div class="ph-info">
        <h1>${p.n} <span class="badge ${p.priority==='A'?'red':'ghost'}">${p.priority} 级</span></h1>
        <div class="ph-sub">${p.city} · ${p.title} · Person #${p.id} · ${p.stage}</div>
        <div class="ph-tags">${p.tags.map(t=>`<span class="badge ${t==='客户'?'red':t.includes('招募')?'gold':''}">${t}</span>`).join('')}</div>
      </div>
      <div class="ph-actions btn-row">
        <button class="btn btn-primary" data-go="#/capture">${ic('mic')} 记录沟通</button>
        <button class="btn btn-ghost" data-act="noop">${ic('edit')} 完整客户档案</button>
      </div>
    </div></section>
    <div class="tabs">${tabs}</div>
    ${body}
  </main>`);
}

/* ---------------- 机会 ---------------- */
function viewOpportunities(){
  const stages=['发现','沟通','方案','成交'];
  const cols=stages.map((s,si)=>{
    const list=state.opps.filter(o=>o.stage===s);
    return `<div class="kcol"><div class="kcol-head"><span class="dot ${si===3?'jade':'gold'}"></span>${s}<span class="kcount tnum">${list.length}</span></div>
      ${list.map(o=>`<button class="opcard" data-opp="${o.id}">
        <h3>${o.t}</h3><div class="op-meta">${o.person} · 更新 ${o.updated}</div>
        <div class="op-foot"><span class="op-val">${o.value}</span><span class="text-link">推进 ${ic('chevronR')}</span></div>
      </button>`).join('')||'<div class="page-sub" style="font-size:11px;padding:6px 2px">本阶段暂无机会</div>'}</div>`;
  }).join('');
  return pageWrap('#/opportunities',`<main class="page">
    ${head('OPPORTUNITIES','经营机会：候选审核后才进入业务','Person 专属机会可无客户归属；阶段推进与关闭都走预览确认，关闭时记录 Outcome',
      `<button class="btn btn-ghost btn-sm" data-act="noop">${ic('list')} 已关闭/结果</button><button class="btn btn-primary btn-sm" data-act="noop">${ic('plus')} 新建机会</button>`)}
    <div class="stack">
      <section class="card"><div class="card-head"><h2>${ic('spark')} 待确认候选</h2><span class="badge gold">1 待审</span></div>
        <div class="card-body"><div class="ai-box">
          <div class="ai-head"><span class="ai-ico">${ic('target')}</span><b>留学保障需求候选</b><span class="badge gold">证据 2 条</span></div>
          <p><b>林悦</b>：互动 #301 明确留学表述 + 保障矩阵无教育金；建议进入「发现」阶段继续澄清预算。</p>
          <div class="ai-actions"><button class="btn btn-ghost btn-sm">拒绝候选</button><button class="btn btn-gold btn-sm">编辑候选</button><button class="btn btn-primary btn-sm">接受并建机会</button></div>
        </div></div>
      </section>
      <div class="kanban">${cols}</div>
      <div class="notice info">${ic('alert')}<div>阶段不由 AI 自动推进；关闭机会时在同一事务写入 Outcome（结果 / 感受 / 业务价值），行动关联走专用关联表，不改动旧记录。</div></div>
    </div>
  </main>`);
}

/* ---------------- 活动 ---------------- */
function viewActivities(){
  return pageWrap('#/activities',`<main class="page">
    ${head('ACTIVITIES','活动工作台','先有人，才有数字：报名与实际到场分开记录，复盘逐人审核',
      `<button class="btn btn-ghost btn-sm" data-act="noop">${ic('chart')} 活动量日报</button><button class="btn btn-primary btn-sm" data-act="noop">${ic('plus')} 新建活动</button>`)}
    <div class="stack">
      <div class="cal-strip">${['一','二','三','四','五','六','日'].map((d,i)=>`
        <div class="cal-day ${i===4?'active':[2,6].includes(i)?'has':''}"><b>${[29,30,1,2,3,4,5][i]}</b>${d}${i===2?'<br>沙龙':''}${i===6?'<br>参观日':''}</div>`).join('')}</div>
      <div class="chip-row">${['全部 3','筹备中 1','已确认 1','已结束 1'].map((c,i)=>`<button class="chip ${i===0?'active':''}">${c}</button>`).join('')}</div>
      ${DEMO.activities.map(a=>`<div class="row row-click" style="align-items:center;padding:16px" data-go="#/activity/${a.id}/overview">
        <span class="avatar-lg ${a.status==='已结束'?'':'gold'}" style="border-radius:14px">${ic('calendar')}</span>
        <div class="row-main">
          <div class="row-title" style="font-size:14.5px">${a.n} <span class="badge ${a.statusCls||'jade'}">${a.status}</span></div>
          <div class="row-sub tnum" style="margin-top:4px">${a.date} · ${a.place}</div>
          <div class="row-sub">已到场 ${a.attended} 人${a.invited?` · 已邀请 ${a.invited} 人`:''} · 待办 ${a.tasks} 项</div>
        </div>${ic('chevronR')}</div>`).join('')}
    </div>
  </main>`);
}
const ATABS=['活动概览','参与者','任务','嘉宾与主题','AI 筹备','复盘与结果','AI 辅助工具'];
function viewActivity(idStr, tabStr){
  const a=DEMO.activities.find(x=>x.id===Number(idStr))||DEMO.activities[0];
  const tab=ATABS.indexOf(tabStr)>=0?ATABS.indexOf(tabStr):0;
  const tabs=ATABS.map((t,i)=>`<button class="tab ${i===tab?'active':''}" data-go="#/activity/${a.id}/${encodeURIComponent(t)}">${t}</button>`).join('');
  let body='';
  if(tab===0) body=`<div class="layout">
    <div class="stack">
      <section class="card"><div class="card-head"><h2>${ic('users')} 到场概览</h2></div><div class="card-body">
        <div class="stats" style="box-shadow:none"><div class="stat"><div class="stat-label">已邀请</div><div class="stat-num tnum">${a.invited||18}</div></div><div class="stat"><div class="stat-label">实际到场</div><div class="stat-num jade tnum">${a.attended||11}</div></div><div class="stat"><div class="stat-label">缺席</div><div class="stat-num red tnum">${(a.invited||18)-(a.attended||11)}</div></div><div class="stat"><div class="stat-label">重要互动</div><div class="stat-num gold tnum">4</div></div></div>
        <div class="notice info" style="margin-top:14px">${ic('users')}<div>“到场”独立记录，普通报名不会产生高价值互动；行动候选需要同活动同人的重要互动支撑。</div></div>
      </div></section>
      <section class="card"><div class="card-head"><h2>${ic('clock')} 活动流程</h2></div><div class="card-body"><div class="timeline">
        <div class="tl-item"><span class="tl-dot jade"></span><div class="tl-body"><div class="tl-title">签到入场 <span class="badge jade">完成</span></div><div class="tl-time">13:30</div></div></div>
        <div class="tl-item"><span class="tl-dot jade"></span><div class="tl-body"><div class="tl-title">主题分享：家庭健康管理</div><div class="tl-text">嘉宾王宁主持，现场提问集中在体检与既往症。</div><div class="tl-time">14:00 - 15:00</div></div></div>
        <div class="tl-item"><span class="tl-dot gold"></span><div class="tl-body"><div class="tl-title">一对一交流 <span class="badge gold">4 条重要互动</span></div><div class="tl-time">15:00 - 16:00</div></div></div>
      </div></div></section>
    </div>
    <aside class="rail">
      <section class="card"><div class="card-body">
        <h3 style="font-size:14px;margin-bottom:10px">活动信息</h3>
        <div class="kv-grid">
          <div class="kv"><small>日期</small><div class="tnum">${a.date}</div></div><div class="kv"><small>状态</small><div>${a.status}</div></div>
          <div class="kv" style="grid-column:1/-1"><small>地点</small><div>${a.place}</div></div>
        </div>
        <div class="btn-row eq c2" style="margin-top:13px"><button class="btn btn-ghost btn-sm">${ic('edit')} 编辑</button><button class="btn btn-ghost btn-sm" data-go="#/activity/${a.id}/${encodeURIComponent('参与者')}">参与者</button></div>
      </div></section>
      <button class="btn btn-primary btn-block" data-go="#/activity/${a.id}/${encodeURIComponent('复盘与结果')}">${ic('spark')} 进入复盘 V2</button>
    </aside></div>`;
  if(tab===1) body=`<section class="card"><div class="card-head"><h2>${ic('users')} 参与者（5）</h2><div class="btn-row"><button class="btn btn-ghost btn-sm">导出</button><button class="btn btn-primary btn-sm">${ic('plus')} 添加参与者</button></div></div>
    <div class="card-body" style="padding-top:10px">
      ${DEMO.participants.map(p=>`<div class="row"><span class="avatar-md avatar" style="border-radius:11px">${p.n[0]}</span>
        <div class="row-main"><div class="row-title">${p.n} <span class="badge">${p.r}</span></div><div class="row-sub">${p.note}</div></div>
        <span class="person-state ${p.state}">${p.stateText}</span></div>`).join('')}
    </div></section>`;
  if(tab===2) body=`<section class="card"><div class="card-head"><h2>${ic('check')} 筹备任务（3）</h2><button class="btn btn-primary btn-sm">${ic('plus')} 拆解新任务</button></div>
    <div class="card-body">${DEMO.actTasks.map(t=>`<div class="task ${t.done?'done':''}" style="border-left-color:var(--line-2)"><button class="check">${ic('check')}</button><div class="task-main"><div class="task-top"><span class="task-title">${t.t}</span></div><div class="task-meta">${t.who} · 截止 ${t.due}</div></div></div>`).join('')}</div></section>`;
  if(tab===3) body=`<div class="layout-eq">
    <section class="card"><div class="card-head"><h2>${ic('users')} 嘉宾资源池</h2><button class="btn btn-primary btn-sm">新建嘉宾</button></div><div class="card-body">
      <div class="row"><span class="avatar-lg gold">王</span><div class="row-main"><div class="row-title">王宁 <span class="badge gold">已关联 Person #2</span></div><div class="row-sub">私企业主 · 健康/财税主题 · 合作 3 次</div></div><button class="icon-btn">${ic('edit')}</button></div>
    </div></section>
    <section class="card"><div class="card-head"><h2>${ic('book')} 主题资源池</h2><button class="btn btn-primary btn-sm">新建主题</button></div><div class="card-body">
      <div class="row"><span class="avatar-lg alt" style="border-radius:13px">${ic('book')}</span><div class="row-main"><div class="row-title">家庭健康管理</div><div class="row-sub">适用：中端客户沙龙 · 资料 4 份 · 关联活动 2 场</div></div><button class="icon-btn">${ic('edit')}</button></div>
    </div></section></div>`;
  if(tab===4) body=`<div class="stack"><div class="ai-box"><div class="ai-head"><span class="ai-ico">${ic('spark')}</span><b>AI 筹备建议</b><span class="badge gold">草稿 · 可修改</span></div>
    <p>本场到场客户中 3 人有家庭成员健康相关记录，建议在一对一环节优先倾听体检与既往症话题，不做产品推销；回访在 48 小时内完成效果最好。</p><div class="src">依据：参与者画像与历史互动 · 不发送完整客户资料</div>
    <div class="ai-actions"><button class="btn btn-ghost btn-sm">重新生成</button><button class="btn btn-primary btn-sm">采纳为筹备备注</button></div></div>
    <button class="btn btn-soft btn-block" data-go="#/activity/${a.id}/${encodeURIComponent('AI 辅助工具')}">${ic('grid')} 打开全部 AI 辅助工具</button></div>`;
  if(tab===5) body=`<div class="stack">
    <section class="card"><div class="card-head"><h2>${ic('spark')} 复盘 V2 · 逐项审核</h2><span class="badge">基于有界活动上下文</span></div>
      <div class="card-body"><div style="display:grid;gap:11px">
        ${[['王宁 · 行动候选','预约年度医疗保障检视','活动现场两次提及体检异常与住院史','重要互动 #511'],
           ['林悦 · 机会候选','留学保障需求','沟通中确认子女留学计划，家庭无教育金','重要互动 #509'],
           ['李婉 · 结果记录','带新朋友到场，转介绍意愿待确认','其朋友留下联系方式并同意回访','到场记录']]
          .map(([t,desc,why,src],i)=>`<div class="ctx-item" style="display:block">
            <div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap"><b>${t}</b><span class="badge ${i===2?'jade':'gold'}">${i===2?'结果（已发生事实）':'候选 · 待你确认'}</span></div>
            <div style="margin-top:5px;font-size:12.5px">${desc}</div><div class="ctx-src">依据：${why} · ${src}</div>
            <div class="btn-row eq c3" style="margin-top:10px"><button class="btn btn-ghost btn-sm">拒绝</button><button class="btn btn-gold btn-sm">编辑</button><button class="btn btn-primary btn-sm">接受</button></div>
          </div>`).join('')}
      </div><div class="notice info" style="margin-top:14px">${ic('check')}<div>同一实质来源不能换引用重复接受；接受后服务端复检 AI 审计、人物、来源与活动状态。</div></div></div>
    </section></div>`;
  if(tab===6) body=`<div class="tool-grid">
    ${[['check','任务拆解','从筹备目标拆成可确认的任务'],['users','推荐嘉宾','核对嘉宾资源、主题匹配与合作意愿'],['book','推荐主题','从目标人群与活动目的挑选主题'],
       ['send','逐人跟进建议','区分到场事实与需求意向，再安排回访'],['refresh','六维复盘','保留旧版活动分析和六维复盘入口'],['book','活动学习记录','人工整理经验，独立于未来全局学习引擎']]
      .map(([i,t,d])=>`<button class="tool-tile"><span class="tt-ico">${ic(i)}</span><b>${t}</b><p>${d}</p><span class="text-link">打开 ${ic('chevronR')}</span></button>`).join('')}
  </div>`;
  return pageWrap('#/activities',`<main class="page">
    <div class="crumb"><a href="#/activities">全部活动</a>${ic('chevronR')}<span>活动 #${a.id}</span></div>
    ${head('ACTIVITY / PEOPLE BEFORE NUMBERS',a.n,`${a.date} · ${a.place} · 活动 #${a.id}`,`<span class="badge ${a.statusCls||'jade'}">${a.status}</span>`)}
    <div class="tabs">${tabs}</div>${body}
  </main>`);
}

/* ---------------- 招募 ---------------- */
function viewRecruit(){
  const max=Math.max(...DEMO.recruitStages.map(s=>s.c));
  return pageWrap('#/recruit',`<main class="page">
    ${head('RECRUIT','组织发展工作台','八阶段漏斗 · 六维评分 · 增员候选人同样以 Person 身份归档',
      `<button class="btn btn-ghost btn-sm" data-act="noop">${ic('chart')} 月度目标</button><button class="btn btn-primary btn-sm" data-act="noop">${ic('plus')} 新增人才</button>`)}
    <div class="layout">
      <div class="stack">
        <div class="chip-row">${['全部 4','签约入司 1','入职申请 1','精准面谈 1','增员活动 1'].map((c,i)=>`<button class="chip ${i===0?'active':''}">${c}</button>`).join('')}</div>
        ${DEMO.recruitCands.map(c=>`<div class="row row-click"><span class="avatar-lg gold">${c.n[0]}</span>
          <div class="row-main"><div class="row-title">${c.n} <span class="badge gold">${c.stage}</span></div>
          <div class="row-sub">${c.tags.join(' · ')}</div><div class="row-sub tnum">更新于 ${c.updated}</div></div>
          <div style="text-align:center;flex-shrink:0"><div class="stat-num tnum" style="font-size:20px;color:var(--gold)">${c.score}</div><div class="row-sub">六维评分</div></div>
          ${ic('chevronR')}</div>`).join('')}
      </div>
      <aside class="rail">
        <section class="card"><div class="card-head"><h2>${ic('chart')} 八阶段漏斗</h2></div><div class="card-body"><div class="funnel">
          ${DEMO.recruitStages.map(s=>`<div class="frow"><span>${s.n}</span><div class="fbar"><i style="width:${Math.round(s.c/max*100)}%;--o:${0.45+0.55*s.c/max}"></i></div><b class="tnum">${s.c}</b></div>`).join('')}
        </div></div></section>
        <section class="card"><div class="card-body"><h3 style="font-size:14px;margin-bottom:9px">9 月目标 vs 行业基准</h3>
          <div class="kv-grid">
            <div class="kv"><small>月度新增目标</small><div class="tnum">6 / 达成 8</div></div><div class="kv"><small>入司目标</small><div class="tnum">1 / 达成 1</div></div>
          </div>
          <div class="notice" style="margin-top:12px"><span></span><div>小样本（&lt;3）只显示数字，不做趋势判断。</div></div>
        </div></section>
        <button class="btn btn-ghost btn-block" data-act="noop">${ic('mic')} AI 增员话术（五步法 / STAR）</button>
      </aside>
    </div>
  </main>`);
}

/* ---------------- 更多 ---------------- */
function viewMore(){
  const tiles=[
    ['users','传统客户列表','11 列 · 搜索排序分页 · 转增员','#/customers-legacy'],
    ['trash','客户 / 增员回收站','软删除恢复 · 批次影响预览','#/trash-legacy'],
    ['chart','经营漏斗','客户 / 机会 / 招募三漏斗','#/funnels-legacy'],
    ['users','嘉宾 / 主题资源','资源池管理与活动关联','#/speakers-legacy'],
    ['calendar','客户 / 招募活动量','日期类型统计与明细','#/stats-legacy'],
    ['spark','AI 建议历史','筛选 · 采纳 · 忽略 · 执行结果','#/ai-suggestions-legacy'],
    ['shield','产品与保单','11 类保障 · 检视报告人工修订','#/policies-legacy'],
    ['camera','照片与附件','选择文件 · 预览 · 备注','#/files-legacy'],
    ['file','OCR / AI 解析','逐字段校对 · 已有客户合并对比','#/ocr-legacy'],
    ['gift','伴手礼记录','新增 · 编辑 · 删除明细','#/gifts-legacy'],
    ['list','客户跟进','方式 · 结果 · 需求 · 下一步','#/followups-legacy'],
    ['flag','招募目标','月份 · 目标 · 完成 · 基准','#/goals-legacy'],
    ['settings','账号与应用维护','改密 · 退出 · 强制加载最新版','#/account'],
    ['check','测试场景','虚构样本登记 · 幂等演示','#/scenario-legacy'],
    ['map','页面与功能地图','全部设计页面索引','#/map'],
    ['book','设计说明','配色、布局与交互决策说明','#/about'],
  ];
  return pageWrap('#/more',`<main class="page">
    ${head('MORE','更多功能','旧版功能完整保留并持续可用；新架构与旧功能并行互通')}
    <div class="tile-grid">${tiles.map(([i,t,d,h])=>`
      <button class="tile" data-go="${h}"><span class="t-ico">${ic(i)}</span><b>${t}</b><p>${d}</p><span class="tile-foot"><span class="text-link">打开 ${ic('chevronR')}</span></span></button>`).join('')}
    </div>
  </main>`);
}

/* ---------------- 账号 ---------------- */
function viewAccount(){
  return pageWrap('#/more',`<main class="page" style="max-width:720px">
    ${head('ACCOUNT','账号与应用维护')}
    <div class="stack">
      <section class="card"><div class="card-head"><h2>${ic('user')} 当前账号</h2></div><div class="card-body">
        <div class="kv-grid">
          <div class="kv"><small>显示名</small><div>Victor 梁</div></div><div class="kv"><small>登录方式</small><div>CloudBase 用户名密码</div></div>
          <div class="kv"><small>会话策略</small><div>5 分钟无操作重新登录</div></div><div class="kv"><small>版本基线</small><div class="tnum">release-20261005-162209</div></div>
        </div>
        <div class="btn-row eq c3" style="margin-top:16px"><button class="btn btn-ghost btn-sm" data-act="noop">${ic('key')} 修改密码</button><button class="btn btn-gold btn-sm" data-act="noop">${ic('refresh')} 强制加载最新版</button><button class="btn btn-danger btn-sm" data-act="logout">${ic('logout')} 退出登录</button></div>
      </div></section>
      <div class="notice info">${ic('check')}<div>前端静态文件以 no-store 提供；如怀疑缓存漂移，使用「强制加载最新版」重新拉取 admin.html 与模块资源。</div></div>
    </div>
  </main>`);
}

/* ---------------- 设计说明 / 地图 ---------------- */
function viewAbout(){
  const sw=[['#d31145','AIA 朱红','主操作 · 当前导航 · 品牌'],['#2e333b','墨色','正文 · 晨间简报卡'],['#a87a1e','暖金','机会 · 财富 · 对方承诺'],['#1b8a5e','翠色','完成 · 已确认事实 · 我承诺'],['#fbeaf0','玫粉','AI 建议背景'],['#f5f5f7','浅灰','页面底色']];
  const notes=[
    ['check','更清晰的信息层级','页面标题收敛到 20–22px；卡片标题统一 14.5px；元信息 11–12px，减少装饰性大字。'],
    ['spark','墨色简报替代红色装饰球','首屏签名元素改为「晨间简报」深色卡：3 条有序要点，每条带人物、来源与内嵌动作，红仅作 4px 引导条。'],
    ['check','Today 5 优先级芯片','必做 M / 应做 R / 可做 O 顺序编号，左侧色条对应优先级，完成后划线降透明度。'],
    ['grid','按钮对称与等高','主/次/幽灵/危险四档按钮统一 40px（手机 44px）；卡片底栏与 AI 操作区采用等宽栅格，右对齐。'],
    ['users','双端独立版式','iPad 顶部 7 导航 + 330px 右栏；iPhone 底部五格栏 + 中央凸起记录 FAB，弹层走底部 Bottom Sheet。'],
    ['shield','AI 透明三要素','每个 AI 块固定展示：状态徽章（待核实/已确认）、可核验来源、对称的采纳/编辑/拒绝操作。'],
  ];
  return pageWrap('#/more',`<main class="page">
    ${head('DESIGN NOTES','设计说明：本版相对 codex 原型的优化点','2026-10-05 · iPad 与 iPhone 15 Pro Max（430×932）双端方案，待确认后再开发')}
    <div class="stack">
      <section class="card"><div class="card-head"><h2>${ic('spark')} 配色（沿用既有设计文档）</h2></div><div class="card-body">
        <div class="swatch-row">${sw.map(([hex,n,u])=>`<div class="swatch"><i style="background:${hex}"></i><div><b>${n}</b><span class="tnum">${hex}</span><br>${u}</div></div>`).join('')}</div>
      </div></section>
      <section class="card"><div class="card-head"><h2>布局与交互优化</h2></div><div class="card-body"><ul class="design-note">
        ${notes.map(([i,t,d])=>`<li><span class="n-ico">${ic(i)}</span><div><b>${t}。</b>${d}</div></li>`).join('')}
      </ul></div></section>
      <section class="card"><div class="card-head"><h2>双端差异</h2></div><div class="card-body">
        <div class="kv-grid">
          <div class="kv"><small>iPad（横/竖向自适应）</small><div>顶部横向主导航；主辅双栏（主列 + 330px 固定右栏）；机会四列看板；编辑用居中对话框；工具三列宫格。</div></div>
          <div class="kv"><small>iPhone 15 Pro Max（430×932）</small><div>灵动岛 + 状态栏；底部五格标签栏与凸起红色记录键；全部单栏卡片；看板横滑；编辑用底部弹层；触控目标 ≥44px；输入框 16px 防缩放；保留安全区。</div></div>
        </div>
      </div></section>
      <div class="notice rose">${ic('alert')}<div>本文件为静态界面原型，所有数据虚构；未改造、部署或连接正式业务系统。</div></div>
    </div>
  </main>`);
}
function viewMap(){
  const groups=[
    ['主导航',[['今日 · 简报与 Today5','#/today'],['AI 助手','#/ai'],['AI 搜索','#/search'],['五段式创建行动','#/command']]],
    ['人物与机会',[['人物目录','#/people'],['Person 360 · 总览','#/person/1/overview'==='#/x'?'#/person/1':'#/person/1'],['互动时间线','#/person/1/互动时间线'],['事实与洞察','#/person/1/事实与洞察'],['保险概览','#/person/1/保险概览'],['机会与行动','#/person/1/机会与行动'],['机会看板','#/opportunities']]],
    ['活动与招募',[['活动工作台','#/activities'],['活动概览','#/activity/501/活动概览'],['复盘 V2','#/activity/501/复盘与结果'],['招募工作台','#/recruit']]],
    ['其他',[['更多功能','#/more'],['账号维护','#/account'],['设计说明','#/about']]],
  ];
  return pageWrap('#/more',`<main class="page">
    ${head('SITEMAP','页面与功能地图','评审用导航；可逐页点击体验，刷新后交互状态重置')}
    <div class="stack">${groups.map(([g,items])=>`<section class="card"><div class="card-head"><h2>${g}</h2></div>
      <div class="card-body" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:9px">
      ${items.map(([t,h])=>`<button class="btn btn-ghost" style="justify-content:flex-start" data-go="${h}">${t}</button>`).join('')}
      </div></section>`).join('')}
    </div>
  </main>`);
}

/* ---------------- 旧功能占位 ---------------- */
function viewLegacy(name){
  return pageWrap('#/more',`<main class="page">
    <div class="crumb"><a href="#/more">更多</a>${ic('chevronR')}<span>${name}</span></div>
    <div class="empty" style="padding:60px 24px">${ic('grid')}<h3>${name}（旧版功能）</h3><p>本原型聚焦新架构页面的重设计；该旧版页面保持现状继续可用，<br>正式开发时沿用现有 admin.html 实现，不改交互语义。</p>
    <div style="height:14px"></div><button class="btn btn-soft" data-go="#/more">返回更多功能</button></div>
  </main>`);
}

/* ---------------- 路由 ---------------- */
const routes=[
  [/^#\/today$/,()=>viewToday()],
  [/^#\/ai$/,()=>viewAI()],
  [/^#\/search$/,()=>viewSearch()],
  [/^#\/command$/,()=>viewCommand()],
  [/^#\/people$/,()=>viewPeople()],
  [/^#\/person\/(\d+)(?:\/(.+))?$/,m=>viewPerson(m[1],decodeURIComponent(m[2]||''))],
  [/^#\/opportunities$/,()=>viewOpportunities()],
  [/^#\/activities$/,()=>viewActivities()],
  [/^#\/activity\/(\d+)(?:\/(.+))?$/,m=>viewActivity(m[1],decodeURIComponent(m[2]||''))],
  [/^#\/recruit$/,()=>viewRecruit()],
  [/^#\/more$/,()=>viewMore()],
  [/^#\/account$/,()=>viewAccount()],
  [/^#\/about$/,()=>viewAbout()],
  [/^#\/map$/,()=>viewMap()],
  [/^#\/capture$/,()=>{setTimeout(openCapture,0);return viewToday();}],
  [/^#\/(review|customers|trash|funnels|speakers|stats|ai-suggestions|policies|files|ocr|gifts|followups|goals|scenario|prep)-legacy(?:\/.*)?$/,m=>viewLegacy({review:'今日 / 七日复盘',customers:'传统客户列表',trash:'回收站',funnels:'经营漏斗',speakers:'嘉宾 / 主题资源',stats:'活动量日报','ai-suggestions':'AI 建议历史',policies:'产品与保单',files:'照片与附件',ocr:'OCR / AI 解析',gifts:'伴手礼记录',followups:'客户跟进',goals:'招募目标',scenario:'测试场景'}[m[1]]||'旧版功能')],
  [/^#\/prep\/\d+$/,()=>viewLegacy('会前准备 / 对话策略（规划预览）')],
];
function render(){
  const app=document.getElementById('app');
  if(IS_P){
    const screen=document.querySelector('.device-screen');
    if(screen && !screen.querySelector('.dynamic-island')){
      const island=document.createElement('div');island.className='dynamic-island';screen.insertBefore(island,app);
    }
  }
  if(!state.logged){app.innerHTML=(IS_P?chrome('').statusbar:'')+viewLogin();window.scrollTo(0,0);return;}
  let hash=location.hash||'#/today';
  for(const [re,fn] of routes){const m=hash.match(re);if(m){app.innerHTML=fn(m);window.scrollTo({top:0});return;}}
  app.innerHTML=viewToday();window.scrollTo(0,0);
}

/* ---------------- 全局事件 ---------------- */
document.addEventListener('click',e=>{
  const go=e.target.closest('[data-go]');
  if(go){e.preventDefault();go(go.getAttribute('data-go'));return;}
  const actEl=e.target.closest('[data-act]');
  if(!actEl)return;
  const act=actEl.dataset.act;
  if(act==='modal-close'){closeModal();return;}
  if(act==='logout'){state.logged=false;closeModal();location.hash='';render();toast('已退出登录');return;}
  if(act==='login'){/* form submit handles */return;}
  if(act==='toggle-task'){const id=actEl.dataset.id;state.done[id]=!state.done[id];toast(state.done[id]?'已标记完成':'已恢复为进行中');render();return;}
  if(act==='cand-approve'){state.cand[actEl.dataset.id]='ok';toast('候选已送审，等待业务确认');render();return;}
  if(act==='cand-reject'){state.cand[actEl.dataset.id]='no';toast('已忽略该候选');render();return;}
  if(act==='toggle-brief'){toast('完整简报：模型等待上限 10 秒');return;}
  if(act==='search-run'){state.searchRan=true;render();return;}
  if(act==='search-reset'){state.searchRan=false;render();return;}
  if(act==='cmd-next'){state.commandStep=Math.min(4,state.commandStep+1);render();return;}
  if(act==='cmd-back'){state.commandStep=Math.max(0,state.commandStep-1);render();return;}
  if(act==='cmd-reset'){state.commandStep=0;render();return;}
  if(act==='cmd-bad'){openModal(`<div class="modal-head"><h2>指令已拒绝</h2><button class="icon-btn" data-act="modal-close">${ic('x')}</button></div>
    <div class="modal-body"><div class="notice rose">${ic('alert')}<div><b>EXECUTOR_NOT_ENABLED</b><br>“删除所有行动”属于未启用的危险操作；当前执行器仅支持创建行动。自然语言不能绕过页面授权。</div></div>
    <div class="btn-row end"><button class="btn btn-primary" data-act="modal-close">我知道了</button></div></div>`);return;}
  if(act==='noop')return;
});
document.addEventListener('submit',e=>{
  if(e.target.matches('[data-act="login"]')){e.preventDefault();state.logged=true;location.hash='#/today';render();toast('欢迎回来，Victor');}
});
document.addEventListener('click',e=>{
  const oppEl=e.target.closest('[data-opp]');
  if(!oppEl)return;
  const o=state.opps.find(x=>x.id===Number(oppEl.dataset.opp));
  if(!o)return;
  const last=o.stage==='方案';
  openModal(`<div class="grab"></div><div class="modal-head"><h2>${o.t}</h2><button class="icon-btn" data-act="modal-close">${ic('x')}</button></div>
  <div class="modal-body">
    <dl class="preview-kv">
      <dt>人物</dt><dd>${o.person} · Person 关联</dd>
      <dt>当前阶段</dt><dd><span class="badge gold">${o.stage}</span></dd>
      <dt>预估价值</dt><dd class="tnum">${o.value}</dd>
      <dt>最近更新</dt><dd class="tnum">${o.updated}</dd>
    </dl>
    <div class="notice rose" style="margin-top:14px">${ic('alert')}<div>阶段推进与关闭均走「预览 → 确认 → 执行」，关闭时同事务记录 Outcome；本弹层仅示意操作入口。</div></div>
  </div>
  <div class="modal-foot">
    <button class="btn btn-danger" data-act="modal-close">关闭并记录结果</button>
    <button class="btn btn-primary" data-act="modal-close">${last?'推进到成交':'推进到下一阶段'}</button>
  </div>`);
});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
window.addEventListener('hashchange',render);
render();
