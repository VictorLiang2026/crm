# 人物跟进建议实施任务

状态：实现、CloudBase 部署、GitHub 发布与云端一致性核对均已完成。每项对应 `requirements.md` 同编号或范围。

- [x] 1. 复核发布基线与线上 `public` 数据结构、权限、迁移台账；确认当前 dirty diff 归属和 GitHub master 最新提交。
  - 不清理或覆盖既有 Skill 文档修改。
  - _Requirement: 全部_
- [x] 2. 准备配对建议数据结构及 migration/rollback（仅在 public），加入版本、来源和软删除/审计字段。
  - _Requirement: 1, 5, 6, 7_
- [x] 3. 扩展 assistant 服务和 Gateway 合约，生成 CloudBase 单套两段式系统建议；加入 GPT 任务包读取、Preview、确认写回、版本冲突和幂等处理。
  - _Requirement: 2, 3, 4, 5, 6_
- [x] 4. 改造 Console 人物建议模块为配对列表、iPad 比较详情及 CRUD；增加跨人物 GPT 待处理任务包入口，完整双语化。
  - _Requirement: 8, 9_
- [x] 5. 保留旧 URL/历史和 `ai_recommendations` 行为；记录旧候选历史的查看路径。
  - _Requirement: 10_
- [x] 6. 执行语法检查、针对性业务回归及要求的跨模块 regression，整理发布记录和恢复方案。
  - _Requirement: 全部_
- [x] 7. 按项目发布顺序部署明确产物，提交推送、打标签并核对本地/GitHub/CloudBase 一致。
  - _Requirement: 全部_
