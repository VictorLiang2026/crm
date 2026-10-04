# WP10｜机会从候选到成交/关闭

基线：`e5be1c669ef81d575b9c73ce7ca2dc3160cc6150`，`release-20261004-174356`。修改前本地、GitHub 与 CloudBase 静态文件及 28 个 CRM 函数逐项一致。范围只涉及 `public`；初始测试业务行维持 10 条。按项目约定，本包页面布局只考虑 iPad，未实施手机适配。

## 影响与兼容

- 页面：Person 360 的正式机会卡片改为服务端预览、人工确认；机会主入口增加待审核候选的来源、审核入口、Person 专属机会管理和选择人物新增入口。旧客户机会仍跳原客户详情，旧漏斗与旧路由不改。
- 接口：`person_360` 增加候选目录、关联行动/结果及机会预览/执行；原 Person 360 直接机会写入接口保留名称但返回 `PREVIEW_REQUIRED`，防止绕过确认。旧 `opportunities` 函数不变。`assistant` 候选操作对测试账号限定已登记虚构 Person，保留既有模型配置和人工候选确认。
- 字段/数据：正式机会使用原 `public.opportunities` 的 `person_id`、`customer_id`、类型、阶段、进展和下一步；原 Action 直接关联保持不变，新关联通过 `public.crm_opportunity_action_links` 保存，不改 Action 身份/来源字段。关闭时在同一事务写 `public.outcomes`。`public.crm_opportunity_commands` 保存账号绑定的 15 分钟预览、快照和幂等结果；本轮未改旧基表列或视图。迁移为 `20261004180000_opportunity_commands.sql` 和 `20261004201000_opportunity_action_links.sql`，各有同名前缀 `.rollback.sql`。
- 权限：新台账和两个 RPC 仅 `service_role` 可访问；`anon`、`authenticated` 无新增授权。Person 专属更新要求 `customer_id IS NULL`；测试账号仅能写已登记的虚构 Person、机会与 Action。测试账号的 AI 候选理由及下一步由服务端补齐 `【系统测试·勿联系】`，人工编辑去掉标记会被拒绝。候选仍由来源证据、人工预览和一次性执行控制；拒绝只改候选，不建正式机会。

## 验证与发布记录

两次迁移均先 dry-run；版本 `20261004180000` 云端任务 `task-e6d6fdc8`、版本 `20261004201000` 云端任务 `task-189de0fe` 均成功。第二次迁移用于修复真实关联确认时被现有 `actions_guard()` 拒绝的问题：第一次确认事务完整回滚，行动和机会均未改写；修复保留该旧保护，新增服务角色专用关联表并将关联 UUID、命令 UUID、测试批次键对应起来。安全目录 45 张表、12 个视图、36 个序列、31 个函数，既有对象授权不变，新表对 `anon` 和 `authenticated` 均无授权。隔离回归 95 通过、0 失败、5 预设跳过；浏览器回归 59 通过、0 失败、6 预设跳过；共享模块 56 份一致。完整 `npm run test:wp01` 已通过，匿名网关 57/57 通过。WP03 浏览器启动器增加对 Windows 短暂文件占用的有限重试；云端匿名调用两个函数均返回 `UNAUTHORIZED`，未写业务数据。

线上 prtest 对已登记虚构 Person #783 发起过一次真实候选分析：AI task/run/result 均为 #14 并已登记到测试台账。模型判定原有活动反馈和虚构到场不构成明确需求，返回 `insufficient_evidence`；未创建候选或正式机会。随后用户通过 WP07 V2 人工确认写入带标记的虚构 Interaction #10，AI task/result #15 与命令回执可追踪；初始种子仍为 10 行。

基于 Interaction #10 的候选 #2（AI task/run/result #16）有明确来源，人工拒绝后状态 `rejected`、AI 反馈 `rejected`，Person 专属正式机会仍为 0。再次分析得到候选 #3（AI task/run #17、result #18），人工核对服务端预览后晋升为唯一正式 Opportunity #10；`person_id=783`、`customer_id=NULL`，候选状态 `created`、AI 反馈 `accepted`，旧客户机会 #9 的 `customer_id=788` 与更新时间保持原值。上述业务和 AI ID 均在测试台账可查。真实账号首次关联 Action #8 时触发旧不可变保护，命令 `9db715a5-5ffb-4821-ad21-bcf87b6c2830` 保持 preview，未写业务。修复后重新预览并由用户确认，命令 `21ecceab-9fa5-441c-9455-41712f05f7e6` 执行成功，关联 UUID `4af54098-86e2-40f5-8715-20e6ba9b44b9` 带批次键 `crm_test_main_v1`；原 Action #8 的 `opportunity_id` 仍为空。随后用户确认阶段命令 `e752664d-4462-46b6-844c-337afd966ea2`，机会 #10 从“发现”改为“沟通”；旧客户机会 #9 状态与更新时间不变。编辑、关闭和 Outcome 仍待真实账号验收。

第一阶段代码发布提交 `88b9b172cc840c7bdc1ea6be1aa6d65d56ad68c5`，标签 `release-20261004-191953`；云端部署 `person_360`、`assistant`、`crm/js/modules/{opportunity-workflow,person-360,phase14-hubs}.js`。第二阶段提交 `79a4810cf9e109d11643020a6fd5fa3c581b8033`、标签 `release-20261004-203640`，仅重部署 `person_360` 修复关联执行；静态文件未变，本地、GitHub、云端 25 个静态资源和 28 个 CRM 函数/165 个源码配置文件一致。编辑机会时生产页曾把一次底层请求拒绝显示为 `预览失败：undefined`，且服务端没有收到预览命令；重试成功后，第一份预览的下一步误含中文左引号，未执行。用户生成了无引号的修正预览。为明确底层网络/会话错误，本轮另将机会模块的错误提取改为优先显示 `message`、`error`、`errMsg` 或 `code`，再显示可操作的通用提示；隔离浏览器回归覆盖非 Error 拒绝，随后只上传这一静态模块。线上地址为 `https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html`。iPad 768 宽度下隔离机会卡片和编辑表单未横向溢出；未做手机布局适配。无真实联系方式、真实保单或外发。剩余真实验收结果与最终版本待补。

回退页面与函数时从基线标签制作恢复提交并逐件部署，不强推。关联表的 rollback 只在没有已确认关联时可运行；原命令台账的 rollback 只在没有已执行命令时可运行。已有业务或审计记录须先评估影响，不能静默删除数据。
