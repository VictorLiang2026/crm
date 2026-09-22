# CRM smoke / regression

范围：为当前单文件前端及现有云函数建立可重复运行的回归骨架，不修改业务实现。

## 运行

需要 Node.js 22 或更新版本（本次验证 26.8.2）及已安装的 Edge/Chromium/Chrome；不新增 npm 依赖、不自动安装浏览器或 SDK。Windows 默认寻找 Edge，也可通过进程环境变量 CRM_TEST_BROWSER 指定浏览器可执行文件。

```powershell
npm test
npm run test:backend
npm run test:browser
```

也可直接运行 `node tests/regression/run.cjs`，不需要 npm install。命令支持 `--backend-only` 或 `--browser-only`，不接受线上 URL、凭据或写入开关。受限执行环境需允许启动浏览器和本机回环服务。

退出码：0=本次所选自动化层全部通过；1=至少一项失败；2=配置或执行异常。SKIP 不计入通过。2026-09-22 用户授权修复活动详情只读问题后，完整测试为 56 PASS、0 FAIL、5 SKIP；原断言保留，并新增姓名补齐且原记录不变的断言。

每次运行自动输出 `.results/latest.json` 和 `.results/latest.md`，包含模式、时间、Git HEAD、页面 SHA-256、逐项 PASS/FAIL/SKIP、错误与耗时。结果目录不入 Git；本工作包的固定结果快照在 `docs/testing/`。单层运行会覆盖 latest，因此交付前使用完整运行结果。

## 文件

| 文件 | 职责 |
| --- | --- |
| run.cjs | 执行测试、错误退出码、生成报告 |
| browser.cjs | 本机 HTTP 服务、隐藏独立浏览器、CDP 驱动及外网拦截 |
| fixtures.cjs | 仅本地模拟认证和允许的云函数响应，全部为合成数据 |
| smoke.cjs | 真实前端脚本与 DOM 的路由、交互、异常回归 |
| backend.cjs | 在隔离上下文中执行真实云函数，数据库替换为只读内存适配器 |
| database-readonly.sql | public 元数据字段存在性检查，独立通过只读管理工具运行 |
| delete-batch-live.sql | 迁移后使用 `[CRM_TEST_ONLY]` 负数 ID 临时记录验证删除批次事务；成功后在同一事务中清理 |

## 覆盖与限制

| 关键链路 | 自动覆盖 |
| --- | --- |
| 登录入口 | 空输入、错误凭据、模拟成功后进入目标路由 |
| customers | 列表、详情导航、50条分页、搜索空结果、空数据 |
| customer detail | ID传递、详情、最新跟进下一步、接口错误 |
| followups | 跟进标签；后端按客户过滤、软删除过滤、日期倒序 |
| opportunities | 标签、客户ID、接口错误；后端软删除过滤 |
| today | 模拟建议渲染及点击进入客户详情 |
| funnels | 三个事实漏斗、空状态、接口错误；不触发真实AI |
| activities | 活动列表、点击详情、空状态、接口错误、软删除过滤 |
| activity detail | 活动ID、参与人、异步待办；具名/缺姓名参与人读取契约 |
| recruit | 列表及阶段漏斗；后端列表/详情与里程碑关联 |
| recruit detail | 候选人ID、增员跟进、接口错误 |
| recycle bin | 客户/增员回收站记录和删除时间、默认批量恢复禁用；只读后端列表 |
| 相邻回归 | 快速录入点击背景保留草稿 |

页面使用完整原始内联脚本与样式，测试服务器只在内存中替换外部 CloudBase SDK 脚本标签；不替换页面路由、callFn、渲染或表单实现。浏览器例程验证本地模拟 API 契约，不证明真实 SDK/Auth、云函数部署、RLS、AI 或网络健康。

后端测试执行仓库真实 index.js，require 仅允许替换的 ./db。内存适配器只实现测试所需的查询方法，不能替代 PostgreSQL 的类型、约束、权限、视图定义和事务验证。Node VM 用于隔离可信仓库代码的依赖，不是运行恶意代码的安全沙箱。

## 数据与网络边界

- 默认完全离线数据测试。浏览器服务只监听 127.0.0.1，仅提供页面与 fixtures.js；不提供写接口。页面 CSP 禁止连接、表单提交和子框架，CDP 同时拦截非本机请求及非 GET。
- 不加载生产 SDK、不传真实凭据。所有业务 API 响应来自明确白名单；未知调用、写动作、直接数据库/存储调用使测试失败。
- today_coach.generate 仅是本地白名单中的模拟响应，不调用生产 AI。
- 数据文本均用 `[CRM_TEST_ONLY]` 标记，数值ID属于合成数据，不得拿到线上复用。本骨架没有线上写模式，也不会插入、删除、恢复或清理线上数据。
- 后端适配器将无schema表名解释为本地 public 表；拒绝其他schema、pr_名称与未知对象。边界测试中的 pr 字符串仅用于验证本地拒绝行为，没有发送数据库查询。
- 隔离浏览器使用临时用户目录，不读取个人浏览器登录信息；结束时仅关闭自身启动的实例。临时目录保留供诊断，不执行递归删除。
- 不收集生产客户记录、Cookie、token、环境变量值或截图；报告只含合成测试内容和对象元数据。

## public 数据库只读检查

1. 通过 CloudBase auth(status) 确认当前环境严格为 crm-d1gkae8ddc930d151。不得自行切换到体验环境。
2. 完整读取 database-readonly.sql，通过 queryPgDatabase(action="sql", sql=文件原文, limit=200) 执行。此文件不是迁移，禁止用迁移或写管理命令执行。
3. 必须校验 success=true、returnedRows=24、truncated=false，逐行检查 status；任意 FAIL 或异常都不能报告通过。记录时间、环境和原始结果。
4. 仅检查 public 对象的关键字段存在性；不读取视图数据，不保证字段类型/权限/视图语义正确。只读元数据检查不等于业务端到端验证。

普通 npm test 不自动连接云端，报告中的 live.database=SKIP 表示该次离线运行未执行线上检查。本工作包另行执行的数据库结果见固定报告。

`delete-batch-live.sql` 只能在确认迁移已应用后，通过数据库写管理入口执行。脚本只访问 `public`，先检查固定测试 ID 未被占用；断言失败时整个 DO 事务回滚，成功时显式删除全部测试记录。不得把这些负数 ID 用于真实业务。

## 新增用例

用合成数据明确表达期望行为和异常状态，保持未知调用默认失败；不得为了变绿而给未确认的读操作增加生产通路。所有线上写测试需要后续明确设计测试记录标记、ID验证与授权边界，本骨架不实现该通路。

发现失败先区分测试夹具错误和真实行为。修正夹具必须依据当前源码或只读元数据，并说明理由；真实业务失败保留断言、记录复现，不随测试包修改业务。当前 activity-readonly 即为保留的失败。
