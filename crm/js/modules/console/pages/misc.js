// AI 助手页与更多页：WP0 静态内容沿用，AI 能力在 WP3 接入。
import { h } from '../dom.js';
import { ic } from '../icons.js';
import { data } from '../data.js';
import { wpTag, pageHead, card, emptyNote, loadInto, sk, bdg } from '../ui.js';

const SEARCH_EXAMPLES = [
  '最近三个月参加过活动但没有继续跟进的人',
  '有孩子、最近关注教育、但还没谈保险的人',
  '最近关系下降的重点客户',
];
const SEARCH_LABELS = {
  activity_no_followup: '实际参加活动后未见跟进',
  child_education_no_insurance: '已确认子女关系、教育记录、未见保险记录',
  declining_priority: '重点客户的关系趋势下降',
};

function evidenceFor(row, template) {
  if (template === 'activity_no_followup') {
    return `到场记录 #${row.participant_id} · 活动 #${row.activity_id} · ${row.activity_date || ''}`;
  }
  if (template === 'child_education_no_insurance') {
    return `家庭成员 #${row.child_member_id} · 教育来源 public.${row.education_source_table} #${row.education_source_id}`;
  }
  return `客户优先级 ${row.sales_priority} · 关系记录 #${row.relationship_id} · 趋势 ${row.trend}`;
}

function searchPanel(ctx) {
  const out = h('div', {});
  let queryInput;
  function doSearch() {
    const q = queryInput.value.trim();
    if (!q) { ctx.toast('请输入搜索问题'); return; }
    loadInto(out, async () => {
      const res = await data.aiSearch(ctx, q);
      if (!res.ok) throw new Error(res.error?.code || 'SEARCH_FAILED');
      if (res.status === 'unsupported') {
        return h('div', { class: 'muted' }, res.notice || '当前问题不在支持范围内');
      }
      if (res.status !== 'complete' || !Array.isArray(res.rows)) throw new Error('INVALID_RESULT');
      const tpl = res.criteria?.template || '';
      const months = res.criteria?.months || 0;
      const rows = (res.rows || []).filter((r) => /^[1-9][0-9]*$/.test(String(r.person_id)));
      const body = [];
      body.push(h('div', { class: 'search-summary' }, [
        bdg(SEARCH_LABELS[tpl] || '受限条件', 'ink'),
        h('span', { class: 'muted' }, `最近 ${months} 个月 · 数据库匹配 ${res.total} 人`),
      ]));
      for (const notice of res.notices || []) {
        body.push(h('p', { class: 'foot-note' }, notice));
      }
      if (!rows.length) {
        body.push(h('p', { class: 'muted' }, '当前没有可核实的匹配记录；这不代表现实中没有符合条件的人。'));
      } else {
        body.push(h('div', { class: 'search-results' }, rows.map((r) =>
          h('a', { class: 'list-row data-row', href: `#/person/${r.person_id}` }, [
            h('div', { style: 'flex:1;min-width:0' }, [
              h('div', { class: 'row-title' }, r.display_name || `Person #${r.person_id}`),
              h('div', { class: 'row-sub' }, evidenceFor(r, tpl)),
            ]),
            ic('chevron'),
          ]))));
      }
      if (res.total > rows.length) {
        body.push(h('p', { class: 'muted' }, `先显示 ${rows.length} 人，请缩小问题范围。`));
      }
      body.push(h('p', { class: 'foot-note' }, '来源：public CRM 记录。AI 只解析条件，名单由数据库计算，未修改客户资料。'));
      return h('div', {}, body);
    }, h('div', { class: 'muted' }, [sk('100%'), h('div', { style: 'height:8px' }), sk('70%')]));
  }
  queryInput = h('textarea', {
    class: 'sheet-input', rows: '3', maxlength: '1000',
    placeholder: '例如：最近三个月参加过活动但没有继续跟进的人',
  });
  const form = h('form', { class: 'search-form', onsubmit: (e) => { e.preventDefault(); doSearch(); } }, [
    queryInput,
    h('button', { class: 'btn btn-soft', type: 'submit' }, [ic('search'), '搜索']),
  ]);
  const examples = h('div', { class: 'search-examples' }, [
    h('span', { class: 'muted' }, '试试：'),
    ...SEARCH_EXAMPLES.map((s) => h('button', {
      class: 'btn btn-ghost btn-sm', type: 'button',
      onclick: () => { queryInput.value = s; queryInput.focus(); },
    }, s)),
  ]);
  return h('div', { class: 'search-panel' }, [form, examples, out]);
}

export function renderAI(ctx) {
  const items = [
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
    }),
    card({
      title: 'AI CRM 搜索', icon: 'search', tag: wpTag('已上线'),
      body: [
        h('p', { class: 'foot-note', style: 'margin:0 0 12px' }, '用自然语言描述要找的人。AI 只解析条件；名单和来源由 CRM 数据库计算。'),
        searchPanel(ctx),
      ],
    }),
    h('div', { style: 'height:16px' }),
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

export function renderMore(ctx) {
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
        : h('button', { class: 'tile', type: 'button', onclick: () => ctx.toast('快速记录在 WP2 接入') }, [ic(icon), h('b', {}, name), h('span', {}, desc)]))),
    h('div', { style: 'height:16px' }),
    card({
      title: '控制台建设排期', icon: 'grid', tag: wpTag('WP1 · 进行中'),
      body: [
        h('p', { class: 'foot-note', style: 'margin:0 0 10px' }, 'WP1：只读接入人物、Person 360、机会、活动与招募真实数据；无云函数与数据库变更。'),
        h('ul', { class: 'plan-list' }, [
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
