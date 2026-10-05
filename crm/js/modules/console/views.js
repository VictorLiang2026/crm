// Console 页面框架（WP0）：结构、导航与空态；业务数据按排期接入（WP1 只读 / WP2 写入 / WP3 AI）。
// 约定：所有数据区带 WP 标签；除「退出登录」与本地页签切换外不发起任何云函数调用。
import { h } from './dom.js';
import { ic } from './icons.js';

// ---------- 通用构件 ----------
function wpTag(text, hot) {
  return h('span', { class: 'wp-tag' + (hot ? ' hot' : '') }, text);
}
function sk(width, cls) {
  return h('span', { class: 'sk ' + (cls || ''), style: 'width:' + width });
}
function pageHead({ kicker, title, sub, actions, tag }) {
  return h('div', { class: 'page-head' }, [
    h('div', { class: 'page-head-row' }, [
      h('div', {}, [
        h('div', { class: 'kicker' }, kicker),
        h('h1', { class: 'page-title' }, [title, tag ? h('span', { style: 'margin-left:10px;vertical-align:middle' }, tag) : null]),
        sub ? h('p', { class: 'page-sub' }, sub) : null,
      ]),
      actions && actions.length ? h('div', { class: 'head-actions' }, actions) : null,
    ]),
  ]);
}
function card({ title, icon, tag, body, foot, cls }) {
  return h('section', { class: 'card ' + (cls || '') }, [
    title ? h('div', { class: 'card-head' }, [icon ? ic(icon) : null, h('b', {}, title), tag ? h('span', { style: 'margin-left:auto' }, tag) : null]) : null,
    body ? h('div', { class: 'card-body' }, body) : null,
    foot ? h('div', { class: 'card-foot' }, foot) : null,
  ]);
}
function emptyNote(title, note) {
  return h('div', { class: 'empty' }, [h('b', {}, title), note]);
}
function toastWp(ctx, text) {
  return () => ctx.toast(text);
}

// ---------- 今日 ----------
function renderToday(ctx) {
  const d = new Date();
  const week = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()];
  const brief = h('section', { class: 'brief' }, [
    h('div', { class: 'brief-head' }, [
      ic('bell'), h('b', {}, '晨间简报'), wpTag('AI 生成 · WP3'),
      h('span', { style: 'margin-left:auto;font-size:12px;opacity:.7' },
        `${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${week}`),
    ]),
    h('div', { class: 'brief-body' }, [1, 2, 3].map((i) =>
      h('div', { class: 'brief-row' }, [
        h('span', { class: 'brief-num' }, String(i)),
        h('div', { style: 'flex:1;display:flex;flex-direction:column;gap:8px;padding-top:4px' }, [sk('86%', 't'), sk('58%')]),
      ]))),
    h('div', { class: 'brief-foot' }, [
      h('span', {}, '每条要点将带来源与依据，由你确认后才影响今日安排'),
      h('span', { class: 'wp-tag' }, 'WP3 接入'),
    ]),
  ]);
  const today5 = card({
    title: '优先行动 · Today 5', icon: 'chevron', tag: wpTag('WP1 接入'),
    body: [1, 2, 3].map(() => h('div', { class: 'sk-row' }, [sk('34%'), sk('48%')])),
    foot: [h('span', { class: 'foot-note' }, '将按 必做 M（红）/ 应做 R（墨）/ 可做 O（灰）三级排序'), h('span', { style: 'margin-left:auto' }, '')],
  });
  const stats = h('div', { class: 'stat-row' }, [
    ['待办行动', 'var(--red)'], ['待履承诺', 'var(--gold)'], ['待确认候选', 'var(--ink-2)'], ['近期活动', 'var(--jade)'],
  ].map(([label, color]) => h('div', { class: 'stat' }, [
    h('b', { style: 'color:' + color }, h('span', { class: 'sk', style: 'width:26px;height:22px;display:inline-block' })),
    h('span', {}, label),
  ])));
  const candidates = card({
    title: '需要你确认', icon: 'shield', tag: wpTag('WP2 接入'),
    body: [emptyNote('候选生成与审核流程', '机会候选 / 身份候选将在此集中呈现：拒绝、编辑、接受并建机会，三键等宽。')],
  });
  const aside = [
    card({ title: '今日节奏', body: [sk('92%'), sk('70%')], tag: wpTag('WP1') }),
    card({ title: '双向承诺', body: [sk('84%'), sk('62%')], tag: wpTag('WP1') }),
    card({ title: '关系风险', body: [sk('78%'), sk('55%')], tag: wpTag('WP1') }),
    card({ title: '机会速览', body: [sk('88%'), sk('48%')], tag: wpTag('WP1') }),
  ];
  ctx.main.replaceChildren(
    pageHead({
      kicker: 'TODAY', title: `早安，${ctx.operator.name || 'Victor'} · 今天先做什么`,
      sub: '框架预览：先定要事，再看数字。数据接入见各卡片 WP 标签。',
    }),
    h('div', { class: 'today-grid' }, [
      h('div', {}, [brief, h('div', { style: 'height:16px' }), stats, h('div', { style: 'height:16px' }), today5, h('div', { style: 'height:16px' }), candidates]),
      h('div', { class: 'today-aside' }, aside),
    ]),
  );
}

// ---------- 人物 ----------
const PERSON_TABS = ['总览', '互动时间线', '事实与洞察', '家庭与关系', '保险概览', '机会与行动', '招募', '活动'];
function tabbar(tabs, note) {
  let bar;
  const btns = tabs.map((t, i) => h('button', {
    class: 'tab' + (i === 0 ? ' active' : ''), type: 'button',
    onclick: (ev) => {
      btns.forEach((b) => b.classList.remove('active'));
      ev.currentTarget.classList.add('active');
      if (note) ctxToastNote(ev, note);
    },
  }, t));
  bar = h('div', { class: 'tabs' }, btns);
  return bar;
}
let _toastFn = null;
function ctxToastNote(ev, note) { if (_toastFn) _toastFn(note); }

function renderPeople(ctx) {
  const chips = ['全部', '客户', '招募候选人', '嘉宾', 'A 级', '本周有互动'].map((c, i) =>
    h('button', { class: 'chip' + (i === 0 ? ' active' : ''), type: 'button', onclick: (ev) => {
      chips.forEach((x) => x.classList.remove('active'));
      ev.currentTarget.classList.add('active');
    } }, c));
  ctx.main.replaceChildren(
    pageHead({
      kicker: 'PEOPLE', title: '人物目录', tag: wpTag('WP1 接入'),
      sub: '客户、增员、嘉宾统一为 Person 身份；按精确 ID 关联，不按姓名自动合并。',
      actions: [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: toastWp(ctx, '身份候选审核在 WP2 接入（AI 仅提名，人工确认）') }, [ic('users'), '身份候选']),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: toastWp(ctx, '新建人物在 WP2 接入') }, [ic('plus'), '新建人物']),
      ],
    }),
    h('div', { class: 'toolbar' }, [
      h('div', { class: 'searchbox' }, [ic('search'), h('input', { placeholder: '搜索姓名 / 城市 / 机构（WP1 启用）', disabled: true })]),
    ]),
    h('div', { class: 'chip-row', style: 'margin-bottom:14px' }, chips),
    card({
      body: [1, 2, 3].map(() => h('div', { class: 'list-row' }, [
        h('span', { class: 'pavatar sm' }, h('span', { class: 'sk', style: 'width:20px;height:20px;border-radius:6px' })),
        h('div', { style: 'flex:1;display:flex;flex-direction:column;gap:7px' }, [sk('28%', 't'), sk('46%')]),
        ic('chevron', 'mut'),
      ])),
      foot: [h('span', { class: 'foot-note' }, '人物列表将按需分页读取；点开进入 Person 360 详情。')],
    }),
  );
}

function renderPerson(ctx, id) {
  ctx.main.replaceChildren(
    pageHead({
      kicker: 'PERSON 360', title: `Person #${id}`, tag: wpTag('WP1 接入'),
      sub: '人物详情：汇总互动、事实、家庭、保险、机会与招募数据。',
      actions: [
        h('button', { class: 'btn btn-soft', type: 'button', onclick: toastWp(ctx, '记录沟通（Quick Capture）在 WP2 接入') }, [ic('mic'), '记录沟通']),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: toastWp(ctx, '完整客户档案（Legacy）入口在 WP1 对齐') }, [ic('file'), '完整客户档案']),
      ],
    }),
    tabbar(PERSON_TABS, 'Person 360 各页签数据在 WP1 接入'),
    card({
      body: [emptyNote('总览', '将聚合：人物摘要（AI · 待核实）、正在推进的事、待确认候选与近期互动。')],
      cls: 'tabs-body',
    }),
  );
}

// ---------- 机会 ----------
function renderOpportunities(ctx) {
  const cols = ['发现', '沟通', '方案', '成交'];
  ctx.main.replaceChildren(
    pageHead({
      kicker: 'OPPORTUNITIES', title: '经营机会', tag: wpTag('WP1 读 · WP2 写'),
      sub: '候选审核后才进入业务；阶段推进与关闭都先预览确认，关闭时记录 Outcome。',
      actions: [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: toastWp(ctx, '已关闭/结果视图在 WP1 接入') }, [ic('grid'), '已关闭/结果']),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: toastWp(ctx, '新建机会在 WP2 接入') }, [ic('plus'), '新建机会']),
      ],
    }),
    card({
      title: '待确认候选', icon: 'sparkle', tag: wpTag('WP2 接入'),
      body: [emptyNote('AI 候选将在生成后进入这里', '每条候选带证据与来源，三键等宽：拒绝候选 / 编辑候选 / 接受并建机会。')],
    }),
    h('div', { style: 'height:16px' }),
    h('div', { class: 'kanban' }, cols.map((c, i) =>
      h('div', { class: 'kcol' }, [
        h('div', { class: 'kcol-head' }, [h('span', { style: 'display:flex;align-items:center;gap:7px' }, [h('i', { class: 'kdot v' + i }), c]), h('span', { class: 'kcount' }, '0')]),
        h('div', { class: 'kempty' }, 'WP1 接入'),
      ]))),
    h('p', { class: 'foot-note', style: 'margin-top:12px' }, '阶段不由 AI 自动推进；同一事务内写 Outcome（结果 / 感受 / 业务价值），不改动旧记录。'),
  );
}

// ---------- 活动 ----------
const ACTIVITY_TABS = ['流程', '签到与到场', '互动与名单', '机会候选', '伴手礼', '照片', '复盘'];
function renderActivities(ctx) {
  const d = new Date();
  const strip = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
    strip.push(h('div', { class: 'day' + (i === 0 ? ' today' : '') }, [
      h('b', {}, String(day.getDate())),
      h('span', {}, i === 0 ? '今天' : '周' + '日一二三四五六'[day.getDay()]),
    ]));
  }
  ctx.main.replaceChildren(
    pageHead({
      kicker: 'ACTIVITIES', title: '活动工作台', tag: wpTag('WP1 接入'),
      sub: '先有人，才有数字：报名与实际到场分开记录，复盘逐人审核。',
      actions: [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: toastWp(ctx, '活动量日报在 WP1 接入') }, [ic('calendar'), '活动量日报']),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: toastWp(ctx, '新建活动在 WP2 接入') }, [ic('plus'), '新建活动']),
      ],
    }),
    h('div', { class: 'date-strip' }, strip),
    h('div', { style: 'height:16px' }),
    card({
      body: [1, 2].map(() => h('div', { class: 'list-row' }, [
        h('span', { class: 'pavatar sm gold' }, h('span', { class: 'sk', style: 'width:20px;height:20px;border-radius:6px' })),
        h('div', { style: 'flex:1;display:flex;flex-direction:column;gap:7px' }, [sk('40%', 't'), sk('52%')]),
        ic('chevron', 'mut'),
      ])),
      foot: [h('span', { class: 'foot-note' }, '活动列表：日期筛选 + 状态筛选（筹备中 / 已确认 / 已结束）。')],
    }),
  );
}

function renderActivity(ctx, id) {
  ctx.main.replaceChildren(
    pageHead({
      kicker: 'ACTIVITY', title: `活动 #${id}`, tag: wpTag('WP1 接入'),
      sub: '报名与到场分开记录；复盘候选逐人人工审核。'}),
    tabbar(ACTIVITY_TABS, '活动详情各页签数据在 WP1 接入'),
    card({
      body: [emptyNote('流程', '筹备 → 邀约 → 到场签到 → 互动与机会候选 → 复盘，将在此按时间线呈现。')],
      cls: 'tabs-body',
    }),
  );
}

// ---------- 招募 ----------
const FUNNEL_STAGES = ['新增人才', '互动破冰', '初次面谈', '增员活动', '精准面谈', '入职申请', '签约入职', '流失'];
function renderRecruit(ctx) {
  const widths = [92, 76, 62, 52, 40, 28, 16, 14];
  ctx.main.replaceChildren(
    pageHead({
      kicker: 'RECRUIT', title: '组织发展工作台', tag: wpTag('WP1 接入'),
      sub: '八阶段漏斗 · 六维评分：增员候选同样以 Person 身份归档。',
      actions: [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: toastWp(ctx, '月度目标在 WP1 接入') }, [ic('calendar'), '月度目标']),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: toastWp(ctx, '新增人才在 WP2 接入') }, [ic('plus'), '新增人才']),
      ],
    }),
    h('div', { class: 'today-grid' }, [
      card({
        body: [1, 2, 3].map(() => h('div', { class: 'list-row' }, [
          h('span', { class: 'pavatar sm gold' }, h('span', { class: 'sk', style: 'width:20px;height:20px;border-radius:6px' })),
          h('div', { style: 'flex:1;display:flex;flex-direction:column;gap:7px' }, [sk('26%', 't'), sk('44%')]),
          h('span', { class: 'sk', style: 'width:34px;height:20px' }),
          ic('chevron', 'mut'),
        ])),
        foot: [h('span', { class: 'foot-note' }, '候选人列表：阶段徽标 + 六维评分 + 更新时间。')],
      }),
      card({
        title: '八阶段漏斗', icon: 'recruit', tag: wpTag('WP1'),
        body: FUNNEL_STAGES.map((s, i) => h('div', { class: 'funnel-row' }, [
          h('span', {}, s), h('span', { class: 'funnel-bar-track' }, h('span', { class: 'funnel-bar', style: 'width:' + widths[i] + '%' })), h('span', { class: 'funnel-n' }, '–'),
        ])),
        foot: [h('span', { class: 'foot-note' }, '小样本（<3）只显示数字，不做趋势判断。')],
      }),
    ]),
  );
}

// ---------- AI 助手 ----------
function renderAI(ctx) {
  const items = [
    ['search', 'AI CRM 搜索', '三个受控问题模板，名单由数据库计算，每条带来源。', '已上线 · 入口对齐 WP3', ''],
    ['sparkle', '自然语言创建行动', 'Command → Plan → Preview → Confirm → Execute 五段式安全契约。', 'WP3', 'hot'],
    ['users', '人物摘要', '会前快速了解一个人的变化、目标与待确认事项。', 'WP3', ''],
    ['shield', '会前准备 / 对话策略', '切入、话题、话术与引用；证据不足时明确说暂不能判断。', '规划中', ''],
    ['target', '机会分析', '基于互动与事实给出推进建议，不由 AI 改阶段。', '规划中', ''],
    ['calendar', '活动复盘候选', '逐人审核到场互动、行动与机会，防重复接受。', '规划中', ''],
  ];
  ctx.main.replaceChildren(
    pageHead({
      kicker: 'AI ASSISTANT', title: 'AI 助手：只建议，不替你决定', tag: wpTag('WP3 接入'),
      sub: '所有结果可追溯到真实记录；模型经 AI Gateway 配置，不绑定厂商。',
      actions: [h('button', { class: 'btn btn-soft', type: 'button', onclick: toastWp(ctx, '已上线的 AI CRM 搜索当前在 admin.html → AI助手') }, [ic('search'), '去搜索'])],
    }),
    h('div', { class: 'ai-grid' }, items.map(([icon, name, desc, status, hot]) =>
      h('div', { class: 'card ai-card' }, [
        h('div', { class: 'ai-ic' }, ic(icon)),
        h('b', {}, name),
        h('p', {}, desc),
        h('div', { class: 'ai-foot' }, [h('span', { class: 'status-chip ' + (hot || 'plan') }, status)]),
      ]))),
    h('div', { style: 'height:16px' }),
    card({
      body: [h('p', { class: 'foot-note' }, 'AI 不能选择模板外操作、不能生成 SQL、不能替你合并人物身份；「没有记录」不会被解释成「没有需求」。')],
    }),
  );
}

// ---------- 更多 ----------
function renderMore(ctx) {
  const tiles = [
    ['#/today', 'home', '今日', '晨间简报与 Today 5'],
    ['#/people', 'users', '人物', '目录与 Person 360'],
    ['#/opportunities', 'target', '机会', '候选审核与四列看板'],
    ['#/activities', 'calendar', '活动', '工作台与复盘'],
    ['#/recruit', 'recruit', '招募', '八阶段漏斗'],
    ['#/ai', 'sparkle', 'AI 助手', '搜索 / 摘要 / 命令'],
    [null, 'mic', '快速记录', '四步口述 → 候选确认（WP2）'],
  ];
  ctx.main.replaceChildren(
    pageHead({ kicker: 'MORE', title: '更多', sub: '功能入口与本轮建设说明。' }),
    h('div', { class: 'tile-grid' }, tiles.map(([hash, icon, name, desc]) =>
      hash
        ? h('a', { class: 'tile', href: hash }, [ic(icon), h('b', {}, name), h('span', {}, desc)])
        : h('button', { class: 'tile', type: 'button', onclick: toastWp(ctx, '快速记录在 WP2 接入') }, [ic(icon), h('b', {}, name), h('span', {}, desc)]))),
    h('div', { style: 'height:16px' }),
    card({
      title: '控制台建设排期', icon: 'grid', tag: wpTag('WP0 · 当前'),
      body: [
        h('p', { class: 'foot-note', style: 'margin:0 0 10px' }, '本页为 WP0 骨架：只含壳层、导航与页面框架，不含业务数据与写入。'),
        h('ul', { class: 'plan-list' }, [
          h('li', {}, [h('b', {}, 'WP1 只读接入：'), '人物目录、Person 360、机会看板、活动、招募、Today 5 与统计。']),
          h('li', {}, [h('b', {}, 'WP2 写入闭环：'), '快速记录（服务端 resolveName + 人工确认）、任务完成/撤销、机会候选三键、活动到场。']),
          h('li', {}, [h('b', {}, 'WP3 AI 能力：'), '晨间简报、会前准备、五段式自然语言命令、复盘候选（模型经 Gateway 配置）。']),
        ]),
      ],
      foot: [
        h('span', { class: 'foot-note' }, '旧版完整功能继续在 admin.html 使用'),
        h('button', { class: 'btn btn-ghost', type: 'button', style: 'margin-left:auto', onclick: () => ctx.signOut() }, [ic('logout'), '退出登录']),
      ],
    }),
  );
}

export {
  renderToday, renderPeople, renderPerson, renderOpportunities,
  renderActivities, renderActivity, renderRecruit, renderAI, renderMore,
};

// tabbar 组件需要弹 toast：由 app.js 注入，避免循环依赖。
export function bindToast(fn) { _toastFn = fn; }
