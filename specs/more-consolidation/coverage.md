# 更多入口覆盖矩阵（M00 基线）

核对日期：2026-10-24。源码 1e46c83。基线文件：crm/js/modules/console/pages/misc.js、router.js、data.js 及各页面/函数。
统计：8 个工作区快捷入口 + 2 个系统旧入口 + 7 个知识/策略入口 + 3 个原生回收站 + 9 个业务兼容入口 = 29；17 Legacy、12 原生。退出按钮另计。

## 17 个旧入口逐项

以下“已覆盖”表示源码已有能力，完整替代需后续包按差异验证。所有旧地址继续保留；本矩阵不是删除授权。

| 旧 hash（均在 /crm/admin.html） | 现有原生覆盖 / 主要调用链 | public 数据与操作语义 | 缺口及最终归属 / 工作包 |
| --- | --- | --- | --- |
| #/account | settings；现有 auth 密码修改/退出 | Auth 账号；不改业务表 | 刷新确认、维护工具合并到设置；M02 |
| #/test-scenario | 旧页独有、后端测试白名单 | 仅登记虚构场景，不能真实客户测试 | 设置开发工具折叠保留；M02 |
| #/customers | people 客户筛选、Person 概览；person_360/customer services | persons + customers；原客户软删/恢复 | 列表状态/过滤核对；不机械搬旧列；M03 |
| #/more/followups | Person 时间线；followups.list/create/update/remove | followups 原记录，单项硬删；不复制 interactions | 人物入口跟进闭环，跨客户旧总表保留；M03 |
| #/funnels | 原生机会/招募局部统计；funnel_insight.stats/explain | 旧客户/机会/招募事实视图；只读、AI 显式调用 | 新轻量分析入口与口径说明；M16 |
| #/ai-suggestions | Person AI 历史、#/ai/experience；assistant + ai_recommendations | ai_tasks/results 与旧 ai_recommendations 分离 | 旧跨客户查询/日期筛选分页未统一；M12–13 |
| #/more/policy-review | Person insurance；policy_review_reports | policy_review_reports，历史/生成/编辑；单条删除沿旧语义 | 保障工作区链接与术语；M04 |
| #/more/products | Person insurance；products.list/upsert | 客户保障额度/保费/缴费年限，版本校验 | 这是客户保障数据，不是公司产品库；M04 |
| #/more/gifts | Person care；gifts CRUD | gifts.customer_id，单项硬删 | customer 角色依赖不变；M04 |
| #/more/photos | Person care 附件；photos CRUD | photos.customer_id；元数据列表、懒读正文、单项硬删 | 保存文件已有；完整新上传→OCR 草稿尚缺；M08–09 |
| #/speakers | 活动详情资源页；activity_speakers + 身份解析 | activity_speakers.person_id；引用/版本保护、现有删除预览 | 无需先有活动的独立资源目录与服务端检索；旧 AI 推荐保留；M06 |
| #/topics | 活动详情资源页；activity_topics | activity_topics；引用保护、主题关联保留 | 独立目录与检索，旧推荐兼容；M06 |
| #/recruit/goals | #/recruit/goals 已支持编辑；recruit_goals | recruit_goals / 进度与基准；原事务保存 | 基准编辑/目标反推高级旧功能保留；修正只读文案；M07 |
| #/activity/customer | #/activity-report/customer；activity_reports | 客户跟进/活动工作量既有口径，不叠加 interactions | 日期参数丢失修复；统一入口和覆盖提示；M01/M15 |
| #/activity/recruit | #/activity-report/recruit；activity_reports | 招募跟进/里程碑/目标既有口径 | 同上，不改变日界线/软删统计；M01/M15 |
| #/customers/trash | #/recycle/customers；customers.trashList/restore | customers 及原级联删除批次 | 原生单项恢复已有；旧批量恢复保留；M05 |
| #/recruit/trash | #/recycle/recruit；recruit_candidates + Person-only executor | recruit_candidates/followups 的各自恢复批次 | 原生整合独立与客户关联候选，旧批量保留；M05 |

## 12 个原生卡片

| 入口 | 现状 / 处理 |
| --- | --- |
| #/today | 主导航重复；M17 iPad 收拢但不删除路由 |
| #/people | 同上，人物统一入口 |
| #/opportunities | 新 Person-only 写入已有；旧客户机会写入适配见 M10–11 |
| #/activities | 保留工作区；手机 More 仍需可达 |
| #/recruit | 保留工作区；手机 More 仍需可达 |
| #/ai | 保留工作区；手机 More 仍需可达 |
| #/settings | M02 整合，M17 四主入口之一 |
| 快速记录按钮 | PC37 新版已上线；本轮保留触发及全局可达，不回退为细碎事实 |
| #/knowledge-governance | M14 复用；M17 四主入口之一 |
| #/people-trash | M05 统一入口下复用；原 URL 保留 |
| #/recycle/customers | 同上 |
| #/recycle/recruit | 同上 |

## 确认的缺陷 / 不应重复开发的能力

- router dispatch 仅传 m[1]，丢人物 section 与报表 query；M01 修复。
- 机会旧客户按钮在 Console 内跳 #/customers，落到 Today；M01 改为校验 ID 后跳 Legacy 详情。
- 现有招募目标已可编辑；不能按过时说明再造编辑器。
- 现有 AI experience 已支持可读结果、原始 JSON 折叠、回执与 JSON 校验；必须保留。
- 现有保险编辑/检视、礼品/附件 CRUD、跟进编辑及三回收站已存在；优先整合入口。
- OCR 现有记录可审阅/解析/预览确认/撤销，不等于完整新文件导入流程。
- Person-only 机会命令的拒绝旧客户保护不能删除；采用 M10 独立适配。
- 活动资源目前先读 activityDetail，不能声称独立目录已经存在。

## 验收和退出记录

后续每包在 evidence/Mxx.md 追加实际变更、服务契约、回归命令、Git/标签、云端范围、回退点与未验证项。
未通过本项等价验收的旧入口只能降低展示频率，不能移除兼容路径。

### 逐包进展

- M01：深链参数和旧客户机会跳转已发布，见 evidence/M01.md。
- M02：设置刷新确认与折叠维护入口已发布，见 evidence/M02.md。
- M03：复用既有客户筛选/阶段/优先级/日期和原跟进 CRUD；补充日期→时间线捷径，旧经营/招募状态及批量工具仍有上下文兼容入口。验证和发布状态见 tasks.md / evidence/M03.md。
