# Admin 重复入口清理发布记录

日期：2026-11-08  
工作基线：`435d9b36cf5e05966d7f979e42ca6c8c381adcaf` (`release-20261108-094516`)  
状态：静态页面已部署，CloudBase 全量核对通过；待 GitHub 提交/标签发布及最终同步核对。

## 范围与影响

依据用户确认，移除 `admin.html` 中明确重复的 Console 导航入口，保留 AI 建议历史。此次只改入口呈现，不删旧功能代码、事件处理、API、路由或兼容地址。

- Admin 主导航只保留“更多”；全局“快速记录”入口保留。
- Admin“更多”只保留“AI建议历史”。
- 首页和客户、招募、活动列表中，移除 Console 已有对应功能的重复快捷入口。
- AI 建议历史、新建助手行动、活动经验等没有明确替代入口或属于独立工作流的入口保留。
- 客户/人物和招募详情中的上下文操作、旧页面功能与 URL 路由保留；不改变数据写入、权限、软删除或恢复流程。
- 生产变更范围仅为静态文件 `/crm/admin.html` 与 `/crm/js/modules/phase14-hubs.js`；无数据库、云函数、权限或客户数据变更。

## 验证

- 页面预检：Admin“更多”及 Console 对应页面在隔离浏览器中已打开；此前 Console 对应路由专测通过。
- `npm run test:regression:browser:short`：PASS 48，FAIL 0，FLAKY 0，SKIP 26。
- `npm run test:regression:browser:long`：PASS 21，FAIL 0，FLAKY 0，SKIP 53。
- Console 对应页面/功能专测：14 项通过。
- `npm run test:modular`：通过。
- WP01 全量自动门禁：`PASS_WITH_LIMITATIONS`；catalog 1248 项检查通过；隔离 browser regression 104 PASS / 0 FAIL / 0 FLAKY / 5 SKIP；匿名探针 81/81；WP04 身份审计 785 客户、573 招募、6 嘉宾均映射，3 条已声明的姓名暂存参与者例外，测试台账 10 条。
- `npm run check:release-gate`：PASS。明示未验证项为真实人工登录、service runtime、线上业务写操作和手机真机；本工作包没有执行这些操作。
- 发布后 `tools/sync-check.ps1 -CloudOnly`：PASS；Admin 页面 SHA-256 匹配，95 个可达页面资源匹配，30 个 CRM 函数的 243 个源码/配置文件匹配。
- `git diff --check`：通过。
- 回归更新：WP03 旧页面专测改为直接访问仍保留的 `#/test-scenario` 兼容路由，不再依赖已移除的 Admin 菜单入口。

## 发布与恢复

- 回滚基线：`release-20261108-094516`。恢复时创建恢复提交并重新部署上述静态文件，不强推历史。
- CloudBase 静态托管：`/crm/admin.html`、`/crm/js/modules/phase14-hubs.js`，上传成功 2/2；线上地址为 https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html 。未部署云函数。
- GitHub 提交、发布标签及 GitHub/CloudBase 最终核对：待完成，完成后在此补记提交与标签。
