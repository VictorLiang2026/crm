# 教育补全“最近更新的人物”人群选项

日期：2026-11-18  
范围：`public` 教育补全批次选择、Assistant 服务校验、教育补全模块中英文文案。

## 需求与实现

- 首个选择框增加“最近更新的人物”，按 `public.persons.updated_at DESC, id DESC` 取指定人数；入库时间选项继续按 `created_at DESC, id DESC`。
- 两种最近人群沿用 1–1,500 人限制；搜索选择和全部待补全人群保持现有行为。
- 资格条件未变：人物未软删除，且毕业院校或院系/专业至少一项为空。`updated_at` 是人物资料最后更新时间，不代表教育字段最后更新时间，界面已提示此口径。
- `person_education_batches.selection_mode` 记录选择模式并参与同 request key 的幂等校验。已有批次按原 person_ids/sample_size 推导元数据，批次人选、项目、候选、人物资料均不变。
- 保留服务端身份校验、service_role-only RPC、候选人工审核、预览与确认后执行；不增加 AI 模型调用或自动写入。

## 数据库与回滚

- Migration：`20261118084800_education_recently_updated_cohort.sql`；rollback：同名 `.rollback.sql`。
- 仅操作 `public.person_education_batches` 与 `public.crm_education_backfill_v1`。已检查线上 `public` 视图目录，没有依赖 `person_education_batches` 的视图。
- 线上 migration ledger 已登记 `20261118084800`。实时查询确认函数源码含更新时间排序，RPC 权限仍为 service_role-only；既有批次选择模式都映射为 `recent_created`，既有批次状态、调用额度、items 和 Person 未改。
- Rollback 恢复前一版公平排队函数，并移除 `selection_mode` 元数据列；保留所有批次、项目及审核/回填记录。
- 仓库 migration 和 `C:\Users\victor\cloudbase\migrations` 双份 SHA-256 已一致。

## 回归

- `node --test tests/education-backfill/workflow.test.cjs tests/education-backfill/service.test.cjs tests/education-backfill/ui.browser.cjs tests/education-backfill/integration.test.cjs`：30/30 通过。
- 覆盖：最近更新时间排序与相同时间 ID 倒序、最近入库排序保持原状、旧批次元数据推导、幂等复用/冲突、rollback 保留批次项目、iPad 中英文选择器和人数文案、搜索选择及服务端权限/确认流程。
- JS 语法检查通过。
- WP01 migration 后复跑：`PASS_WITH_LIMITATIONS`，1719 项 catalog 检查、匿名探针 119/119、隔离回归 102 PASS、5 个预设跳过项，无 blockers；登录、service runtime、真实生产写入和手机视觉仍未验证。
- 发布门禁通过。共享副本 60/60 一致。
- `assistant` 云函数部署脚本返回成功。只读/拒绝性 invoke 收到 `DEVICE_ACCESS_DENIED`，没有已签名的浏览器设备上下文，因此没有执行有效教育 RPC；真实登录后的线上创建/审核链路未验证。
- 静态托管只上传 `/crm/js/modules/console/education-backfill.js` 与 `/crm/js/modules/console/i18n.js`，托管工具确认 2/2 成功。
- CloudBase-only 源核对通过：30 个函数的 346 个源码/配置文件与本地一致，108 个可达静态资源与 CloudBase 一致；首页 HTTP 200 且 SHA 一致。
- 生产未创建教育批次、未触发识别、未写入 Person 教育字段。

## 发布记录

Migration ledger 最新版本 `20261118084800`。Git 发布标签计划为 `release-20261118-0930`；发布脚本负责创建提交、推送标签并执行最终三端核验。CloudBase-only 源码/资源核验已通过。
