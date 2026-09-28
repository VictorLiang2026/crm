# Person 360 保险概览（2026-09-29）

## 范围与事实

- 仅使用现有 `public.products`、`policy_review_reports`、`ocr_records`、`photos`、`opportunities`、`actions`，通过 `persons.legacy_customer_id` 关联旧客户。
- 线上修改前有效记录数：保单明细 0、检视报告 1、OCR 6、照片/附件 6、活跃保险机会 0、待办 Action 0。
- 不建保险新表，不改数据库权限或旧客户详情的保单检视页面、云函数。

## 实现与安全边界

- `person_360.getInsuranceContext` 先核验真实登录，服务端仅以 `GET` 和 `public` profile 读取白名单表。密钥只在函数环境中。
- 仅返回保单类别与录入金额、最近报告摘要、保险相关 OCR 摘要、关联附件元数据、保险机会与行动。照片正文、完整 OCR、报告原始模型输出不查询。
- “已记录需求”仅来自人工编辑的检视字段，仍提示与客户核实；未编辑的报告缺口独立标记为待核实。缺数据时显示未知状态，不自动推断无保障或保障充足。
- 保险机会既读 Person 关联也读旧 customer 关联，按 ID 去重。已关联统一 Action 的机会不重复展示旧 `next_action`。
- Person 360 新增六块只读区域，原客户保单检视页和入口保留。

## 验证与回滚

- 定向服务测试：13 通过，0 失败；覆盖匿名拦截、只读字段、去重和无旧客户关联。
- 全站隔离浏览器与后端回归：68 通过，0 失败，5 跳过；含登录、客户详情、保单检视、Person 360、跟进、机会、Today、漏斗、活动、增员、回收站。
- 线上真实测试账号只读调用 `person_360.get`、`listOpportunities`、`getInsuranceContext`：Person 存在、保险概览结构正确、无接口错误；未保存客户内容。未登录直调新接口返回 `UNAUTHORIZED`。
- 两个静态文件线上 SHA-256 与本地相同。
- 发布仅涉及 `person_360` 函数、`/crm/js/modules/person-360.js` 和 `/crm/css/person-360.css`。回滚按上一个发布标签重新部署这三个产物；无数据库回滚。
- 线上当前无活跃保单明细、保险机会或 Action，因此这些非空卡片只在隔离夹具中验证。
