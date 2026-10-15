# PC04 Person 资料与客户经营操作原生整合

日期：2026-10-15  
状态：实现、部署、Git 发布和三端核验完成。  
范围：人物编辑、人物目录客户视图及相邻 Person 360 客户画像；不含其他 PC 包。

## 本轮基线与证据

- 修改前 `master`：`e28383ccb84bc03e1d98eab426c2eb06f32f21c1`；本地分支为 `master`，origin 为项目规定的 GitHub 仓库。
- 修改前发布标签：`release-20261015-005645`（PC04 开始时基线）。
- PC04 发布前本地与 GitHub 已同步到相邻修复 `3c46b877f490f9a9b983e317ccd6d6ffd5002b7b`；PC04 变更在该最新提交之上叠加，没有回退该修复。
- PC04 代码提交：`17dae4275c1f7c689e2b8cda72f13077e6fe0017`；实现与部署标签：`release-20261015-080902`。
- PC04 没有执行 public 数据写入或迁移；业务代码已按下文清单部署到生产。
- 修改前工作区已有 PC02 文档修改，以及 PC01/计划相关未跟踪文件。本轮未改写这些文件；发布脚本会将跟踪文件统一暂存，不能直接用于本轮发布。
- 线上契约复核限定 `public`：Person 基础/经营字段由 `persons` 权威保存；客户专属信息在 `customers`；招募优先级在已有关联的 `recruit_candidates`。未查询或调用 `pr`/`pr_*`。

## 字段与旧功能覆盖

历史计划提到客户工作台“11 列”，但该数字不是当前可执行契约。本轮按当前 Legacy 页面及线上对象复核：旧客户列表实际显示 9 列（客户名、综合优先级、客户阶段、最近跟进、下次跟进、工作台状态、招募状态、ID、操作）。不得把历史说明中的旧列数当成实时结构。

| 信息 | 权威来源 | PC04 覆盖与操作 | 约束/未覆盖 |
|---|---|---|---|
| Person 身份和基础资料：姓名、电话、微信、性别、生日、职业、组织、学历、来源、婚姻、首次联系、人物备注 | `public.persons` | Person 编辑器沿用 `person_360.updatePerson`，按 Person 版本乐观锁更新；Person 360 与列表从同一 Person 来源读取 | 不恢复 customers 中已清理的基础资料副本列 |
| 客户经营：客户阶段、销售优先级、转介绍优先级、爱好 | `public.persons` | 原生编辑并展示；仍走人物更新边界 | 角色不由标签、阶段或手工编辑创建 |
| 客户专属资料：标签、客户备注、个人收入、家庭收入、资产/房产信息、MBTI、画像 JSON | `public.customers` | Person 编辑器和 Person 360 展示；保存走 `customers.update`，带 `expectedUpdatedAt` 乐观锁 | `profile` 仅接受当前编辑器约定的画像键及 events JSON；其余 Legacy 字段仍在原路由使用 |
| 招募优先级 | 已有 `public.recruit_candidates` 行 | 仅当当前 Person 有活动 recruit 记录时显示编辑；调用 `recruit_candidates.update` 并带版本 | 不创建招募角色或候选人；没有活动记录时不提供写入口 |
| 目录中的客户阶段和客户经营排序字段 | Person 目录 RPC 与 `persons` | 新增客户视图开关和客户阶段列；客户视图只对 customer role 过滤，所有人物总目录仍可返回；原有优先级/跟进排序保留 | 客户阶段列当前不可排序：数据库目录 RPC 没有该排序键，本包零迁移 |
| 详情/软删除客户关联 | `customers`, `person_roles` | Person 360 将无活动客户行但仍有角色/软删除关联的情况明确标为不可用；不暴露为可编辑客户档案 | 解除、恢复仍按旧回收站和角色推导流程处理 |
| 旧客户列表的跟进日期、工作台状态、招募状态、ID及操作 | Legacy 客户/跟进/招募路由 | 保留原入口与行为；Person 360 和目录没有复制这些工作流 | 本轮不删除、不改写 Legacy 路由，也不替换旧统计口径 |

## 实施内容

- `write.js` 将 Person、客户、招募字段分别提交到原有服务边界。客户专属字段与招募优先级独立保存，避免跨域部分失败被误报为整体成功。
- `customers.update` 和 `recruit_candidates.update` 兼容旧调用，同时在提供 `expectedUpdatedAt` 时检测并发修改；冲突返回明确错误。
- 人物目录增加可切换的客户视图，列出客户阶段；全人物目录保留。Person 360 增加客户专属详情和不可用关联提示。
- 补齐简体中文/英文标签及必要的 iPad 样式。Legacy URL、登录入口、软删除/恢复语义保持。
- 数据库迁移：零。数据变化：零。生产已更新本报告所列 5 个静态资源和 3 个云函数。

## 验证

本地执行：

- `node --check`：本轮修改的后端 JS 语法检查通过。
- `git diff --check`：通过。
- `npm run test:modular`：通过。
- `npm run test:pc04`：8/8 通过，包括两个写入边界、冲突检测、客户视图查询范围、双语标签和隔离浏览器/iPad方向用例。
- `npm run test:wp05`：9/9 通过，包含 Person 画像和不可用客户关联语义。
- `npm run test:people-pages`：3/3 通过。
- `npm run test:pc03`：4/4 通过。
- `npm test`：108 PASS、0 FAIL、5 SKIP。
- `node tests/regression/run.cjs --browser-only`：72 PASS、0 FAIL、6 SKIP。
- `npm run test:wp01`：使用新鲜 `public` catalog 和 WP04 身份审计通过，releaseGate=`PASS_WITH_LIMITATIONS`；catalog 827 项通过，匿名 61/61 通过，身份审计 782/782 customers、574/574 recruits、4/4 speakers、participants 1/4 mapped 且保留 3 条已声明姓名暂存例外。登录、service_role 运行时、线上业务写入及真实设备验收仍未验证。
- 两组旧 PMC 独立测试曾失败：PMC16 为 4 项旧契约断言，PMC17 为 3 项旧 customers 副本字段断言，与当前在线字段归属不一致。没有为 PC04 修改这些历史测试或扩大范围。

未执行：真实账号线上登录、客户/招募线上写入、并发冲突的线上交互、生产业务回归。不得把本地隔离测试当作这些证据。

## 发布阻断与恢复

WP01 证据刷新后，`tools/release.ps1` 与三个函数部署门禁均通过 `PASS_WITH_LIMITATIONS`。保留的登录、service_role、线上写入和真机未验证项不代表已通过。

部署结果：

- 静态资源 5 个：`crm/js/modules/console/i18n.js`、`pages/people.js`、`pages/person.js`、`write.js`、`crm/css/console.css`；CloudBase 上传结果 5/5 成功。
- 云函数 3 个：`customers`、`person_360`、`recruit_candidates`；项目脚本分别上传成功。
- 部署后 `tools/sync-check.ps1 -CloudOnly`：51 个可达前端页面/模块/样式匹配；29 个函数的 175 个源码/配置文件匹配。
- 生产入口：[CRM Console](https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html)。

另有 PC02 跟踪文档修改和 PC01/计划未跟踪文件。发布期间只隔离保存 PC02 文档改动，PC01/计划文件保持未跟踪；本包只提交 PC04 代码、测试与本报告：

- 静态文件：`crm/js/modules/console/i18n.js`、`pages/people.js`、`pages/person.js`、`write.js`、`crm/css/console.css`。
- 云函数：`customers`、`person_360`、`recruit_candidates`（按项目函数部署脚本逐个发布，并遵循其共享副本核验）。
- WP01 门禁、部署后 CloudOnly、提交前与提交后的完整三端 sync-check 均通过。代码提交/标签为 `17dae4275c1f7c689e2b8cda72f13077e6fe0017` / `release-20261015-080902`。本报告关闭记录随 `release-20261015-081930` 发布，未触发额外云端变更。
- 代码回退基于 PC04 发布标签恢复对应静态文件和三个函数并重新部署；无数据库回滚，因为没有迁移。

## 后续准入

本包完成的是人物资料与核心客户经营字段整合，不表示 Legacy 客户详情、跟进状态、活动、招募流、报表与回收站均已合并。后续 PC 包须逐项补齐操作映射、权限、删除恢复和统计口径证据；未完成之前保留原 Legacy 路由。
