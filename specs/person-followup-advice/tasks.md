# 人物跟进建议改造任务

状态：业务代码、CloudBase 部署、GitHub 发布和三端一致性复核完成。

- [x] 1. 复核当前 UI、服务端生成/编辑/删除和线上 `public` 表结构；确认表无业务行。
  - _Requirement: 全部_
- [x] 2. 收敛验收规则：系统 AI 一键生成；GPT SKILL 尚未接入；双侧标题和编辑/删除彼此独立。
  - _Requirement: 1–8_
- [x] 3. 准备标题增量 migration/rollback，并保留旧 title 字段和软删除流程。
  - _Requirement: 2, 3, 7_
- [x] 4. 更新 CloudBase Skill 输入契约；生成时不要求人工标题/关注点；新增 lane 独立更新分支，兼容旧 paired-update 接口。
  - _Requirement: 2–5_
- [x] 5. 改 Console 人物建议页为一键生成、两栏各自编辑/删除、GPT SKILL 空态；旧任务包路由不再显示手工导入 UI。
  - _Requirement: 1–8_
- [x] 6. 完成回归与发布门槛。
  - 改动文件语法检查通过；跟进建议服务端 3/3、隔离浏览器/iPad 1/1、AI skills 11/11、AI Gateway 18/18、PC08 13/13 通过。
  - 知识库完整套件串行执行 68/68 通过；PDF 分卷测试已校正为当前线上实际 30 页分卷，没有修改 PDF 上传业务代码。
  - WP01：目录 1,239 项通过，匿名只读探针 81/81，WP04 身份审计通过（保留 3 条已声明例外），综合回归 108 通过 / 0 失败 / 5 跳过。
  - WP01 状态 `PASS_WITH_LIMITATIONS`；登录、service-role 写入、线上业务写入/AI 生成和移动端仍未验证。
  - _Requirement: 全部_
- [x] 7. 部署明确文件。
  - `20261101090000` migration 已应用并核对台账/字段；迁移与 rollback 已在两个本地位置镜像。
  - `assistant` 已部署并做无登录、无写入的拒绝响应探测；仅上传 3 个明确页面资源。
  - CloudBase 复核通过：96 个页面资源、30 个函数、243 个源码/配置文件一致。
  - _Requirement: 全部_
- [x] 8. 完成 GitHub 发布并复核 GitHub / CloudBase / 本地一致。
  - 按 `tools/release.ps1` 从 `master` 原子提交并推送发布标签。
  - _Requirement: 全部_
