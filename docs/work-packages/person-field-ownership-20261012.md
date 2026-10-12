# Person 字段归属与 Console 人物目录发布记录

日期：2026-10-12  
基线：`master` / `dc443d832f7c245ff0b55a1c477c10465f376f94` / `release-20261011-181627`  
环境：CloudBase `crm-d1gkae8ddc930d151`，仅 `public` schema

## 变更范围

- Person 统一承载电话、来源、性别、生日、职业、爱好、客户经营阶段、客户优先级、转介绍优先级、婚姻情况、首次接触日期及人物备注；姓名继续保留为各业务行的展示快照。
- 招募优先级归 `recruit_candidates`。原客户表中 558 条没有招募记录的非空优先级自动生成 558 条招募记录；已有招募记录承接原优先级，已删除状态保留。
- 嘉宾的电话、微信、机构、来源与 Person 合并；客户和嘉宾表中的重复人物字段已移除。
- Person 目录加入客户/招募/转介优先级、本次/下次跟进日期、转客户/转增员列。优先级和日期支持排序；旧“优先级”和“客户经营阶段”列移除。回收站按角色展开对应优先级多选，按“搜索”才应用。
- 显示方案：Person 360 是完整且唯一的人物资料编辑入口；客户、招募、嘉宾等业务表单只展示姓名、电话、职业、机构等少量只读人物上下文并提供人物入口；业务自身字段仍留在相应角色页面。完整评估见 `specs/person-field-ownership/design.md`。

## 迁移与部署

- `20261012100000_person_field_ownership_expand` 已成功应用：扩展人物/招募字段、按 Person 优先规则补齐空值，并创建 558 条招募承接记录。
- `20261012110000_person_field_ownership_contract` 已成功应用：重建 11 个依赖视图、更新人物列表和回收站函数/授权、移除客户和嘉宾重复字段。
- `20261012120000_person_trash_rpc_service_only` 已成功应用：撤销回收站 RPC 对 anon/authenticated 的执行权，只保留 service_role；同步把该新增公开函数的精确权限加入 catalog allowlist。
- 两条迁移各自带 rollback SQL。历史迁移账本未记录 `20261011120000` / `20261011130000`，但线上删除批次对象已存在，且线上 `crm_delete_batch` 与 `20261011130000` 定义一致；本轮未重放旧迁移，也未改历史账本。
- 已部署 12 个受影响 CRM 云函数：`assistant`、`activity_reports`、`activity_speakers`、`ai_activity`、`ai_followup`、`ai_recommend`、`ai_referral`、`customers`、`person_360`、`policy_review_reports`、`recruit_candidates`、`today_coach`。
- 已上传 9 个明确变更的页面文件，包括 `admin.html`、Console 样式、人物/回收站/编辑器模块。线上静态首页哈希匹配；51 个可达静态资源匹配；29 个 CRM 函数的 175 个源码/配置文件匹配。

## 验证

- `npm test`：107 PASS、0 FAIL、5 SKIP。普通沙箱首次运行因 loopback 浏览器目标不可访问失败；在允许本机隔离浏览器访问后重跑通过。
- `npm run test:wp05`：8/8 PASS；`npm run test:people-pages`：2/2 PASS。
- `npm run test:wp01`：12/12 本地 WP01 用例 PASS；安全发布报告为 `PASS_WITH_LIMITATIONS`，catalog 823 项、匿名网关 61/61 PASS，完整回归 107/0/5。
- `npm run check:shared`：58 个共享副本 / 29 个函数一致；`git diff --check`、变更 JS 语法检查通过。
- 只读线上核验：558 条迁移标记记录；招募优先级总数 574、未删除 571；客户与嘉宾重复列不存在；人物列和招募优先级列存在；8 个关键依赖视图均成功查询；回收站 RPC 的 anon/authenticated 执行权为 false，service_role 为 true。

## 未执行项

- 未使用真实客户数据进行写入或删除测试；WP01 报告中的 `service-runtime` 与 `live-writes` 仍为 UNVERIFIED，需后续使用隔离的虚构记录和获准账号运行真实服务流程。
- 未提供手工登录后的生产浏览器走查证据；WP01 login 状态为 `MANUAL_LOGIN`。手机布局不属于本工作包验收范围。
- 自动化发布门槛允许上述已登记限制，不代表这些项目已通过运行时验证。

## Git 发布

发布提交、标签、推送和发布后本地/远端核对结果列于本轮交付报告。
