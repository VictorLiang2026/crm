# WP04 身份完整性复跑

先读根 AGENTS、环境/安全边界及 `specs/target-crm-v1/{requirements,design,tasks}.md`。

1. 通过已授权 CloudBase PostgreSQL 只读入口执行 `audit.sql`，只接收完整、未截断的一行 snapshot，解析后保存至 `tests/security/.results/wp04-audit.json`。
2. `npm run test:wp04` 校验一小时内的快照、完整覆盖及明示例外，再运行同名/明确 ID/确认/拒绝的不落库夹具。
3. `npm run test:wp01` 现在包含 WP04；发布断言再次检查快照哈希和时效，文件替换、过期、新遗漏、ID 冲突或第 11 条初始样本都会阻断。

`exceptions.json` 仅说明尚待人工核对的身份，不授权创建、合并或补连。新增例外必须核对具体记录、原因和范围；不能自动把未知记录加入清单或把映射冲突当成允许例外。例外解除后可正常通过，不要求刻意保留遗漏。统计中的“活动”指 deleted_at 为空；不把报名视作到场，不用姓名相等推断同一个人。

SQL 区分参与者 `person_type=person` 的直接 Person ID 与 customer/recruit/speaker 的旧业务 ID，检查双方映射一致、有效性和活动父记录；保留已有 canonical Person 且旧 ID 为空的兼容路径。旧记录的原始姓名、联系方式不进入快照；受保护的测试 ID 清单也不导出。

夹具所有业务文本使用 `【系统测试·勿联系】`，全部在内存内，POST/PATCH 只是隔离请求替身，不联网、不落库、不生成审计或外发。线上审计不写数据库。已有 WP03 初始样本 10 条，不运行新的种子或空库事务夹具。

自动测试不等于本轮真实登录、CRUD 或手机真机验收；本轮没有业务产物变更，旧页面通过隔离回归，云端业务文件逐一核对。历史真实验证见 WP03 报告。
