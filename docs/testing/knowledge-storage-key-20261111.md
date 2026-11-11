# 知识库分卷上传 STORAGE_FAILED 修复（待发布）

## 故障与原因

用户报告第 01/03 卷（第 001–030 页）上传失败。2026-11-11 22:46（上海时间）生产日志显示 uploadPrepare 成功、多次上传分片成功，person_360 在文件最终写入时返回 STORAGE_FAILED；assistant 随后取消上传会话。对应来源记录已不存在，未执行人工数据恢复或清理。

存储网关日志进一步确认：POST 对象写入返回 HTTP 400，code 为 STORAGE_INVALID_KEY，消息为 Invalid key。该对象键直接包含中文、全角加号和原分卷文件名；OPA 日志为 allow=true，auth_type 为 service_role。原错误并非 PDF 页数超限、AI 失败或登录未通过。

关联存储请求 ID：`68358e5b-1a29-43c2-b160-3a97d5b43c32`。失败对象大小为 2743364 字节。日志引用仅记录诊断事实，不保存凭证、鉴权证明或原文件内容。

## 修复与兼容

- 修改 `cloudfunctions/assistant/knowledge-library-service.js` 的 uploadPrepare。
- 已符合安全 ASCII 子集的原名称继续沿用；其他名称使用 `document` 加受支持的文件扩展名。
- owner/upload UUID 两层路径保留；不同上传会话不会因相同内部文件名而共用对象。
- 原始 file_name、标题、分卷编号、页码、MIME 类型和文件内容不变。
- 既有对象依旧按数据库已存 storage_key 读取；不迁移、不覆盖或重命名已有对象。
- 上传大小校验、设备验证、公开接口、分卷规则、权限和数据库结构不变；不新增模型调用。
- 不涉及公共共享 db.js/ai.js 副本，本轮只需部署 assistant 函数。

## 基线

本地 HEAD：`be8931a`，标签：`release-20261111-222024`。已有未提交的活动报名等改动保持原样。

改前 sync-check 的 64 份公共副本通过，随后因既有未提交文件而停止。GitHub 默认代理仍无法连接，无法完成三端基线核对。CloudBase MCP 环境和只读日志查询正常。

## 验证

- 语法检查、git diff --check、64 份共享模块一致性检查通过。
- `node --test tests/knowledge-library/management.test.cjs tests/knowledge-library/knowledge-pdf.test.cjs tests/knowledge-library/service.test.cjs tests/knowledge-library/ocr-queue.test.cjs tests/knowledge-library/content-versions.test.cjs`：54/54 通过。
- 新增回归覆盖中文和全角符号分卷名、空格及特殊符号、Emoji、不同卷路径唯一、原 file_name 保留、存储路径和来源授权路径一致、既有安全 ASCII 名称兼容。
- 同组回归覆盖普通上传和 finalize、既有文件读取、PDF 文本提取、扫描件渲染及 OCR 队列、隐私校验、内容版本。
- `npm run check:release-gate`：BLOCKED；报告/目录过期、源码指纹变化、身份审计证据过期、全量浏览器等关键结果未齐。未绕过门禁。
- `node --test tests/knowledge-library/pdf-split.browser.cjs`：在浏览器启动阶段失败，`BROWSER_INFRASTRUCTURE / browser.debugger-target / No browser page target`；没有执行页面业务断言。
- 真实文件上传、完整浏览器回归及线上修复验收未完成；不能将离线回归等同线上端到端通过。

## 发布与回滚

尚未部署、提交、推送或创建本轮标签。生产仍为修复前实现。

后续在可运行完整回归的执行会话中，核查最新三端基线，隔离本轮函数和测试改动，刷新证据并通过门禁，只部署 assistant，再提交推送、打标签和核对三端。验收应从正常界面重新上传带中文/特殊符号文件名的分卷 PDF，确认各卷保存并进入后续提取处理。

回退只撤销本轮存储键生成代码，重新部署 assistant；已使用安全键上传的记录仍可按现有读取逻辑访问，无数据库回滚或对象删除。

## 用户明确要求上线后的发布重试

2026-11-11 晚间重新核查：HEAD 仍为 be8931a，本轮仅函数存储键生成和专项测试为待发布修改；其他工作包改动保留。GitHub 代理连接失败，单次调用停用代理后 DNS 解析失败；最小本地 HTTP 探针仍返回 EACCES，无法启动依赖该连接的浏览器回归。发布门禁再次 BLOCKED，git diff --check 通过。未部署、未提交推送、未创建发布标签。

已获用户明确发布授权，后续可用会话无需重复申请普通发布许可。请从本记录接手，刷新基线与验证证据，完成门禁后只部署 assistant，并单独提交本轮两个代码/测试文件及本记录，核对 GitHub、云端与本地。不得混入活动报名工作包或绕过发布门禁。

## 本轮发布结果（2026-11-11）

- 基线刷新：本地 `be8931a502f71772bca8e75e05c1f042b1cfe0c2` 与 GitHub `origin/master` 一致；生产页面及 106 个可达静态资源与该干净基线一致。部署前云函数逐项对比仅发现 assistant 本轮目标文件不同。
- 公共目录快照 1547 项检查通过；WP04 身份审计通过并保留 3 条已登记待确认项；匿名网关探针 106/106 通过；PC34 和隔离回归 104 项通过、5 项预设跳过。WP01 为 `PASS_WITH_LIMITATIONS`，登录、服务运行时写探测、线上业务写入和手机验收仍标记未验证。
- 知识库专项 `management.test.cjs` 13/13 通过；共享模块 60 份副本一致；`git diff --check` 通过。
- 已通过 `tools/deploy-function.ps1 -Function assistant` 仅部署 assistant。CloudBase 调用 RequestId `57dc8a8f-9233-405e-abdf-585cfe667df2` 返回 `DEVICE_ACCESS_DENIED`，确认函数已运行且无业务数据写入；真实分卷上传与最终线上业务验收未执行。
- 提交、标签和推送待本记录补全。回滚仍只需恢复本轮 storage key 生成代码并重部署 assistant，不做数据库回滚或对象删除。
