# PC09 人际关系边维护与治理

日期：2026-10-15  
基线提交：`b58831a0a627d5932ae6855cf69914fa66e2a47c`（包含并行完成的人物招募标签更新）  
范围确认：用户明确确认了增加 1–5 重要性、service_role 预览/执行审计及已确认关系进入现有会前准备和搜索。

## 实施

- Person 新增“人际关系”页签；与家庭成员、客户/招募角色及关系衰减提示分开。
- 对端人物通过 `PersonService.resolveName()` 返回候选，人工作出选择。支持两个方向、关系类型、阶段、强度、重要性、待确认/已确认状态、来源、编辑、确认、解除和恢复。
- 所有写入先调用数据库服务端预览，再由用户确认后执行。新关系默认为 pending；只记录人工来源，AI 候选不得自动确认。
- `public.relationships.importance` 为可空 1–5；`public.crm_relationship_commands` 保存 before/preview/result、操作者、幂等键与执行时间。新增 RPC 仅 service_role 可执行，命令表 RLS + FORCE RLS 且仅 service_role 策略。
- Meeting Prep 保持只读取有效 confirmed 边，新增 importance 字段。现有固定搜索模板已经只使用有效 confirmed 边，SQL 模板和角色派生触发器未改。
- migration 与 rollback 成对；rollback 遇到已执行命令或已填 importance 会拒绝移除审计/数据。

## 发布产物

- CloudBase migration `20261015190000_relationship_lifecycle`：已应用，远端任务 `task-4d09c571b7bd4247` 状态 Succeed。
- Cloud Function：仅部署 `person_360`，共享副本核对为 58 份/29 个函数全一致。
- 静态托管仅上传 4 个文件：`data.js`、`i18n.js`、`pages/person.js`、新增 `relationship-actions.js`。MD5 与托管 ETag 一致；4 个线上文件 HEAD 均 HTTP 200。未上传 `admin.html`、CSS 或其他函数。

## 回归证据

- `npm run test:pc09`：7/7 通过。含双向边、候选身份核验、iPad 横竖屏、简中/英文、取消不执行/人工确认后执行、迁移契约和会前准备 importance。
- `npm run test:pc08`：12/12 通过；`npm run test:pc07`：11/11 通过；`npm run test:context-engine`：21/21 通过；`npm run test:modular` 通过。
- `npm run test:wp01`：releaseGate `PASS_WITH_LIMITATIONS`；目录 881 项检查无漂移，匿名探针 64/64，通过隔离旧路由 108 项、5 项历史跳过。
- 生产 function 调用以无会话触发 `listRelationships(Person 784)`，实际返回 `UNAUTHORIZED`，证明部署后的函数加载且匿名在数据库读取之前被拒绝；该动作未访问数据库、未写数据。
- 生产数据库只读核验：关系与命令表均 0 行；importance nullable smallint；命令表 RLS + FORCE RLS/service_role only；2 个新 RPC anon/authenticated EXECUTE=false、service_role=true。

## 未完成的线上人工验收

当前没有已登录生产 Console 会话，本包未对测试人物执行已确认边创建/编辑/确认/解除/恢复，也未验证其进入真实 AI 搜索/会前准备的内容。隔离浏览器使用服务 mock 完成确认门测试；不得将其描述为生产写入回归。上线后应由用户在标记为虚构测试人物的记录上完成至少一次完整生命周期，观察 AI 消费后再恢复/解除，并记下测试记录 ID。

## 当前发布状态

CloudBase migration、函数和静态产物已部署；Git 提交、发布标签和部署后三端 sync-check 由本次发布流程完成。最新主干的 People 页面与 `people_badge_recruit` 双语文案已纳入合并后的发布基线。真实登录后的关系生命周期及 AI 消费仍待人工验收。
