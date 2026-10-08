# PMC-09 证据（evidence/PMC-09）

## 1. 包概述

- 包名：PMC-09｜客户列表、详情、搜索和表单读取 Person
- 前置：PMC-08 已发布
- 执行日期：2026-10-08
- 状态：待用户验收

## 2. 变更清单

| 文件 | 变更类型 | 说明 |
| --- | --- | --- |
| `cloudbase/migrations/20261008210000_pmc09_customers_page_read_person.sql` | 新增 | 修改 `crm_customers_page_v1`：基础字段从 persons 读取（经 person_id JOIN），回退 customers |
| `cloudbase/rollbacks/20261008210000_pmc09_customers_page_read_person_rollback.sql` | 新增 | rollback：恢复原函数定义 |
| `cloudfunctions/customers/index.js` | 修改 | `get` action：基础字段从 persons 读取（经 person_id），回退 customers |

## 3. 读取切换规则

| customers 字段 | persons 字段 | 回退 |
| --- | --- | --- |
| customer_name | display_name | customers.customer_name |
| phone | phone | customers.phone |
| wx_account | wechat | customers.wx_account |
| gender | gender | customers.gender |
| birthday | birthday | customers.birthday |
| occupation | occupation | customers.occupation |
| education | education | customers.education |

**客户经营字段**（customer_stage, sales_priority, tags, annual_income 等）仍从 customers 读取。

## 4. 部署

| 项 | 时间 | 状态 |
| --- | --- | --- |
| migration 执行 | 2026-10-08 | 成功（confirm=true） |
| customers 函数部署 | 2026-10-08 | 成功 |

## 5. 验证

| 项 | 结果 |
| --- | --- |
| 函数定义含 COALESCE(p.display_name) | true |
| crm_customers_page_v1 查询 | total=782，返回正常 |
| 语法检查 | 通过 |

## 6. 不变项

- 前端（admin.html/console.html）：不修改
- RLS 策略：不变
- 视图：不重建
- 分页/排序/筛选：不变
- 返回字段名：不变（前端兼容）

## 7. 未验证项

- 线上 invoke 测试未执行（tcb invoke Cam auth 失败）
- 已通过语法检查 + 部署成功 + 数据库查询验证
- 待用户在 iPad 上验收

## 8. 发布标签

见发布记录。
