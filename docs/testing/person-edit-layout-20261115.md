# 人物资料编辑表单排版发布记录

日期：2026-11-15

## 变更

- 人物资料编辑弹层的前四行改为：姓名/性别/生日，手机/微信，职业/来源，毕业院校/院系或专业。
- 姓名列窄于生日列；后三行两列等宽。其余资料字段顺序、编辑控件和保存逻辑保持原实现。
- 仅调整 `crm/js/modules/console/write.js` 表单结构及 `crm/css/console.css` 页面专属布局规则；无数据库、接口或云函数变更。

## 验证

- `node --check crm/js/modules/console/write.js`：通过。
- 独立浏览器表单烟测：iPad 竖屏 820×1180、横屏 1180×820 均显示预期行序；姓名列窄于生日列，后 3 行等宽，无页面横向溢出或网络错误。
- 现有 `person-customer-operations.browser.cjs` 编辑保存用例运行时未初始化 `window.personWrites`，等待更新回调超时；同文件目录用例也有页面夹具超时。此浏览器夹具结果与布局烟测分开记录。
- `npm run test:wp01`：`PASS_WITH_LIMITATIONS`；102 PASS、0 FAIL、5 个历史跳过，WP04 身份审计 PASS，public 目录 1,561 项通过，匿名权限探针 107/107 通过。
- `npm run check:release-gate`：通过。人工登录、service-role 运行时、生产业务写入及手机真机验证仍按总门禁标记为未验证；本次 UI-only 变更未涉及这些路径。
- 静态托管仅上传 `crm/js/modules/console/write.js` 与 `crm/css/console.css`；上传成功，无云函数或数据库变更。
- 上传后 CloudBase 同步检查：103 个可达页面/模块/样式资源匹配，30 个函数的 336 个源/配置文件匹配；GitHub 发布后的三端核对由发布脚本完成。
