/**
 * 生成《CRM 系统现状分析与后续工作计划》Word 文档（2026-10-11）
 * 依赖: npm i docx（项目已安装）
 * 运行: node tools/gen-roadmap-docx.js
 */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType,
  PageBreak, ShadingType,
} = require('docx');

// ---------- 辅助 ----------
function h(text, level) {
  return new Paragraph({ children: [new TextRun({ text, bold: true })], heading: level, spacing: { before: 240, after: 120 } });
}
const h1 = (t) => h(t, HeadingLevel.HEADING_1);
const h2 = (t) => h(t, HeadingLevel.HEADING_2);
const h3 = (t) => h(t, HeadingLevel.HEADING_3);

function p(text, opts = {}) {
  return new Paragraph({ children: [new TextRun({ text, ...opts })], spacing: { after: 80 } });
}
function bullet(text) {
  return new Paragraph({ children: [new TextRun({ text })], bullet: { level: 0 }, spacing: { after: 40 } });
}
function cell(text, opts = {}) {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold: !!opts.bold, size: opts.size || 18, color: opts.color || '000000' })] })],
    shading: opts.shading ? { fill: opts.shading, type: ShadingType.CLEAR, color: 'auto' } : undefined,
    width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
  });
}
function table(rows, widths) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((r, i) => new TableRow({
      children: r.map((c, j) => cell(c, {
        bold: i === 0,
        shading: i === 0 ? '2E5090' : undefined,
        color: i === 0 ? 'FFFFFF' : undefined,
        width: widths ? widths[j] : undefined,
      })),
    })),
  });
}
const run = (text, opts = {}) => new TextRun({ text, ...opts });
function pageBreak() { return new Paragraph({ children: [new PageBreak()] }); }

// 工作包块：编号、标题、目标、范围、步骤、验收
function wpBlock(num, title, goal, scopeLines, stepLines, acceptLines) {
  const out = [];
  out.push(h3(`${num}｜${title}`));
  out.push(p('目标', { bold: true }));
  out.push(p(goal));
  out.push(p('范围', { bold: true }));
  scopeLines.forEach((s) => out.push(bullet(s)));
  out.push(p('实施步骤', { bold: true }));
  stepLines.forEach((s, i) => out.push(bullet(`${i + 1}. ${s}`)));
  out.push(p('验收标准', { bold: true }));
  acceptLines.forEach((a) => out.push(bullet(a)));
  out.push(p(''));
  return out;
}

// ---------- 文档内容 ----------
const children = [];

// ===== 封面 =====
children.push(new Paragraph({ spacing: { before: 1600 } }));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  children: [run('CRM 系统现状分析与后续工作计划', { bold: true, size: 44, color: '2E5090' })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { before: 200 },
  children: [run('以 Person 为中心 · AI 驱动 · 人的关系管理', { size: 26, color: '666666', italics: true })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { before: 360 },
  children: [run('生成日期：2026-10-11　|　版本：v1.0　|　适用：Codex / Trae 工作包指令', { size: 22 })],
}));
children.push(pageBreak());

// ===== 第一部分：系统现状分析 =====
children.push(h1('第一部分：系统现状分析'));

children.push(h2('一、当前系统架构（双轨制）'));
children.push(p('当前 CRM 系统存在两套并行前端：'));
children.push(table([
  ['维度', 'admin.html（旧版）', 'console.html（新版控制台）'],
  ['架构', '单文件约 3900 行，逻辑内联', '模块化 ES Modules，crm/js/modules/console/'],
  ['导航', '客户经营 / 组织发展 双模块切换', '7 个主 Tab：今日/人物/机会/活动/招募/AI/更多'],
  ['数据入口', 'callFunction 直连云函数', 'core/createApi 包装（校验函数名、拒绝 pr_*）'],
  ['中心实体', '以 customer 为中心，Person 为附属', '以 Person 为中心，customer 为角色之一'],
  ['写入方式', '直接 CRUD', '服务端预览→人工确认→执行 三段式'],
  ['多语言', '中文硬编码', 'i18n.js 字典管理，中/英双语'],
  ['布局', '桌面优先', 'iPad 优先（手机底栏五格保留）'],
], [1800, 3600, 4000]));
children.push(p('关键事实：新版 console.html 已具备完整骨架和核心功能，但大量 Legacy 业务操作仍需跳转回 admin.html。', { bold: true }));

children.push(h2('二、Person 整合进展（核心底座已完成）'));
children.push(h3('身份层'));
children.push(bullet('persons — 统一身份中心，16 列（display_name/gender/birthday/organization 等）'));
children.push(bullet('person_roles — 角色表（customer/recruit/speaker/participant/partner/referrer/alumni/other）'));
children.push(bullet('person_name_key — 姓名归一化键，服务端 PersonService.resolveName() 做同名消歧'));
children.push(h3('关系层'));
children.push(bullet('relationships — Person 间有向边（strength/importance/trend/stage）'));
children.push(bullet('households + household_members — 家庭关系（anchor + member，含 relationship_to_anchor/confirmed_at）'));
children.push(h3('行为层'));
children.push(bullet('interactions — 互动记录（person_id, type, channel, at, summary, importance）'));
children.push(bullet('context_items — 上下文三元组（Fact/Signal/Inference，含 confirmed/valid_from/to）'));
children.push(bullet('actions + commitments — 行动与承诺（统一 work item）'));
children.push(bullet('opportunities — 机会（已加 person_id，支持 customer_id IS NULL 的 Person-only 机会）'));
children.push(bullet('outcomes — 结果记录（关联 action/opportunity/interaction）'));
children.push(h3('AI 与知识层'));
children.push(bullet('ai_tasks / ai_results — AI 审计台账（task/run/result 三件套）'));
children.push(bullet('knowledge_items / playbooks / learnings — 知识库（已建表，待充分利用）'));
children.push(bullet('opportunity_candidates — AI 机会候选（需人工确认后晋升正式机会）'));
children.push(h3('PMC 清理迁移（2026-10-10 完成）'));
children.push(bullet('customers.person_id 全量回填并加外键约束'));
children.push(bullet('移除 persons.legacy_customer_id 桥接列'));
children.push(bullet('重建视图基于 person_source（v_recruit_candidates 等）'));
children.push(bullet('修复 crm_search_people_v1、crm_customers_page_v1、person_directory_page_v1 等函数'));
children.push(bullet('移除 opportunities/recruit 的复合外键（改为 person_id 单字段）'));
children.push(p('身份映射覆盖（WP04 验收）：客户 778/778（1 明示例外）、候选人 13/13、嘉宾 3/3、参与者 2/3（1 例外）—— 达 100% 有映射或明示例外。'));

children.push(h2('三、新版 Console 已实现功能'));
children.push(h3('1. 今日工作台（#/today）— WP2/WP9'));
children.push(bullet('晨间简报（Morning Brief）七段：摘要/Top Actions/承诺/近期/风险/机会/待确认'));
children.push(bullet('Today 5 纯事实规则排序；双向承诺、机会速览'));
children.push(bullet('AI 工作建议（guidance: rules 或 ai）'));
children.push(h3('2. 人物目录（#/people）— WP1/Phase14'));
children.push(bullet('分页（20/页）、排序、姓名搜索；角色徽章；招募中标记'));
children.push(h3('3. Person 360（#/person/:id）— WP5/WP6/WP8/WP10/WP11/WP12'));
children.push(bullet('八页签：总览/时间线/事实/家庭/保险/机会与行动/招募/活动'));
children.push(bullet('行动/承诺完成闭环、机会推进闭环、保险摘要、活动复盘、关系衰减信号只读卡片'));
children.push(h3('4. 机会看板（#/opportunities）— WP10'));
children.push(bullet('四列看板（发现/沟通/方案/成交）+ 待确认候选三键审核（接受/拒绝）'));
children.push(bullet('推进/关闭/新建机会（preview→confirm→execute）'));
children.push(h3('5. 活动工作台（#/activities）— WP12'));
children.push(bullet('活动列表（日期条筛选）+ 详情页签：流程/签到与到场/行动/候选/伴手礼/照片/复盘'));
children.push(bullet('活动复盘 V2：AI 候选逐项审核 + Outcome 确认'));
children.push(h3('6. 招募工作台（#/recruit）— WP1'));
children.push(bullet('候选人列表（legacy 视图 + person-only 视图合并）、八阶段漏斗、当月目标进度'));
children.push(h3('7. AI 助手（#/ai）— WP3'));
children.push(bullet('AI CRM 自然语言搜索（3 个模板：活动后未跟进/子女教育无保险/关系走弱）'));
children.push(bullet('AI 能力卡片：自然语言命令、人物摘要、会前准备、机会候选、活动复盘'));
children.push(h3('8. 更多（#/more）与设置（#/settings）'));
children.push(bullet('导航 tiles + 17 项 Legacy 入口跳转 admin.html'));
children.push(bullet('设置页：语言切换（中/英）+ 账号维护（部分迁移）'));
children.push(h3('写入闭环（全部三段式）'));
children.push(bullet('行动/承诺完成：previewWorkItem → executeWorkItem'));
children.push(bullet('机会推进/关闭/新建：previewOpportunity → executeOpportunity'));
children.push(bullet('机会候选审核：opportunityCandidate edit/reject/preview→confirm→execute'));
children.push(bullet('快速记录：AI 解析 → resolveQuickCaptureName 身份解析 → 人工选择 → commitQuickCaptureV2'));

children.push(h2('四、Legacy 功能清单（仍在 admin.html，更多页入口）'));
children.push(table([
  ['功能', '路由', '整合状态'],
  ['客户列表', '#/customers', '人物目录已替代（只读）'],
  ['客户详情（7 Tab）', '#/customer/:id', 'Person 360 只读覆盖，编辑仍跳旧页'],
  ['跟进记录 CRUD', '客户详情 Tab', '未整合'],
  ['保单检视报告', '#/more/policy-review', '保险页签只读，生成/编辑仍跳旧页'],
  ['产品（保单额度）', '#/more/products', '未整合'],
  ['伴手礼 CRUD', '#/more/gifts', '未整合'],
  ['照片管理', '#/more/photos', '未整合'],
  ['AI 建议历史', '#/ai-suggestions', '未整合'],
  ['漏斗统计', '#/funnels', '未整合'],
  ['嘉宾管理', '#/speakers', '未整合'],
  ['主题管理', '#/topics', '未整合'],
  ['招募目标管理', '#/recruit/goals', '招募页只读展示，编辑未整合'],
  ['客户活动量日报', '#/activity/customer', '未整合'],
  ['增员活动量日报', '#/activity/recruit', '未整合'],
  ['客户回收站', '#/customers/trash', '未整合'],
  ['增员回收站', '#/recruit/trash', '未整合'],
  ['账号设置', '#/account', '设置页已部分迁移'],
  ['测试场景', '#/test-scenario', '保留（测试工具）'],
], [2600, 2600, 4200]));

children.push(h2('五、已建但未充分利用的数据对象'));
children.push(bullet('knowledge_items / playbooks / learnings — 知识库三件套，仅有表结构'));
children.push(bullet('relationships — 关系边表，仅关系衰减信号读取，无管理界面'));
children.push(bullet('context_items — 上下文事实，主要由 Quick Capture 写入，无独立管理'));
children.push(bullet('households — 家庭关系，Person 360 只读展示，无编辑能力'));
children.push(bullet('assistant 自然语言命令 — 仅 action create 接入，update/close/delete 仍拒绝执行'));

// ===== 第二部分 =====
children.push(pageBreak());
children.push(h1('第二部分：整体目标与整合策略'));

children.push(h2('一、不变的核心目标'));
children.push(p('1. 以 Person 为中心', { bold: true }));
children.push(p('所有业务对象（客户、候选人、嘉宾、参与者、家庭成员）都归属于 Person；Person 是唯一身份实体。'));
children.push(p('2. AI 驱动', { bold: true }));
children.push(p('AI 只做建议、候选、摘要、复盘，关键写入必须人工确认；模型通过 AI Gateway/CloudBase 配置，不硬编码厂商。'));
children.push(p('3. 人的关系管理', { bold: true }));
children.push(p('不仅是客户管理，而是人际关系网络经营——关系强度、节奏、衰减信号、家庭网络、转介绍链路。'));
children.push(p('4. 先进且安全', { bold: true }));
children.push(p('三段式写入（preview→confirm→execute）、RLS 基线、测试数据隔离、human-in-the-loop。'));

children.push(h2('二、整合策略'));
children.push(p('原则：', { bold: true }));
children.push(bullet('能在 Console 原生实现的 Legacy 功能，全部整合到对应板块'));
children.push(bullet('整合后从 LEGACY_ENTRIES 移除对应项'));
children.push(bullet('实在无法整合（如测试工具、特殊报表），留在「更多」的 Legacy 区，明确标注'));
children.push(bullet('整合只做"等价替代"，不改变业务语义和数据结构'));
children.push(bullet('每个整合工作包独立、可回滚、有验收'));
children.push(p('板块归属映射：', { bold: true }));
children.push(table([
  ['Legacy 功能', '整合到 Console 板块'],
  ['客户列表', '人物目录（已完成只读）'],
  ['客户详情编辑', 'Person 360 → 总览页签（新增编辑）'],
  ['跟进记录', 'Person 360 → 时间线页签（新增跟进）'],
  ['保单检视', 'Person 360 → 保险页签（新增生成/编辑）'],
  ['产品（保单额度）', 'Person 360 → 保险页签（新增保障编辑）'],
  ['伴手礼', 'Person 360 → 活动页签 或 独立"馈赠"区'],
  ['照片', 'Person 360 → 保险页签附件 / 活动页签'],
  ['AI 建议历史', 'AI 页 或 Person 360'],
  ['漏斗统计', '机会页（新增漏斗视图）'],
  ['嘉宾管理', '活动页（嘉宾作为参与者子类型）'],
  ['主题管理', '活动页'],
  ['招募目标管理', '招募页（新增编辑）'],
  ['活动量日报', '今日页（新增日报视图）'],
  ['回收站', '更多 → 回收站专区'],
  ['账号设置', '设置页（已部分迁移）'],
], [3800, 5600]));

// ===== 第三部分：详细工作计划 =====
children.push(pageBreak());
children.push(h1('第三部分：详细工作计划（工作包）'));

children.push(h2('阶段一：Person 360 编辑能力补齐（最高优先级）'));
children.push(...wpBlock('WP-C1', 'Person 360 基本资料编辑',
  '将客户基本信息编辑从 admin.html 迁移到 Person 360 总览页签，不再需要跳转旧页面。',
  [
    'Person 360 总览页签增加"编辑"按钮',
    '底部弹窗表单：姓名、电话、性别、生日、职业、组织、微信、来源、经营阶段、销售/招募/转介绍优先级、婚况、年收入、标签、附加信息',
    '已关联 customer 的 Person 调用现有 customers.update；Person-only 调用 person_360.updatePerson',
    '沿用三段式：preview → confirm → execute（复用 work_item 模式或新建 customer_preview RPC）',
  ],
  [
    '后端：person_360 新增 previewCustomerUpdate / executeCustomerUpdate，内部调用 customers.update，写入 crm_customer_commands 台账',
    '前端：console/pages/person.js 总览页签加编辑按钮，write.js 新增 openCustomerEdit',
    '迁移：新增 crm_customer_commands 表（15 分钟预览、幂等、账号绑定），同时提供 rollback',
    'i18n：表单字段标签中/英双语',
    '回归：旧客户详情编辑仍可用（双轨期）',
  ],
  [
    'Person 360 内可编辑全部客户基本字段，保存后即时刷新',
    'Person-only 人物可编辑 persons 表字段',
    '编辑走三段式，未确认不写库',
    '旧 admin.html 编辑不受影响',
  ]));
children.push(...wpBlock('WP-C2', 'Person 360 跟进记录整合',
  '在 Person 360 时间线页签新增跟进记录能力，替代旧客户详情跟进 Tab。',
  [
    '时间线页签增加"新增跟进"按钮',
    '表单：跟进日期、目标（建立联系/约见面/邀请活动/获取家庭信息/推进签单/推进招募/推进转介绍）、方式、摘要、备注、下次跟进日期、下次跟进目标',
    '写入 followups 表（关联 customer_id），通过 followups 云函数',
    '列表展示整合旧跟进 + 人工互动',
  ],
  [
    '后端：复用 followups.create/update/remove，person_360 封装 createFollowup 走 preview/execute',
    '前端：时间线页签加"新增跟进"入口，write.js 新增 openFollowupCreate',
    '迁移：crm_followup_commands 台账 + rollback',
    '时间线合并显示旧跟进和新互动',
  ],
  [
    'Person 360 内可新增/编辑/删除跟进',
    '跟进出现在时间线中',
    '旧客户详情跟进 Tab 仍可用',
  ]));
children.push(...wpBlock('WP-C3', 'Person 360 家庭关系编辑',
  '补齐 households 的写入能力，Person 360 家庭页签支持新增/移除家庭成员。',
  [
    '家庭页签增加"添加成员"按钮',
    '表单：选择已有 Person 或新建 Person、关系类型（配偶/子女/父母/兄弟姐妹/其他）',
    '确认流程：添加需确认（confirmed_at），移除需二次确认',
    '调用现有 person_360.addMember / removeMember',
  ],
  [
    '后端：确认 addMember/removeMember 支持 preview/execute',
    '前端：家庭页签加成员管理 UI',
    'i18n：关系类型中/英',
  ],
  [
    '可添加已有 Person 为家庭成员',
    '可移除家庭成员（软删除 household_members）',
    '关系类型正确展示',
  ]));
children.push(...wpBlock('WP-C4', 'Person 360 保险保障编辑',
  '在保险页签内编辑保单额度（products），替代 admin.html 产品页。',
  [
    '保险页签"保障明细"区增加"编辑保障"按钮',
    '表单：11 个 ap_* 保额字段 + items JSON 明细',
    '调用 products.upsert，复用三段式',
  ],
  [
    '后端：person_360 封装 products upsert 的 preview/execute',
    '前端：保险页签加编辑表单',
    '迁移：crm_product_commands 台账 + rollback',
  ],
  [
    'Person 360 内可编辑保单额度',
    '保存后保险摘要即时刷新',
  ]));
children.push(...wpBlock('WP-C5', 'Person 360 保单检视整合',
  '在保险页签内生成/编辑保单检视报告，替代 admin.html 保单检视页。',
  [
    '保险页签增加"生成检视报告"按钮',
    '调用 policy_review_reports.generate（AI 5 段报告）',
    '报告展示 + 人工编辑（edited_* 字段）',
    '历史报告列表',
  ],
  [
    '后端：确认 policy_review_reports 的 generate/edit 接口可被 person_360 调用',
    '前端：保险页签加报告生成/展示/编辑 UI',
    'AI 结果未经人工编辑不认定为已确认保障事实',
  ],
  [
    'Person 360 内可生成 AI 检视报告',
    '可人工编辑报告字段',
    '历史报告可查看',
  ]));

children.push(h2('阶段二：机会与活动板块深化'));
children.push(...wpBlock('WP-C6', '机会漏斗统计整合',
  '在机会页新增漏斗统计视图，替代 admin.html 漏斗页。',
  [
    '机会页增加"漏斗"切换视图',
    '按阶段统计机会数量/金额',
    '复用 v_funnel_stats 或新建查询',
  ],
  [
    '后端：person_360.listOpportunityDirectory 增加聚合参数，或新建 getOpportunityFunnel',
    '前端：机会页加漏斗图表/列表',
  ],
  [
    '机会页可查看各阶段机会数量分布',
    '数据与旧漏斗页一致',
  ]));
children.push(...wpBlock('WP-C7', '活动伴手礼与照片整合',
  '在活动详情页签内管理伴手礼和照片，替代 admin.html 对应页。',
  [
    '活动详情"伴手礼"页签：列表 + 新增（关联 activity_id 或 person_id）',
    '活动详情"照片"页签：列表 + 上传（base64 存 photos 表）',
    '调用 gifts / photos 云函数',
  ],
  [
    '后端：确认 gifts/photos 支持按 activity_id 查询',
    '前端：活动详情伴手礼/照片页签加 CRUD UI',
    '照片上传保持 base64 存表，不调多模态',
  ],
  [
    '活动内可管理伴手礼',
    '活动内可上传/查看照片',
  ]));
children.push(...wpBlock('WP-C8', '活动嘉宾与主题整合',
  '在活动模块内管理嘉宾和主题，替代 admin.html 嘉宾/主题页。',
  [
    '活动详情"流程"页签增加主题管理（activity_topics）',
    '活动详情增加嘉宾管理（activity_speakers，关联 Person）',
    '调用 activity_speakers / activity_topics 云函数',
  ],
  [
    '后端：确认 activity_speakers/topics CRUD',
    '前端：活动详情加嘉宾/主题管理 UI',
    '嘉宾关联 Person（resolveName 消歧）',
  ],
  [
    '活动内可管理主题',
    '活动内可添加嘉宾并关联 Person',
  ]));

children.push(h2('阶段三：招募与今日板块深化'));
children.push(...wpBlock('WP-C9', '招募目标管理整合',
  '在招募页内编辑月度目标，替代 admin.html 招募目标页。',
  [
    '招募页"目标进度"区增加"编辑目标"按钮',
    '表单：月份、各阶段目标人数',
    '调用 recruit_goals 云函数（atomic save）',
  ],
  [
    '后端：复用 recruit_goals 接口',
    '前端：招募页加目标编辑 UI',
    '保持事务性保存',
  ],
  [
    '招募页可编辑月度目标',
    '进度条实时更新',
  ]));
children.push(...wpBlock('WP-C10', '招募候选人新增与跟进',
  '在招募页内新增候选人、记录跟进，替代 admin.html 招募详情。',
  [
    '招募页增加"新增人才"按钮',
    '候选人详情（弹层或新页）：阶段推进、跟进记录、AI 评分、AI 接触建议',
    '调用 recruit_candidates / recruit_followups / recruit_score / recruit_recommend',
  ],
  [
    '后端：复用 recruit_* 云函数',
    '前端：招募页加新增/详情 UI',
    '阶段推进写入 recruit_milestones',
  ],
  [
    '招募页可新增候选人',
    '可推进阶段、记录跟进',
    'AI 评分/建议可用',
  ]));
children.push(...wpBlock('WP-C11', '今日活动量日报整合',
  '在今日页新增活动量日报视图，替代 admin.html 客户/增员活动量日报。',
  [
    '今日页增加"日报"卡片或子视图',
    '客户活动量 + 增员活动量双轨',
    '调用 activity_reports 云函数（today/range 模式）',
  ],
  [
    '后端：复用 activity_reports',
    '前端：今日页加日报展示',
    '支持日期范围切换',
  ],
  [
    '今日页可查看当日活动量统计',
    '数据与旧日报一致',
  ]));

children.push(h2('阶段四：回收站与设置收尾'));
children.push(...wpBlock('WP-C12', '回收站专区',
  '在「更多」页建立回收站专区，整合客户/增员回收站。',
  [
    '更多页增加"回收站"入口',
    '客户回收站 + 增员回收站双 Tab',
    '列表、恢复、彻底删除',
    '调用 customers / recruit_candidates 的 listTrash/restore/purge',
  ],
  [
    '后端：复用现有回收站接口',
    '前端：更多页加回收站专区',
    '彻底删除需二次确认',
  ],
  [
    '可查看/恢复/彻底删除客户和增员回收站数据',
    '从 LEGACY_ENTRIES 移除回收站入口',
  ]));
children.push(...wpBlock('WP-C13', '设置页完整迁移',
  '将账号设置剩余功能迁移到设置页。',
  [
    '密码修改（已有密码重置）',
    '操作者信息（姓名/性别/生日，已在 APP_CONFIG）',
    '退出登录',
    '从 LEGACY_ENTRIES 移除账号设置入口',
  ],
  [
    '前端：设置页完善 UI',
    '复用 admin.html 的账号逻辑',
  ],
  [
    '设置页可改密、退出',
    '账号设置从 Legacy 区移除',
  ]));

children.push(h2('阶段五：AI 与关系管理深化'));
children.push(...wpBlock('WP-C14', '自然语言命令执行器扩展',
  '将 assistant 自然语言命令从仅 action create 扩展到 update/close/delete。',
  [
    'assistant intent-router 支持 action update/close/delete',
    'opportunity update/close',
    '全部走 Command → Plan → Preview → Confirm → Execute',
    '拒绝未经预览确认的执行',
  ],
  [
    '后端：assistant 新增各类型命令的 plan/preview/execute',
    '复用已有 command 台账模式',
    '前端：AI 页或 Person 360 接入命令面板',
  ],
  [
    '自然语言可触发 action/opportunity 的 update/close/delete',
    '必须人工确认后执行',
    '未接入执行器的命令拒绝执行',
  ]));
children.push(...wpBlock('WP-C15', '关系管理界面',
  '为 relationships 表建立管理界面，实现关系强度/重要性/趋势的人工维护。',
  [
    'Person 360 新增"关系"页签或在总览展示关系网络',
    '可查看该 Person 的所有关系边',
    '可添加/编辑关系（对方 Person、强度、重要性、趋势、阶段）',
    '结合关系衰减信号（已实现只读）',
  ],
  [
    '后端：person_360 新增 listRelationships / previewRelationship / executeRelationship',
    '前端：Person 360 关系管理 UI',
    '迁移：crm_relationship_commands 台账 + rollback',
  ],
  [
    '可查看 Person 的关系网络',
    '可添加/编辑关系属性',
    '关系衰减信号能利用人工维护的强度/重要性',
  ]));
children.push(...wpBlock('WP-C16', '知识库利用',
  '激活 knowledge_items/playbooks/learnings 表，在 AI 功能中利用。',
  [
    'AI 助手页增加知识库管理入口',
    'knowledge_items：经验条目（可被 AI 检索）',
    'playbooks：话术/流程模板',
    'learnings：复盘学习',
    'AI 搜索/摘要时引用知识库',
  ],
  [
    '后端：assistant 增加知识库检索接口',
    '前端：AI 页加知识库管理 UI',
    'AI prompt 注入相关知识条目',
  ],
  [
    '可新增/管理知识条目',
    'AI 摘要/搜索时引用知识库',
  ]));

children.push(h2('阶段六：Legacy 清理与收尾'));
children.push(...wpBlock('WP-C17', 'Legacy 入口清理',
  '逐个从 LEGACY_ENTRIES 移除已整合的功能，最终只保留无法整合的项。',
  [
    '随各 WP 完成，逐项移除 LEGACY_ENTRIES 中的对应项',
    '保留项：测试场景（测试工具）',
    '评估是否还需保留 admin.html 整体入口',
  ],
  [
    '每个 WP 验收后，更新 console/pages/misc.js 的 LEGACY_ENTRIES',
    '最终确认 Legacy 区只剩必要项',
  ],
  [
    'LEGACY_ENTRIES 只保留测试场景等无法整合的工具',
    '所有业务功能在 Console 内闭环',
  ]));

// ===== 第四部分：执行顺序与依赖 =====
children.push(pageBreak());
children.push(h1('第四部分：执行顺序与依赖'));
children.push(p('阶段一（Person 360 编辑）：C1–C5 可并行', { bold: true }));
children.push(p('阶段二（机会与活动）：C6–C8 可并行', { bold: true }));
children.push(p('阶段三（招募与今日）：C9–C11 可并行', { bold: true }));
children.push(p('阶段四（回收站与设置）：C12–C13', { bold: true }));
children.push(p('阶段五（AI 与关系）：C14–C16', { bold: true }));
children.push(p('阶段六（Legacy 清理）：C17 随各 WP 完成逐步清理', { bold: true }));
children.push(p(''));
children.push(h2('关键约束（每个工作包必须遵守）'));
[
  '仅限 public schema，不碰 pr schema 或 pr_* 函数',
  '不删除/重命名已有表、视图、函数（除非单独批准）',
  '新数据库变更必须同时提供 migration 和 rollback',
  'AI 不硬编码模型厂商，走 AI Gateway/CloudBase 配置',
  '关键写入必须 human-in-the-loop（preview→confirm→execute）',
  '不做"大顺手重构"，每个 WP 只做指定范围',
  '新功能必须中/英双语，通过 crm/js/modules/console/i18n.js',
  '布局只考虑 iPad，不主动做手机适配',
  '每个 WP 完成后部署、提交、打标签、三端核对',
  'Legacy 功能优先保留，整合完成前不删除旧实现',
].forEach((c) => children.push(bullet(c)));

// ===== 第五部分：Codex/Trae 通用指令模板 =====
children.push(pageBreak());
children.push(h1('第五部分：Codex / Trae 工作包通用指令模板'));
children.push(p('以下为每个工作包执行时的标准指令格式，可直接拷贝给 Codex 或 Trae：', { bold: true }));
children.push(p(''));
const template = [
  '【工作包编号】WP-CX',
  '【工作包名称】XXX 整合',
  '',
  '【前置条件】',
  '1. 已读取根 AGENTS.md、docs/development-environment.md、docs/开发安全边界说明.md',
  '2. 本地、GitHub、云端基线一致（运行 tools/sync-check.ps1 确认）',
  '3. 当前发布标签已记录，可回滚',
  '',
  '【目标】',
  '<从工作包文档复制目标>',
  '',
  '【范围】',
  '<从工作包文档复制范围>',
  '',
  '【实施步骤】',
  '<从工作包文档复制步骤>',
  '',
  '【技术约束】',
  '- 仅限 public schema',
  '- 新 DB 变更必须有 migration + rollback',
  '- AI 走 AI Gateway，不硬编码厂商',
  '- 写入走 preview→confirm→execute 三段式',
  '- 中/英双语，i18n.js 管理',
  '- iPad 布局',
  '',
  '【涉及文件】',
  '- 前端：crm/js/modules/console/pages/*.js, crm/js/modules/console/write.js, crm/js/modules/console/i18n.js',
  '- 后端：cloudfunctions/person_360/*.js（及 _shared 共享模块同步）',
  '- 数据库：cloudbase/migrations/*.sql + cloudbase/rollbacks/*.sql',
  '- 样式：crm/css/console.css',
  '',
  '【验收标准】',
  '<从工作包文档复制验收标准>',
  '',
  '【发布】',
  '1. 部署受影响的云函数和静态文件',
  '2. 运行 npm test / npm run test:wp01 回归',
  '3. Git 提交、推送、打标签',
  '4. tools/sync-check.ps1 三端核对',
  '5. 从 LEGACY_ENTRIES 移除已整合项（如适用）',
];
template.forEach((line) => {
  children.push(new Paragraph({
    children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 18 })],
    spacing: { after: 20 },
  }));
});

// ---------- 输出 ----------
const doc = new Document({
  creator: 'Victor',
  title: 'CRM 系统现状分析与后续工作计划',
  styles: {
    default: {
      document: { run: { font: 'Microsoft YaHei', size: 21 } },
    },
  },
  sections: [{ children }],
});

const outPath = path.join(__dirname, '..', 'docs', 'CRM系统现状分析与后续工作计划.docx');
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outPath, buf);
  console.log('文档已生成：' + outPath);
});
