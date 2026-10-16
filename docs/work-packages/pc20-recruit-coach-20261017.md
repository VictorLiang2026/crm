# PC20 招募教练与可追溯跟进结果

日期：2026-10-17。基于 PC19 的 Person 候选人流程实施。只读使用候选人档案和最近最多 20 条招募跟进；不读客户数据，不更新旧评分或候选人阶段。

## 交付

- 新增 `recruit_coach` Skill 2.0，通过既有 AI Gateway 和 CloudBase 已配置模型生成六维建议：行业资源 25%、学习能力 15%、抗挫力 20%、沟通表达 15%、创业动机 15%、文化契合 10%。模型选择与 CloudBase 配置一致。
- 输出引用服务端白名单内的虚构/业务记录来源；证据不足的维度保持未评分，整体标记不确定。旧 `recruit_score`、`recruit_recommend` 和旧评分展示保持原样。
- Person 360 显示建议版本、分项理由、证据来源、联系假设、澄清问题、禁用措辞与下一步。人工接受、修改后接受、拒绝或暂缓后才可进入后续动作。
- 接受后复用现有 Action 服务端预览/确认；实际跟进结果独立经过服务端预览、哈希确认、执行，写入 `public.outcomes`，关联 `ai_result_id` 与可选的同一 Person Action。
- 新界面简体中文/英文、iPad 优先。无手机适配验收。

## 数据库与安全

- 迁移 `20261017100000_recruit_coach_outcomes` 已应用；最新迁移版本核验为 `20261017100000`。
- 新增 nullable `public.outcomes.ai_result_id`、受 RLS FORCE 保护的 service-only 命令表和 `public.crm_recruit_coach_outcome_v1` 预览/确认/执行 RPC；全限定 `public`，仅 service role 可访问。回滚文件会在存在已关联 Outcome 或已执行命令时拒绝破坏性回滚。
- 迁移后结构读取确认 AI 结果外键、索引、命令表与 RLS 策略存在；命令表当前无记录。未对真实客户或真实候选人写入数据。
- 现有 AI 数据仍走服务端，浏览器没有 API key 或数据库直连。拒绝/暂缓只记 AI 结果人工选择状态；不会改评分、阶段或候选人档案。

## 回归

- `npm run test:pc20`：5/5 通过，含合成候选人从建议、人工接受、Action 服务端预览确认到 Outcome 预览确认的浏览器闭环。
- `npm run test:pc19`：10/10 通过，覆盖候选人创建、Person 360 档案/阶段/跟进与附件失败路径。
- `npm run test:pc23`：14/14 通过；`npm run test:ai-gateway`：14/14 通过；Skill Registry：8/8 通过；`test:modular` 与 `check:shared` 通过。
- WP01 完整发布回归：108 项通过、0 失败、5 项既定跳过；WP04 身份审计保留 3 条已登记未确认参与者例外；目录核验 933 项无差异；匿名探针 66/66；`PASS_WITH_LIMITATIONS`、无阻断项。
- `npm run check:release-gate`：PASS。开放项为真实登录、service-role 运行时、生产业务写入与移动设备验收。

## 发布状态

- 数据库：migration `20261017100000_recruit_coach_outcomes` 已应用并核验。
- 云函数：仅部署 `assistant`、`person_360`，CLI 均返回 `Code updated`。
- 静态托管：仅上传 `/crm/js/modules/console/data.js`、`i18n.js`、`recruit-write.js`、`write.js`，4/4 成功。
- 部署后 CloudOnly 核对通过：`admin.html` SHA-256 一致；66 个可达静态资源一致；29 个函数的 188 个源码/配置文件一致。
- GitHub 提交与标签通过 `tools/release.ps1` 发布；提交号、标签与发布后完整三端核对结果见最终发布回报。

## 尚未验证

- 本地浏览器合成数据测试不调用生产 AI 模型；尚未通过生产登录态做真实模型调用与真实 service-role 函数调用。
- CloudBase MCP 的 `invokeFunction` 返回 `Cam authentication failed`，因此未执行生产函数运行探针；两个函数部署回执及云端源码比对均通过。
- 未向真实人物写入 Action 或 Outcome；Outcome 的生产写入由隔离浏览器 mock 覆盖。
- 需要用具备登录权限的账号做线上界面人工操作验收。
