# WP11｜保险上下文可用性

基线：`b13b8dbe0bd556f6b135bed1b7066250dcf44fb7`、`release-20261004-212700`。修改前本地、GitHub、CloudBase 的 25 个静态资源与 28 个 CRM 函数/165 个源码配置文件一致。仅使用 `public`；初始测试业务行保持 10 条。页面只按 iPad 布局验收，不增加手机适配。

## 影响与边界

- `#/person/:id` 的六块保险摘要改为有界只读汇总，逐条显示 `public` 来源、日期和入口。保障明细来自 `products`，检视与附件来自 `policy_review_reports`、`ocr_records`、`photos`，需求来自明确提及保险的互动或已确认 Fact，机会与下一步来自 `opportunities`、`actions` 及 WP10 关联表。来源数量通过既有测试台账摘要标记“含测试数据”；不返回 OCR 原文、附件 URL、报告 raw 或联系方式。
- 报告生成原文只作为未经复核的摘要；“待核实缺口”仅使用人工编辑的报告字段，而且须已有保障明细或保险附件/OCR 依据。无资料显示“未知”，不推断无保障或缺口。关闭机会不进入 Open Opportunities；机会文字下一步与正式行动分开标注。
- Person 360 可直接打开旧客户详情的保单检视、照片附件和 OCR 页签；旧表单、旧 URL、软删除与回收站、机会和行动写入路径不变。`person_360.getInsuranceContext` 只增返回字段，不改已有字段语义。除测试客户的报告文本安全标记外，旧 `policy_review_reports.generate` 保持原流程与模型配置；其 AI 结果在人工编辑前不得作为已确认保障事实。
- 仅对姓名带 `【系统测试·勿联系】` 的虚构客户，旧报告生成时强制使用虚构操作员，为字符串或结构化的报告内容和 raw 逐字段加标记，并对同一客户同日测试报告做顺序重放保护。没有新模型调用方式、数据库结构、权限或外发。已生成报告 #3 的两个结构化字段由精确匹配 ID、客户、测试台账及原文哈希的数据修复补标记，脚本与拒绝覆盖后续修改的 rollback 同交。测试优先使用已登记 Person #783／客户 #788 及无客户资料的 Person #786，新增业务行须走旧页面的人工操作并登记衍生 ID，不增加初始第 11 行。

## 验收与发布

本地：`node --test tests/households/insurance-context.cjs tests/wp11/report-marker.cjs` 6/6；隔离浏览器 `npm run test:browser` 63 通过、0 失败、6 个既定跳过，覆盖有资料、无资料、来源跳转、旧保单检视、照片上传弹窗、OCR 空状态及旧客户/招募/活动/Today/回收站；`npm run test:modular` 通过。2026-10-04 22:29 的只读 `public` 目录与身份审计快照已刷新，最新 `npm run test:wp01` 为 `PASS_WITH_LIMITATIONS`，匿名网关 57/57，旧路由 99 通过、0 失败、5 个既定跳过。登录自动证据、服务角色写入探测和手机视觉检查仍未验证；手机不在本包范围。

生产测试账号已确认 Person #783 六块保险概览、“含测试数据”、旧客户 #788 保单检视页签与产品 #2 的虚构医疗保额显示。经旧表单人工保存 `public.products#2`（客户 #788，医疗(CI) 200000、年缴 1200、10 年、已缴 0，日期 2026-10-04）；经旧报告入口生成 `public.policy_review_reports#3`（报告日期 2026-10-04）。两行均由 `crm_test_main_v1` 台账登记为 `derived`，初始 `initial` 仍为 10。报告 #3 的原始 AI 缺口不进入 Person 的 Potential Gaps；截至本记录，尚待人工修订摘要与待核实问题、同日重放和附件实测。Person-only 无资料边界和旧 OCR/照片路径已由隔离夹具验证，真实账号的附件/OCR 路径仍待验收。本包因此暂记阶段成果，WP11 清单项暂不勾选。

阶段发布只包含 `admin.html`、`crm/js/modules/person-360.js`、`crm/js/modules/opportunity-workflow.js`、`crm/css/person-360.css`，以及 `person_360`、`policy_review_reports` 两支函数；25 个静态资源与 28 支函数/165 个文件云端哈希核对通过。Git 提交、标签与三端一致性以发布命令完成后的记录为准。

恢复代码时从基线标签创建恢复提交，仅重部署本包改动的 `admin.html`、Person 360/机会模块与样式、`person_360` 和 `policy_review_reports` 函数；不强推。数据修复可执行配套 rollback，但只在报告 #3 的两字段自修复后未再变化时通过；虚构产品、报告、附件先逐条核对影响和测试台账再考虑回收或保留，不静默删数据。
