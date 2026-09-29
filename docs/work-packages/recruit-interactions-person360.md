# 招募互动映射与 Person 360 Recruit 面板

基线：`731e3f0a861fe1ee8cf0e1a8db1684132ac589fd` / `release-20260930-004955`。修改前本地、GitHub `master`、线上 `admin.html` 及 27 个 CRM 云函数源码一致。范围仅限 `public` schema；本轮没有数据库变更、migration 或 rollback，也没有新密钥或权限变更。

线上只读核验：13 条在用 `recruit_candidates` 均有正确的 `person_id`，0 条关联错配；`recruit_followups` 与来源为 `recruit_followups` 的已存储 `interactions` 当前均为 0 条。因此生产环境没有可用于检查招募跟进映射的真实样本；没有为验证而创建线上记录。

实现：保留 `recruit_followups` 云函数、原 CRUD 和 `#/recruit/:id` 详情页。`LegacyInteractionAdapter` 在 Person 时间线查询时用 `recruit_candidates.person_id` 精确选取候选人，将其未删除的招募跟进按 `source_type='recruit_followups'`、`source_id=跟进 ID` 即时投影成虚拟 Interaction；已有的按客户读取入口保持兼容。时间线继续按来源键去重，若以后显式导入同一来源，优先显示已存储行。编辑或删除原跟进会在下次读取时反映，无需同步维护第二份业务记录。

Person 360 通过现有真实登录保护的 `person_360` 函数新增只读 `listRecruitContext`，按 Person ID 读取最多 10 条在用候选人和最近 20 条在用招募跟进，仅返回阶段、动机、顾虑、潜力评分、职业规划、下一步以及跟进摘要等限定字段。页面新增 Recruit 面板，提供原招募详情链接；无候选人或无跟进时有明确空状态。`admin.html`、旧招募流程、回收站及其他旧接口不变。

验证：语法、共享文件哈希和 Interaction 针对性测试通过；新增断言覆盖 Person 精确映射、不同 Person 隔离、只读、编辑/删除即时反映、未登录拒绝及面板字段。完整隔离回归 82 PASS / 0 FAIL / 5 SKIP，覆盖登录、客户、Person 360、招募列表与详情、跟进、活动、Today、漏斗及回收站。前两次受限环境中的测试 Edge 调试端口未就绪；在允许测试浏览器正常启动后重跑通过。已部署函数未登录直调 `listRecruitContext` 返回 `UNAUTHORIZED`（RequestId `bbc4d03a-f214-4832-90aa-f12d4c8f3ad1`）。测试账号在独立浏览器中登录后，线上只读探针返回 `hasPerson=true`、`candidateCount=1`、`recentRecruitFollowupCount=0`、`mappedRecruitInteractionCount=0`、`error=null`；仅保存数量和状态，不保存姓名、原文或登录凭据。

发布范围：仅 `person_360` 云函数与 `/crm/js/modules/person-360.js`、`/crm/css/person-360.css` 两个静态文件；共享 Interaction 源及函数内副本同版入库，旧 `recruit_followups` 函数不部署。若需要回退代码，使用基线标签重新部署上述三个产物并建立恢复提交；无数据库数据需要回滚。

限制：线上当前没有招募跟进，真实用户新建、编辑、删除后 Person 360 的端到端联动尚需在将来出现明确标记的测试记录或真实业务记录时做只读复核。面板只显示最近 20 条，不是历史全量列表；完整列表仍在原招募详情页。
