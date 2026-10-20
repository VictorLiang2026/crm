# PC36 E12：只读助手回执契约修复

2026-10-21，生产 Console 的“AI 助手 · 只读任务”在虚构 Person #784 的摘要请求上显示通用失败。只读审计显示 `public.ai_tasks#68` / `public.ai_results#55` 已成功把请求识别为 `summarize`，`assistant` 云函数也返回唯一人物候选 #784 和 `needs_person_selection`；摘要执行器尚未运行，回执明确 `businessDataWritten=false`。Console 只接受 `ok === true` 的正常回执，但 PC25 `runReadIntent` 的正常返回缺少 `ok`，因此页面把成功的人物选择回执当作失败。原有浏览器夹具自行填入了 `ok:true`，服务测试只核对状态，两侧没有验证同一契约。

本轮经用户具体确认，仅在 `cloudfunctions/assistant/read-intent-service.js` 为正常回执补 `ok:true`，并在 PC25 服务及页面契约测试中固定这一要求。意图分类、服务端重新解析人物、人工选定身份、只读执行器、认证门禁和其他 `assistant` 路由不变；不改数据库、权限或静态页面。异常仍由原入口返回 `ok:false`，不伪装成功。影响范围是 Console AI 页的 PC25 只读任务正常状态；旧搜索、摘要、会前准备、Action/Opportunity 命令和招募删除均应保留原行为。

改动前基线：本地与 GitHub `master` 均为 `d3fdf66be36e3b066dc9e99543ad36d77e6ff788`，回滚标签为 `release-20261020-183432`；完整 `tools/sync-check.ps1` 通过，75 个可达静态资源及 29 个云函数的 202 个源码/配置文件与云端一致。无 CloudBase 漂移。

本轮验证：三个改动文件语法检查和 `git diff --check` 通过；PC25 23/23、PC24 21/21、PC26 19/19、PC27 20/20、PC28 21/21；旧功能隔离回归 `npm test` 为 108 PASS / 0 FAIL / 5 既定 SKIP。CloudBase 代码审查核对新增字段不含凭据、登录或权限变化，匿名拒绝与旧路由由 PC25/PC26/PC28 夹具覆盖。隔离测试不能替代生产真人选择与摘要生成。

发布仅上传 `assistant` 云函数；不部署静态页面或其他函数。上传回执为 `Code updated`，云端 `assistant` 源码比对通过。用户随后在生产 Console 的第一张“AI 助手 · 只读任务”卡片亲自选择虚构 Person #784，确认显示摘要、`public` 来源和“只读完成”。只读审计显示两次意图解析任务 #70/#71 已完成，人物摘要任务 #72 和结果 #59 均完成；生成上下文只引用 `public.persons#784` 与 `public.interactions#23`。结果未被标记为人工采纳；Person #784 在此期间没有新增 Action（仍为 1 条），Opportunity 仍为 0，AI 任务 #72 和结果 #59 自动登记为“勿联系”虚构衍生审计行。本次生产验收证明页面与服务端正常回执已对接，且该请求未直接创建 Action 或 Opportunity；不推断摘要内容的业务准确性。

用户曾把同一句“总结”输入第二张“AI CRM 搜索”卡片，产生搜索任务 #69／结果 #56。该搜索卡现有页面会直接展示原始证据 JSON，并出现未翻译键 `search_v2_condition_followupMonths`；用户反馈阅读困难。该问题涉及 PC24 现有搜索结果呈现，已单独记录，未纳入本轮获准的 PC25 接口修复，也不影响上述第一张卡片的验收结论。

若需恢复代码，基于上述标签形成恢复提交并仅重新部署 `assistant`；数据库及业务数据无须回滚。E12 的自然语言 Action 与 Opportunity 更新、关闭及拒绝分支尚待单独验收，不能由本轮只读摘要结果替代。

首次运行发布脚本时，代码提交 `d3854a2` 与标签 `release-20261021-005530` 已推送，但该新建文档未显式暂存；脚本的发布后核对因此拒绝完成。该标签仅标识已上传的代码，不作为本工作包完成标签。文档须显式加入提交，再用新的发布标签完成三端核对；不移动或覆盖已推送标签。
