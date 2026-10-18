# PC28 设计

## 流程

Console 招募工作台打开独立命令弹层。`assistant.recruitDeleteInterpret` 使用既有 CloudBase AI Gateway 的模型配置，仅产生 `delete recruit_candidates` 意图、人物与候选人短语；服务端 `resolveName` 返回候选人物，人工选定后 `assistant.recruitDeleteTargets` 重查 Person-only 候选人并由人选择单行。通用 `assistant.command` 的其他 delete 路径保持拒绝执行。

`assistant.recruitDeleteCommand` 对 `plan / preview / confirm / execute` 做严格输入白名单和已登录身份核验，再调用新 `public.assistant_recruit_delete_command_v1`。Plan 的幂等键绑定操作者、请求文本、Person 与候选人；Preview 返回可见影响摘要并在仅服务角色可读的命令表保存完整版本快照。Confirm 仅接受服务端生成的预览校验值；Execute 锁定命令、Person、候选人及全部既有跟进，比较快照，再调用现有 `public.crm_person_only_recruit_delete_v1`。所有数据库写入及回执落库在同一事务中。

执行结果记录本次 `delete_batch_id`、候选人 ID、同批跟进 ID 与操作者。恢复不新增执行器，仍由 PC35 招募回收站调用现有服务；相同命令重试不重复调用删除。过期、越权、换目标、追加/修改/提前删除跟进及客户转化都返回明确拒绝。模型输出不参与授权，前端布尔 `confirmed` 无效。

## 数据与权限

新 `public.assistant_recruit_delete_commands` 表只授予 `service_role` 必要权限，启用并强制 RLS；RPC 为 `SECURITY INVOKER` 且检查 `current_user = 'service_role'`。匿名及 authenticated 无表权限和函数执行权。RPC 只引用 `public` 业务对象。新表承载审计，rollback 将执行器改为拒绝并撤销写权限，保留已产生的命令/批次证据；代码回退不自动恢复业务数据。

不修改现有表、视图、RLS、软删除函数或模型厂商配置。前端只新增 Console 模块及招募页入口、双语键；旧 `admin.html` 实现保留。

## 验证

隔离单元与浏览器回归覆盖白名单、双语/iPad、身份人工选择、预览确认前无写入、错误与重试；`public` 回滚事务覆盖已登记 #20/#3 的实际删除、同批恢复、预删跟进不复活、过期/伪造/版本变化/重放。部署后由测试账号在页面人工确认一次 #20 删除与恢复，并只读核对批次、隐藏和恢复。通用安全门禁、PC26/27 命令、PC35 回收站、招募与 Legacy 回归均须通过。
