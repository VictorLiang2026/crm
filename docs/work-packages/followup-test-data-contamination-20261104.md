# 跟进建议测试数据污染修复

日期：2026-11-04

## 变更

- CloudBase 跟进建议生成前核验实际选中的知识来源。测试数据命中或 provenance 核验失败时，在调用模型前拒绝生成。
- CloudBase 输出和 GPT 补充预览若含明确虚构测试标记，不写入跟进建议。
- 恢复 `crm_test_main_v1` 下 `knowledge_items#3` 到测试人物 `persons#783` 的测试登记关系。该知识内容保留，但后续被识别为测试来源。
- 对 Person 800 的污染建议 `person_followup_advice#3` 进行软删除，记录仍可恢复。

## 影响范围

- 仅影响人物跟进建议生成和 GPT 补充预览；未改变其他 AI 工作流、页面、接口、字段或权限。
- 不涉及 schema 变更；所有数据操作限定 `public` schema。
- 被测试来源污染的生成会进入失败状态，不会作为有效建议保存。测试登记服务不可用时同样拒绝生成。

## 验证

- `node --check`：assistant service 与入口通过。
- `node --test tests/knowledge-library/followup-advice-service.test.cjs`：18/18 通过。
- `npm run test:knowledge-library`：86/86 通过。
- `npm run test:wp01`：15/15 通过。
- 计费核对更正（2026-11-04）：生产环境为个人版，`BillingInfo.EnvDeductionMode=credits`，使用套餐资源点抵扣 AI Token。旧式 Token Credits 包列表为空不代表 AI 不可用；之前据此判断额度不足是错误的。`public` 数据库查询工具角色不能直接执行受限的 `crm_test_disclosure_v1`，已用测试登记表直接读回核实恢复的关系。
- 模型配置核对：`cloudbase` 托管组启用 `hy3`，跟进建议函数 `AI_GATEWAY_MODEL` 已配置为 `hy3`，与启用模型一致。通过生产 `ai_parse` 的 Quick Capture V2 只读入口提交虚构文本，实际 AI 调用成功返回预览；该入口不选择人物、不写 CRM 业务数据。Token 用量报表按周期汇总且可能延迟，未把累计用量误认为本次请求的单次扣费。
- 生产跟进建议行软删除已通过只读查询确认。部署 `assistant` 函数后，CloudBase 源码核对通过：30 个函数的 243 个源码/配置文件与本地一致，96 个静态资源与线上一致。
- 首次核对发现既有 `knowledge_mcp/scf_bootstrap` 仅有 CRLF/LF 差异。发布检查器原先未将无扩展名启动脚本按文本规范化，已针对该文件补充换行比较，未改动或重新部署该函数。
- `assistant` 只读调用验证因云函数管理端不携带登录态返回 `UNAUTHORIZED`，因此跟进建议专属接口仍需通过真实登录会话做最终页面/API 冒烟；没有注入登录身份或写入生产业务数据。

## 回滚

- 代码回滚：按项目恢复流程从发布标签重新部署 `assistant`，创建恢复提交，不强推。
- 数据回滚：如需恢复误删建议，仅在确认业务需要后将 `public.person_followup_advice.id=3 AND person_id=800` 的 `deleted_at` 置空；如需撤销测试登记，仅删除 `public.crm_test_records` 中 `batch_key='crm_test_main_v1' AND record_table='knowledge_items' AND record_id='3'` 的新增关系。两项均为独立、可逆的数据操作。
