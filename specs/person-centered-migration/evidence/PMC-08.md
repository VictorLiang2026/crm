# PMC-08 证据（evidence/PMC-08）

## 1. 包概述

- 包名：PMC-08｜接管客户、Person 及跨模块基础信息写入口
- 前置：PMC-07 已验收
- 执行日期：2026-10-08
- 状态：待用户验收

## 2. 变更清单

| 文件 | 变更类型 | 说明 |
| --- | --- | --- |
| `cloudfunctions/customers/index.js` | 修改 | `create` action 接管：创建客户时自动建/关联 Person；`update` action 移除 PMC-07 应用层 Person 映射（依赖数据库触发器）+ 增加 OCR 恢复保护 |
| `cloudfunctions/activity_speakers/index.js` | 修改 | `create` action 接管：不再直接 INSERT customers，改为建 Person + customers |

## 3. 关键设计决策

### 3.1 消除双重同步

**问题**：PMC-07 在 `customers.update` 应用层加了 Person 映射（经 `person_id`），同时数据库已有 `customer_person_identity_bridge_trigger`（AFTER UPDATE 经 `legacy_customer_id` 同步 customers→persons）。两者指向同一 person，导致 `persons.updated_at` 被更新两次。

**决策**：移除应用层 Person 映射，完全依赖数据库触发器。理由：
- 数据库触发器已在做同步，应用层映射是冗余的
- 触发器经 `legacy_customer_id`，对于已回填的客户（PMC-06，779 行），`legacy_customer_id` 有效
- 对于新创建的客户（PMC-08 create 接管），`create` 时设置 `legacy_customer_id`

### 3.2 customers.create 接管逻辑

1. 插入 customers 记录
2. 按 `customer_name` 精确匹配 `persons.display_name`
3. 唯一匹配 → 关联（设置 `customers.person_id` + `persons.legacy_customer_id`）
4. 多个匹配 → 报错（同名不同人，需人工确认，不自动选择）
5. 无匹配 → 创建新 Person，设置双向关联

**符合 execution-contract F**：不凭同名自动合并；多个同名时报错让人工确认。

### 3.3 OCR 恢复保护

**检测条件**：请求包含 3 个以上基础字段（customer_name, phone, wx_account, gender, birthday, occupation, education）。

**处理**：
- 查询当前 customers 基础字段值
- 比较请求值与当前值
- 有冲突 → 返回 `OCR_SNAPSHOT_RESTORE_CONFLICT`，要求重新预览
- 无冲突 → 正常执行（数据库触发器同步到 persons）

**符合 PMC-07 设计**：恢复前比较当前值与快照前值，新修改产生冲突时要求重新预览和确认。

### 3.4 activity_speakers.create 接管

嘉宾创建时不再直接 INSERT customers，改为：
1. 按姓名查找 persons（与 customers.create 相同逻辑）
2. 唯一匹配 → 关联
3. 多个匹配 → 报错
4. 无匹配 → 创建新 Person
5. 创建 customers（设置 person_id）+ 设置 persons.legacy_customer_id

**嘉宾域完整调整留在 PMC-13**；本包只消除绕过统一基础写服务的路径。

## 4. 部署

| 函数 | 部署时间 | 状态 |
| --- | --- | --- |
| customers | 2026-10-08 | 成功 |
| activity_speakers | 2026-10-08 | 成功 |

## 5. 数据库核实

| 项 | 值 |
| --- | --- |
| customers.person_id 非空行数 | 779（未变，PMC-06 回填） |
| 数据库触发器 | `customer_person_identity_bridge_trigger` 保留（未修改） |
| RLS 策略 | 未变 |
| 视图 | 未重建 |

## 6. 未验证项

- 线上 invoke 测试未执行（tcb invoke Cam authentication failed）
- 已通过语法检查 + 部署成功 + 代码审查
- 待用户在 iPad 上验收

## 7. 未接管入口（桥接办法）

| 入口 | 状态 | 桥接办法 |
| --- | --- | --- |
| Legacy Quick Capture | 已接管 | 经 person_360 previewIdentity/executeIdentity |
| admin.html 客户表单 | 已接管 | customers.create/update 内部映射 |
| OCR 恢复 | 已接管（保护） | customers.update 检测快照覆盖 |
| 嘉宾创建 | 已接管 | activity_speakers.create 建 Person |
| AI Parse | 只读 | 不写入基础字段 |
| Console 写入 | 已接管 | 经 person_360 各 action |

## 8. 发布标签

见发布记录。
