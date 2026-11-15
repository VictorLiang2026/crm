# GitHub 空间核查（2026-11-16）

## 结论

就本次 CRM 普通代码仓库推送而言，没有发现容量瓶颈，不需要为这次迭代扩容。此前推送失败是当前执行环境中的 Git 凭据管理器启动/授权问题，没有收到仓库空间不足或文件过大错误。

## 实测

| 指标 | 结果 | 含义 |
| --- | --- | --- |
| GitHub REST 仓库 `size` | 11,722 KB，约 11.4 MiB | GitHub 报告的仓库大小，不等于账户剩余配额 |
| 可见性 | public | `VictorLiang2026/crm` |
| 本地当前版本文件合计 | 约 18.0 MiB | 当前工作区 HEAD 的未压缩受版本控制文件，不含 node_modules 和其他未跟踪数据 |
| 最大当前文件 | 951,904 字节，低于 1 MB | SheetJS 前端依赖 |
| 当前大于 50 MiB 的文件 | 0 | 未发现当前版本中的大文件推送风险 |
| 本地 Git 对象 | 松散约 20.45 MiB，打包约 9.53 MiB | 包含本地额外历史，与 GitHub 接口统计口径不同 |
| 本仓库 Actions artifacts | 0 | 公开 artifacts 接口 `total_count=0`，不代表其他仓库或账户级所有产品用量 |
| Git LFS 跟踪配置 | 未发现 | 当前 `.gitattributes` 仅指定知识库 bootstrap 的 LF 换行；本次代码不使用 LFS |

GitHub 官方说明：普通 Git 单文件超过 50 MiB 会警告，超过 100 MiB 会阻止；建议仓库理想情况下低于 1 GB。本仓库远低于这些量级。

官方依据：https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github

Git LFS、Actions 等有独立用量/计费口径。当前未取得账户级授权，不能据此宣称整个账户的 LFS、其他仓库 artifacts 或付费额度的确切剩余量。

人物资料和本次回填结果存储于 CloudBase，GitHub 保存程序与迁移脚本；本轮没有把真实人物沟通原文或回填结果导入 Git 仓库。

## 主任务继续推进

远端 master 已更新为 `1edcc00312f8d3a57ae29e93b9637ce320c88d87`。已建立新的独立工作树，合并教育资料补全改动，保留远端的导航、知识库、报表等修复。

此前线上 `console.css` 与仓库的差异已经由这个新基线消除：本地与实际下载均为 115,600 字节，LF MD5 为 `0666241b49aa452c4be3604977b76340`。没有覆盖线上样式或将无关样式额外混入本轮功能改动。

当前执行环境 GitHub CLI 仍未登录，仓库读取可用而认证推送仍未完成；浏览器最小诊断在加载任何 CRM 业务代码之前，导航到合成 data 页面时就出现 `Page.navigate: Target closed`。这两项仍需解决，生产功能未部署、未启用，真实人物字段未更新。
