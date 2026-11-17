# 话术与异议持续优化

用户确认最新个人版方案后实施。开发基线 fd87c0e，已合入独立发布的教育资料提交 9bdde35 / release-20261117-233514；代码回退参考该版本，不自动回滚新增业务数据。未覆盖其页面、样式或后端修改。

## 范围

- 两个默认关闭的独立待办标记；固定批次清单、成功清除对应标记、失败保留、续跑复用原任务。
- CloudBase 通过既有 AI Gateway 配置调用模型，不指定厂商。用户已说明环境使用资源点计费，无需额外购买 Token Credits。
- AI 只存候选；服务端预览后人工批量采用。历史版本可编辑为新版本；选择旧版固定，批量采用排除固定或依据变更条目。
- DOCX 原件保留，全文分块解析，图片单独 OCR；原文按来源范围摘取。遗漏段落、图片失败、嵌入对象和分块边界单独显示。当前仍限 2 MiB DOCX、50 万字符、单次导入 300 条、每条 4000 字；超限不截断后冒充成功。
- GPT 专用 references:read / references:gpt:submit；通用知识接口继续隔离话术。SKILL 仅保存候选，不代替人工采用，不安装周期调度。
- UI 复用现有六列列表、按钮和对话框；新增字典均有简体中文/英文，验收范围为 iPad。

## 数据与发布范围

- 仅 public。新增六张私有表、一个序列、两个 service_role 专用函数和内容版本触发器。原表、旧接口、旧历史均保留。
- 迁移 20261118010000 / 20261118010001，配对 rollback。已有新版本、任务或新增授权时回滚会停止，需另行评估并保留数据。
- CloudBase 迁移工具首次返回 verified=false；后续 migrationDetail 已返回两份迁移，规范化 SQL 与本地一致；实时对象和 scope 约束已核对。未绕过迁移历史或重放 CREATE。
- 云函数仅 assistant、knowledge_mcp。新专用 timer 为 referenceOptimizationWorker，每分钟处理一个已提交任务；使用现有受限 worker/OCR 委派能力。旧 OCR 与教育 timer 的代码流程不变。
- 静态文件：console.css、communication-references.js、reference-optimization.js、manual-docx-import.js、i18n.js、knowledge-mcp-consent.js、oauth-consent.html。主 admin.html 本轮无改动。

## 验证

- 知识库与 MCP 整套 165 项通过；新增 iPad 双语、worker、MCP 专用授权组合 13 项通过。
- 最终 SQL/范围迁移 6 项通过：双队列、预览采用、人工分支/固定版、固定清单/续跑、解析进度/权限、无变更不增版和回滚阻断。
- 后续小修改的对应单元组合 17 项通过。
- 新增九个权限目录对象逐一核对后纳入基线；旧对象无权限漂移。新表强制 RLS，匿名/普通登录角色无直接权限。
- CloudBase code review 已检查专用服务端入口、密钥不回显、表先迁移、旧 device guard 保留和模型配置复用。

## 发布验收

- WP01 发布门槛通过；旧系统隔离回归 102 PASS / 0 FAIL，5 项原有预设跳过。真实账号登录仍列未验证，手机不在本轮验收范围。
- assistant、knowledge_mcp 已通过门槛逐个部署；七个静态产物逐个上传成功。可达页面/模块/样式 108 项云端哈希一致。
- 真实 CloudBase 优化验收：停用的合成测试话术，任务 9359d62b-3637-4899-9f59-2fa6021d91fa 完成；审计 taskId 303，候选版本未确认，当前版本不变，系统标记清除。保留测试标识，测试条目随后软删除，活动测试条目数为 0。
- 真实全文解析验收：合成 DOCX，任务 5b0e5306-25a3-413a-a8d2-e8dbef47618d 完成，4/4 段已处理，2 个话术范围、2 个明确排除的标题段、0 警告。未导入到业务话术列表。
- referenceOptimizationWorker 已创建并启用，CustomArgument 与既有运行时密钥匹配；不改变旧 timer。
- 线上权限负向验收：无设备凭证的新接口请求返回 DEVICE_ACCESS_DENIED；错误密钥的定时入口返回 handled=false，未执行任务。MCP 公开授权元数据 HTTP 200，已包含两项 reference scopes。
- 新 SKILL 已保存到仓库，并安装到当前用户本地 skills。GPT 客户端首次新增 scopes 授权与真实整批 SKILL 执行仍需用户完成；没有擅自建立定期 GPT 任务。
- 图像 OCR 路径已做隔离测试；本轮真实 DOCX 验收为纯文本，没有声称扫描图像端到端验收通过。

发布标签：`release-20261118-001300`。提交前完整云端核对已通过：108 个页面/模块/样式、30 个云函数的 346 个源码/配置文件一致。Git 发布通过 `tools/release.ps1` 执行；脚本在原子推送 master 与标签后再次执行完整三端核对，退出成功才视为发布完成。

定时器需使用 SCF CreateTrigger 的 CustomArgument 绑定现有运行时密钥；普通简化触发器入口不传该参数。[腾讯云接口说明](https://cloud.tencent.com/document/product/583/18589)。不提交密钥，不批量重建其他触发器。
