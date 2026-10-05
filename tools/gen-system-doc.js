/**
 * 生成 Victor's CRM 系统说明文档 (DOCX) —— 唯一事实来源
 * 输出: docs/system-documentation.docx （不带版本号，始终代表最新；封面标注当前版本）
 * 系统变更后更新本脚本并重新生成。
 */
const DOC_VERSION = 'v2.0.0';
const DOC_DATE = '2026-10-05';
const DOC_SUFFIX = 'AI-native Person 360 目标 CRM（WP01–WP13 基线）';
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType,
  PageBreak, Header, Footer, PageNumber,
  TableOfContents, convertInchesToTwip, LevelFormat,
} = require('docx');

const BLUE = '2563eb', PINK = 'db2777', PURPLE = '7c3aed', CYAN = '0891b2';
const GOLD = 'd4a017', GREEN = '059669', GRAY = '64748b', DARK = '1e293b';

// helpers
const h1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 200 }, children: [new TextRun({ text, bold: true, size: 32, color: DARK })] });
const h2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 160 }, children: [new TextRun({ text, bold: true, size: 26, color: BLUE })] });
const h3 = (text, color) => new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 220, after: 120 }, children: [new TextRun({ text, bold: true, size: 22, color: color || PURPLE })] });
const p = (text, opts) => new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text, size: 21, ...(opts || {}) })] });
const bullet = (text, level) => new Paragraph({ bullet: { level: level || 0 }, spacing: { after: 60 }, children: [new TextRun({ text, size: 20 })] });
const spacer = () => new Paragraph({ spacing: { after: 100 }, children: [] });
const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

function tbl(headers, rows, colWidths) {
  const hdrCells = headers.map((h, i) => new TableCell({
    width: colWidths ? { size: colWidths[i], type: WidthType.PERCENTAGE } : undefined,
    shading: { type: ShadingType.SOLID, color: '2563eb' },
    children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: 'ffffff', size: 19 })] })],
  }));
  const dataRows = rows.map(row => new TableRow({
    children: row.map(cell => new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text: String(cell || ''), size: 18 })] })],
    })),
  }));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ tableHeader: true, children: hdrCells }), ...dataRows],
  });
}

const sections = [];

// ===== 封面 =====
sections.push(new Paragraph({ spacing: { before: 3000 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Victor's CRM", size: 52, bold: true, color: DARK })] }));
sections.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: '系统说明文档', size: 40, bold: true, color: BLUE })] }));
sections.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [new TextRun({ text: DOC_VERSION + ' — ' + DOC_SUFFIX, size: 24, color: GRAY })] }));
sections.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 }, children: [new TextRun({ text: DOC_DATE, size: 22, color: GRAY })] }));
sections.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'CloudBase: crm-d1gkae8ddc930d151', size: 18, color: GRAY })] }));
sections.push(pageBreak());

// ===== 目录 =====
sections.push(h1('目录'));
sections.push(new TableOfContents('目录', { hyperlink: true, headingStyleRange: '1-3' }));
sections.push(pageBreak());

// ===== 1. 系统概述 =====
sections.push(h1('1. 系统概述'));
sections.push(h2('1.1 项目简介'));
sections.push(p("Victor's CRM 是一套基于腾讯云开发（CloudBase）的轻量级保险行业客户关系管理与 AI 经营辅助系统，面向保险代理人提供客户经营、活动经营、组织发展（增员）、机会管理与 AI 教练等一体化能力。"));
sections.push(p('系统采用 Serverless 架构：前端为单文件 HTML 应用加按需加载的 ES 模块（无构建工具），后端为 28 个云函数，数据库为 CloudBase PostgreSQL，所有数据访问通过云函数中转，前端不直连数据库。'));
sections.push(p('2026 年 9 月起，系统在原有 Legacy CRM（客户/活动/增员三模块）之上，以增量方式建成了 AI-native 的 Person 中心新架构（WP01–WP13 工作包）：以 persons 为统一人物身份，以 interactions（互动）、context_items（事实/信号/推断）、actions（行动）、commitments（承诺）、outcomes（结果）为经营闭环账本，所有 AI 关键写入均经“服务端预览 → 人工确认 → 事务执行”。旧功能完整保留并收入“更多”入口，两套体系并行互通。'));
sections.push(spacer());

sections.push(h2('1.2 技术栈'));
sections.push(tbl(
  ['层次', '技术', '说明'],
  [
    ['前端主体', '原生 HTML + JS + CSS', 'admin.html 单文件（约 497KB / 8400+ 行），hash 路由，callFn 调云函数'],
    ['前端模块', '原生 ES Modules', 'crm/js/core 核心层 + crm/js/modules 16 个业务模块 + crm/css 9 个样式，按需 import'],
    ['后端', 'Node.js 云函数（28 个）', 'Nodejs18.15 / Nodejs20.19 双运行时，rdb 链式 API 与服务端 PG RPC'],
    ['数据库', 'PostgreSQL (CloudBase)', '47 张表 + 10 个业务视图，全部新表强制 RLS、仅 service_role 可访问'],
    ['AI 体系', 'CloudBase AI Gateway', 'provider 中立网关，模型由环境配置选择；AI 任务/运行/结果三表审计'],
    ['AI 文本', '混元等内置模型（套餐积分）', 'generateText 结构化 JSON；保险经营话术、候选生成、复盘、简报'],
    ['AI 视觉', 'glm-5v-turbo', '多模态图片 OCR 与客户资料提取'],
    ['存储', 'CloudBase 云存储', '客户照片、增员雷达图/报告等文件'],
    ['托管', 'CloudBase 静态托管 /crm/ 目录', 'admin.html 入口 + crm/js、crm/css 模块资源，no-store 防缓存漂移'],
    ['认证', 'CloudBase 用户名密码登录', '5 分钟无操作重新登录；新函数真实登录 UID 校验 + 服务端密钥'],
    ['部署', 'tcb CLI + 版本化迁移', '云函数/静态文件精准部署，SQL 迁移经 CloudBase 迁移历史管理'],
  ],
  [16, 30, 54]
));
sections.push(spacer());

sections.push(h2('1.3 核心设计原则'));
sections.push(bullet('Person 中心：客户、增员候选人、嘉宾、活动参与者、机会统一归并到 persons 身份，按精确 ID 关联，绝不按姓名自动合并'));
sections.push(bullet('AI 只建议不擅改：AI 产出候选（Fact/Signal/机会/行动/承诺）一律先预览，人确认后才落库；requires_confirmation 默认 true'));
sections.push(bullet('命令五段式：Command → Plan → Preview → Confirm → Execute，预览绑定登录 UID、摘要与 15 分钟有效期，执行幂等可重放'));
sections.push(bullet('证据驱动防虚构：AI 必须引用真实存在的来源；来源不足返回“证据不足/不生成”，“没有记录”不被解释为需求或风险'));
sections.push(bullet('事实/信号/推断分层：context_items 的 fact、signal、inference 类型严格区分，AI 来源默认 confirmed=false'));
sections.push(bullet('增量并存：新 Person 架构与旧 Legacy CRM 并行，旧页面/旧函数/旧写入全部保留，Legacy 收入“更多”，不迁移不回填旧数据'));
sections.push(bullet('AI 失败降级：模型超时/失败自动回退确定性规则版，绝不导致页面白屏（如晨间简报模型最多等 10 秒）'));
sections.push(bullet('最小权限：新表仅 service_role 可访问，anon/authenticated 无权；密钥只存云函数配置，不入仓库不入浏览器'));
sections.push(bullet('测试数据隔离：虚构测试样本必须登记批次并带【系统测试·勿联系】标记，触发器自动登记衍生记录'));
sections.push(spacer());

sections.push(h2('1.4 顶部主导航（Phase 14）'));
sections.push(p('主导航七个顶级入口加一个常驻快速记录按钮，按代理人一天的工作流组织：'));
sections.push(tbl(
  ['导航', '路由', '说明'],
  [
    ['今日', '#/ , #/today', '首页工作台、Today 5、晨间简报、承诺/行动提醒'],
    ['AI助手', '#/ai, #/ai/search, #/assistant/*', 'AI 搜索、意图路由、统一行动创建向导'],
    ['人', '#/people, #/person/:id', '人物目录与 Person 360（新一代人物主页）'],
    ['机会', '#/opportunities', '机会目录：正式机会与待审核候选分区'],
    ['活动', '#/activities, #/activity/:id', '活动列表/详情、参与者、嘉宾、AI 复盘 V2'],
    ['招募', '#/recruit, #/recruit/:id, #/recruit/goals', '增员工作台、候选人、月度目标'],
    ['更多', '#/more', '旧版功能入口（客户列表、回收站、漏斗、讲师/主题、活动量日报、账号维护等）'],
    ['＋ 快速记录', '全局常驻', 'Quick Capture 自然语言速记（Legacy V1 与 Person V2 双模式）'],
  ],
  [16, 34, 50]
));
sections.push(pageBreak());

// ===== 2. 总体架构 =====
sections.push(h1('2. 总体架构'));
sections.push(h2('2.1 双轨架构总览'));
sections.push(p('系统由两套互通的体系组成，共享同一 CloudBase 环境与登录身份：'));
sections.push(tbl(
  ['维度', 'Legacy CRM（2026-09 前建成）', 'Person 中心新架构（WP01–WP13）'],
  [
    ['核心实体', 'customers / recruit_candidates / activities', 'persons 统一身份 + 角色/关系/家庭'],
    ['经营记录', 'followups / opportunities / activity_tasks', 'interactions / actions / commitments / outcomes / context_items'],
    ['访问方式', '云函数匿名 RDB + RLS fn_only', '真实登录 UID + 服务端密钥 + service_role RPC'],
    ['AI 调用', '各函数内置 generateText', 'AI Gateway + Skill Registry + Context Engine'],
    ['写入控制', '人工表单直接 CRUD', '预览-确认-执行事务台账 + 幂等键'],
    ['前端位置', 'admin.html 内聚页面', 'crm/js/modules ES 模块按需加载'],
    ['入口', '“更多”内保留全部旧入口', '主导航 今日/AI助手/人/机会'],
  ],
  [16, 38, 46]
));
sections.push(spacer());
sections.push(p('两轨连接点：persons.legacy_customer_id 与 customers 一对一快照映射；opportunities、activity_participants、activity_speakers、recruit_candidates 均增加 person_id/canonical_person_id 外键；旧跟进/增员跟进通过只读适配器投影为 Person 时间线，但不回填、不改写旧表。'));
sections.push(spacer());

sections.push(h2('2.2 请求链路'));
sections.push(bullet('浏览器 → CloudBase 网关 → 云函数（app.auth().getUserInfo() 校验真实登录）'));
sections.push(bullet('Legacy 函数：函数内匿名 RDB 访问公开视图/表，基表 RLS fn_only 仅放行云函数上下文'));
sections.push(bullet('新架构函数（person_360 / assistant）：校验登录 UID 后，用函数配置中的服务端 PG API Key 调用 SECURITY INVOKER 的固定 RPC 与列白名单读取'));
sections.push(bullet('AI 请求：业务函数 → AI Gateway → CloudBase 托管模型，用量与结果落 ai_tasks/ai_runs/ai_results'));
sections.push(bullet('关键写入：浏览器提交结构化命令 → 服务端生成预览台账 → 人工确认 → RPC 事务写业务表与回执，重放返回同一结果'));
sections.push(pageBreak());

// ===== 3. 数据库设计 =====
sections.push(h1('3. 数据库设计'));
sections.push(p('CloudBase PostgreSQL 共享集群 public schema，截至 2026-10-05 共 47 张表、10 个业务视图。旧业务表以 RLS fn_only 保护；2026-09-25 后新建的 28 张表全部强制 RLS 且仅 service_role 拥有受限权限（多为 SELECT/INSERT/UPDATE，无 DELETE）。所有变更经版本化迁移（cloudbase/migrations，70+ 个 SQL）与成对回滚脚本管理。'));
sections.push(spacer());

sections.push(h2('3.1 Legacy 客户域 — 10 张表'));
sections.push(tbl(
  ['表', '关键字段', '用途'],
  [
    ['customers', 'Id, customer_name, customer_stage, profile(jsonb), sales_priority, delete_batch_id', '客户主档，profile 8 维度画像；软删除并带删除批次'],
    ['followups', 'Id, customer_id, followup_notes, next_followup_goal(TEXT)', '跟进记录（goal 为自由文本）'],
    ['gifts', 'Id, customer_id, gift_name, given_date', '礼品记录'],
    ['photos', 'Id, customer_id, photo_url, thumbnail_url', '客户照片'],
    ['products', 'Id, customer_id, product_name, items, ppa', '产品额度（含条目数/保费）'],
    ['opportunities', 'Id, customer_id, person_id, opportunity_type, status', '经营机会（含转介绍）；新架构机会 person_id 关联、customer_id 可空'],
    ['ai_recommendations', 'Id, customer_id, suggested_followup_goal(TEXT), nba', 'AI 下一最佳行动建议历史'],
    ['ocr_records', 'Id, customer_id, ocr_text', 'OCR 识别记录（含身份证等敏感信息）'],
    ['policy_review_reports', 'Id, customer_id, summary, gaps, recommendations', '保单检视报告 5 段'],
    ['customer_goal_benchmarks', 'benchmark_name, target_value', '客户经营目标基准'],
  ],
  [25, 42, 33]
));
sections.push(spacer());

sections.push(h2('3.2 Legacy 活动与增员域 — 9 张表'));
sections.push(tbl(
  ['表', '关键字段', '用途'],
  [
    ['activities', 'Id, activity_name, status, type, planned_date', '活动主档'],
    ['activity_participants', 'Id, activity_id, person_type, person_id, canonical_person_id, status', '参与者多态 + 规范 Person 关联'],
    ['activity_tasks', 'Id, activity_id, task_type, status', '活动待办（硬删除语义）'],
    ['activity_speakers', 'Id, name, person_id, relationship_stage', '嘉宾资源池，可关联 Person'],
    ['activity_topics', 'Id, topic_name, category', '主题资源池'],
    ['recruit_candidates', 'Id, customer_id, person_id, name, stage, potential_score, profile(jsonb)', '增员候选人（8 阶段漏斗），强关联客户主表/Person'],
    ['recruit_milestones', 'Id, candidate_id, milestone_type', '里程碑时间线'],
    ['recruit_followups', 'Id, candidate_id, followup_notes', '增员跟进记录'],
    ['recruit_goals / recruit_goal_benchmarks', '年月, 候选人数 / 行业基准', '增员月度目标（原子保存）与对比基准'],
  ],
  [28, 42, 30]
));
sections.push(spacer());

sections.push(h2('3.3 Person 身份与关系域 — 6 张表（新）'));
sections.push(tbl(
  ['表', '关键字段', '用途'],
  [
    ['persons', 'id(bigint), display_name, name_key, legacy_customer_id, gender, birthday, phone, wechat, profile, deleted_at', '统一人物身份；由 customers 1:1 快照回填（776 条），新建需人工确认'],
    ['person_roles', 'person_id, role(customer/recruit/speaker/participant 等)', '人物角色多值层，一次性回填 792 条'],
    ['relationships', 'from_person_id → to_person_id, relationship_type, direction', '人与人的有向关系边'],
    ['households', 'id, household_name', '家庭单元'],
    ['household_members', 'household_id, person_id, member_role, 唯一约束', '家庭成员（人工确认的关系）'],
    ['person_identity_commands', '台账：账号/幂等键/预览/15 分钟有效期', '人物新建身份确认命令台账'],
  ],
  [26, 44, 30]
));
sections.push(spacer());

sections.push(h2('3.4 经营账本域 — 6 张新表 + opportunities 扩展'));
sections.push(tbl(
  ['表', '关键字段', '用途'],
  [
    ['interactions', 'person_id, interaction_type, importance, source, occurred_at, activity_id', '互动台账（人/电话/会面/活动到场等），兼容旧跟进只读投影；按人+时间+来源去重'],
    ['context_items', 'person_id, item_type(fact/signal/inference), content, confidence, interaction_id', '事实/信号/推断上下文；AI 来源默认未确认，校验触发器防越级确认'],
    ['actions', 'person_id, title, action_type, priority(low/medium/high/urgent), status, due_at, opportunity_id, interaction_id, activity_id', '统一行动（20+ 审计字段）；完成需时间与操作者，AI 行需确认'],
    ['commitments', 'person_id, content, commitment_type(I_PROMISED/THEY_PROMISED/MUTUAL), status, due_at, interaction_id', '承诺台账，独立于旧 next-action 字段'],
    ['outcomes', 'outcome_type, result, sentiment, business_value, action_id/opportunity_id/interaction_id/activity_id/recruit_candidate_id', '已发生结果；多态关联，ON DELETE SET NULL，无 DELETE 授权'],
    ['opportunity_candidates', 'person_id, opportunity_type, evidence_refs, status(draft/preview/confirmed/created/rejected), ai_result_id', 'AI 机会候选与人工审核流'],
    ['opportunities（扩展）', '新增 person_id', '正式机会；Person 专属机会 customer_id 为空，旧客户机会行为不变'],
  ],
  [24, 46, 30]
));
sections.push(spacer());

sections.push(h2('3.5 AI 运行时与知识域 — 6 张表（新）'));
sections.push(tbl(
  ['表', '用途'],
  [
    ['ai_tasks', 'AI 任务定义（requires_confirmation 默认 true）'],
    ['ai_runs', '模型每次运行：耗时、用量、临时错误、重试、超时记录'],
    ['ai_results', '结构化结果与人工反馈；复合外键限定结果只能指向同一任务的运行'],
    ['knowledge_items', '知识条目：产品/条款/公司/证据/案例/故事/法规/个人经验 8 类，含有效期、verified、confidence(0–1)'],
    ['playbooks', '沟通话术本：场景/异议/深层原因/澄清问题/回应逻辑/证据案例故事引用/禁用说法/下一目标'],
    ['learnings', '经验学习：情境/AI建议/人的决定/实际行动/结果/教训，confirmed=false 起步，确认留审计'],
    ['（AI Gateway 审计）', '所有真实模型调用的任务、运行、结果、用量统一落上述三表，支持审计与成本追溯'],
  ],
  [30, 70]
));
sections.push(spacer());

sections.push(h2('3.6 命令台账与测试治理域 — 10 张表（新）'));
sections.push(tbl(
  ['表', '用途'],
  [
    ['quick_capture_v2_commands', 'Quick Capture V2 确认命令；RPC quick_capture_v2_commit 原子写 interaction + context_items'],
    ['assistant_action_commands', 'Assistant 统一行动创建命令（plan/preview/confirm/execute 绑定 UID 与 15 分钟有效期）'],
    ['crm_work_item_commands', '行动/承诺的预览-确认-执行台账（幂等键、原版本、回执）'],
    ['crm_opportunity_commands', '机会创建/阶段推进/编辑/关闭命令台账（关闭同事务写 outcomes）'],
    ['crm_opportunity_action_links', '行动与机会的服务角色专用关联（绕开旧 actions 不可变保护，带批次键）'],
    ['crm_activity_review_commands', '活动复盘 V2 的逐项审核/结果记录命令台账'],
    ['crm_activity_review_source_claims', '活动复盘逐来源认领与防重（同一实质来源不可重复接受）'],
    ['crm_test_batches / crm_test_records / crm_test_previews', '测试批次登记、衍生测试样本逐 ID 登记、测试场景预览（真实链路隔离）'],
  ],
  [42, 58]
));
sections.push(spacer());

sections.push(h2('3.7 视图层 — 10 个业务视图'));
sections.push(p('旧列表/详情查询走 *_view 与 v_* 聚合视图；Person 架构落地后，v_action_center、v_funnel_stats、v_recruit_candidates 等全部重建为 security_invoker 视图并纳入 Person 关联。视图缺列是静默故障：表结构变更后必须 DROP + CREATE 重建并重新 GRANT。'));
sections.push(tbl(
  ['视图', '用途'],
  [
    ['customers_view', '客户列表/详情（43 列，聚合礼品/跟进/AI建议/照片）'],
    ['followups_view / gifts_view / photos_view / products_view', '跟进/礼品/照片/产品列表'],
    ['ai_recommendations_view', 'AI 建议列表'],
    ['v_action_center', '跨域今日行动池（14 列，纳入统一 Action）'],
    ['v_funnel_stats', '三漏斗统计（当前数/阶段变化/超期/停留）'],
    ['v_recruit_candidates / v_recruit_candidates_trash', '增员候选人列表（38 列，含 Person/目标/基准）与回收站'],
  ],
  [40, 60]
));
sections.push(pageBreak());

// ===== 4. 云函数架构 =====
sections.push(h1('4. 云函数架构'));
sections.push(p('共 28 个云函数，分三类：Legacy 业务 CRUD（14 个）、Legacy AI 智能（10 个）、Person 中心新函数（4 个：person_360、assistant、activity_reports 等独立函数，及拆出的资源函数）。共享源码位于 cloudfunctions/_shared（11 个模块），部署时复制为各函数目录内副本并做哈希一致性校验。'));
sections.push(spacer());

sections.push(h2('4.1 Legacy 业务函数'));
sections.push(tbl(
  ['函数', '主要 action / 说明'],
  [
    ['customers', 'list（服务端分页）/get/create/update/remove/restore，软删除+级联+删除批次'],
    ['followups / gifts / photos / products', '各自 list/get/create/update/remove'],
    ['opportunities', '机会 CRUD（旧客户机会通道保持不变）'],
    ['activities / activity_tasks', '活动 CRUD、参与者、待办'],
    ['activity_speakers / activity_topics', '嘉宾资源池、主题资源池独立管理'],
    ['activity_reports', '活动量统计报表（客户/增员活动量日报）'],
    ['recruit_candidates', 'list/get/create/update/remove/restore（Person 关联，仅 Person 招募可删的守卫）'],
    ['recruit_followups / recruit_milestones / recruit_goals', '增员跟进、里程碑、月度目标（原子保存）'],
    ['ocr_records', 'OCR 记录独立函数'],
  ],
  [30, 70]
));
sections.push(spacer());

sections.push(h2('4.2 Legacy AI 函数'));
sections.push(tbl(
  ['函数', '用途'],
  [
    ['ai_parse', 'parse 文本/多图→客户资料；quick_capture 自然语言拆解（V1）；version:2 走 Quick Capture V2 预览'],
    ['today_coach', 'daily_review 每日复盘/晨间简报（view=morning 七段）、Today5 生成、cockpit 只读驾驶舱；六维规则排序 action-facts'],
    ['ai_recommend', '客户 NBA 下一最佳行动（保险金字塔/双十原则/普尔象限）'],
    ['ai_followup', '口语→结构化跟进；通读历史生成画像更新建议'],
    ['ai_activity', '活动 analyze/prepare/decompose/嘉宾推荐/主题推荐/postReview；postReviewV2 生成活动复盘审计与候选'],
    ['ai_referral', '转介绍建议（适配度/信心/时机/话术/NBA）'],
    ['ai_recommendations', 'AI 建议历史管理'],
    ['funnel_insight', '三漏斗 stats 事实 + explain AI 解读（超时降级规则版）'],
    ['policy_review_reports', '保单检视报告生成（5 段）'],
    ['recruit_score / recruit_recommend', '增员 6 维度潜力评分；增员话术与 NBA（增员五步法/STAR 异议处理）'],
  ],
  [28, 72]
));
sections.push(spacer());

sections.push(h2('4.3 Person 中心新函数'));
sections.push(h3('4.3.1 person_360（核心聚合函数，40+ action）'));
sections.push(p('真实登录 + 服务端密钥（CRM_PERSON360_DB_API_KEY，2026-12-25 到期需轮换），固定 public 表/列白名单。主要能力分组：'));
sections.push(bullet('身份：get/getCustomerProfile/lookupCustomer/search、listPeople（人物目录分页，每页≤50）、resolveIdentity/previewIdentity/executeIdentity'));
sections.push(bullet('仅招募人物：listPersonOnlyRecruits/get/回收站/删除/恢复（人物域候选人）'));
sections.push(bullet('时间线与洞察：listInteractions/createInteraction、getTimelinePage、getContextGroups、recordActivityInteraction'));
sections.push(bullet('家庭：addMember/removeMember；保险上下文 getInsuranceContext；增员上下文 listRecruitContext'));
sections.push(bullet('机会：机会目录/候选 listPendingOpportunityCandidates、listOpportunities、previewOpportunity/executeOpportunity、行动关联 getOpportunityLinks/listUnlinkedOpportunityActions'));
sections.push(bullet('工作项：listPersonWorkItems/listTodayWorkItems/previewWorkItem/executeWorkItem；承诺 listDueCommitments'));
sections.push(bullet('信号：getRelationshipDecay 关系衰减只读信号'));
sections.push(bullet('活动复盘：previewActivityReview/executeActivityReview/listActivityOutcomes'));
sections.push(bullet('人物归并：addCanonicalParticipant、createSpeakerProfile/linkSpeakerPerson、resolveQuickCaptureName'));
sections.push(spacer());
sections.push(h3('4.3.2 assistant（AI 助手网关函数）'));
sections.push(bullet('真实登录校验后工作；不做开放式聊天机器人，意图必须显式传入（intent + subject + input）'));
sections.push(bullet('七种意图：search 检索、summarize 人物摘要、prepare 会前/活动准备、analyze 机会/活动分析、plan 当日计划、create_candidate、update_candidate'));
sections.push(bullet('action=search：AI CRM Search，模型只选固定模板与 1–12 个月时间窗，人物/数量/来源由数据库函数 crm_search_people_v1 计算，绝不执行模型生成 SQL'));
sections.push(bullet('action=command：变更命令安全契约，四操作 create/update/close/delete 必须走 plan→preview→confirm→execute；当前已启用资源：统一行动（actions）创建、机会候选、工作项、机会、活动复盘，各自独立执行器与授权'));
sections.push(bullet('quickCaptureV2、opportunityCandidate、testSamples 等专用 action 分流到对应服务'));
sections.push(spacer());

sections.push(h2('4.4 共享模块（cloudfunctions/_shared）'));
sections.push(tbl(
  ['模块', '职责'],
  [
    ['db.js', 'rdb 链式 API、generateText、extractJson、assertOk 等旧通道封装'],
    ['ai.js', '保险 NBA 标准话术与 8 条 AI 护栏的共享实现'],
    ['ai-gateway.js', 'provider 中立 AI 网关：结构化结果与用量落库、临时错误逐次记录、超时不重试、审计失败即停止'],
    ['context-engine.js', '上下文引擎：有界装配 Person 资料/互动/事实，控制发送给模型的内容范围'],
    ['skill-registry.js', '技能注册表：crm_search_parse、person_summary、meeting_prep、opportunity_analysis、conversation_playbook 等'],
    ['action-service.js', '统一行动的列表/手工创建/完成（来源 manual，引用活性校验）'],
    ['interaction-service.js', '互动台账读写、旧跟进只读适配、去重与重要性校验'],
    ['person-service.js', 'resolveName 身份解析：精确匹配，歧义/缺失拒绝自动建人'],
    ['conversation-playbook.js', '话术本技能：证据/案例/故事引用服务端核验'],
    ['legacy-interaction-adapter.js', '旧 followups/recruit_followups/活动到场 → Person 时间线只读投影'],
    ['test-data.js', '测试样本策略：标记校验与批次登记'],
  ],
  [32, 68]
));
sections.push(pageBreak());

// ===== 5. 前端架构 =====
sections.push(h1('5. 前端架构'));
sections.push(h2('5.1 单文件主体 + 模块化扩展'));
sections.push(p('admin.html 保留全部 Legacy 页面（约 497KB、8400+ 行），含 no-store 缓存头；2026-09-26 起新增功能以 crm/js 下的原生 ES Module 实现，路由命中时动态 import，不改动旧页面包。'));
sections.push(tbl(
  ['目录', '内容'],
  [
    ['crm/js/core', 'api.js（callFn 封装）、feature-flags.js（功能开关，quick_capture_v2 默认关）、state.js、router-extension.js'],
    ['crm/js/modules', '16 个业务模块：person-360、person-profile、person-insights、work-items、opportunity-candidates、opportunity-workflow、morning-brief、quick-capture-v2、activity-review-v2、ai-crm-search、assistant-action-create、phase14-hubs、account-settings、test-scenario、test-data-notice 等'],
    ['crm/css', '9 个模块样式：person-360、work-items、morning-brief、quick-capture-v2、activity-review-v2、ai-crm-search、assistant-action-create、ai-native、phase14-navigation'],
  ],
  [24, 76]
));
sections.push(spacer());

sections.push(h2('5.2 主要路由'));
sections.push(tbl(
  ['Hash', '页面', '架构归属'],
  [
    ['#/ , #/today', '今日工作台 / 今日教练', '新旧融合'],
    ['#/ai', 'AI 助手中心（功能集合页）', '新'],
    ['#/ai/search', 'AI CRM 搜索', '新'],
    ['#/assistant/actions/new', '统一行动创建向导（五段式）', '新'],
    ['#/people', '人物目录（只读分页）', '新'],
    ['#/person/:id', 'Person 360 人物主页', '新'],
    ['#/opportunities', '机会目录（正式 + 待审核候选）', '新'],
    ['#/activities / #/activity/:id', '活动列表 / 详情（含复盘 V2 模块）', '旧+新模块'],
    ['#/recruit / :id /goals', '增员工作台/详情/目标', '旧'],
    ['#/customers / #/customer/:id', '客户列表/详情（Legacy）', '旧'],
    ['#/customers/trash、#/recruit/trash', '回收站', '旧'],
    ['#/funnels', '三漏斗分析', '旧'],
    ['#/speakers、#/topics', '讲师/主题资源池', '旧'],
    ['#/activity/customer、#/activity/recruit', '客户/增员活动量日报', '旧'],
    ['#/ai-suggestions', 'AI 建议历史', '旧'],
    ['#/more', '更多（Legacy 功能聚合入口）', '新导航'],
    ['#/account', '账号与应用维护（改密/退出/强制加载最新版）', '新'],
    ['#/test-scenario', '测试场景（真实链路隔离测试）', '治理'],
  ],
  [30, 45, 25]
));
sections.push(spacer());

sections.push(h2('5.3 今日工作台'));
sections.push(bullet('驾驶舱四段：快速记录入口 → Today 5（2 Must/2 Recommended/1 Optional）→ 四线趋势（7 天滚动窗口只给方向）→ AI 提醒（逾期/到期/活动后无下一步/增员停留等确定性事实）'));
sections.push(bullet('晨间简报（morning-brief 模块，按需生成、进页面不自动调模型，模型建议最多等 10 秒失败降级）'));
sections.push(bullet('简报七段：Morning Brief 概览 / Top Actions（六维规则排序 Top5）/ Commitments（逾期+未来三天，各≤50）/ Upcoming（未来 7 天活动与行动≤10）/ Risk（有记录依据的逾期≤10）/ Opportunities（未关闭正式机会≤10）/ Need Confirmation（待审核候选≤10，跳转 Person 360）'));
sections.push(bullet('承诺卡片：person_360.listDueCommitments 只读，逾期与未来三个北京自然日到期分组'));
sections.push(bullet('Today5 与 #/today 共用当天缓存 key（v5），全 App 当天只调一次生成模型；写入行动/承诺成功后清缓存重载'));
sections.push(spacer());

sections.push(h2('5.4 Person 360 人物主页'));
sections.push(bullet('人物档案：身份信息、客户画像（getCustomerProfile）、增员资料上下文、保险上下文（保单/产品/检视证据）'));
sections.push(bullet('家庭视图：家庭成员搜索、加入/移除，独立 Person 也可按 ID 访问；无 Person 映射的旧客户显示明确的不可用提示，不暗中建人'));
sections.push(bullet('互动时间线：互动/旧跟进/活动到场统一分页展示，重要互动中文标签（实质沟通等），可跳转来源活动'));
sections.push(bullet('事实与上下文分组（getContextGroups）：事实/信号/推断分区，AI 项显示待核实状态'));
sections.push(bullet('关系衰减信号：依据关系强度、重要性、最近重要互动与个人历史间隔（需≥3 个不同日期互动）给出 why/confidence/recommended_action；证据不足明确提示，用客户优先级代理时显示警示'));
sections.push(bullet('机会卡：候选审核（接受/拒绝/编辑）+ Person 专属正式机会管理；保留进入传统客户详情的链接'));
sections.push(bullet('工作项：行动与承诺的新建、完成、取消、重开、改期，逾期标识；预览不写业务，确认后执行'));
sections.push(spacer());
sections.push(pageBreak());

// ===== 6. 核心业务流程 =====
sections.push(h1('6. 核心业务流程'));

sections.push(h2('6.1 Quick Capture 快速记录（双模式）'));
sections.push(bullet('V1（默认）：首页/客户详情一键唤起，自然语言拆解为人/事件/事实/需求/阶段/下一步，沿用 ai_parse.quick_capture，草稿点遮罩不丢失'));
sections.push(bullet('V2（功能开关控制）：同一句自然语言走 version:2 解析为互动 + Fact/Signal 候选 + 机会/行动/承诺候选，打开可编辑预览；必须人工从搜索结果选择 Person，不能自动选/建人'));
sections.push(bullet('V2 提交：二次服务端身份解析 → RPC quick_capture_v2_commit 原子写 1 条 interactions 与保留 AI 来源的 context_items（confirmed=false）；机会/行动/承诺候选本期仅预览'));
sections.push(bullet('网络超时不自动重试，提示用户先到 Person 360 核查再提交，防重复'));
sections.push(spacer());

sections.push(h2('6.2 机会候选到成交闭环（WP10）'));
sections.push(bullet('候选生成：读取 Person 有限字段 + 最多 30 条有来源互动/有效事实/到场活动/增员资料/保单与检视/少量 OCR 摘要；不发送完整历史与图片'));
sections.push(bullet('证据门槛：来源为空、仅到场或仅保单存在、AI 引用不存在来源时不生成候选；返回 insufficient_evidence'));
sections.push(bullet('审核：人可编辑或拒绝（候选状态 draft/preview/confirmed/created/rejected，AI 结果联动反馈 accepted/rejected）'));
sections.push(bullet('正式创建：preview（15 分钟）→ confirm（绑定 UID 与摘要）→ execute（复检 Person/来源/重复，事务内创建 Person 专属 opportunities，重放返回同一机会）'));
sections.push(bullet('阶段推进/编辑/关闭同样走预览确认；关闭在同一事务写 outcomes；行动关联用专用关联表，不改旧 Action 不可变字段'));
sections.push(spacer());

sections.push(h2('6.3 行动与承诺日常操作（WP08）'));
sections.push(bullet('Person 360 与 Today 读写同一张 actions/commitments；列表按到期时间取每类≤50 未完成 + 最近 10 条已完成，超窗提示'));
sections.push(bullet('人工创建来源标记 manual；完成必须记录时间与操作者；AI 来源行必须人工确认'));
sections.push(bullet('预览台账 crm_work_item_commands 保存账号、幂等键、原版本、15 分钟截止；过期预览、伪造 Person、跨 Person ID 均拒绝'));
sections.push(spacer());

sections.push(h2('6.4 活动复盘 V2（WP12）'));
sections.push(bullet('活动详情独立 activity-review-v2 模块：ai_activity.postReviewV2 基于有界活动上下文生成 AI 审计与 Action/机会候选/结果建议'));
sections.push(bullet('参与者身份优先用 canonical_person_id，旧客户/增员/嘉宾仅按精确外键定位 Person；无身份依据拒绝生成'));
sections.push(bullet('仅真实到场或重要性达标、人工确认的实质互动可支撑行动候选；机会候选必须有同活动同 Person 的重要互动；普通报名不产生高价值互动'));
sections.push(bullet('逐项接受/拒绝；服务端复检 AI 审计、候选索引、Person、来源与活动状态；逐来源防重，接受过的来源不能换引用重复接受'));
sections.push(bullet('Outcome 只接受已发生的人工事实，独立确认，不自动改变机会/行动状态；列表与详情显示活动 ID、参与者 ID 便于核对'));
sections.push(spacer());

sections.push(h2('6.5 AI CRM Search'));
sections.push(bullet('入口 #/ai/search：自然语言提问，模型只输出三个固定模板之一与时间窗，数据库函数 crm_search_people_v1 计算名单'));
sections.push(bullet('模板一：活动后未跟进（只计 attended 实际到场，邀请不算）；模板二：子女教育但记录中未见保险（仅表示“记录未见”）；模板三：A/B 级重点客户关系下降（须有明确下降事实）'));
sections.push(bullet('每条结果含 Person ID、显示名与可追溯来源，最多 30 人；无法归类的问题返回不支持，不拼接模型 SQL'));
sections.push(spacer());

sections.push(h2('6.6 Legacy 业务模块（持续可用）'));
sections.push(tbl(
  ['模块', '功能点'],
  [
    ['客户经营', '客户档案、跟进、礼品、照片、产品额度、保单检视、经营机会（含转介绍）、8 维度画像、OCR 名片/证件识别'],
    ['活动经营', '活动 CRUD、多态参与者、活动待办、嘉宾/主题资源池、AI 分析/筹备/分解/推荐/复盘/经验沉淀'],
    ['组织发展', '候选人 8 阶段漏斗、跟进、里程碑、AI 6 维评分、增员话术、月度目标 vs 行业基准'],
    ['三漏斗', '客户漏斗(6 阶段)/机会漏斗(5 阶段)/增员漏斗(8 阶段)，v_funnel_stats 事实卡 + AI 解读，小样本保护'],
    ['回收站', '客户/增员软删除恢复、级联子表、删除批次标记'],
  ],
  [18, 82]
));
sections.push(pageBreak());

// ===== 7. AI 体系 =====
sections.push(h1('7. AI 能力体系'));
sections.push(h2('7.1 AI Gateway 与技能注册'));
sections.push(bullet('Provider 中立：模型由 CloudBase 环境配置选择（AI_MODEL 可兼容回退），代码不含厂商绑定；统一经套餐积分调用'));
sections.push(bullet('结构化结果与真实用量落 ai_tasks/ai_runs/ai_results；临时错误逐次记录并重试，超时不重试，错误结果拒绝落库，审计写入失败则停止调用'));
sections.push(bullet('Skill Registry 注册技能：crm_search_parse、person_summary、meeting_prep（会前准备，含 relevant_playbook）、opportunity_analysis、activity_review、conversation_playbook 等'));
sections.push(bullet('Context Engine 有界装配上下文：只发必要字段与有来源摘要，不发送完整历史、OCR 原文或照片内容'));
sections.push(spacer());

sections.push(h2('7.2 数据- AI 分层与人工确认'));
sections.push(tbl(
  ['层级', '含义', '确认规则'],
  [
    ['fact 事实', '已发生且被确认的客观信息', 'AI 不可直接写 confirmed fact'],
    ['signal 信号', '候选观察（如关系衰减）', '默认未确认，不触发自动行动'],
    ['inference 推断', '人工/模型评估（关系强度等）', '需人工评估录入'],
    ['candidate 候选', '机会/行动/承诺/互动建议', '五段式命令确认后才落业务表'],
  ],
  [20, 46, 34]
));
sections.push(spacer());

sections.push(h2('7.3 八条 AI 护栏（共享 ai.js / 各服务强制执行）'));
sections.push(bullet('1. AI 只产出建议与候选，不直接改阶段、机会、客户等核心字段'));
sections.push(bullet('2. 信息不足透明返回“证据不足/样本不足，暂不能判断”，禁止虚构数据、成功率、ROI、因果'));
sections.push(bullet('3. 所有候选必须携带可核验来源引用，服务端复检来源存在且归属当前 Person'));
sections.push(bullet('4. 关键写入必须服务端预览 + 一次性人工确认 + 事务执行 + 幂等重放'));
sections.push(bullet('5. “没有记录”不得解释为需求、保障缺口或风险不存在'));
sections.push(bullet('6. 模型不能选择模板外操作、不能生成或拼接 SQL、不能决定身份合并'));
sections.push(bullet('7. AI 失败/超时降级确定性规则，页面不白屏；简报模型等待上限 10 秒'));
sections.push(bullet('8. AI 运行全程审计（任务/运行/结果/用量/人工反馈），learnings 未经确认不得作为已验证经验回流模型'));
sections.push(pageBreak());

// ===== 8. 安全设计 =====
sections.push(h1('8. 安全设计'));
sections.push(h2('8.1 数据库权限三层'));
sections.push(bullet('Legacy 表：ROW LEVEL SECURITY + fn_only 策略，仅云函数匿名上下文（sub IS NULL AND role=anon）放行，阻止前端直连'));
sections.push(bullet('新架构 28 张表：强制 RLS，仅 service_role 拥有 SELECT/INSERT/UPDATE（多数无 DELETE），anon/authenticated 显式 REVOKE；CloudBase 默认授权过宽时通过补充迁移回收'));
sections.push(bullet('业务 RPC：SECURITY INVOKER、仅 service_role EXECUTE，固定表/列白名单，错误回显不含密钥与环境信息'));
sections.push(spacer());

sections.push(h2('8.2 身份与密钥'));
sections.push(bullet('CloudBase 用户名密码登录；新函数每个 action 前先 getUserInfo 取真实 UID，匿名调用一律 UNAUTHORIZED'));
sections.push(bullet('person_360 使用独立服务端密钥 CRM_PERSON360_DB_API_KEY（2026-12-25 到期，须提前轮换）；today_coach、assistant 各有独立服务端密钥配置'));
sections.push(bullet('密钥只存云函数配置，不入 Git、不入浏览器；旧网关策略拒绝匿名函数调用'));
sections.push(spacer());

sections.push(h2('8.3 命令安全与防重'));
sections.push(bullet('客户端伪造 confirmed、计划 ID、确认令牌均无效；阶段缺失分别返回 COMMAND_PLAN_REQUIRED / SERVER_CONFIRMATION_REQUIRED / EXECUTOR_NOT_ENABLED'));
sections.push(bullet('预览绑定账号、请求幂等键、原版本快照与 15 分钟截止；执行时复检权限、状态与并发'));
sections.push(bullet('数据库触发器/守卫：跨 Person 的互动/机会关联拒绝；身份、链接、来源标记创建后不可变；越界评分（>100 或 confidence>1）拒绝'));
sections.push(bullet('回滚脚本数据守卫：表非空或存在命令回执/依赖时拒绝 DROP，防止静默删除业务数据'));
sections.push(spacer());

sections.push(h2('8.4 测试数据治理'));
sections.push(bullet('真实链路测试样本必须登记 crm_test_batches，内容虚构并带【系统测试·勿联系】标记；触发器把衍生业务行逐 ID 登记到 crm_test_records'));
sections.push(bullet('测试账号只能操作同批次已登记的虚构 Person/机会/行动；人工编辑去掉标记的写入会被拒绝'));
sections.push(bullet('测试场景预览经 crm_test_previews 与身份命令守卫，不污染真实经营判断'));
sections.push(bullet('生产探针脚本只上报 {hasPerson, counts, pass} 等布尔/计数，不上报姓名、备注、token'));
sections.push(spacer());

sections.push(h2('8.5 其他安全约定'));
sections.push(bullet('OCR 记录含身份证等敏感信息，RLS fn_only；敏感文件（数据库信息.txt）永不入库、不部署托管'));
sections.push(bullet('前端一律 textContent/el 工厂渲染，避免 innerHTML 注入；AI 搜索结果同样 textContent 呈现'));
sections.push(bullet('所有 SQL 参数化；视图重建后必须重新 GRANT；视图不能启用 RLS（PG 限制），安全边界在基表'));
sections.push(pageBreak());

// ===== 9. 部署与运维 =====
sections.push(h1('9. 部署与运维'));
sections.push(h2('9.1 环境信息'));
sections.push(tbl(
  ['项', '值'],
  [
    ['环境 ID', 'crm-d1gkae8ddc930d151（ap-shanghai）'],
    ['云函数', '28 个（Nodejs18.15 / Nodejs20.19，256MB，超时 3–150 秒按函数配置）'],
    ['静态托管', 'https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/'],
    ['前端入口', '/crm/admin.html（no-store）+ /crm/js、/crm/css 模块'],
    ['数据库', 'CloudBase PostgreSQL，public schema，47 表 / 10 视图'],
    ['GitHub', 'https://github.com/VictorLiang2026/crm'],
    ['文档三件套', 'docs/system-documentation.docx、docs/db-schema.svg、docs/data-dictionary.html'],
  ],
  [26, 74]
));
sections.push(spacer());

sections.push(h2('9.2 三地同步铁律'));
sections.push(p('每次改动立即走完整流程，不攒批：'));
sections.push(bullet('① 改代码：改 _shared 后同步全部函数目录副本（npm run check:shared 校验哈希）'));
sections.push(bullet('② 部署云端：tcb fn code update 逐函数部署；hosting deploy 精准上传 admin.html 与变动的 js/css（不泄露 .git、cloudfunctions）'));
sections.push(bullet('③ 数据库：版本化迁移先 dry-run/plan，经 CloudBase 迁移历史应用；成对准备 rollback'));
sections.push(bullet('④ 提交推送：git add 具体文件 → commit → 代理推送（http.proxy=127.0.0.1:7897，sslBackend=schannel）'));
sections.push(bullet('⑤ 打标签：每次提交 release-YYYYMMDD-HHMM；当天首次提交加 semver 标签；推送并 GitHub API 复核'));
sections.push(bullet('⑥ 复核：tools/sync-check.ps1 校验工作区干净、本地=GitHub、admin.html MD5 一致、标签一致'));
sections.push(spacer());

sections.push(h2('9.3 验证体系'));
sections.push(tbl(
  ['层级', '手段'],
  [
    ['静态', 'node --check、npm run check:shared（共享副本哈希）、git diff --check'],
    ['单元/服务', 'node --test：AI Gateway、互动、命令安全、技能注册、关系衰减、晨间简报等'],
    ['数据库边界', '只读 verify-public.sql + 事务内 validate-transaction.sql（标记夹具，验证后回滚）'],
    ['离线回归', 'npm test：约 107 项全量回归（登录、客户、Person360、Today、活动、招募、回收站、Quick Capture）'],
    ['浏览器回归', '隔离 Edge 夹具：约 66 项，覆盖五段式向导、候选审核、390/768px 宽度不溢出'],
    ['线上探针', '真实登录只读调用 + 匿名 UNAUTHORIZED 负向验证；只上报布尔/计数'],
    ['安全审计', 'npm run test:wp01：权限目录约 784 项、匿名网关 57/57、身份审计 6 条例外人工跟踪'],
  ],
  [22, 78]
));
sections.push(p('布局范围约定：新页面按 iPad 宽度验收，不做手机适配承诺；真机视觉与真实模型正向调用需人工/有效积分包时另行验收。', { color: GRAY }));
sections.push(pageBreak());

// ===== 10. 版本历史 =====
sections.push(h1('10. 版本与建设历程'));
sections.push(h2('10.1 Legacy 阶段（v1.0 – v1.8.10）'));
sections.push(tbl(
  ['版本', '主要内容'],
  [
    ['v1.0–v1.6', '基础 CRM：客户/跟进/礼品/照片/产品/OCR/保单检视；经营机会；活动多态参与；转介绍；增员重构与 jsonb 画像'],
    ['v1.7', '活动待办、嘉宾/主题资源池、AI 活动分析/复盘/经验沉淀、Activity→NBA→Today'],
    ['v1.8 Sprint', 'Quick Capture 自然语言速记；AI 经营驾驶舱（Today5/趋势/提醒）'],
    ['v1.8.8', '轻量漏斗管理：客户/机会/组织三漏斗，v_funnel_stats + funnel_insight'],
    ['v1.8.9', 'AI 能力统一：共享 NBA 标准模块与 8 条护栏，零前端零 DDL'],
    ['v1.8.10.x', 'ENUM→TEXT 自由文本迁移；快速录入嘉宾身份；嘉宾域方案 B 对齐，所有人以 customers 为 person 中心'],
    ['v2.0.0（2026-09-16）', '项目更名 crm：本地目录、云端 /crm/ 托管目录、GitHub 仓库统一；新架构基线起点'],
  ],
  [24, 76]
));
sections.push(spacer());

sections.push(h2('10.2 目标 CRM 工作包（WP01–WP13，2026-09-21 至 10-05）'));
sections.push(tbl(
  ['工作包', '交付'],
  [
    ['WP01–WP03', '只读基线安全门、测试数据披露策略、测试场景框架'],
    ['WP04', 'persons 身份底座：customers 1:1 快照回填，service_role 隔离'],
    ['WP05', '人物档案：person_360 函数与独立入口、家庭 households'],
    ['WP06', '人物洞察：interactions 互动台账、context_items、时间线、旧数据只读适配器'],
    ['WP07 / WP07.1', 'Quick Capture V2 原子提交与审计；人物目录与角色分页'],
    ['WP08', '统一行动 actions 与承诺 commitments 的日常操作（预览-确认-执行）'],
    ['WP09', 'Today 事实工作台统一与晨间简报七段'],
    ['WP10', '机会从 AI 候选到成交/关闭全流程，关闭写 outcomes'],
    ['WP11', '保险上下文 Person360：可解释的保单/家庭保障证据视图'],
    ['WP12', '活动关系闭环：复盘 V2 候选逐项审核、互动去重、来源防重'],
    ['WP13.x', '服务端分页、关键查询索引、增员目标原子保存、SDK 版本锁定、公网权限加固、删除批次'],
    ['AI Runtime', 'ai_tasks/ai_runs/ai_results 三表 + AI Gateway + Skill Registry + Context Engine'],
    ['知识层', 'knowledge_items 知识库 + playbooks 话术本 + outcomes 结果 + learnings 学习'],
    ['Assistant', '意图路由 V1、命令安全契约、AI CRM Search、首个可执行行动命令'],
    ['导航与账号', 'Phase 14 七模块主导航/Legacy 治理；账号维护页（改密/退出/强制刷新）'],
  ],
  [22, 78]
));
sections.push(spacer());
sections.push(p('截至 2026-10-05 最新发布标签：release-20261005-162209。每个工作包均按“迁移成对回滚、隔离测试、真实登录只读探针、三端哈希核对、发布标签”流程交付，生产库初始虚构种子 10 行且全部登记可追踪。'));
sections.push(pageBreak());

// ===== 11. 附录 =====
sections.push(h1('11. 附录'));
sections.push(h2('11.1 主要枚举值'));
sections.push(tbl(
  ['对象', '取值'],
  [
    ['customer_stage', '新认识 / 关系维护 / 需求挖掘 / 方案沟通 / 成交推进 / 转介绍经营'],
    ['opportunities.status', '发现 / 沟通 / 方案 / 成交 / 关闭'],
    ['recruit_candidates.stage', '新增人才 / 互动暖客 / 初次面谈 / 增员活动 / 精准面谈 / 入职申请 / 签约入司 / 流失'],
    ['activities.status', 'idea / preparing / confirmed / in_progress / ended / reviewed'],
    ['participants.status', 'invited / attended / absent'],
    ['actions.priority / status', 'low / medium / high / urgent；open / in_progress / completed / cancelled'],
    ['commitments.commitment_type', 'I_PROMISED / THEY_PROMISED / MUTUAL'],
    ['context_items.item_type', 'fact / signal / inference'],
    ['interactions.source', 'manual / followup / recruit_followup / activity 等（有界白名单）'],
    ['knowledge_items.item_type', 'product / policy / company / evidence / case / story / regulation / personal_experience'],
    ['opportunity_candidates.status', 'draft / preview / confirmed / created / rejected'],
    ['person 角色', 'customer / recruit / speaker / participant 等'],
  ],
  [32, 68]
));
sections.push(spacer());

sections.push(h2('11.2 主要目录结构'));
sections.push(tbl(
  ['路径', '说明'],
  [
    ['admin.html', '前端单文件主体（约 497KB，含全部 Legacy 页面与登录）'],
    ['crm/js/core、crm/js/modules、crm/css', '新一代 ES 模块与样式（按需加载）'],
    ['cloudfunctions/<fn>/', '28 个云函数（index.js + 共享模块副本 + package.json）'],
    ['cloudfunctions/_shared/', '11 个共享源码模块（db/ai/ai-gateway/context-engine 等）'],
    ['cloudbase/migrations/、cloudbase/rollbacks/', '版本化迁移（70+）与成对回滚'],
    ['cloudbaserc.json', '环境、函数清单、运行时与超时配置'],
    ['docs/work-packages/', 'WP01–WP13 工作包范围、验收与发布记录'],
    ['docs/architecture/', 'AI Runtime、上下文引擎、人物关系等架构说明'],
    ['docs/baseline/', '只读基线盘点'],
    ['tests/', '只读核验 SQL、事务验证、node --test 与浏览器回归夹具'],
    ['tools/', 'gen-system-doc.js、gen-schema-svg.js、release.ps1、sync-check.ps1'],
  ],
  [38, 62]
));
sections.push(spacer());

sections.push(h2('11.3 相关文档'));
sections.push(bullet('数据库 Schema 图：docs/db-schema.svg；数据字典：docs/data-dictionary.html'));
sections.push(bullet('架构说明：docs/architecture/ 与 docs/work-packages/ 下各专题文档'));
sections.push(bullet('发布与基线：docs/baseline/current-baseline.md、各工作包发布记录'));
sections.push(bullet('GitHub 仓库：https://github.com/VictorLiang2026/crm'));

// ===== 构建 =====
const doc = new Document({
  creator: "Victor's CRM",
  title: "Victor's CRM 系统说明文档",
  description: "System documentation for Victor's CRM (current: " + DOC_VERSION + ')',
  styles: {
    default: {
      document: { run: { font: 'Microsoft YaHei', size: 21 } },
    },
  },
  numbering: {
    config: [{
      reference: 'bullets',
      levels: [
        { level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: 0.25 } } } },
      ],
    }],
  },
  sections: [{
    properties: {
      page: {
        margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1), right: convertInchesToTwip(1) },
      },
    },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Victor's CRM 系统说明文档（" + DOC_VERSION + '）', size: 16, color: '94a3b8' })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '第 ', size: 16, color: '94a3b8' }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '94a3b8' }), new TextRun({ text: ' 页', size: 16, color: '94a3b8' })] })] }) },
    children: sections,
  }],
});

const outPath = path.join(__dirname, '..', 'docs', 'system-documentation.docx');
Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(outPath, buffer);
  console.log('DOCX 已生成:', outPath, (fs.statSync(outPath).size / 1024).toFixed(1) + ' KB');
});
