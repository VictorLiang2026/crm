# PMC-03 测试套件（tests/pmc/）

本目录为 PMC-03（迁移验证及恢复基线）新增的测试与漂移检测。**不接入 release gate**：独立运行，不修改 WP01 门槛（`tests/wp01/README.md`）跳过。

## 文件清单

| 文件 | 内容 | 覆盖契约 |
| --- | --- | --- |
| `risk-cases.test.cjs` | R1–R10 + R-ID1 离线契约测试（fixture，不触线上） | data-model §6 C1–C9、§1.3 R-ID1/2、§4.3 D10、§5.3 同名、§6.1 ocr 特例 |
| `shared-copy-drift.test.cjs` | R11 文件哈希漂移检测（person-service.js 三份副本） | execution-contract H（共享模块纪律） |

## 运行方法

```bash
# 全部运行
node --test tests/pmc/risk-cases.test.cjs tests/pmc/shared-copy-drift.test.cjs

# 单独运行风险用例
node --test tests/pmc/risk-cases.test.cjs

# 单独运行漂移检测
node --test tests/pmc/shared-copy-drift.test.cjs
```

## 覆盖矩阵

| 风险 | 契约 | 测试断言要点 |
| --- | --- | --- |
| R1 同名不同人 | data-model §5.3、AGENTS 规则 14 | resolveName 返回候选不自动选定 |
| R2 Person 无客户角色 | §4.3 D10 | customers.remove 不级联 persons |
| R3 一人多角色 | §4.1 | UNIQUE(person_id, role) 兜底 |
| R4 并发编辑 | C4 | expectedUpdatedAt 不符→409 |
| R5 重复提交 | C6 | clientRequestId 去重 |
| R6 迁移期新增修改 | C1/C2/C3 | 旧入参兼容、不清空、不破坏 |
| R7 旧客户端请求 | C1/C2 | 新增 personId 旧前端无感 |
| R8 部分发布失败 | execution-contract K | 失败即停，不标完成 |
| R9 OCR 恢复 | §6.1 ocr 特例 | customer_snapshot→customers.update（T2） |
| R10 权限拒绝 | C7 | RLS 不变、新列不新授权 |
| R-ID1 bigint 精度 | §1.3 R-ID1/2 | int8 字符串化、禁 parseInt |
| R11 共享副本漂移 | execution-contract H | person-service.js 三份哈希比对 |

## 限制声明

- **不触线上**：所有 R1–R10 用例使用内存 fixture，不调用云函数、不读写数据库。
- **不演练恢复**：R8 只验证"失败即停"契约，不执行实际回滚（无隔离环境）。
- **不预设通过**：R11 漂移即报，不预设三份一致；当前若三份一致是观察结果，不是回填期望。
- **不接入 release gate**：本目录测试失败不阻断 WP01 发布；WP01 仍按 `tests/wp01/README.md` 现有定义执行。
- **不新增种子**：复用 `tests/regression/fixtures.cjs` 已登记虚构样本（`【系统测试·勿联系】`）。

## 已知缺口（G-PMC03）

| # | 缺口 | 处置 |
| --- | --- | --- |
| G-PMC03-1 | WP01 门槛不含迁移核对项 | PMC-03 提供 `tools/migration-check.cjs` 作为补充证据，不接入 release gate |
| G-PMC03-2 | sync-shared.cjs 不追踪 person-service.js | PMC-03 提供漂移检测；扩展 MODULES 属 PMC-04+（单独授权） |
| G-PMC03-3 | 无隔离环境用于结构回滚/数据恢复演练 | PMC-03 仅提供 runbook，不执行演练 |
