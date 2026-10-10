# PMC-18：真实运行观察与一致性复核

状态：**观察中**（2026-10-10 开包，观察周期 90 天，终点 2026-01-08；结束条件=周期到期+用户审阅）。本包不删除字段、不自动扩大到新功能。

---

## 0. 观察周期与范围（用户已批准）

| 项 | 值 |
| --- | --- |
| 观察周期 | **90 天**（用户 2026-10-10 确认） |
| 起点 | 2026-10-10（T0 基线） |
| 终点 | 2026-01-08 |
| 结束条件 | 周期到期 + 用户审阅是否满足物理清理条件 |
| 监测方式 | 定时自动监测 + 通知（用户选择；具体方案待确认） |
| 不做 | 不删除字段、不自动扩大到新功能、不顺手重构 |

## 1. 观察项清单

| 类别 | 指标 | T0 基线（2026-10-10） | 阈值/期望 |
| --- | --- | --- | --- |
| 身份新增遗漏 | customers 无 person_id（活跃） | 0 / 782 | =0 |
| 身份新增遗漏 | recruit 无 person_id（活跃） | 0 / 15 | =0 |
| 身份新增遗漏 | persons 无角色（非测试） | 1（测试数据 id=787） | 0 业务遗漏 |
| 字段漂移 | customers 基础 7 字段 vs persons 不一致 | 0 行 | =0 |
| 旧字段写入 | customers 基础字段被直接修改迹象 | T0 无审计触发器，待方案确认 | 无裸写 |
| 旧接口调用 | 云函数日志中旧接口调用 | 待日志分析 | 无 |
| 同步失败 | 桥触发器执行失败 | 待方案确认 | 0 |
| 重复人物 | persons 同名+同手机号 | 0 组 | =0 |
| 孤立引用 | 各业务表 person_id 孤儿 | 全 0 | =0 |
| 权限拒绝异常 | 云函数日志 permission denied | 待日志分析 | 无异常 |
| 查询性能 | 列表/搜索/统计/招募中位 | 16/16/32/10 ms | ±20% PMC-17 基线 |
| 统计差异 | v_action_center / v_funnel_stats | 待首次定时采集 | 无异常 |
| OCR 恢复 | ocr_records 状态 | 6 条（列名待确认） | 无失败 |
| 跨角色编辑 | 同 Person 多角色编辑一致性 | 待日志分析 | 无冲突 |

## 2. T0 基线证据

### 2.1 migration-check（tools/migration-check.sql）

- counts: persons 787 (3 softDeleted), customers 783 (1 softDeleted), recruit_candidates 18 (3 softDeleted), activity_participants 19 (15 softDeleted), opportunities 9 (6 softDeleted), activity_speakers 11 (7 softDeleted), relationships 0
- mappings: legacy_matched=782, customers_without_person=0
- orphans: 全 0（gift/photo/recruit/product/followup/interaction/opportunity/participant 无孤儿）
- roles: duplicate_role_rows=0
- softdelete_cross: person_alive_customer_deleted=0, person_deleted_customer_alive=0
- nulls: persons_phone=785（Person 不必填电话，正常）, persons_display_name=0, customers_customer_name=0

### 2.2 补充观察（D:\Temp\pmc18-t0-extra.sql）

- person_id_mapping: active_customers=782, with_person_id=782, without=0
- field_drift: drift_rows=0
- duplicate_persons: dup_groups=0
- persons_without_role: no_role=1（id=787「【系统测试·勿联系】王小明」，测试数据）
- recruit_mapping: active=15, without_person=0
- ocr_status: total=6

### 2.3 WP04 身份审计（tests/wp04/audit.cjs）

- status=PASS_WITH_EXCEPTIONS, failures=0
- customers: 782/782 映射, exceptions=0
- participants: 4 active, 1 mapped, 3 exceptions（既有白名单）
- recruits: 15/15 映射, exceptions=0
- speakers: 4/4 映射, exceptions=0

### 2.4 性能基线（D:\Temp\pmc17-perf-run.cjs，×5 取中位）

| 入口 | T0 中位 | PMC-17 基线 | 变化 |
| --- | --- | --- | --- |
| list_customers_page | 16 ms | 17 ms | -6% |
| search_people_template | 16 ms | 22 ms | -27% |
| stats_funnel_view | 32 ms | 37 ms | -14% |
| list_recruit_view | 10 ms | 13 ms | -23% |

无性能退化（均在 ±20% 阈值内或更优）。

## 3. 定时自动监测方案（待用户确认）

用户选择「定时自动监测+通知」。方案如下，需确认后实施：

### 3.1 新增对象

| 对象 | 类型 | 说明 |
| --- | --- | --- |
| `pmc18_observations` 表 | 新增表 | 仅存元数据：observed_at, metric, value, level(info/warning/critical), detail。无 PII |
| `pmc18_observer` 云函数 | 新增函数 | 只读：复用 migration-check.sql + 补充查询逻辑，采集计数并写入 pmc18_observations |
| 定时触发器 | 新增触发器 | 每天 02:00 调用 pmc18_observer |

### 3.2 采集指标（仅元数据，不含个人资料）

- 身份映射率（customers/recruit/speakers/participants 的 mapped/active）
- 孤儿引用计数（各业务表 person_id 孤儿）
- 字段漂移行数（customers 基础 7 字段 vs persons）
- 重复人物组数（同名+同手机号）
- 性能中位（4 入口）
- 软删跨表不一致计数

### 3.3 通知方式（待选择）

- **方案 A（推荐）**：异常项写入 pmc18_observations 表 + 提供只读 action `listRecentObservations` 供 Console/Legacy 查看；无主动推送
- **方案 B**：方案 A + 企业微信 webhook 主动推送（需用户提供 webhook URL）

### 3.4 影响与约束

- 不改任何现有业务逻辑、不删除任何字段、不修改现有表结构
- 新增表和云函数均为只读观测用途
- 定时触发器每天 02:00 执行，不影响业务高峰
- 失败回滚：DROP TABLE pmc18_observations + 删除云函数 + 删除触发器

### 3.5 人工执行方法（未授权自动化时的备选）

```bash
# 基线核对
node tools/tcb-exec.cjs --file tools/migration-check.sql
node tools/tcb-exec.cjs --file D:\Temp\pmc18-t0-extra.sql
# 性能探针
node D:\Temp\pmc17-perf-run.cjs
# 身份审计
node D:\Temp\pmc17-wp01-capture.cjs && node -e "require('./tests/wp04/audit.cjs').evaluate(...)"
```

## 4. 异常记录

| 日期 | 指标 | 实测 | 严重程度 | 处理 |
| --- | --- | --- | --- | --- |
| 2026-10-10 | persons_without_role | 1（测试数据） | info | 确认为「【系统测试·勿联系】王小明」，非业务遗漏 |

## 5. 剩余风险

- 旧字段写入（customers 基础字段裸写）目前无审计触发器，无法自动检测；需方案确认后决定是否加审计触发器
- OCR 恢复状态列名待确认（restored_at 不存在），需查 ocr_records 表结构
- 旧接口调用、同步失败、权限拒绝异常需分析云函数日志，尚未建立日志采集机制
- 统计差异（v_action_center / v_funnel_stats）待首次定时采集

## 6. 验收

- 批准的观察周期（90 天）实际完成
- 关键异常已处理并验证
- 用户可审阅是否满足物理清理条件
- 周期未完成时状态保持「观察中」，不得进入 PMC-20
