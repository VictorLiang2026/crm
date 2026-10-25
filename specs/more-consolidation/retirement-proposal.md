# M19 后续清退建议与逐项授权清单

核对日期：2026-10-25。前置基线：16dee465f24b80bd034516fb0ee947442bc7022b / release-20261025-145200。范围仅当前CRM、public；未访问受排除的schema、对象或函数。本文件是建议，不是删除授权或可直接执行的DDL。

## 一、结论与优先级

1. **已完成的精简**：More默认四主入口，低频捷径和17旧入口折叠。数据、API、旧URL保持；无需为减少导航再删除后台能力。
2. **当前应保留**：全部17旧URL及其仍被新系统调用的服务/表；旧推荐、目标反推、批量恢复等未完全等价的流程。
3. **可进一步调查**：6个历史兼容视图。当前源码未找到直接名称引用，public范围内未找到依赖视图、例程目录依赖或例程正文名称引用；这不足以证明没有动态SQL、外部客户端或其他范围的消费者。
4. **暂不建议清理业务数据**：跟进、建议历史、OCR、原件、预览命令和回执属于业务/审计资产，不能因“旧版”或“已执行”就删除。
5. 本轮没有可直接自动执行的表/视图/函数/路由删除项目；M19完成的是清退评估交付。实际清退应逐项审批并提供migration/rollback。

## 二、全部旧入口的保留决定

完整原生覆盖见[最终覆盖矩阵](coverage.md)。以下地址均属于/crm/admin.html；本轮全部保留。

| 旧入口 | 已核对消费者 / 数据与流程 | 决定与将来清退前提 |
| --- | --- | --- |
| #/account | 原账号维护；Console settings复用认证语义 | 保留兼容URL；将来可评估跳转到设置，需验证会话/改密/刷新/返回路径 |
| #/test-scenario | 旧受控场景页、assistant白名单、crm_test_records等登记 | 保留维护区；不得为精简移除测试身份限制或删除登记 |
| #/customers | 旧列表/详情；Console people/Person；customers与persons及众多业务外键 | 旧经营/招募状态、批量工具尚需保留；不能删除customers角色表 |
| #/more/followups | 原跟进入口、Person时间线、activity_reports和上下文读取 | followups仍是原始来源；保留，不能搬进interactions后重复计数或删源 |
| #/funnels | Legacy漏斗、Console analytics/机会页→funnel_insight→v_funnel_stats | 保留服务与视图；旧完整展示与精确口径未完全替代 |
| #/ai-suggestions | 旧页、Person旧建议、assistant.ai-history-query→ai_recommendations、activity_reports | 历史表与查询函数保留；旧ID不能转成ai_results反馈ID |
| #/more/policy-review、#/more/products | Person insurance、policy_review_reports/products及报表 | 保留原记录和API；products是客户保障资料，不是可删的公司产品目录 |
| #/more/gifts | Person care、gifts及activity_reports | 保留原礼品记录和customer作用域 |
| #/more/photos | Person care/file-import/OCR、photos/ocr_records及新增导入任务 | 保留旧上传/OCR兼容行为；原件、解析快照、撤销凭证不能盲目清理 |
| #/speakers、#/topics | 新活动资源目录/活动详情→activity_speakers/activity_topics；活动与参与者引用 | 新旧共用同一服务和表；旧推荐/高级工具保留，引用保护不变 |
| #/recruit/goals | 新招募目标、旧基准/反推、recruit_goals、recruit_milestones、recruit_goal_benchmarks及保存RPC | 保留全部底座；将来先覆盖高级工具，再评估旧显示入口 |
| #/activity/customer、#/activity/recruit | 新activity-report→activity_reports；客户/招募原始业务表与Person显示字段 | 保留两个URL和服务；可另包评估旧页跳转，不得悄改日期/软删除/统计口径 |
| #/customers/trash、#/recruit/trash | 新回收站与旧批量恢复；各对象恢复函数/批次 | 保留；新页面没有完全替代旧批量操作，不得合并不同删除批次 |

源码证据：crm/js/modules/console/pages/misc.js显式17项、data.js的当前调用、assistant/ai-history-query.js旧建议读取、funnel_insight/index.js视图读取、activity_reports/index.js原始来源、recruit_goals/index.js目标/基准/里程碑读取。M18对全部17旧URL实际打开验证通过；这里并未声称验证了所有真实客户写入。

## 三、6个兼容视图候选：逐个核实，逐个审批

2026-10-25 15:05（北京时间）只读核对public目录。六视图均存在且security_invoker=true、authenticated无SELECT授权；photos_view的anon SELECT为false，其余五个为true。保留当前权限，不把授权存在等同于可绕过RLS。

| 候选视图（均public） | 实际public上游关系 | 当前定义MD5 | 本轮决定 |
| --- | --- | --- | --- |
| customers_view | persons、customers、followups、gifts、photos、recruit_candidates、ai_recommendations | 334b371fa1c618316b38112eab632f09 | 保留，候选评估 |
| followups_view | persons、customers、followups、gifts、ai_recommendations | dace16de0afc28cbe495fdffb09fc231 | 保留，候选评估 |
| gifts_view | persons、customers、followups、gifts、ai_recommendations | 4b1dfb2d01c243beecfc9b67e6dfdd26 | 保留，候选评估 |
| photos_view | persons、customers、photos | 31bc8a4da1d57471a0911ab45b3c80fa | 保留，候选评估 |
| products_view | persons、customers、followups、gifts、products、ai_recommendations | 17b53f3821e844f68e51a96aca1b3aac | 保留，候选评估 |
| ai_recommendations_view | persons、customers、followups、gifts、ai_recommendations | ee6f718d0552cf3842d0b8d3f7f2c021 | 保留，候选评估 |

核查方法和结果：

- 对admin.html、crm/js、当前CRM cloudfunctions执行六个完整名称的直接引用搜索，排除node_modules和受排除函数目录：无直接命中。部署源码已在M18核对一致。
- public范围的pg_rewrite/pg_depend反向视图依赖：0；public例程目录依赖：0；public例程正文完整名称匹配：0。上表列出正向数据依赖；这些基表仍有业务用途，完全不属于候选删除对象。
- 上述是有限的静态/目录证据。动态拼接SQL、脚本参数、外部报表、已复制给同事的代码、保存的URL/API请求、其他范围的依赖和访问日志均未完成核实，不记作0。
- 定义哈希用于以后发现漂移，**不是可恢复的完整备份**。实际清退前必须备份精确DDL、列顺序/类型、owner、ACL、security_invoker、注释及相关依赖，并验证重建。

不能将这6个候选扩展为删除v_funnel_stats、v_action_center或v_recruit_candidates系列；后者仍有明确消费者。也不能因视图候选而删除它们的上游表、序列或公共函数。

## 四、观察证据与等待条件

实际只读聚合public.pmc18_observations：2026-10-19至2026-10-25共7个日期、140行，每日20种指标；critical行0，warning行7，均为persons_without_role这一指标的每日记录。这里的7行不代表7种新问题；未在本包改写人物角色或追查个人数据。

这些数据证明当前表内已有连续7日指标，不能证明每次定时任务的执行方式、全周期无异常、旧功能零访问或可删除视图。PMC指标是完整性观察，不是旧页面/API使用量统计。原定观察期至**2027-01-08**，且仍需用户审阅；本轮不提前宣布结束。

后续候选清退建议至少满足：观察期结束并审阅、目标使用量证据完整、所有已知消费者完成替代/迁移、回滚演练通过、用户对具体对象单独批准。可另行提出30天最小化使用统计方案，只统计入口/动作/成功失败计数，不采集客户内容；本轮没有安装埋点、改变日志或建立定时任务。

## 五、下一轮可以交给Codex的顺序（需另行授权）

### R01：只读补齐依赖与使用证据

针对一个明确候选，重新核对master/生产/定义哈希，列出静态、运行时、数据库、外部导出与人工使用的消费者；区分已核实/未知。只限public，不扩大schema权限。任何范围外依赖出现即停止相关操作并报告。验收：每个未知项有负责人和确认方式；没有完整证据就保留。

### R02：补齐尚未等价的新功能

先单独评估旧批量恢复、资源推荐、高级目标反推等实际需求，不为了删除旧页复制全部旧界面。为选定功能写影响/兼容/回归清单，按项目规则获得明确确认后再开发。验收：同一Person/原记录、权限、失败、版本、恢复批次与输出口径等价；旧URL仍可达。

### R03：制作可审核的单对象清退方案

一个对象一份影响清单，列出精确名称、消费者、DDL/ACL备份路径和哈希、观察窗口、迁移前检查、migration与rollback、失败回退触发条件及实际重建演练证据。不得使用CASCADE、批量模糊匹配或自动删除底表。此包只准备方案，不执行删除。

### R04：用户逐项批准后执行

审批必须指向确切对象及版本。若执行前定义/依赖/使用量已变化，停止并重新评估。先备份、再次校验前置条件，再执行批准的单对象migration，检查数据库权限/依赖视图、跑受影响链与WP01；按精确发布流程提交标签及三端核对。失败只按审定rollback恢复结构，不能回滚真实业务数据。

### R05：观察与交接

记录发布后错误、兼容入口使用、关键功能结果与回退条件；达到审定观察期后再讨论下一个对象。删除入口不等于删除共享服务，删除视图不等于删除基表。没有证据的项目继续保留，不以“代码更少”为完成标准。

## 六、本轮交付边界

M19只新增此清退建议、证据摘要及更新任务/交接文档；没有删除/重命名表、视图、函数、路由、数据或字典，没有执行migration/rollback，没有新增监测/自动化。M00–M19完成后，后续开发从[交接验收](../../docs/work-packages/more-consolidation-integration-20261024.md)和[tasks](tasks.md)开始。
