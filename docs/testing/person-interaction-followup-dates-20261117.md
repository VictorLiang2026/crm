# Person 互动日期与跟进日期同步

日期：2026-11-17  
基线：`e4834cdb52d7f4cec6025317b15695c9aaff3407`  
迁移：`20261117170000_person_interaction_followup_dates`

## 变更

- “记录互动”的“发生时间”改为日期输入“本次跟进日期”，按 `Asia/Shanghai` 当日保存；历史时间戳请求仍兼容。
- 所有人物场景都可填写“下次跟进日期”。未提供该值时保留已有日期；明确点按“清除下次跟进日期”才会清除。
- 客户跟进日期写入原 `public.followups` 字段；一般互动日期写入新增的 `public.interactions.next_followup_date`。
- 人物目录与客户工作清单将客户跟进、增员跟进、一般互动汇总在一起：最近日期取最大值，未来下次日期取最早值。
- 互动保存或删除时更新 `public.persons.updated_at`。普通人物资料保存路径继续由资料保存事务更新该字段，不改本次/下次跟进日期。
- 迁移及回滚仅改 `public`；迁移前未发现依赖 `public.interactions` 的视图。回滚在该列仍有非空数据时拒绝删除，避免丢失跟进日期。

## 验收

- PGlite 互动迁移回归：通过。覆盖上海时区日期保存、客户跟进日期同步、日期精度、空白保留、显式清除、人物 `updated_at`、旧时间戳调用兼容及安全回滚。
- 人物目录 SQL 回归：通过。覆盖一般互动进入最近/下次跟进汇总、与既有来源共同汇总以及回滚恢复。
- iPad 双语互动编辑器浏览器回归：通过。覆盖日期输入、一般/客户互动、下次日期显示和显式清除。
- 人物列表回归：7 项通过。
- PC05 旧互动入口回归：通过。
- 模块化前端检查：通过。
- WP01 完整发布门禁：通过；保留现有登录、服务角色运行时、生产写入和移动端未验证项。
- `test:interactions` 单独运行有 8 个既有 Person 360 dispatch 测试因夹具返回 `DEVICE_ACCESS_DENIED` 失败；在未修改的干净 `master` 上同样复现。WP01 综合回归为通过。
- CloudBase 迁移应用工具报告结果与后续状态查询不一致。只读复核确认迁移版本已列入远端历史，日期列已存在，互动 RPC 与三个目录 RPC 均含预期 SQL 片段。
- 生产服务角色目录 RPC 运行探测因只读 SQL 工具使用管理角色而返回 `Unauthorized`，本轮未完成该运行探测；没有对生产业务记录执行创建、更新或删除。

## 发布范围

- 数据库：只执行 `20261117170000_person_interaction_followup_dates`。
- 静态托管：仅上传 `crm/js/modules/console/person-interaction.js` 和 `crm/js/modules/console/i18n.js` 到对应 `/crm/js/modules/console/` 路径。
- 不部署云函数；不触及 `pr` schema 或 `pr_*` 函数。
