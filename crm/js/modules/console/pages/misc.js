// AI 助手页与更多页：WP0 静态内容沿用，AI 能力在 WP3 接入。
import { h } from '../dom.js';
import { ic } from '../icons.js';
import { wpTag, pageHead, card } from '../ui.js';

export function renderAI(ctx) {
  const items = [
    ['search', 'AI CRM 搜索', '三个受控问题模板，名单由数据库计算，每条带来源。', '已上线 · 入口在旧版', ''],
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
      actions: [h('button', { class: 'btn btn-soft', type: 'button', onclick: () => ctx.toast('已上线的 AI CRM 搜索当前在 admin.html → AI 助手') }, [ic('search'), '去搜索'])],
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
