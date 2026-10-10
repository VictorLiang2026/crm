---
name: "crm-release"
description: "Victor's CRM 版本发布三地同步清单（本地→云端→GitHub→tag→复核）。当用户说『发布/发版/上线/部署到生产/打标签/release vX.Y.Z』或版本人工验收通过需要正式发布时调用；也适用于代码已改完需要部署+提交+推送的收尾场景。"
---

# CRM 发布三地同步流程

适用工作区：`D:\CRM\crm`（2026-09-16 起由 `d:\CRM\crm-v1` 更名；Victor's AI Relationship OS，腾讯云开发）。
GitHub 仓库：`https://github.com/VictorLiang2026/crm.git`（2026-09-16 由 crm-v1 更名，旧 URL 有 GitHub 自动跳转）。
核心铁律：**本地、云端（云函数+静态托管）、GitHub master 三处必须一致，每次提交必须打 tag 并复核，保证任意提交可回滚**。

## 总规则（最高优先级，2026-09-12 锁定 / 2026-09-16 更名更新）

本系统**锁定三方同步**，任何代码改动后必须立即部署云端 + 提交推送 GitHub，不得遗留未同步状态。**变更及时部署提交，不攒批**。

| 维度 | 锁定目标 |
|------|---------|
| 本地工作区 | `D:\CRM\crm` |
| 云端托管 | CloudBase `/crm/` 子目录（envId `crm-d1gkae8ddc930d151`；envId 不随更名变化） |
| GitHub | `https://github.com/VictorLiang2026/crm.git` master 分支 |

每次改动完成后立即执行下方「硬策略」全流程，保持三方一致。

## 硬策略（用户明确要求，2026-09-12 起生效，标签规则 2026-09-16 更新）

- **每次代码更改后必须走完整流程**：部署云端 → 提交推送 → 打 tag → 复核，无需逐步征求确认（用户已授权直接执行）。
- **标签规则（2026-09-16 起，不再使用 v1 命名）**：
  - 每次提交打一个时间戳回滚标签：`release-YYYYMMDD-HHMM`（如 `release-20260916-0947`）
  - 每天的**第一次提交**额外打一个当前版本 semver 标签（首基线 `v2.0.0`，之后按版本演进递增，如 `v2.0.1`/`v2.1.0`）
  - 历史 v1.x 标签保留不动
- 纯文档/维护提交同样打 release 时间戳 tag，保证每个提交有回滚基准。

## 托管目录隔离（2026-09-12 起 / 2026-09-16 迁移到 /crm/）

- 本系统所有托管文件位于 `/crm/` 子目录：
  - `crm/admin.html`
  - `crm/data-dictionary.html`
  - `crm/db-schema.svg`
  - `crm/system-documentation.docx`
- 根目录只保留平台文件 `__auth/*` 与其他系统（如 `cloud-admin/`）。
- 访问基址：`https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/`
- ⚠️ **tcbgw 网关对带查询参数（`?v=`/`?t=`）的 URL 返回 404**，验证时 URL 不要带查询串。

## 前置约束（不可违反）

- 大版本号（X.Y.Z 升级）必须用户明确指定；日常改动直接执行部署+提交+补丁 tag 全流程，无需逐步确认。
- PowerShell 5：不支持 `&&`/`||`，命令用 `;` 分隔；禁止 cmd 语法；`.ps1` 需 `-ExecutionPolicy Bypass`；git 命令加 `--no-pager`。
- tcb 登录会写 `~/.cloudbase/.~auth.json`，被沙箱拦截 → **登录 + env use + 部署必须放在同一条 Shell 命令里，并加 `dangerouslyDisableSandbox: true`**。
- git push 走代理：`git -c http.proxy=http://127.0.0.1:7897 -c http.sslBackend=schannel push origin master`（openssl 后端报 `SSL unexpected eof` 时换 schannel 即可，重试 ≤2 次）。
- **`tools/release.ps1` 内部的 git 不继承 `-c` 代理参数**：跑脚本前先设仓库级 `git config http.proxy http://127.0.0.1:7897; git config http.sslBackend schannel`，发布完成后 `git config --unset http.proxy; git config --unset http.sslBackend` 还原，否则脚本会在首次 ls-remote 握手失败退出。
- PS 5.1 `ConvertFrom-Json` 读 MCP 凭据文件可能报 ArgumentException（编码/嵌套问题）→ 用 node 把 `credentials.{secretId,secretKey,token}` 转成纯 PS 变量文件（`$secretId='...'`，值内单引号翻倍为 `''`）再 `.` dot-source；**不要把 token 拼在命令行**。
- 临时文件跨进程一律用绝对路径并先核对存在：PowerShell 的 `$env:TEMP` 在本机是 `D:\Temp`，node 桥脚本默认 `%LOCALAPPDATA%\Temp`（C 盘），两者不是同一目录。

## 第 0 步：发布前状态核对（三件套）

1. `git status --short` + `git --no-pager log --oneline -3` —— 确认改动清单、无遗漏文件
2. `git --no-pager ls-remote origin master` —— 远端可达性 + 分支指向
3. `git --no-pager ls-remote --tags origin` —— 现有 tag 清单，确认新版本号未被占用

## 第 1 步：本地自检

- 云函数语法：`node --check cloudfunctions/<fn>/index.js`（每个改动函数）
- admin.html 内联脚本：提取 `<script>` 内容到 `tools/.tmp-*.js` 跑 `node --check`，验证后删除临时文件
- 功能走查清单（新增路由/按钮/函数时必须做，node --check 发现不了逻辑行丢失）：用 Grep 逐项核对 ①路由分支行 ②入口按钮 ③DOM 挂载点 ④函数定义 ⑤云函数路由 action 分支；缺一条就是 Edit 被 IDE 缓冲区回写丢失
- 数据库相关：新 SQL 涉及的列名/约束必须先用 MCP `queryPgDatabase` 对生产库核实（注意 followups/customers 主键是大写 `Id`；recruit_candidates 无 name/priority/occupation 列；activity_tasks 无 deleted_at）
- docs 文档若受影响：更新 `docs/db-schema.svg`（跑 `node tools/gen-schema-svg.js`，改脚本顶部 SCHEMA_VERSION/SCHEMA_DATE）、`docs/data-dictionary.html`（手写）、`docs/system-documentation.docx`（跑 `node tools/gen-system-doc.js`，DOC_VERSION/DOC_DATE）；**文件名永不带版本号**

## 第 2 步：云端部署与验证（dangerouslyDisableSandbox: true，同一命令）

- 取临时凭证：MCP `mcp_cloudbase` → `auth`，args `{"action":"get_temp_credentials","reveal":true,"confirm":"yes"}`
- 一条命令完成：`tcb.cmd login --apiKeyId <secretId> --apiKey <secretKey> --token <token>; tcb.cmd env use crm-d1gkae8ddc930d151;` 然后逐条部署：
  - 云函数：`tcb.cmd fn code update <fnName> --dir cloudfunctions/<fnName> --json`（部署后等 ~10 秒再验证）
  - 前端：`tcb.cmd hosting deploy ./admin.html /crm/admin.html --env-id crm-d1gkae8ddc930d151 --yes`
  - 文档（如有变更）：`tcb.cmd hosting deploy ./docs/<file> /crm/<file> --env-id crm-d1gkae8ddc930d151 --yes`
- **托管 cloudPath 前缀铁律（2026-10-11 双 crm 事故）**：本地文件参数保留仓库相对路径（`./crm/js/modules/...js`），云端路径只写一次 `/`+该相对路径（`/crm/js/modules/...js`）；**禁止** `"/crm/" + "crm/js/..."` 拼成 `/crm/crm/js/...`。循环部署时云端路径恒为 `"/" + $f`。
- **验证 URL 必须独立构造**：哈希比对 URL 一律由"基址 + `/` + 仓库相对路径"现算（`$base + "/" + $f`），不复用部署命令拼过的路径串——否则部署错到双前缀路径、curl 也验同一错误 URL，会得到双向"假 MATCH"。
- 验证（必须真实调用，部署期不暴露 SQL 列名错误）：
  - 云函数：优先 `tcb.cmd fn invoke <fnName> --params '{"action":"...","...":"..."}'`（PowerShell 内 JSON 双引号用 `\"` 转义；大输出重定向到文件再解析）。**注意**：临时 STS 凭证下 invoke 可能报 `[Invoke] Cam authentication failed`，但 `fn code update`/hosting 权限正常、代码实际已更新；不要误判部署失败或重刷部署，改用浏览器真实登录会话做端到端冒烟（如 person_360 时间线/Person 360 页面）。
  - 托管文件：`curl.exe -s -o <tmp> https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/<file>` 后 `Get-FileHash` 比对（**URL 不带查询参数，网关会 404**；**不能对 .Content 字符串直接算哈希**，编码会错）。
  - **单文件 curl MATCH 后必须再跑 `node tests/wp01/static.cjs`**（sync-check 同款，遍历 admin.html/console.html 引用链校验全部 50+ 资源）；它失败而 curl 匹配，先查自己的 URL 拼接，再查 CDN。
  - **边缘 DIFF 诊断**：CDN 哈希不一致时，用 `tcb.cmd hosting download "<cloudPath>" <localPath> -e crm-d1gkae8ddc930d151` 直拉 COS 源站比对哈希/内容标记；源站旧=部署路径错或对象被覆盖，源站新边缘旧=CDN 传播，等待即可。用 `tcb.cmd hosting list "<dir>"` 查 LastModified/ETag 定位写入时刻。
- 删除托管旧文件/误传目录：先 `tcb.cmd hosting delete <cloudDir> --dir --dry-run -e <env>` 核对清单（Key 逐条确认），再去掉 `--dry-run` 加 `--yes` 执行；删除后 list 复核目录消失、正确路径仍在。

## 第 2.5 步：WP01 发布门与证据时效（release.ps1 自动调用）

- `tools/release.ps1` 提交前自动跑 `tests/wp01/run.cjs --assert-release`：catalog/regression/anonymous/wp02~wp06 等 9 项必须 PASS；login/service-runtime/live-writes/mobile 为明示缺口，不阻塞。
- **证据只有 1 小时有效**：`tests/security/.results/wp01-catalog.json`（catalog.sql）与 `wp04-audit.json`（../wp04/audit.sql）均来自生产只读快照，过期必须重新采集，改文件时间无效。门阻塞链是"剥洋葱"：一个 critical FAIL 时其余显示 `not verified`，**每修一项重跑会暴露下一个**（典型链：wp02 fixture → catalog 基线 → wp04 审计 → wp05 → wp06 → regression）。
- 无 IDE MCP 集成时，通过 stdio JSON-RPC 桥 spawn `@cloudbase/cloudbase-mcp` 的 `queryPgDatabase` 采集；桥接脚本、设备码长驻轮询、响应解包与校验规则见 [references/wp01-evidence-mcp.md](references/wp01-evidence-mcp.md)。
- **时间预算**：门全绿后 1 小时窗口内必须完成云端部署并跑完 release.ps1；门跑完若又改了门指纹文件（admin.html/package.json/cloudbaserc.json 及 crm/cloudfunctions/cloudbase/tools/tests 下任何被 git 跟踪或未忽略文件），报告指纹失效需重跑门——**先修完所有门问题、再做与门无关的改动、最后一次跑门**。

## 第 3 步：本地提交 + 推送 GitHub

- 提交信息风格：`feat(vX.Y.Z): 中文摘要` / `docs: ...` / `fix(vX.Y.Z): ...`
- 优先显式 `git add <具体文件>`，不用 `git add -A`
- `git commit -m "..."` 后代理推送 master（见前置约束）
- 推送失败（TLS eof）：换 schannel 重试；连续失败可考虑 GitHub API 兜底（git database API 组 tree/commit）

## 第 4 步：打 tag 并推送（每次提交必做）

- tag 打在**最终发布提交**上（若 tag 后又有 fix，把 tag 移到最终 commit 再推，保证回滚基准=线上真实代码）
- 每次提交：`git tag release-YYYYMMDD-HHMM <commit> -m "..."`；当天首次提交**再加**一个 semver 版本标签（`v2.0.0` 起，版本演进与用户确认）
- `git -c http.proxy=http://127.0.0.1:7897 -c http.sslBackend=schannel push origin <tag>`

## 第 5 步：三地一致性复核

- GitHub API 复核（api.github.com 比 github.com 主站稳定）：
  - tag：`Invoke-RestMethod https://api.github.com/repos/VictorLiang2026/crm/tags` 确认新 tag 存在
  - 文件：`.../contents/<path>` 确认新文件 EXISTS、旧文件 404
- `git status --short` 确认本地干净
- 收尾汇报表格：本地 HEAD / GitHub master / 云函数版本 / 托管文件 / tag 清单，五项状态全绿

## 常见坑（来自本项目教训）

- 托管验证 URL 带 `?v=`/`?t=` 查询参数 → tcbgw 网关返回 404（响应体可能是 404 回退页，造成"404 但内容正确"的假象），验证一律用裸 URL
- tcb 登录"✔ 登录成功"但后续命令说无有效身份 → 登录与部署没在同一沙箱外命令里执行
- 云函数部署后调用报列不存在 → rdb select 了生产库没有的列，部署期不报错，只有 invoke 暴露
- admin.html 改动后页面行为异常但语法通过 → 先 Grep 核对逻辑行是否被 IDE 缓冲区回写吞掉，再怀疑逻辑
- PowerShell 内联 `node -e "..."` 含中文/引号易被破坏 → 写成临时 .js 文件执行后删除
- 大响应走 PowerShell 管道被截断 → curl/Invoke 一律 `-OutFile` 落盘再读
- **双 `crm` 前缀部署**（2026-10-11）：cloudPath 拼成 `/crm/crm/...`，验证 URL 同错→假 MATCH，sync-check 才拦截。详见第 2 步铁律；误传对象按 dry-run→delete→list 复核清理
- **curl 单文件 MATCH 但 static.cjs/sync-check DIFF** → 第一嫌疑是自己的验证 URL 构造，第二才是 CDN；用 `hosting download` 直拉源站定性
- **release.ps1 会 `git add -A` 提交工作树全部改动**：跑脚本前 `git status --porcelain` 逐项确认归属；并发会话（如 PMC 系列）的未提交文件必须先 stash 隔离，发布后再恢复。发布后才出现的他人改动不 add、不还原、不提交，仅在报告说明
- 浏览器隔离冒烟（tests/regression/smoke.cjs）遇 `signOut` 后的 `location.replace` 整页刷新：等待表达式必须可选链 `document.getElementById('view')?.innerText?.includes('CRM 登录') === true`，否则刷新窗口期 `#view` 为 null 抛 TypeError 造成假失败
- 含临时 STS token 的凭证文件、PS 变量文件、MCP 桥脚本一律放 Temp 且发布收尾即删；桥脚本不要留在仓库或 tools/ 下
