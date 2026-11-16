# 教育资料补全：独立检出与发布阻碍复核

## 2026-11-16 08:39（上海）进一步诊断

- 实际发布脚本 `tools/release.ps1` 注明先部署改动，再执行 Git 发布。因此 GitHub 登录并非所有部署准备工作的前置条件；此前概括为先推送再部署不准确，已纠正。
- `gh auth status` 仍为未登录；仓库使用标准 `manager` 凭据助手。已有仓库代理配置未作修改，也未用代理规避网络策略。设备网页成功不等于 CLI 已完成凭据交换，后者已被执行环境明确拒绝访问 GitHub API。
- 将测试进程的 TEMP/TMP 改为允许写入的 `D:/Temp` 后重跑教育页面浏览器用例，仍在 `cdp.Page.navigate` 出现 `BROWSER_INFRASTRUCTURE`，没有把失败改成跳过。
- 单独诊断捕获 Edge 标准错误：Edge 156 可响应 Browser.getVersion，但打开纯 `data:text/html` 页面（没有加载 CRM 业务代码、没有调用生产接口）即断开 CDP；日志出现 crashpad 管道结束、crash server failed to launch，浏览器退出码 3221225477（0xC0000005）。这些日志证明基础浏览器运行失败，但不足以确定 Windows 崩溃的更底层原因。
- Git 发布与浏览器运行条件仍未恢复，WP01 发布门禁亦未满足。未绕过门禁、未执行生产迁移或真实字段写入。已完成的 98 项专项测试与本地提交保持有效；不能据此声称已通过浏览器验收。


2026-11-16 授权续接：用户已在 GitHub 设备授权页完成授权。但执行环境在 CLI 交换凭据时明确拒绝访问 `https://api.github.com:443`（Network access was blocked by policy），随后 `gh auth status` 仍为未登录。没有要求用户重复授权，没有通过代理变换绕过策略。当前功能提交为 `0d41961`，已生成独立补丁及经 `git bundle verify` 校验通过的增量 bundle，位于 `D:/Temp/crm-education-patches-3bf10840/`。未推送、未部署、未回填真实字段。下一步需要先恢复当前执行环境对 GitHub API 的许可访问，再完成 CLI 凭据交换。

最新续接：远端已更新到 `1edcc00`，另建工作树并重新合并功能，保留新基线修复。此前线上额外 CSS 差异现已消除，本地与线上 MD5 相同。GitHub 仓库仅约 11.4 MiB，不存在本轮代码的空间瓶颈；详见 `docs/testing/github-storage-20261116.md`。以下 b2b 基线差异为前一轮历史记录，GitHub 认证推送与浏览器验收仍未完成。

2026-11-16 续接。此记录不是生产发布成功记录。

## 已完成

- GitHub 访问恢复。原工作区 `.git/FETCH_HEAD` 仍拒绝写入，未改变原仓库元数据。
- 在获准写入的 `D:/Temp/crm-education-release-20261116-d3d8f9f4` 建立独立克隆，基于实时 `origin/master` 的 `b2b603ee2f53fbc5b3310b2621434d204080b0b1` 合并本轮改动。
- 最新 master 的名单复核行保留、跟进历史独立读取及对应字典修改全部保留，没有用旧工作区覆盖它们。
- 合并后的 17 个专项/相邻测试文件重新运行：98 PASS、0 FAIL、0 SKIP。
- 新检出中的自动换行转换造成了基线误差。仅在规范化后的内容哈希与 Git 暂存区对象完全一致时恢复文件到 Git 原始字节；没有修改无关代码语义。干净基线的 `admin.html` 已通过线上 HTTP 200 与 SHA-256 核对，60 份共享模块副本也一致。
- 浏览器测试夹具改为复用项目既有直接 CDP 驱动，保留全部断言，避免自行使用的 Puppeteer Windows pipe/frame 初始化问题。未改浏览器共享运行器或业务逻辑。

## 尚未通过的条件

1. **线上现有 CSS 与最新 GitHub master 存在真实差异。** 干净基线 `crm/css/console.css` 为 114,759 字节、LF MD5 `aadb6bd6ce48af556fe87eece7556abd`；线上为 115,600 字节、MD5 `0666241b49aa452c4be3604977b76340`。带独立查询参数的实际下载和托管对象 ETag 相同，排除了单纯换行或旧缓存解释。线上在仓库末尾追加了知识库摘要及增员页面相关样式，托管修改时间为 2026-11-16 01:13:36（上海）。这些样式不属于教育补全，本轮没有覆盖、删除或擅自纳入提交。`sync-check.ps1 -CloudOnly` 因此仍失败。
2. **浏览器验收仍失败。** 调试端口可以启动并连接，但 Puppeteer 运行时未获得主 frame；复用项目 CDP 驱动后，在导航阶段连接提前关闭。失败仍被保留为 `BROWSER_INFRASTRUCTURE`，没有跳过断言或改成通过。不能声称已通过 iPad 中英文交互或视觉验收。

## 发布状态

本轮改动准备提交到独立功能分支供核对和接续，不合并 master，不打生产发布标签，不部署函数/静态页面，不执行数据库 migration，不启用新开关，也不写入真实人物字段。

随后已在上述独立克隆成功提交：`7e58798`，分支 `codex/person-education-backfill-20261116-d3d8f9f4`，19 个文件。推送尚未成功：Git 凭据管理器的 MSYS 子进程无法创建 Windows 命名对象（`NtCreateDirectoryObject` 返回 `0xC0000022`），继而无法获取 GitHub 身份。没有强推、手动输出令牌、改动系统凭据或绕过身份验证。已提供 GitHub 连接入口，等待实际连接确认后再使用其能力。此提交不是远端提交或生产发布。

下一步应先核实上述线上额外 CSS 的来源并完成相应 Git 同步，再在可稳定运行浏览器的环境完成验收与发布门禁。随后按工作包迁移、精准部署、生成真实候选预览，并经用户确认具体字段前后值后执行回填。

## 2026-11-16 20:41（上海）最小复现实验：本地回环连接被拒绝

本节补充并修正早先的原因判断。只凭 `No browser page target` 不能证明 Edge 故障；本轮在完全不启动浏览器、不加载 CRM 的情况下，Node HTTP 服务成功监听随机本地端口，但同一进程请求该端口即返回 `connect EACCES 127.0.0.1:37104`。因此当前执行环境的回环连接权限足以阻断页面夹具和 CDP 调试，不应继续把更换 Edge 或修改业务代码当作解决办法。此前记录的 0xC0000005 是先前实验事实，不据此认定当前所有失败具有同一崩溃原因。

直接连接配置的本机代理端口返回 `connect EACCES 127.0.0.1:7897`，说明当前执行器不能访问该代理，**不能据此断言用户机器上的代理没有启动**。GitHub 主站及 API 的系统 DNS 查询均返回 ENOTFOUND；没有更换 DNS、指定 IP、搭建转发、修改代理或绕过执行环境限制。

浏览器对照覆盖 Edge 启动器、156、137，以及关闭崩溃日志的普通参数组合。未取得可访问的页面目标；156 的调试端口出现后访问仍为 EACCES，137 未取得调试端口。Windows Application 事件日志读取也被拒绝，无法进一步核实故障模块；不臆测具体 DLL 或 Windows 安全组件。

新增只读工具 `node tools/diagnose-education-environment.cjs`，分别报告本地 HTTP 自测、已配置本机代理端口、GitHub DNS 与 CLI 状态。不修改配置/凭据/门禁，不输出令牌或代理账号密码；无阻碍时也只标记 PREFLIGHT_ONLY，不冒充验收通过。本轮实际执行结果为 BLOCKED，四项阻碍全部复现；语法检查通过。仅新增诊断工具和本记录，没有修改业务实现、没有发布。

所需执行条件：在允许本地回环通信及正常 GitHub 域名解析/HTTPS 的 Codex 执行环境中接续；若本机代理在使用，执行器还需能访问其已配置端口。当前会话不能调整这些运行权限。恢复后先运行上述诊断，再核对远端最新基线，执行 iPad 中英文验收，重新采集 WP01 权限/身份及回归证据，按既定流程迁移、精准部署、Git 发布，生成实际候选预览；具体人物字段仍须经人工确认后执行。

## 2026-11-16 20:33:36 +08:00 续接复核（未发布）

- 保留原工作区全部未提交改动；独立检出仍为 0d41961，未修改 Git 配置或凭据。
- gh auth status：未登录。默认代理连接 127.0.0.1 失败；仅对只读 ls-remote 临时取消代理后，github.com DNS 解析失败。未再次要求设备授权。
- 重跑教育审核页面测试：0 PASS、1 FAIL，BROWSER_INFRASTRUCTURE / browser.debugger-target / No browser page target。没有加载到功能验收步骤，不把结果记为业务通过。
- check:release-gate：WP01 BLOCKED，报告缺失或超过一小时、源码/测试变化、目录权限证据过期、身份审计缺失或过期。未绕过门禁、未部署。
- CloudBase auth(status)：READY，目标环境 crm-d1gkae8ddc930d151。仅对 public.persons 执行汇总只读查询：未删除人物 987，毕业院校非空 0，院系或专业非空 0；public.person_education_batches 不存在。没有执行迁移、模型调用或真实人物写入。
- 后续仍需恢复可运行的浏览器及 GitHub 通路，再重新采集 WP01 权限/身份和回归证据；已有本地检查不能替代这些发布条件。本轮没有业务代码变更，不重复跑已通过的后端测试。

## 2026-11-16 21:01:46 +08:00 云端运行准备与连接状态复核（只读）

- 只读诊断继续复现：本地 HTTP 自测及配置的 127.0.0.1:7897 代理连接均为 EACCES，GitHub 主站/API DNS 均为 ENOTFOUND，CLI 未就绪。未改执行器、DNS、代理或凭据。
- CloudBase 仅查询 assistant 的详情及触发器，不涉及其他函数。状态 Active，Nodejs18.15，超时 180 秒，最后修改时间返回为 2026-11-16 01:13:28。对入口源码统一换行并比较，仍与独立检出已保存的 1edcc00 基线一致；此比较不代替全函数包、GitHub 实时远端或静态资源核对。
- 已有 AI_GATEWAY_MODEL 配置键存在；未读取或输出任何环境变量明文。不据此声称已验证真实模型调用能力或精度。
- EDUCATION_BACKFILL_ENABLED、EDUCATION_BACKFILL_TRIGGER_SECRET、AI_EDUCATION_MODEL 均未配置；教育动作尚未部署；仅存在既有 knowledgeOcrWorker，未发现 educationBackfillWorker。没有改动既有触发器。
- GitHub 连接目录查询确认：ChatGPT 的 GitHub 连接 installed=false；先前设备网页授权不能证明 CLI 凭据已保存，也不能证明该连接已安装。此前已提供过连接建议，本轮没有重复弹出安装卡。
- 本轮核对明确了后续部署仍需完成的配置步骤，但没有通过发布门禁，因此没有执行迁移、模型调用、部署、人物字段回填或 Git 发布。当前需要由运行环境提供本地回环及 GitHub 网络访问能力；当前会话不能修改该权限。已有功能方案和人工确认规则继续有效。

## 2026-11-16 21:04（上海）确认会话级禁网标志

用户反馈其他会话能连接 GitHub。本会话直接读取进程环境确认 CODEX_SANDBOX_NETWORK_DISABLED=1；这与当前执行环境的网络受限配置一致。普通 git ls-remote 再次失败；独立 Node 回环 HTTP 自测和代理连接仍为 EACCES，GitHub DNS 为 ENOTFOUND。因此不是仅凭 Git 错误推测禁网，也不能把用户其他会话可联网当成本会话已具备权限的证据。

git config --show-origin --show-scope 确认 GitHub 代理来自 local .git/config，值为 http://127.0.0.1:7897；凭据 helper 来自系统 Git 配置，为 manager。未修改任何配置。新增诊断输出 sandboxNetworkDisabled 和 EXECUTOR_NETWORK_DISABLED 阻碍标记；不尝试更改该环境变量或绕过执行器策略。语法检查通过。当前会话无法提升网络权限；应在用户已有的可联网会话接续同一工作包，或者由运行环境重新授予本会话网络能力后再继续验收发布。

## 2026-11-16 再次接续：门禁及生产部署

- 发布检出基于 GitHub master `0b22e0e2a24c90d89bdbd48b4b92ba4d7f4abd84`，保留本轮独立提交 `0d419616526e3a610dfc384ca282c0b4035503e6` 原分支不变；原工作区的全部未提交变更未覆盖、未清理。
- 生产迁移 `20261116000100 person_education_backfill` 成功；四张新表均启用并强制 RLS，只授权 service_role；两项函数也仅授权 service_role。配对 migration/rollback 已备份至 `C:\Users\victor\cloudbase\migrations`。当前没有新增批次，Person 的两个目标字段仍是空值。
- WP01 预期权限目录只增加经逐项核对的四表、两函数；新鲜 catalog 为 1,609 项通过，WP04 为 0 个身份异常。最终 WP01 为 `PASS_WITH_LIMITATIONS`；匿名权限探针 111/111，完整回归 102 PASS、0 FAIL、5 个既有 skip。未验证项：人工登录、实时生产写入、服务运行时写入、手机验收。
- 教育服务/SQL 专项 20 PASS；教育模块 iPad 中英文浏览器验收 1 PASS；模块化检查通过。WP01 使用已有本地 `node_modules` 路径运行，没有改动依赖文件。
- 仅部署 `assistant` 云函数，并单独上传五个受影响 Console 文件：`data.js`、`education-backfill.js`、`i18n.js`、`pages/misc.js`、`router.js`。主页 HTTP 200 且 SHA-256 一致；104 个可达页面/模块/样式资源及 30 个函数的 338 个源码/配置文件均一致（`CloudOnly` PASS）。这只核验云端源码，不代表 GitHub 或业务写入回归已同步完成。
- 生产 AI Gateway 当前配置为 CloudBase 原生模型 `hy3`；没有启用或更换模型。
- **尚未完成的发布动作：** Assistant 环境新变量和专属 `educationBackfillWorker` 定时器未成功配置，`EDUCATION_BACKFILL_ENABLED` 仍未启用；未创建教育批次、未调用真实模型，也未生成候选预览、未回填 Person。`manageFunctions.updateFunctionConfig` 被凭据自动审查拒绝（检查在 1ms 内返回，认定不能证明完整凭据已人工比对，并要求 `CLOUDBASE_MCP_SKIP_CREDENTIAL_GUARD=manageFunctions.updateFunctionConfig`）。本次没有修改审查配置或用其他路径绕过。GitHub 提交、tag 和发布后的三端核对待此阻断解决后执行。
- 后续用户明确批准上述单动作审查豁免及连接重载。本地项目 `.codex/config.toml` 现在仅为 `manageFunctions.updateFunctionConfig` 添加豁免；原文件备份在 `D:\Temp\crm-education-patches-3bf10840\config.toml.before-credential-guard`。重启精确匹配的 CloudBase MCP 子进程后，宿主启动了新进程，但本对话的 MCP transport 仍为 `closed`。CloudBase CLI 只读环境列表正常；没有用 CLI 或其他 API 写入凭据、没有创建定时器。要继续需重载 Codex CloudBase MCP 会话。

## 2026-11-16 再次接续：MCP 恢复、云端核对与发布

- 按用户已批准的单动作配置豁免重新加载 CloudBase MCP。`auth(status)` 返回 READY，当前环境为 `crm-d1gkae8ddc930d151`。没有输出或记录教育 worker 密钥。
- `npm run check:release-gate`：WP01 gate PASS；报告列出的开放验证项为人工登录、service-runtime 写入、live-writes、mobile。专项回归记录为教育 20 PASS、全浏览器回归 102 PASS / 0 FAIL / 5 个预设 skip、教育 iPad 中英文验收 1 PASS；预设 skip 与开放项仍按限制披露，不声称端到端生产写入已验证。
- 生产 `public.person_education_batches` 可查询且当前批次数为 0；本轮没有回填人物字段。尝试通过 CloudBase 管理调用启动 50 人试点时，Assistant 按设计返回 `DEVICE_ACCESS_DENIED`，因此未创建批次，也未触发模型调用；没有模拟或伪造登录身份。
- 已部署的 Assistant 教育入口及独立 `educationBackfillWorker` 触发器现可通过只读查询确认；功能开关配置为启用。没有改动既有 OCR 触发器。
- `sync-check.ps1 -CloudOnly` 通过：`admin.html` HTTP 200 且 SHA-256 匹配；104 个可达页面/模块/样式资源匹配；30 个函数的 338 个源码/配置文件匹配。GitHub 和业务回归不由这项检查代替。
- Git 发布仍按项目 `tools/release.ps1` 执行：先把已部署功能合并到 `master`，通过新鲜 WP01 gate 与云端核对后，原子推送提交和发布标签。未触碰原工作区的未提交文件；原独立提交 `0d419616526e3a610dfc384ca282c0b4035503e6` 保留。
- 用户登录 Console 的 `#/people-education` 后可启动 50 人试点。由于服务端强制绑定登录身份，本执行会话不能代替用户创建批次或预览；待用户会话生成批次后，再查看服务端候选预览供用户核对。`confirm` / `execute` 均未调用。
