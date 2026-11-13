# iPhone 人物目录表格宽度修正

## 变更范围

- 仅当 Console shell 检测到 iPhone UA 时，人物目录表格宽度锁定为列表卡片容器宽度；表格宽度与行内容、姓名长度和分页结果无关。
- iPhone 下为全部人物、客户和活动参与者视图分别分配列宽；长姓名及活动名称在单元格内单行省略，完整文本仍保留在 DOM 和人物详情中。
- 只修改 `crm/css/console.css`、`crm/js/modules/console/pages/people.js` 和对应浏览器回归。没有改接口、字段、数据、权限或按钮行为。iPad、电脑浏览器及非 iPhone 的通用手机样式保持原状。

## 改前复现

- iPhone UA、393 CSS px 视口、人物目录第 1 页含合成长姓名：顶部工具栏宽 373 px，表格内容宽 432 px，滚动窗口宽 371 px，姓名列宽 187 px。
- 根因为目录表使用 `width: max-content; table-layout: auto`，且姓名链接为 `width: max-content`；表格依赖当页最长文本自然扩张，导致首尾分页宽度不稳定。

## 验证

- iPhone 15 模拟回归使用 393×852 CSS px、31 条合成记录及第 1/2 页：表格与列表容器等宽，长姓名省略，页面无横向溢出；客户和活动参与者列宽方案也保持在容器内。
- 人物目录浏览器回归：7/7 通过；现有通用手机、iPad（1024 px）及电脑（1366 px）断言确认没有启用 iPhone 专属列宽。
- WP01：`PASS_WITH_LIMITATIONS`，隔离回归 102 项通过、5 项历史预设跳过，匿名探针 106/106；身份覆盖 customers 785/785、participants 6/6、recruits 573/573、speakers 6/6，异常 0。发布门禁无阻断。
- 浏览器在 393 CSS px iPhone 15 UA 尺寸验证，未进行真实 iPhone 真机视觉验收；登录、生产写操作和 service-role 运行时继续保留 WP01 的未验证项。

## 回退与部署

- 回退基线：`release-20261113-231006`。仅需恢复上述样式与人物目录模块并重新上传对应静态文件；不涉及云函数或数据库。
- 本轮只部署 `crm/css/console.css` 与 `crm/js/modules/console/pages/people.js`，不全量上传项目。
