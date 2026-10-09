# 决策与批准记录

按时间倒序追加；每条记录决策内容、依据和用户批准方式。本文件是"谁在什么时候批准了什么"的权威索引。

| 日期 | 决策 | 批准方式 | 备注 |
| --- | --- | --- | --- |
| 2026-10-07 | 建立 PMC-00～PMC-20 编号体系，与既有 WP01～WP28 并行、编号独立 | 用户 PMC-00 指令明确指定 | 避免与 WP 工作包混淆 |
| 2026-10-07 | 档案目录定为 `specs/person-centered-migration/`，含九类文档 + evidence/ | 用户 PMC-00 指令明确指定 | 可复用等价文件但须建立唯一索引，不平行维护矛盾版本 |
| 2026-10-07 | execution-contract A–N 十四条执行约定 | 用户 PMC-00 指令逐条给定 | 所有 PMC 包强制遵守 |
| 2026-10-07 | PMC-00 范围限定为只读检查 + 文档建立，不改业务代码/业务数据 | 用户 PMC-00 指令明确指定 | 无需额外影响确认 |
| 2026-10-07 | 接管检查发现的外部迁移备份滞后等 4 项缺口登记为观察项，不在 PMC-00 内修复 | 按执行约定 I/J/K 与 AGENTS.md 规则 11（不顺手扩张修改面） | 见 handoff.md 第 5 节；修复须另获授权 |
| 2026-10-07 | 用户当日指示处置 G1–G4：双备份保持一致（授权非破坏性归档+镜像方案）；其他问题按最合理方式解决 | 用户原话："双备份滞后的，保持一致。遇到的其他问题，按照最合理的方式解决。" | G2 tcb.ps1 加守卫；G3 新增只读查询工具；G4 核实为过时记录；G1 因宿主写权限阻断改为交付脚本待用户沙箱外执行。均属工具/文档，无业务影响 |
| 2026-10-07 | 用户授权由助手直接执行 G1 同步脚本（非沙箱模式）："帮我运行 G1 的脚本，按建议方案进行" | 用户明确当次授权 | 执行成功：25 份旧稿归档至外部 `_archive-20261007/`，82 份镜像并哈希复核一致；独立复核 mismatches=0，G1 关闭。仅文件复制/归档，无数据库与云端影响 |
| 2026-10-07 | PMC-02 设计决策清单 D1–D11 集中登记（customers.person_id 基数、U1 处置、性格/婚姻归属、备注标签、姓名唯一约束退出、嘉宾快照语义、多电话多地址、双 FK 退出、阶段权威来源、删角色保留 Person、customers.create 人工确认红线） | **待用户批准** | 全文见 [data-model.md](data-model.md) §8；每项附建议选项（多数建议 A=保守方案）。**未批准前不实施对应部分，不进入依赖该设计的实施包** |
| 2026-10-07 | **PMC-02 设计获用户批准："全部按建议 A 批准"**——D1/D2/D3/D4/D6/D7/D9/D10/D11 按 A 批准；D5/D8 批准的是建议路径（约束现状维持，解除/退出动作届时在独立包单独批准，不提前授权删除） | 用户原话："全部按建议 A 批准" | 批准全文落 [data-model.md](data-model.md) §8。设计基线锁定；后续实施包以该设计为准。**仍未批准**：任何具体实施包（PMC-03+ 指令未收到）、删除/重命名既有对象、所有数据库变更（须 migration/rollback + 针对性确认） |
| 2026-10-08 | PMC-03 范围限定为测试/只读核对/恢复准备工具，不切换业务行为、不迁移真实数据；新测试不接入 release gate（不改门槛跳过）；恢复能力未演练前不声称"可安全回滚" | 用户 PMC-03 指令明确指定 | 产物：pmc-03-verification.md、tools/migration-check.{sql,cjs}、tests/pmc/、evidence/PMC-03.md。R11 发现 sync-shared.cjs 不追踪 person-service.js（列为缺口，扩展属 PMC-04+） |
| 2026-10-08 | PMC-04 范围限定为只读冲突检测+脱敏清单+五分类确认，不自动合并、不批量改写真实人物、不执行生产数据修复；待确认项不计入迁移成功率；E1–E7 阻断 D5 但不阻断 person_id 回填 | 用户 PMC-04 指令明确指定 | 产物：pmc-04-confirmation.md、tools/conflict-check{,-detail}.sql、evidence/PMC-04.md。待确认项（A1–A3/A5/D1/E1–E7）留待 PMC-06 |
| 2026-10-08 | PMC-05 范围限定为兼容性结构扩展（加列+索引+约束），不强制 NOT NULL（PMC-04 有 3 个 customer 无 Person 待 PMC-06）、不移除旧约束（D5/D8 退出条件未满足）、不重建视图（阶段 3）、不修改 RLS/云函数、不回填数据 | 用户 PMC-05 指令明确指定+授权执行 migration 部署 | 产物：pmc-05-implementation.md、cloudbase/migrations/rollbacks/20261008120000_*.sql、tools/migration-apply.cjs、evidence/PMC-05.md。Migration 已应用（4 步 40ms）；旧约束 5 个完整、12 视图正常、数据 783 行 person_id 全 NULL |
| 2026-10-09 | PMC-14 裁决①：7 行软删 customer 参与记录**回填含软删行**（canonical_person_id 经 legacy_customer_id 桥唯一命中回填） | AskUserQuestion 答复："回填含软删行（推荐）" | 覆盖 20260929084000 迁移当时仅回填活跃行的范围缺口；4 行无 person_id 暂存行 + 1 行 speaker 软删行保持"身份待确认"，不造 Person |
| 2026-10-09 | PMC-14 裁决②：活动参与者展示名 **Person 优先+快照保留**（persons.display_name 覆盖返回值；Person 软删回退业务表回填名/快照名；person_name 快照列不可变 D6） | AskUserQuestion 答复："Person 优先+快照保留（推荐）" | 落地于 activities enrichParticipants；仅作用返回值，不写库 |
| 2026-10-09 | PMC-14 生产 UPDATE 专项批准：对 7 行软删 customer 参与行回填 canonical_person_id（id 1,2→person 1；id 3,5,7,9,11→person 89），逐行唯一桥命中、断言块预检通过、回滚按精确 id+预期值备好 | AskUserQuestion 答复："确认执行（推荐）"（安全层拦截后完整披露映射/影响/回滚再确认） | 实际执行 AffectedRows=7；执行后核对 grp1_ok=2、grp89_ok=5、still_pending=5、活跃行 4/0/1 不变 |
| 2026-10-09 | PMC-15 五项推荐裁决按用户预授权直接采纳（用户："有需要确认的，有'推荐'二字的，直接选择推荐，不需要人再确认"）：①person_roles=有明确来源的组合（4 类业务角色派生+4 类人工标记，派生重算 SECURITY DEFINER+5 AFTER 触发器，origin 增 derived）；②relationships 加 source/status/confirmed_at/by_uid 治理列+类型词表+一致性 CHECK（默认 pending，confirmed 才进 AI/搜索上下文）；③households 行为不变仅补边界注释；④读取方收紧（context-engine 两副本/meeting-prep/crm_search_people_v1 只认 confirmed）；⑤一次性精确对账（删 703/792、补 777 customer+recruit，断言块保护） | 用户 PMC-15 指令预授权推荐项 | 生产对账 DO 断言 74ms 通过后执行；postcheck 漂移=0；生产 UPDATE/DELETE 范围在影响说明与证据中披露 |
| 2026-10-09 | PMC-15 生产 DDL/DML：经 cloudbase_postgres（表 owner）角色应用迁移（service_role 无 owner 权限）；DDL 含 person_roles origin CHECK 替换、relationships 加列加约束、新增 2 函数 5 触发器、重建 1 RPC；DML 为删 2 行/插 2 行角色 | 用户持续发布授权+推荐项预授权；高风险生产写已在影响说明披露 | rollback 成对备份至 cloudbase/rollbacks 与外部 CloudBase 迁移目录；功能回归用单 DO 块断言后整体 RAISE 回滚，零残留 |

## 历史批准的继承关系

- 以下既有批准对 PMC 包继续有效，不重复索取：常规 Git 提交与推送、`release-YYYYMMDD-HHmm` 标签、针对性部署受影响产物、`tools/release.ps1` / `tools/sync-check.ps1` / `tools/deploy-function.ps1` 流程（AGENTS.md"每轮必须完成发布"持续授权）。
- 以下事项必须逐项单独批准，不因上述持续授权而豁免：删除/重命名任何已有表、视图、云函数、路由；`pr`/`pr_*` 相关的一切；Legacy Quick Capture 流程变更；数据库危险操作；影响现有行为的每个新实现（AGENTS.md 修改前第 3 条）。
- WP 体系的历史验收（WP01–WP12、WP09-R、WP07.1 等）保留原日期与证据链接于 `specs/target-crm-v1/tasks.md`；PMC 相关包引用时注明"引用历史验收，开工前需实时复核"。
