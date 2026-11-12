# 招募目标分析排版与自然语言删除下线

## 范围与影响

- 重排 Console #/recruit/goals：月份筛选成为紧凑控制条；达成指标和阶段分布优先展示；阶段明细与月度历史默认折叠；目标输入按 iPad 报表宽度分组。原报表口径、月份查询、目标保存、上月草稿和参考假设保持。
- 完整移除 PC28 自然语言招募删除：删除招募页入口、Console 调用、双语文案、assistant 路由、AI skill 和专属服务模块。
- 新 migration 只撤销 service_role 对 PC28 RPC 的执行权和审计表写权限。保留审计表、既有唯一已执行记录、RLS 与 SELECT 权限。Rollback 恢复 PC28 表写权限和 RPC 执行权；需要同时回滚部署以恢复入口。
- 保留常规候选人资料编辑、招募阶段/跟进维护、旧软删除、回收站恢复及 Assistant 其他命令。
- Person 360 的通用“编辑资料”已有招募优先级字段；候选人动机、顾虑、工作经历、家庭情况、性格标签、职业计划、下一步行动/日期在“团队招募”页签的“编辑候选人资料”中。本轮不改写入字段或保存行为。

## 生产数据检查

发布前对 public.assistant_recruit_delete_commands 只读分组查询发现 1 条 executed 记录。migration 不删除或修改该行，也不删表/函数。

## 门禁与回归

- 基线提交：b6869166e893a6d779e65575233d3e1e6bd4f02f（GitHub master）。云端基线检查：107 个静态资产与 30 个函数的 338 个源码/配置文件匹配。
- 目标分析：PC21、L06、M07 及 iPad 中文/英文浏览器回归。
- 功能下线：assistant PC28 退役断言、PC28 service/skill registry 和 assistant 其余命令回归、PC26/PC27 招募常规删除和恢复、WP01 门禁。
- 人物详情编辑字段只读核对；不修改人物或候选人业务记录。
- 回归结果：PC21 24/24、PC28 14/14、PC26 21/21、PC27 20/20、L06 2/2、M07 1/1、安全权限测试 10/10；WP04 身份审计通过（客户 785、参与者 3、招募 573、讲者 6，0 个例外）；WP01 为 PASS_WITH_LIMITATIONS，自动检查 104 PASS、0 FAIL、5 SKIP，旧 Console 路由与招募详情 smoke 全部通过。
- WP01 限制项保留为人工登录、service-runtime、live-writes、mobile 未验证；没有用生产业务数据执行写入/删除测试。assistant 直接匿名探测返回 DEVICE_ACCESS_DENIED，符合设备访问保护；线上 assistant 源码详情确认 PC28 路由已移除且 Recruit Coach 路由仍在。
- 发布范围：仅部署 `assistant` 与 `crm/css/console.css`、`crm/js/modules/console/data.js`、`crm/js/modules/console/i18n.js`、`crm/js/modules/console/pages/recruit.js`、`crm/js/modules/console/recruit-goals.js`。5 个静态文件 HTTP 200 且 SHA-256 匹配；部署后 CloudOnly 核验 106 个页面/模块/样式资产、30 个函数和 335 个源码/配置文件匹配。
- public 权限迁移已应用；service_role 对 PC28 审计表仅保留 SELECT，RPC 无 service_role 执行权限，既有 1 条 executed 审计记录仍保留。

## 回滚

先执行 cloudbase/rollbacks/20261112224500_retire_assistant_recruit_delete.sql，再从回退提交恢复 Assistant/Console 源码并部署。审计数据不会丢失。
