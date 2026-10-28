# 人物编辑单次保存（2026-10-29）

## 范围与实现

- 人物编辑表单只保留底部一个“保存”；Person 基础资料、已关联客户资料、已有候选人招募优先级在一次提交中保存。
- 前端仍通过 `callFn` 调用 `person_360`。服务端将三个字段组交给 `public.crm_person_profile_save_v1`，数据库事务先锁定相关行并逐行校验版本时间，再一次性更新；冲突或异常时所有写入回滚，界面保留输入供重试。
- 函数仅授权 `service_role`，使用 `SECURITY INVOKER`、固定 `search_path` 和字段白名单。迁移仅新增函数，无表数据变更。
- 数据库迁移：`20261028210000_person_profile_transaction`；回滚脚本只删除新增函数。两份脚本与个人迁移备份目录 SHA-256 一致。

## 验证

- Person 编辑器/客户视图 iPad 浏览器回归、客户与招募乐观锁测试、服务层单 RPC 字段映射测试：通过。
- Person service、模块化前端检查：通过。
- WP01：`PASS_WITH_LIMITATIONS`；regression 108 PASS、0 FAIL、5 SKIP；匿名 public 探针 77/77 PASS；目录 catalog 1166 检查、0 漂移；WP04 身份覆盖 `PASS_WITH_EXCEPTIONS`（3 项已声明例外）。
- `service_role` 对新增函数 EXECUTE 为 true；anon 与 authenticated 均为 false。云端迁移历史和函数定义已核对。
- 未对真实人物/客户/候选人执行写入；因此实际登录下的表单写入尚未验证。服务角色运行时、登录和移动端项目外验收仍按 WP01 报告列为未验证。

## 发布与恢复

- 部署范围：`person_360` 云函数及人物编辑依赖的 `write.js`、`i18n.js` 静态模块。
- 数据库恢复仅在需要回退功能时执行配对 rollback（删除新增 RPC），之后需同步回滚前端/云函数代码；本迁移不修改或删除业务数据。
- 发布提交、标签、云端哈希核对结果在本记录末尾补充。
