# CRM 自动化回归骨架工作包结果

日期：2026-09-21（Asia/Shanghai）。只执行测试骨架工作包，未修复失败业务。

## 结果

| 检查层 | 通过 | 失败 | 未执行 |
| --- | ---: | ---: | ---: |
| 完整离线回归 | 40 | 1 | 5 |
| 其中浏览器启动及 smoke/regression | 29 | 0 | — |
| 其中真实云函数 + 只读内存适配器 | 11 | 1 | — |
| 线上 public 元数据检查（单独执行） | 24 | 0 | — |

完整测试：2026-09-21 14:37:23—14:37:36 +08:00，命令 `node tests/regression/run.cjs`，退出码 **1**。未屏蔽失败，也未将未执行项计为通过。

固定机器可读证据：

- [完整回归结果](20260921-regression-results.json)：逐项ID、测试层、状态、错误堆栈、耗时、时间、源码哈希。
- [public元数据结果](20260921-public-metadata.json)：环境、只读SQL、时间、24项字段检查原始响应。
- [测试运行说明与覆盖矩阵](../../tests/regression/README.md)。

离线报告里的 live.database=SKIP 仅表示 npm test 自身不连接云端；本工作包额外通过 MCP 单独完成了上表的24项线上元数据检查。

## 新增与修改文件

新增测试文件：

- tests/regression/run.cjs：运行与报告入口。
- tests/regression/browser.cjs：隐藏独立 Edge/Chromium 与本机测试服务器。
- tests/regression/fixtures.cjs：标记为 [CRM_TEST_ONLY] 的模拟登录和API响应。
- tests/regression/smoke.cjs：真实前端的页面及交互测试。
- tests/regression/backend.cjs：真实后端源码的只读契约回归。
- tests/regression/database-readonly.sql：限定 public 的关键字段元数据断言。
- tests/regression/README.md：运行、边界、覆盖与新增用例规范。

新增结果文件：本报告、20260921-regression-results.json、20260921-public-metadata.json。

仅修改 package.json 增加3个测试脚本、.gitignore 排除临时测试结果。不增加 npm 依赖，不更新锁文件，不修改 admin.html、cloudfunctions、迁移、CloudBase配置或资源、数据库与环境变量。

## 关键链路当前状态

| 链路 | 当前证据 | 结果 |
| --- | --- | --- |
| 登录入口 | 空字段阻止认证、错误凭据提示、模拟成功进入客户路由 | 隔离通过 |
| customers | 列表与点击详情、每页50条/第二页5条、搜索空结果、后端排除软删除 | 隔离通过 |
| customer detail | 正确客户ID与下一步展示、关联跟进过滤、缺失ID与接口错误 | 隔离通过 |
| followups | 详情跟进标签、按客户隔离、日期倒序、排除已删除跟进 | 隔离通过 |
| opportunities | 标签/客户ID、错误可见、后端软删除过滤 | 隔离通过 |
| today | 模拟今日行动显示、点击进入正确客户详情 | 隔离通过，未调用真实AI |
| funnels | 3个事实漏斗、空数据与错误提示 | 隔离通过，未调用真实AI |
| activities | 列表与详情导航、空数据/错误、软删除过滤 | 隔离通过 |
| activity detail | 正常具名参与人和异步待办显示；缺姓名旧记录的只读契约 | 正常路径通过；只读契约失败 |
| recruit | 列表与阶段漏斗、后端候选人查询 | 隔离通过 |
| recruit detail | 里程碑关联、增员跟进标签、ID与错误提示 | 隔离通过 |
| recycle bin | 客户与候选人列表、删除时间、未选择记录时批量恢复禁用 | 隔离只读通过，未执行恢复 |
| 快速录入相邻回归 | 点击弹窗背景保留输入草稿 | 隔离通过 |

## 保留的失败：活动详情读取尝试补写

测试ID：backend.activity-readonly。

复现：仅内存创建带 [CRM_TEST_ONLY] 标记的客户和活动参与人，将该参与人的 person_name 设为空、保留 person_id，执行仓库中的 activities.main({action:'get', id:940001})。

期望：只读测试路径不尝试任何写操作。

实际：activities/index.js 的 enrichParticipants 在109行构造 activity_participants.update({person_name: nm}) 调用。只读适配器记录并抛出 WRITE_BLOCKED，最终断言发现1次写尝试而失败。所有数据均在内存，**未连接数据库，未发生线上写入**。

这证明“get”命名不足以保证调用链无写尝试；并不证明生产 SDK 在该未await链式调用中一定完成落库。真实落库行为未调用验证，保持为风险。未修改活动代码，也未将此用例改成预期失败以隐藏红灯。

## 测试数据校准记录

第一次数据库断言将增员回收站删除时间字段错误写成 deleted_at。随后只读查询 public.v_recruit_candidates_trash 字段，并对照现有前后端源码，确认契约为 candidate_deleted_at。只修正了测试SQL和合成夹具，并增加回收站时间展示断言；第二次24项全部通过。这是测试预期校准，不是修复或改变业务。

## 无法由本骨架自动证明的事项

- 真实账号、CloudBase SDK 登录、token有效性、会话过期重登及真实授权边界；认证是本地模拟。
- PostgreSQL真实查询结果、类型/约束、RLS策略效果、视图语义、事务、跨schema依赖；本轮只查询限定public的字段元数据。
- 真实Today/漏斗AI、上游模型可用性、费用和生成质量。
- 线上新增、编辑、删除、恢复、级联和附件；没有提供线上写测试开关，也未清理任何线上数据。
- 真实手机浏览器、视口布局及视觉回归。
- 云函数安装依赖、环境变量和完整部署配置未逐项验证；26个CRM函数的108个源码/配置文件一致性已在恢复授权后补验通过，详见下文。

## 风险与后续建议

1. 活动详情具有补写调用风险，后续任何生产只读smoke都应先审查副作用；本轮不调用或修复。
2. 浏览器夹具与内存数据库可能随接口变化过时，需要跟随已确认的API契约维护。离线通过不能替代生产端到端验证。
3. 只读SQL需通过已确认环境的管理工具运行，核对24行完整返回；禁止当作迁移执行。边界测试中的pr字符串只送入本地拒绝器，未访问pr schema或pr_函数。
4. 临时浏览器目录保留供诊断；使用专属配置，不读个人浏览器数据，也不删除本机已有目录或线上记录。
5. 后续可另开工作包评估活动补写设计及授权后的真实认证回归，本轮不继续。

## Git、云端及发布状态

- 基线/回滚提交：147bd60a91406c37fa0556824485cebf14a2f1f9；标签 release-20260921-110000。
- 开始与结束均实时读取 GitHub master，仍与本地 HEAD 一致。
- 开始时已有未跟踪 docs/baseline/current-baseline.md，本轮保持不变，未纳入发布。
- sync-check 默认因上述未跟踪基线报告停止；首次 CloudOnly 在页面哈希通过后遇到CLI授权过期而中止。用户要求继续后，重新完成登录授权并运行 CloudOnly，退出码0：线上 admin.html HTTP 200且SHA-256相同，26个CRM函数的108个源码/配置文件逐项一致。没有调用业务函数或操作线上记录。
- 本次补验证据目录：C:\Users\victor\AppData\Local\Temp\crm-cloud-audit-0764b62c61604428863d8b14cbac0248。排除node_modules；云端额外package-lock.json按现有核对脚本规则忽略。此结果不等于业务回归通过，也不代表依赖与环境变量一致。
- 本次补验同时通过git ls-remote确认远端master及release-20260921-110000解引用仍为147bd60a91406c37fa0556824485cebf14a2f1f9。没有重新运行未改变的业务回归；此前40通过、1失败、5未执行及24项数据库元数据通过的结果保持原记录。
- 前端当前本地与已核实线上 SHA-256：ed857e177b0862768a3e793b5c752195e632697d6cd38dc40434b1fda7e4b6b4。
- 所有新CJS语法检查、git diff --check通过；git diff确认业务页面、云函数、迁移、cloudbaserc.json无变化。
- 部署范围：无业务产物变化，无需上传任何页面或云函数。线上地址仍为 https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html 。
- **未提交、推送或打新标签**：遵守 AGENTS.md“回归失败立即停止收尾”；用户明确要求不顺便修复失败功能。本报告仅交付测试骨架与失败证据，不宣称发布成功。

推荐 Git commit message：

```text
test: add isolated CRM smoke and read-only regression harness
```
