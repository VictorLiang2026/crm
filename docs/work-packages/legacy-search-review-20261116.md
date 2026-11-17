# 旧搜索用途核查与有限清理（2026-11-16）

> 本文原始“未发布”状态已由文末 2026-11-17 发布后核对 supersede；中间各节保留当时的历史判断。

用户要求判断旧搜索是否有用，无用部分可以清理。本轮保留此前教育资料补全工作的所有本地改动。

## 结论

旧搜索不能整套认定为无用。当前 Console 主界面使用 `data.aiSearchV2()` → `assistant.searchV2`，智能助手的只读搜索分发也使用 V2；旧的三个固定模板 API 仍保留独立语义，特别是“已确认子女关系、教育线索且未见保险记录”和“重点客户关系下降”。当前 V2 的过滤契约没有与这两个条件完全等价的组合，不应直接删除旧后端来消除一项测试失败。

线上只读审计汇总：

| 任务类型 | 已存任务总数 | 最近 30 天 | 最新任务时间（上海） |
| --- | ---: | ---: | --- |
| 旧搜索 `crm_search_parse` | 11 | 0 | 2026-10-11 00:21:58 |
| 新搜索 `crm_search_query_v2` | 4 | 4 | 2026-10-21 10:36:44 |

这是现存 AI 任务审计统计，不等于真实业务用户次数，也不能排除仓库外的调用、未进入审计的失败或已清理历史。最近没有任务不证明可以安全删除接口。

## 依赖核对

- `assistant/index.js` 仍分发 `action=search` 到 `search-service.js`；后者使用 `crm_search_parse` 模型契约、`search-data.js` 的固定模板适配及 `public.crm_search_people_v1`。
- `tests/wp03/database-rollback.sql` 直接依赖旧 SQL 搜索验证测试数据不会被普通查询排除；旧接口、Skill 和服务端适配仍有专用兼容测试。
- 旧静态模块 `crm/js/modules/ai-crm-search.js` 仍具有直接调用旧接口的实现，其 CSS 也保留。当前源码没有找到该页面模块的加载入口，但旧缓存或仓库外调用未被证明不存在，本轮保留这两个兼容静态文件。
- 全仓库业务代码和测试中没有发现 `data.aiSearch()` 的调用，只有其自身定义。Console 中的 `searchLabels()` 和 `evidenceFor()` 也只有定义，没有调用；新版实际展示使用 `searchReasonText()`。

## 已做的本地清理

1. 删除 `crm/js/modules/console/data.js` 中未引用的 `aiSearch` 包装。
2. 删除 `crm/js/modules/console/pages/misc.js` 中未引用的 `searchLabels()` 和 `evidenceFor()`。

这些是未调用的前端代码；当前搜索继续调用 V2，既有旧后端 API、SQL、Cloud Function、Routes、Skill、历史任务和业务数据全部保留。没有更改旧搜索测试或通过删测试来掩盖失败。

## 基线与验证

- 清理前 `data.js` 本地 MD5 为 `510d6f3290b4ec95e74d6b1aeba90d9c`，与 CloudBase 托管 ETag 一致。
- `misc.js` 的 HEAD 内容与云端仅存在 LF/CRLF 差异，此前已核实；本轮仅删除上述无引用定义，保留教育资料补全新增入口。
- 两个修改文件的 `node --check`：通过。
- `node tests/tooling/modular-frontend.mjs`：通过。
- `node --test tests/pc24/search-v2-service.test.cjs`：9 PASS、0 FAIL，覆盖有界过滤、分页、歧义身份确认、来源追溯及窗口截断提示。
- 既有旧搜索单元测试仍有一项未模拟客户映射 fetch 的环境依赖，缺少 `TCB_ENV` 时访问 `undefined.api.tcloudbasegateway.com` 失败。该问题没有因删除无调用前端代码而解决，继续作为独立未通过项。
- 后续推进补记：用户再次要求落实教育字段更新后，已补齐旧搜索测试的 fetch 与来源披露模拟、用例结束恢复环境。旧搜索业务未改动，所有用例保留；该测试已通过，并在 98 项联合测试中复核通过。上条为清理评审当时的历史状态。
- GitHub 代理连接、发布目录访问和浏览器启动阻碍仍存在，未执行部署、提交、推送或发布标签，不报告为已上线清理。未重复执行已知受阻的浏览器验收。

## 对教育资料补全工作的影响

教育资料补全不依赖旧搜索 API 或这三个删除项。它的本地实现、迁移和人工确认流程保持原状；旧搜索保留独立能力，不阻止继续完善本地功能，但发布仍须解决全部门禁失败。

## 2026-11-17 发布后状态（本节取代“待提交/尚未发布”的当前性结论）

- 旧搜索前端未调用包装（`data.aiSearch`）及未调用展示辅助函数（`searchLabels`、`evidenceFor`）的清理，已在提交 `4471058` 中随教育功能并入 GitHub `master`，业务发布标签为 `release-20261117-131000`。本次闭环提交 `ee1780ce76fa39b8fe969a042ca8560716a3430d` 仅修正文档/测试记录，最新标签为 `release-20261117-133200`。
- 清理覆盖的两处 Console 文件已随 Assistant 和静态资源部署；发布后完整核对确认本地/GitHub/CloudBase 一致，共 106 个可达静态资源及 30 个函数的 340 个源码/配置文件匹配。
- 旧搜索 API、SQL、云函数、Routes、Skill、兼容模块与历史数据仍予保留；没有扩展清理范围。修改前列出的未调用代码已随发布清理，因此当前没有该清理项待发布。
- 专项旧搜索测试夹具修正及私有 Word 导入相邻回归另见 `private-docx-reference-import-20261117.md`；本记录不改变其业务结论。
