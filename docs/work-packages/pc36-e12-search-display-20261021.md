# PC36 E12：AI CRM 搜索结果显示修复

2026-10-21。用户指出第二张“AI CRM 搜索”卡直接展示证据 JSON 和 `search_v2_condition_followupMonths`，批准只改 Console `pages/misc.js` 与 `i18n.js`，保留 `public` 来源 ID、筛选和分页。基线提交 `5546603460fa9dbeefb7d7145b16b3504c92eec7`，回滚标签 `release-20261021-010330`。

结果卡把服务端 `matchReasons.records` 格式化为中英双语的来源 ID 与时间范围，不再序列化内部 `evidence` 数组；重复的独立月份条件行合并显示。未知条件回退到已有“匹配记录”文案，动态内容仍用文本节点。请求参数、人物人工选择、搜索 SQL、模型、服务器总数与翻页行为未改；第一张只读助手不受影响。

专项 PC24/25 与 PC33 相关测试 27/27，通过隔离浏览器核对虚构 Person #784 的双语来源、三个月窗口、无 JSON、分页及两种 iPad 朝向无横向溢出。旧业务回归 108 PASS / 0 FAIL / 5 既定 SKIP；完整 WP01 最终 `PASS_WITH_LIMITATIONS`：`public` 目录 1036 项、匿名 71/71，已登记的登录与通用门禁限制另见故障记录。两个静态文件各自上传成功，`tools/sync-check.ps1 -CloudOnly` 验证云端源码与本地一致。

首次生产视觉验收被独立的 AI 请求登记 HTTP 400 故障阻断，已按另一个获批子包修复，详见 `pc36-e12-ai-claim-http-diagnostic-20261021.md`。随后生产虚构任务 #83 成功完成，用户确认只返回 Person #784、两条指定 `public` 来源，且不再显示原始 JSON 或未翻译键。未开展屏幕阅读器和其他搜索组合的真实账号逐项验收。回滚静态页面时从基线标签恢复上述两个文件并逐个重新上传；无需业务数据回滚。
