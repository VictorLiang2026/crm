# PC06 Person 与 Today 行动承诺操作

## 本次范围

Person 360 与 Today 均可从同一工作项数据源查看 Action 和 Commitment，并使用现有 `person_360.previewWorkItem` → 人工确认 → `executeWorkItem` 创建、编辑、完成、撤销和重开。Today 新建记录要求先搜索并选择 Person；承诺明确区分我承诺、对方承诺和双方承诺。Action 完成后使用已有 Outcome 能力边界：提示用户补记结果，不新增通用结果接口。

保留旧行动中心、旧下一步来源和既有导航；不自动把旧来源转为 Action。仅 Legacy 能力允许修改的当前入口开放操作；当前包的读写仍由现有 WorkItemService 处理。预览展示人物、记录来源、当前状态与执行后状态，服务端冲突后要求重新预览。Person 与 Today 操作后重读各自数据。

## 影响与兼容

- 前端：`crm/js/modules/console/pages/person.js`、`pages/today.js`、`write.js`、`i18n.js` 和 `crm/css/console.css`。新增界面文本均有简体中文和英文版本，按 iPad 竖屏、横屏做了浏览器视口检查。
- 接口：仅调用已上线 `person_360.listPersonWorkItems`、`listTodayWorkItems`、`previewWorkItem`、`executeWorkItem` 及 Person 选择所需的既有目录读取。没有新函数或权限变更。
- 数据：无 migration、rollback、回填或测试业务数据写入。回归使用隔离浏览器合成夹具。
- 兼容：Legacy 路由和兼容来源不移除；旧来源继续只读/回退。Today 到期承诺仍按北京时间的今天及未来三天范围显示。

## 验证

- PC06 浏览器工作流：通过。覆盖 Person 与 Today 创建、编辑、完成、撤销、重开；未确认不执行；服务端状态冲突后需重新预览；Person 搜索选择；承诺类型；完成 Action 后的结果提醒；英文文案；iPad 横竖屏。
- 相邻回归：PC05 时间线写入 1 项通过；WP08 Person 工作项浏览器与服务测试通过；PC04 Person/客户经营测试 8 项通过；Today/机会/行动排序 13 项通过；Action 服务 5 项和 Commitment 服务 2 项通过；模块前端门禁通过。
- `node --check` 与 `git diff --check`：通过。
- 未执行生产账号下真实业务写入；没有将隔离合成测试视为线上写入验收。

## 发布记录

静态托管于 2026-10-15 上传上述 5 个前端文件，CloudBase 返回成功 5/5。五个线上资源均返回 HTTP 200；`sync-check.ps1 -CloudOnly` 通过：51 个可达页面/模块/样式资源一致，29 个函数的 175 个源码与配置文件一致。数据库未迁移、云函数未部署、权限未变更。

Git 提交、`master` 推送、发布标签与发布后完整三端核对由本轮 `tools/release.ps1` 执行。目标标签：`release-20261015-105613`。WP01 门禁状态为 `PASS_WITH_LIMITATIONS`：匿名探针 61/61、隔离回归 108 PASS / 0 FAIL / 5 SKIP；登录摘要过期、service-role 运行时、生产写入和移动端仍未验证。
