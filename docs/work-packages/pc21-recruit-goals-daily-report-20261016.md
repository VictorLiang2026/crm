# PC21 招募目标与双轨经营日报

日期：2026-10-16  
状态：已实施，待发布提交完成

## 范围与兼容

- 在 Console 增加招募目标编辑与历史进度页面，月度目标继续通过已有 `crm_recruit_goals_save_v1` 原子 RPC 保存；未新增数据库对象或迁移。
- 在 Console Today 增加客户/招募双轨日报，支持今日与日期范围、来源记录下钻及招募目标进度。日报数据继续调用现有只读 `activity_reports`。
- `activity_reports` 仅给现有 feed 增加来源记录引用和 Person 子页面目标锚点，不改变统计 SQL、日期分桶、时区、软删除规则或客户/招募合计；不把 Interaction 加入统计，避免与旧活动重复计数。
- 旧 `admin.html` 招募目标、客户统计与 CRUD 流程保留。新页面含简体中文/英文词条，按 iPad 页面范围实现。
- 本轮没有生产业务数据写入；没有新增 AI 能力、权限、表/视图或迁移。

## 影响产物

- 云函数：`activity_reports`。
- Console：`data.js`、`i18n.js`、`router.js`、`views.js`、Today、活动、招募、Person 页面，以及新增 `activity-report.js`、`recruit-goals.js`。
- 测试：PC16 活动导航断言调整为 Console 报表路由；新增 PC21 页面测试与来源下钻统计回归。
- 不变：`admin.html`、数据库对象、权限、登录与旧 CRUD。

## 验证

- `npm run test:pc21`：24/24 通过，涵盖目标原子保存与历史、日报双轨、日期过滤、来源跳转、旧活动导航与统计不变。
- `npm run test:modular`：通过。
- `npm run check:shared`：29 个函数的 58 份共享副本一致。
- `npm run test:wp01`：108 PASS、0 FAIL、5 SKIP；release gate `PASS_WITH_LIMITATIONS`。未验证生产登录、服务角色运行时、真实写入和手机验收；本轮无真实业务写入且手机不在约定范围。
- Node 语法检查及 `git diff --check`：通过（Git 仅提示两份测试文件的 LF/CRLF 转换提示）。
- 部署后静态资源核对：65 个页面/模块/样式资源与云端匹配；`activity_reports` 云端源码核对通过。完整云端函数核验结果以发布命令记录为准。

## 发布范围与恢复

- 静态托管只上传上述 10 个 Console JS 文件；未上传项目目录或 `admin.html`。
- 只部署 `activity_reports`，无数据库迁移。
- 回退时以本次发布前标签恢复并重新部署这 11 个产物，按标准发布流程创建恢复提交；数据库无须回滚。
