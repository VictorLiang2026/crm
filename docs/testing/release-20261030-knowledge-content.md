# 知识库双套内容版本（2026-10-30）

## 本轮范围

按用户最新确认，GPT 在 ChatGPT 中人工处理，结果粘贴回本系统。没有增加 GPT API、密钥、模型厂商绑定、外部知识库同步或自动生成 Skill。系统重新生成继续使用既有 AI Gateway 和 OCR 通道。

知识库增加 GPT原文 / GPT摘要预览列。进入“内容版本”可编辑系统/GPT 原文与摘要、清空单字段或整套、预览恢复最近 20 次确认变更之前的内容、选择一套完整且经过人工核对的内容供后续 AI 使用。默认仍采用系统内容。保存与采用分开，所有内容写入经过服务端预览和明确确认。

GPT 新字段只能补到已有实际系统原文与摘要的记录上；列表里的正文截取不算系统摘要。已有 GPT 内容可继续编辑，不自动重填被清空字段。未选内容不进入推荐检索和提示词。

系统原文/摘要重新生成在现有 `assistant` OCR timer 中排队：附件提取、PDF 分批 OCR、摘要、候选预览分别推进。扫描 PDF 每批最多 3 页，继承原有 40 页、30 MB 限制；不带附件的文字记录可编辑原文并重新生成摘要。识别成功而摘要失败时保留识别结果，使用“继续 / 重新预览”继续。关闭面板后可重新打开查看最近任务；“刷新进度”读取服务端状态。生成完成仍须查看、核对、保存，不自动覆盖。

## 数据与兼容

- 只修改 `public.knowledge_items` / `public.playbooks`，增加 `gpt_original_text`、`gpt_summary`、`selected_content_source`、`content_state`。
- 原 `content` / `response_logic` 的非空约束保持；系统内容的编辑与清空保存为版本覆盖值，显式空值不会回退到旧正文。旧字段是兼容基线，不可直接拿来拼新 AI 上下文。
- 新 `public.knowledge_content_commands` 保存与身份绑定的预览、确认历史和重生成进度，仅服务角色 SELECT/INSERT/UPDATE，强制 RLS；anon/authenticated 无权限。两个新 RPC 也仅限服务角色。
- 预览 15 分钟失效；确认时锁定记录，复查原状态、更新时间和附件指纹；并发变更拒绝执行；重复确认幂等。客户端不能调用队列 claim/progress。
- 选中内容不完整、未复核、附件版本变化或记录无效时暂停引用。不会自动拼接另一套字段。历史 AI 结果保留原快照及引用版本。
- 未启用内容管理的旧记录继续原有编辑/新建流程。启用后原编辑页仍可改标题、类别等元数据；正文和摘要只读，并链接“内容版本”。后端拒绝通过旧接口覆盖已管理的内容。结构化话术的澄清问题、禁用表达等保留。
- 共享解析器用于双份跟进建议、会面准备、异议话术/证据上下文。`_shared/knowledge-content.js` 在 assistant 和 person_360 各有副本，发布前检查一致。
- 本轮未修改或删除已有表、视图、路由或云函数；未改登录、客户、跟进、活动、招募、回收站数据语义。只按 iPad 验收新界面，中英文通过 i18n。

## 基线与发布清单

执行目录：`D:/CRM/crm-knowledge-content`，基线 `ae18dafb6d967386dc56b24ddf1bf473e54e7525`。原工作目录有用户未提交工作，未覆盖；CloudBase MCP 自动落盘的新迁移文件也同步在原目录，均为本轮新增文件。

基线云端核对：91 个前端资源、29 个函数 / 228 个源码配置文件一致；证据 `D:/Temp/crm-cloud-audit-74b10a070f3e4aa7ae570c1a19099001`。

迁移与对应 rollback：

1. `20261030090000_knowledge_content_versions`：新增字段与 RPC。首次语法错误已完整回滚后修正。
2. `20261030124000_knowledge_content_resume`：面板恢复最近后台任务。
3. `20261030130000_knowledge_content_acl`：收紧环境默认继承的服务角色全权限，仅保留 SELECT/INSERT/UPDATE。
4. `20261030132000_knowledge_content_real_summary`：话术正文不再作为实际系统摘要，补充 GPT 内容只检查真正保存的摘要。

MCP apply 返回任务成功后，历史自动核验出现 `MIGRATION_NOT_APPLIED` 误报。逐个 `migrationDetail` 已找到对应版本，SQL 核对了实际字段、函数定义及权限；不通过重复执行或 repair 伪造成功。副本位于 `C:/Users/victor/cloudbase/migrations`。基表没有依赖的 public 业务视图，不需要重建。

仅发布云函数 `assistant`、`person_360`，保持运行时、环境变量、timer 和模型配置。前端仅发布：

- `crm/css/console.css`
- `crm/js/modules/console/i18n.js`
- `crm/js/modules/console/knowledge-governance.js`
- `crm/js/modules/console/knowledge-pages.js`
- `crm/js/modules/console/knowledge-content.js`

## 验证记录

- 67 项 Node 服务与相邻功能测试通过：知识库上传/摘要、PDF/OCR、双份建议、会面准备、治理、话术以及新增内容版本、元数据兼容和 OCR 分批恢复。
- 3 项中英文 iPad/知识库浏览器测试通过；另有双份建议浏览器测试通过。检查 820×1180、1180×820 列表布局和 1024×768 内容面板、预览后确认、XSS 文本显示、旧 CRUD 路径。
- 合成 SQL 事务覆盖默认来源、只预览不写入、身份隔离、重复确认、选用 GPT、单字段清空、并发预览失效、恢复、系统整套清空、队列恢复、缺系统摘要拒绝补 GPT。最后 ROLLBACK；再次核对测试条目和命令残留均为 0，不使用真实客户数据。
- CloudBase 代码审查：复用现有已登录身份；新状态 RPC 服务角色隔离，身份由云函数注入；不回显 headers、环境变量、私有文件内容或凭据；新增表存在且 RLS 完整，原上传配置不变。
- 最终 WP01（2026-10-30T04:45:34Z）为 PASS_WITH_LIMITATIONS：1184 项目录/角色检查通过，108 项业务回归 PASS、0 FAIL、5 项历史预设 SKIP；身份、匿名访问与 PC34 等关键门槛均通过。
- 线上 assistant 新内容接口和 person_360 会面接口均拒绝未登录请求（请求号 `ed578156-b36e-401d-926d-66a9ea3914c1`、`05bc143c-3782-4664-bef1-58a042632c28`）。既有 timer 能访问新队列并返回 `ok:true,processed:false`（请求号 `688d898b-3b91-4b2e-ac7a-878e886d2c69`）；该 smoke 未调用模型、未写业务记录。
- assistant/person_360 针对性部署通过，5/5 静态文件上传成功。Git 发布及前后完整源码核对日志：`D:/Temp/kc-release.log`；发布标签 `release-20261030-124801`。以日志末尾 PASS 和远端标签核对作为完成证据，源码哈希一致不代表真实账号业务验收。

尚未验证：真人账号在生产界面完整操作；本轮未重新调用付费模型对真实附件做 OCR/摘要；不声称已测试 GPT 自动生成（本轮根本没有 GPT API）。新版本的 OCR 步进有隔离测试，实际模型能力沿用原通道。

## 回滚

先恢复基线的上述前端文件和两个函数（通过新的恢复提交与针对性部署，不强推），再按实际情况执行对应 rollback 禁用新 RPC 与命令写入。回滚不删除字段、历史、GPT 文本或原文件；旧代码使用原兼容字段，因此启用后的人工作业仍在版本历史内，不能视为自动还原了用户最新编辑。恢复内容需单独评估并通过预览确认，禁止静默覆写用户数据。

后续 Codex 接手：继续使用统一内容解析器；不要让新消费者直接读取旧 content/response_logic；不要把手工 GPT 内容错误标注为 API 验证结果。若以后编写 GPT Skill，应复用身份绑定的预览/确认接口，而非直接写四个字段或自动切换选用版本。
