# PC22 知识与对话策略治理

日期：2026-10-16  目标环境：`crm-d1gkae8ddc930d151`

## 交付

- More 新增中英双语、iPad 横竖屏治理页；可筛选类型/状态，新增知识和 Playbook 草稿，预览引用，审核、失效并为知识创建保留旧版的修订。
- Person 360 服务端通过 allowlist 读写 `public.knowledge_items` / `public.playbooks`；数据库审核 RPC 仅向 `service_role` 授权。草稿乐观锁、审核身份、引用类型/有效性、日期和置信度均在服务端校验。
- 会前准备与对话策略只接收已审核、来源完整、当前有效且置信度达标的 Evidence。对话策略按异议/场景确定性筛选 Playbook；AI 返回引用会按证据白名单过滤。Case / Story 保留独立引用类型，不作为 Evidence。
- 旧 More 入口和旧 AI 响应字段保留；历史 `ai_results` 快照没有重写。
- `20261016150001_knowledge_governance`、`20261016150002_knowledge_review_guards` 已在 `public` 应用。Rollback 配对文件位于 migrations 目录；移除列会丢失审核/修订记录，因此第一条 rollback 仅撤销审核 RPC并保留审计列，第二条只撤销校验约束并让降为草稿的数据继续留在草稿状态。

## 回归与证据

- `npm run test:pc22`：12/12 通过，覆盖受控保存/审核、引用来源和状态过滤、有效期/置信度、匹配筛选、iPad 横竖屏双语页面、历史上下文边界及旧会前准备/对话策略。
- `npm run test:ai-gateway`：14/14 通过。
- `npm run test:pc03`：4/4 通过，旧 More 路由与入口保留。
- `npm run test:pc08`：完整用例曾与其他浏览器同时运行导致 viewport overflow；隔离重跑家庭页浏览器用例通过，其他相关案例通过。
- `npm run test:wp01`：`PASS_WITH_LIMITATIONS`；fresh public catalog 919 assertions 无 drift，匿名 65/65，WP02–WP06 及完整旧回归通过（108 pass / 0 fail / 5 skip）。门禁仍记录真实登录、service-role 运行时、线上业务写入、移动设备为未验证。
- 部署前 CloudBase 静态托管 7 个文件上传成功；`assistant`、`person_360` 函数分别部署成功。`sync-check.ps1 -CloudOnly` 核验 admin.html 一致、66 个可达静态资源一致、29 个云函数的 186 个源码/配置文件一致。
- Catalog 实际查询确认审核 RPC 为 `SECURITY DEFINER`，仅 `service_role` 有 execute；新增 governance constraints 均存在。两张治理表目前均为空。

## 线上样例完成核验

用户经已登录治理页面确认创建样例后，2026-10-16 对生产 `public` 数据进行只读核验：`knowledge_items` 有2条指定来源 Evidence，其中1条 `verified=true/lifecycle_status=verified/confidence=0.910`，另1条 `verified=false/lifecycle_status=draft/confidence=0.350`；`playbooks` 有1条 `lifecycle_status=verified` 的 PC22 Playbook，其 `evidence_refs={1}` 指向已核验 Evidence。三条记录在 `crm_test_records` 中均为 `crm_test_main_v1` 批次的 `derived` 记录，父记录为 `persons:783`，没有占用 `initial_slot`。Person 783 名称及备注均带“系统测试·勿联系”标记，来源为既有 `crm_test_main_v1` 测试人物，未改动人物资料。

因此 PC22 线上样例验收完成。以上数据库核验只读；实际写入由已登录用户通过治理页面的确认动作完成。本次补记发布为文档变更，业务页面、云函数和数据库对象均未改变。
