# PC02 账号会话与已上线控制台流程复核

日期：2026-10-13  
范围：Console Settings 的账号维护与退出；Legacy 入口和相邻流程只做兼容回归。数据库、云函数和业务数据不在本包修改范围内。

## 1. 实施结果

- Settings 密码卡片移除对 `data.js` 未导出 `callFn` 的动态导入，不再调用不存在的 `requestPasswordReset`，也不再显示“重置链接已发送”。
- 沿用 Legacy `admin.html` 的 `auth.resetPasswordForOld({old_password,new_password})` 认证能力。表单收集当前密码、新密码和确认密码；新密码长度限制为 8–64，要求与当前密码不同且确认一致。
- 密码成功后统一调用 Settings/More 共用的 CloudBase `auth.signOut()`，清除 Console 的五分钟活动标记并返回登录页。退出不执行 `localStorage.clear()` / `sessionStorage.clear()`，保留语言偏好及其他本地状态。
- 改密和退出错误不再透出 SDK 原始英文/内部错误码，分别显示中英双语的可理解提示。所有设置页新增文案位于 `crm/js/modules/console/i18n.js`。
- 没有新增登录方式、匿名权限、云函数、数据库对象或迁移；Console 登录、五分钟重新认证、Legacy 账号路径和 More 页面分类保持原有入口。

## 2. 影响与兼容

影响页面为 `console.html#/settings`。认证端仍使用既有 CloudBase Web Auth 会话 API；退出后重定向到既有 Console 登录页。More 页面继续使用相同的 `ctx.signOut` 行为。Legacy `admin.html` 的账号设置组件没有被替换。

需要发布的静态文件仅为：

- `crm/js/modules/console/app.js`
- `crm/js/modules/console/pages/settings.js`
- `crm/js/modules/console/i18n.js`
- `crm/css/console.css`

页面文件、云函数、数据库及权限没有变更。最新双语错误映射是在此前四文件初次部署之后补入 `settings.js` 和 `i18n.js`；发布记录须以最终部署核对结果为准。

## 3. 回归证据

### 隔离回归

| 验证 | 结果 | 证据边界 |
|---|---|---|
| `npm test` | PASS 108 / FAIL 0 / SKIP 5 | 最终完整回归；5 项 SKIP 为真实登录、数据库只读管理检查、线上 AI、线上写入和真实移动设备。 |
| `console.settings.password-signout` | PASS | 覆盖双语设置、iPad 竖屏/横屏宽度、表单校验、认证失败本地化、改密成功后退出、重新登录、退出失败提示与重试、语言偏好保留。密码值为本地 fixture，不是实际账号密码。 |
| `npm run test:wp05` | PASS 8 / FAIL 0 | Person 360 资料/身份安全与旧详情入口；不覆盖一次真实编辑保存和乐观锁冲突。 |
| `npm run test:wp07` | PASS 6 / FAIL 0 | Quick Capture V2 服务端 Plan/Preview/Confirm/Execute 安全。 |
| `npm run test:quick-capture-v2` | PASS 5 / FAIL 0 | 身份解析、人工确认、服务端约束、匿名调用拒绝；隔离 fixture，无线上写入。 |
| `npm run test:modular` | PASS | Console 模块 API、路由和 flag 检查。 |

浏览器回归曾出现不同旧页面的间歇性等待超时；最终完整 `npm test` 复跑通过。没有为让测试转绿而调整旧页面断言。

### 已登录窗口线上只读证据

通过用户打开的隔离测试窗口检查：`live.login=PASS`、认证 JWT role=`authenticated`，预期 public 白名单中的 61 个表/视图对已登录角色的 `HEAD ...?select=*&limit=0` 均返回 403。只检查对象访问拒绝，不返回行数据。

后续探针在 `assistant.testSamples` 的只读场景状态断言 `scene.ready` 失败后停止；因此未继续非法 dry-run 拒绝项、数量复核或页面路径检查。该探针整体不是 PASS，也没有执行种子、业务写入、AI 生成或邮件。

会话超过项目五分钟活动时限后，退出验证被安全跳过；没有手动延长时间戳或绕过锁。实际 Settings 点击退出、退出后受保护读取拒绝、重新登录尚未取得线上证据。

Person 编辑成功、乐观锁冲突、新旧页面刷新目前只有源码/既有隔离入口证据；没有对线上 Person 写入。Quick Capture 有隔离 UI 与服务端测试证据，没有在线写入验证。因此这两条不能标为端到端验收通过。

## 4. 数据、部署与发布

- 数据库迁移：0。
- 业务数据：未写入、未删除、未恢复。
- 认证账号密码：未修改；没有发送邮件。
- CloudBase：仅上传上列 4 个 Console 静态文件，不部署云函数、不上传项目目录。上传成功；受控 CloudOnly 检查通过，线上 `admin.html` 哈希一致、51 个静态资源一致，29 个 CRM 云函数的 175 个源码/配置文件一致。没有改动数据库。
- Git：发布脚本仅提交本包代码、对应回归用例、索引/状态记录；其他未跟踪计划、快照和文件保留在工作区、不纳入提交。
- Git release gate 与完整发布后 sync-check 仍由发布脚本最终执行；任何检查失败都不得报告发布完成。

## 5. 后续未完成项

1. 本轮在用户回复重新登录后尝试了只读退出探针，但隔离窗口记录的活动时间戳仍为 1592 秒前，探针按五分钟安全锁规则跳过，没有执行退出或匿名请求。真实 Settings 登出、拒绝访问和重新登录仍未取得证据，不绕过活动锁。
2. 排查测试场景 `scene.ready` 为 false 的原因，但拆入对应 PC03/测试数据场景包，不扩大 PC02。
3. 为虚构 Person 的保存成功、乐观锁冲突和 Legacy/Console 刷新建立受控证据。确认实际目标确属专用测试 Person 后再执行写入；否则继续标未验证。
4. 执行 Git commit/tag/push 及完整 sync-check，核对本地、GitHub 与 CloudBase。PC02 只有在以上发布校验完成后才可标记已发布。
