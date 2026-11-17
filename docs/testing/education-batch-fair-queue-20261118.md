# 教育补全批次排队公平性修复

日期：2026-11-18  
环境：`crm-d1gkae8ddc930d151`  
迁移：`20261118010002_education_batch_fair_queue`

## 诊断

线上有两个同一用户的活动批次：较早批次已使用 10/50 次尝试，较新批次为 0/50。原 `queue` 操作始终按 `created_at ASC` 返回最早活动批次，timer 每分钟触发且 AI 单次耗时约 18–22 秒，因此 worker 持续处理旧批次，新批次长期停留在 0/50。页面显示的旧计数是 AI 尝试数（包含失败和多段请求），不是完成的人数。

## 修复范围

- `public.crm_education_backfill_v1` 队列先按 `calls_used / max_calls` 升序选择活动批次，使用比例相同则按创建时间与 ID 排序，避免旧批次独占 worker。
- 保持每分钟触发、单个 worker 的时长限制、AI 规则、批次内容与 Person 资料写入流程不变。既有批次不会重建或重置。
- 教育页面中英文将进度计数明确标注为 AI 尝试额度（已用 / 上限）。
- rollback 恢复旧 FIFO 排序，不改写或删除任何批次/人物数据。

## 验证

- 教育流程与实际 SQL 夹具 29/29 通过，验证使用率低者优先、使用率相同按 FIFO、rollback 后恢复 FIFO。
- iPad 双语浏览器测试 3/3 通过，包括尝试额度文案与英文翻译。
- 专项 manual DOCX 浏览器回归 1/1 通过，验证两种语言下覆盖提示可见、可重试标记有效。
- WP04 public 身份审计通过，8/8 夹具通过。WP01 新鲜目录快照 1,716 项检查通过。
- CloudBase-only 的 `manual-docx-import.js` 经用户确认仅以单文件纳入本次发布；它对应主工作树里已部署的双语扫描覆盖/重试调整。专用 iPad 浏览器回归 1/1 通过。
- 未对 Person 的毕业院校/院系或专业字段执行写入。线上活动批次按原授权继续由 timer 处理，人工审核仍是回填前置条件。

## 部署记录

- CloudBase migration ledger 已记录版本 `20261118010002`；`migrationDetail` 返回该 migration，线上 `public.crm_education_backfill_v1` 源码包含按使用率排序的逻辑。执行权限仍为 service_role-only。
- 已上传 `/crm/js/modules/console/education-backfill.js` 与 `/crm/js/modules/console/i18n.js`；逐文件线上 SHA-256 与本地一致。
- `/crm/js/modules/console/manual-docx-import.js` 源码已与主工作树中用户批准的已部署版本一致。
- timer 后续实际推进原 0/50 的新批次：状态核对时已用尝试数从 0 增至 2；1 条 ready、1 条 running、48 条 pending。旧活动批次仍保留并继续处理。
- 发布前 WP01 门禁通过；CloudBase-only 差异核实为 `manual-docx-import.js` 对应主工作树中用户已有的双语扫描覆盖/重试修改。用户明确批准只将该文件纳入本次发布；其他 Reference Optimization 文件均未带入。
- 静态核验通过：页面可达的 108 个 JS/CSS 文件与 CloudBase 一致。完整 GitHub / CloudBase 发布后核验以本文件的最终发布记录为准。
- 最终 WP01 为 `PASS_WITH_LIMITATIONS`、无阻断；102 项隔离回归通过、5 项历史预设跳过，匿名探针 119/119。人工登录、生产 service runtime 和真实生产写入继续明确标记为未验证。
- Git 发布脚本在提交前云函数核对处停止：线上 `assistant` 函数与 GitHub `master` 的源码不一致。只读下载发现线上 `assistant` 约 30 个源码/配置文件与主工作树的未提交 Reference Optimization 版本分叉（另有 parser 文件内容差异）。这些后台变更不属于本教育工作包，未覆盖、部署或提交；因此本轮教育修复尚无 GitHub commit/tag。
- 教育迁移和教育静态模块已在线运行；等待线上 Assistant 与 GitHub 的既有差异得到独立处理后，再执行包含本轮文件的 Git 发布与最终三端核验。

## 后续统一发布

用户要求再次核实另一轮进度后判断发布方式。本轮确认教育代码、迁移和验收已完成，Git 发布停在 assistant 源码差异检查。随后与话术端到端修复合并，保留全部教育改动及扫描提示，统一发布标签 `release-20261118-013000`。合并后 50 项专项回归通过，WP01 无阻断；详细证据和发布执行日志见 `reference-e2e-20261118.md`。没有重复执行教育迁移或改写 Person 字段。
