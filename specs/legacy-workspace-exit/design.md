# 设计与影响边界

详细产品方案见[17项矩阵、六项升级与退出标准](../../docs/work-packages/legacy-workspace-upgrade-20261025.md)。本文件记录 L00 实现边界。2026-10-25 用户已进一步授权 L01–L08 按方案逐包实施。

## L01 客户经营视图

新增只读 public.person_customer_worklist_v1(jsonb)，仅 service_role 可执行，SECURITY INVOKER。旧目录 RPC、基表、视图、权限与旧 URL 不变。person_360.listPeople 仅在 customerWorklist=true 且唯一角色为 customer 时选择新查询；旧请求保持原行为。按 Person 聚合角色，客户和招募各选最新有效关联，避免多角色重复分页。

工作台沿用最新有效客户跟进（followup_date、Id 倒序）及 first_contact_date/客户 created_at 的旧回退口径；日期以 Asia/Shanghai 的今天判定，created_at 保留旧查询 UTC 日期口径。逾期、今天、未来30天优先，其后判断至少30天未联系；未关联客户和日期未知分别显示。招募跟进不进入客户日期，全部人物视图仍保留原合并日期。筛选、排序、计数和分页在同一个数据库查询中完成，末尾以 Person ID 稳定排序。

仅 people.js、i18n.js、person_360 和成对 migration/rollback 需要发布，新增只读函数对应权限基线增加一项明确允许记录。无基表列变化，无视图重建。回退先恢复 L00 前端和 person_360，再运行 rollback 将新增函数变成拒绝执行的占位实现；保留函数及服务端专用权限，不删除对象、不回滚业务数据。回退提交保留新增对象权限登记。

## L00实现

- 只从console/pages/misc.js的LEGACY_ENTRIES移除批准的11项，不修改route/dispatch或旧页实现。
- 保留六项原URL和显式kind=legacy；修正i18n中兼容区说明及六项保留理由中不准确的“批量工具/资源推荐”等描述，写出实际缺口。
- 新版settings及recycle已有上下文旧入口，继续复用，不新建转跳页或添加另一层菜单。
- 对应测试分开验证“菜单只剩6项”与“全部17旧URL可达”；保留真实浏览器跳转与打开不写数据的断言。回收站测试改走More→统一回收站，原恢复范围/失败重试断言不删。

## 视觉规格

目的：个人日常只做一次功能选择，仍能识别尚未迁完的能力。沿用既有工具型工作台设计；不重新设计页面。

保留现有色板红#D31145、墨#2E333B、背景#F5F5F7、白#FFFFFF；沿用已有-apple-system/PingFang SC/Segoe UI/Microsoft YaHei字体链与SVG图标。现有品牌及设计系统优先于技能的通用字体/布局建议，本轮不新增CSS或字体资源。

布局保留四主卡片、工作区折叠、兼容折叠的主次顺序，仅减少卡片。iPad 820×1180、1180×820验收；既有窄屏工作区捷径行为保留，不进行新手机适配。

## 数据、安全与回退

不改数据库/接口/权限/AI流程，不产生migration/rollback。全部业务数据仍通过现有callFn。新文案仅通过i18n字典；隐藏入口不构成安全机制，原后端鉴权不变。

回退基线release-20261025-151000；必要时恢复本包两个静态文件并正常发布恢复提交，不覆盖用户数据、不强推。原PC36独立未提交文档不进入提交。

## 发布

仅部署crm/js/modules/console/pages/misc.js及crm/js/modules/console/i18n.js。复用现有托管域名和配置，核对响应头、内容哈希；不新建域名、云函数或改变运行时。源码与测试检查后执行WP01和release.ps1完整核验；实际证据见[evidence/L00.md](evidence/L00.md)。
