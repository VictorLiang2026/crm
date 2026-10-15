# PC08 家庭与家庭上下文实施记录

## 范围与数据边界

- 在 Person Console 家庭页展示以当前 Person 为锚点的家庭和其已确认加入的其他家庭；所有关系均标为“相对锚点”。旧 `get` 返回值中的 `household` 与 `members` 保留，新增 `households` 集合。
- 成员新增先走 `PersonService.resolveName()`，精确选择现有人物后再服务端预览；同名不会自动合并。事实编辑、关系更新和解除均走服务端预览、人工确认、带操作者身份的执行命令。
- 解除只软删 `household_members` 关系，不删除 Person。Facts 只允许锚点 Person 确认；成员可以管理自己的关系，不能修改别人的家庭事实。
- 已确认成员以及同时有确认时间和确认者的家庭事实才进入家庭 AI 上下文。会前准备和保险上下文最多读取 5 个家庭、30 个成员；旧未确认 Facts 留在审核界面，不进入模型。
- 不支持重设锚点。数据库允许一个 Person 关联多个家庭；每个家庭仍只有一个锚点，关系类型仍使用 spouse / child / parent / sibling / other。
- Legacy `admin.html` 路由保留。旧的一步写 action 返回 `PREVIEW_REQUIRED`；Legacy Person 360 的家庭增删和事实保存入口改为同一预览与确认命令。

## 生产结构发布

- 环境：`crm-d1gkae8ddc930d151`；所有 SQL 显式引用 `public`。
- Migration：`20261015130000_household_lifecycle`；远端任务 `task-f5448ead` 状态 `Succeed`；远端最新迁移为 `20261015130000`。
- 新增 `households.important_facts_confirmed_at`、`important_facts_confirmed_by_uid` 和 `crm_household_commands`；新增 preview/execute RPC。命令表启用并强制 RLS，RPC 执行权仅 `service_role`。
- 发布后只读核查：households 0 行、household_members 0 行、household command 0 行、确认事实 0 行；没有新建 Person 或种子记录。
- 配对回滚文件：`cloudbase/migrations/20261015130000_household_lifecycle.rollback.sql`。有已执行命令或已确认事实时会拒绝回滚，以免丢失审计和确认状态。

## 自动回归

- `npm run test:pc08`：12 项通过，含多家庭读取、身份解析、确认态过滤、AI 上下文、迁移权限契约、iPad 横竖屏、中英文和预览后执行。
- `npm run test:pc07`：11 项通过，含会前准备及事实生命周期。
- `npm run test:pc04`：8 项通过。
- `npm run test:ai-gateway`：14 项通过；`npm run test:ai-skills`：7 项通过。
- `npm run test:security`：4 项通过；`npm run test:modular`：通过。
- `npm run test:quick-capture-v2`：5 项通过，身份确认契约未变。
- `npm run test:interactions` 输出 26 项通过，但 Node 测试进程未退出，人工终止；该命令记为不完整，不作为全通过证据。PC08 未修改互动写服务；Person 360 `get` 兼容检查本身已通过。
- 已通过修改文件的 Node 语法检查、`git diff --check` 和 `npm run check:shared`（58 份共享副本一致）。
- WP01 release gate：通过（`PASS_WITH_LIMITATIONS`）；public catalog 863 项无权限/对象漂移，身份映射只读审计 PASS_WITH_EXCEPTIONS，匿名 gateway 63/63，Legacy/相邻回归 108 项通过、5 项预设跳过。登录、service_role runtime、真实业务写入及移动端仍是明确未验证项。
- 修正回归台账中三条仍要求旧页面内嵌家庭维护的断言：旧 Person 360 只验证回退入口及加载无写入，家庭操作由 PC08 专项 Console 浏览器测试验证。静态资产检查现将 HTML/JS/CSS 的 CRLF/LF 视为相同文本，仍对内容差异严格失败；原因是托管服务返回的 `console.html` 与本地只有换行格式差异。

## 部署与发布状态

- 生产 migration 已完成；`person_360` 以共享副本校验后部署成功；仅上传 5 个受影响静态文件：`console/family-actions.js`、`console/pages/person.js`、`console/i18n.js`、`console/data.js`、`person-360.js`。
- `sync-check.ps1 -CloudOnly` 通过：`admin.html` SHA 一致，53 个可达 HTML/JS/CSS 资源一致，29 个 CRM 云函数的 180 个源码/配置文件一致；证据目录 `D:\Temp\crm-cloud-audit-dcfa67b570bb41b1bce3b703971e0560`。
- 本包未新增 Person、家庭关系或种子数据。生产 Person 家庭页面登录读取、用户真实点击确认后的虚构测试关系新增/解除、删除恢复联动及线上中英文人工页面检查仍待隔离测试会话验证；不得使用真实客户建立测试关系。
- 功能发布：提交 `4ed005ecb3a3cad879674d6d7a27680d74729023`，标签 `release-20261015-132423`；GitHub `master`、本地和 CloudBase 源码已核对一致。
- 本次实施及发布记录已纳入该提交。真实家庭关系新增/解除、删除恢复联动和生产页面人工检查仍按上一节列为未验证，不因代码发布而推断通过。
