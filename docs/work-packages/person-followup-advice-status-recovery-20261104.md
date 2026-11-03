# 跟进建议生成状态恢复修复（2026-11-04）

## 问题与原因

跟进建议已进入后台生成并返回任务号后，前端通过 `assistant.aiTaskStatus` 轮询。该入口的任务类型白名单漏掉 `person_followup_advice`，导致轮询返回 `INVALID_INPUT`，页面误报“生成失败”。后台 AI 仍继续运行，因此刷新后会先看到“生成中”，稍后再看到已完成结果。

## 改动范围

- `assistant` 状态路由接入跟进建议已有的状态处理器。
- 增加慢启动恢复：前端暂时没有拿到任务号时，服务端按 `public.ai_tasks` 中的任务类型、人物和启动时间查找本次任务；任务创建前保持 pending。
- 未改动模型、提示词、客户资料、建议持久化和其他任务状态处理。

## 验证

- `tests/pc33/ai-async-response.test.cjs` 与 `tests/knowledge-library/followup-advice-service.test.cjs`：18 项通过。
- `npm run test:knowledge-library`：80 项通过。
- `npm run test:wp01`：PASS_WITH_LIMITATIONS；权限快照与隔离回归通过，需人工登录、service runtime、生产写入和移动端仍按既有约定列为未验证。
- CloudBase 实际只读调用 `assistant.aiTaskStatus`，使用虚构 Person ID 和当前启动时间，返回 `pending` 与空任务号，验证部署后的新状态路由。
- CloudBase 源码核对：30 个 CRM 函数、243 个源码/配置文件与仓库一致；96 个页面资源一致。

## 部署与回滚

- 仅部署 `assistant` 云函数；未修改数据库、前端静态资源、权限或业务记录。
- 回滚时恢复到本标签的父提交，并只重新部署 `assistant` 函数。

## 未验证

未对真实人物触发 AI 生成；本次回归使用隔离替身与虚构 Person ID。真实登录证据、service runtime 写探针、生产写入和移动端验收继续保持未验证。
