'use strict';

const numeric = value => value == null || value === '' || typeof value === 'boolean'
  ? null : Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const sumKnown = values => values.length && values.every(v => v !== null) ? values.reduce((a,b) => a+b,0) : null;

// L02 opt-in presentation. Preserve the existing Legacy DTO and its default behavior.
function stageFacts(funnels, rows) {
  return funnels.map(f => {
    const stages = f.stages.map(s => {
      const raw = rows.find(r => r.funnel === f.key && r.stage === s.stage) || {};
      return { ...s, count:numeric(raw.current_count), entered_30d:numeric(raw.entered_30d),
        moved_30d:f.key === 'recruit' ? numeric(raw.moved_30d) : null,
        overdue:numeric(raw.overdue_count),
        dwell_median_days:s.kind === 'terminal' || f.key === 'customer' ? null : numeric(raw.dwell_median_days),
        stuck:s.kind === 'terminal' || f.key === 'customer' ? null : numeric(raw.stuck_count),
      };
    });
    const total = stages.length ? sumKnown(stages.map(s => s.count)) : null;
    return { ...f, stages,total,metrics:[],rates:[],insufficient:total === null || total < 10,
      source:f.key === 'customer' ? 'persons.customer_stage via active customers' : f.source,
      metricBasis:'current-stage-snapshot',
      warnings:[
        '当前阶段人数分布不代表历史转化率，不能据此推断营销效果或客户意图。',
        '近30天新增是近期创建且当前在该阶段的记录，并非进入该阶段的事件次数。',
        f.key === 'customer' ? '客户缺少阶段变更时间，停留、久停和近期改阶段均未知。'
          : f.key === 'opportunity' ? '仅含关联客户的机会，不含Person-only；停留按发现以来估算，久停阈值60天，近期改阶段未知。'
          : '近期改阶段仅含创建超过30天且最近30天修改阶段的存量候选人；不是完整流转次数。停留按阶段变更日计算，久停阈值30天。',
        '总数包含终态，逾期按既有行动中心口径；未知不等于零。',
      ],
    };
  });
}

function stageMessages(funnels,today,language) {
  return [
    {role:'system',content:[
      '你是个人保险营销工作助手，只解释给定的阶段事实，不写入业务。',
      '当前阶段人数分布不是历史转化率；不计算百分比、不推断流转、瓶颈因果、活动效果或客户想法。',
      'null是未知，0是已知零；终态不分析停留；少于10条时明确样本小，数据不足时直接说明。',
      '严格保留每类scope和warnings。机会停留是发现以来，招募改阶段仅是存量样本。',
      '只引用给定数字，建议先核对具体记录再行动。不能说没有待办，因为此快照不是完整待办清单。',
      language === 'en' ? 'Reply in English, at most 220 words.' : '用简体中文，最多350字。',
    ].join('\n')},
    {role:'user',content:JSON.stringify({today,funnels})},
  ];
}

function stageRule(funnels,language) {
  const english=language === 'en';
  return funnels.map(f => {
    const label=english ? {customer:'Customers',opportunity:'Linked-customer opportunities',recruit:'Recruiting'}[f.key] : f.label;
    const total=f.total === null ? (english?'unknown':'未知') : String(f.total);
    const overdue=sumKnown(f.stages.map(s=>s.overdue));
    return english ? `${label}: ${total} records in the current-stage snapshot, including terminal stages. Overdue: ${overdue === null?'unknown':overdue}. ${f.insufficient?'Small or incomplete sample; verify records first.':''}`
      : `${label}：当前阶段快照共${total}条（包含终态），逾期${overdue === null?'未知':overdue}。${f.insufficient?'样本少或不完整，请先核对记录。':''}`;
  }).join('\n') + (english ? '\nThis is a distribution, not a historical conversion rate. Review the workspace records before acting.'
    : '\n这是当前分布，不代表历史转化率。行动前请到对应工作区核对具体记录。');
}
module.exports={stageFacts,stageMessages,stageRule};
