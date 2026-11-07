# 快速记录模型超时提示 — 2026-11-07

## 范围与影响

- 仅 focused 快速记录的 `ai_parse` 模型请求超时从 55 秒调整为 100 秒；云函数总超时仍为 120 秒。
- 解析异常原因继续由 `ai_parse` 返回并显示。前端将 `Load failed` / 网络中断归一为双语提示，说明浏览器未收到服务端错误详情、可能的网络或模型等待原因，并提示原文仍保留。
- 旧版快速记录和 V2 快速记录超时不变；解析仍是只读，不新增业务写入、数据库对象或权限。

## 基线与回归

- 改前 Git 本地 `master` / `origin/master`: `5e016ac0332b1b2d01126304cd7007a5830e9527`，工作区干净；通过临时清除本地 GitHub 代理覆盖后，GitHub `master` 实时读取也确认是该提交。
- 改前 CloudBase 全量核对：30 个函数、243 个源码/配置文件一致；96 个可达页面资源一致。
- 定向回归：`node --test tests/pc37/quick-capture-focused.test.cjs tests/pc37/quick-capture-focused.browser.cjs`，14 项通过。
- `npm run test:modular`：通过。
- `npm run test:wp01`：108 项通过、0 失败、5 项已有跳过；匿名探针 81/81；发布门槛 `PASS_WITH_LIMITATIONS`。未执行真实 AI 调用或生产业务写入。

## 发布与恢复

- CloudBase 发布目标：仅 `ai_parse` 函数，已部署成功。
- 静态发布目标：仅 `/crm/js/modules/console/write.js` 与 `/crm/js/modules/console/i18n.js`，均已上传成功。
- 部署后用虚构内容实际调用 `ai_parse` focused 路径成功，RequestId `91f04ff7-feae-44ab-915c-d966eb09ce06`，耗时 36.7 秒；响应为解析草稿，无人物关联及业务写入。
- 部署后 `tools/sync-check.ps1 -CloudOnly` 通过：96 个可达页面资源、30 个函数及 243 个源码/配置文件与线上一致。
- 完整 `sync-check.ps1` 在工作区包含本轮待发布修改时按预期拒绝继续（`Uncommitted tracked changes or unapproved untracked files`）；提交后再做完整核验。
- 代码与回归提交 `73c3d2d5d41b9371f1fab1d0d1620d1f33ba903e` / 标签 `release-20261107-091231` 已推送。首次发布脚本的收尾核验指出新建发布记录未跟踪；随后将该记录显式暂存并再次运行标准发布脚本，完成文档提交与最终 GitHub 核对。
- 恢复：将 `quick-capture-focused.js` 的模型 timeout 恢复为 55000，并回滚以上两个模块文件到本次变更前版本；重新部署相同目标。无数据库回滚。

## 未验证

- 未对生产账号发起模型请求，100 秒端到端超时和具体模型供应侧错误响应尚未通过线上真实 AI 调用验证。
- 未在生产执行等待超过 100 秒的人工超时测试；该路径通过单元回归验证超时参数为 100000 毫秒，并通过前端回归验证网络错误提示和原文保留。
- 未对真实用户资料发起模型请求，未保存任何业务记录。
