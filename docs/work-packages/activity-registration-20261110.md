# 活动报名独立模块（2026-11-10）

## 目标与边界

- 每个既有活动可配置一条独立公开报名页；页面由活动标题/时间地点、图片、文字段落和少量自定义表单组成。
- 报名者不创建 CloudBase Auth 用户，不写 Person；姓名和电话/微信号只是本次活动联系信息。
- 报名提交后产生随机 256-bit 管理凭证，数据库只存 SHA-256 摘要；明文凭证只在提交响应或员工重发时出现，放在 URL fragment，不随页面请求自动发送。客户可将已有专属管理链接粘贴到另一活动页，同一凭证汇总跨活动报名；系统不按电话/微信号猜测身份或合并记录。
- 同一管理凭证可以查看持有人主动关联的多场报名。持有人可逐条修改待审核或候补的报名。审核通过或未通过后，该条报名锁定。工作人员重发管理链接时，整组报名同时转到新凭证。
- 工作人员登录现有 CRM 后才能配置页面、查询和审核报名。审核通过后，工作人员可显式搜索并关联已有 Person；不自动创建、猜测或合并 Person。
- `public.activity_registration_people` 保存报名与活动、Person 的业务关联。单条报名最多关联一个 Person，同一 Person 可关联多个活动报名；同一活动不会重复关联同一个 Person。活动和 Person 的反向历史均可查询。
- Legacy 活动参与者、签到、`admin.html` 单文件业务实现及其云函数行为保留。

## 页面与交互

### 公开报名页

`/crm/activity-registration.html?slug=<short-name>`：暖白底色的编辑式活动邀请；首屏展示封面与标题，随后是活动时间/地点、简介和图文段落，报名表单保持窄列。iPhone 使用单列，iPad 使用内容区加表单两列；中文默认，可切换英文。

姓名必填，电话和微信号至少填一项；编辑器另支持最多 12 个 text/textarea 字段。已有报名者可粘贴之前的管理链接；系统校验其凭证并将新活动报名关联到同一凭证。提交成功后在当前地址 fragment 写入管理凭证，页面汇总其活动报名状态，客户可跳转查看或修改各条待审记录。

### CRM 报名管理

活动工作台新增“报名管理”入口。员工可选择活动，编辑标题、短链接名、简介、HTTPS 封面/正文图片地址、文字段落及表单字段；状态可保存草稿、发布或关闭。页面目录提供编辑和复制公开链接。

报名审核列表按状态筛选。员工可通过/拒绝/加入候补、标记已联系通知，以及重发管理链接（旧凭证立即失效）。仅审核通过的报名显示人物搜索；员工选择具体候选后建立关联。人物报名历史和单个活动已关联 Person 可互相查询。

## 数据与安全

Migrations `20261110110000_activity_registration.sql` 与 `20261110160000_activity_registration_shared_token.sql` 仅在 `public` 创建四表并支持一凭证多报名；配套 rollback 在存在跨活动共享凭证时拒绝恢复唯一约束，首迁移的 rollback 有报名数据时拒绝删表。报名表、页面、关系和审计记录均启用并强制 RLS，撤销 `PUBLIC`、`anon`、`authenticated`，只向 `service_role` 授权。浏览器不直连 PostgreSQL。

专用 `activity_registration`（员工后台）和 `activity_registration_public`（客户公开页）云函数使用仅存于函数配置的 `CRM_ACTIVITY_REGISTRATION_DB_API_KEY`，REST profile 固定为 `public`，资源访问采用固定表白名单。两个函数包共享报名业务和回包加密代码，员工入口额外校验设备；公开 handler 只允许页面读取、提交、凭证管理 action。OPA 只把公开函数路径加入匿名 allowlist，后台函数路径仍由匿名 deny 拦截；员工后台操作还校验 CloudBase 调用者身份。浏览器只使用可公开发布密钥调用公开函数，不登录、不匿名登录、不创建 CloudBase 用户。

网关 OPA 仅新增默认 HTTPSERVICE 域名上的 `POST /v1/functions/activity_registration_public` 匿名例外；后台函数及其他函数不开放匿名访问，现有知识服务路径规则保持原样。公开报名页不上传文件，图片通过 HTTPS URL 配置。

2026-11-11 候选版本新增 `20261111230000_activity_registration_write.sql` 和配套 rollback。报名写入、容量检查、审核、手工关联人物以及同组凭证轮换在数据库事务中处理。该函数使用调用者权限，仅授予 `service_role` 执行权限。编辑已建页面时保留其活动归属。

涉及管理链接、联系方式及员工数据的成功结果使用当前页面生成的公钥加密。浏览器在本次页面会话中解密。公开活动介绍仍可直接读取。

## 生产影响

- 新增公开静态文件 `/crm/activity-registration.html`、样式和公开脚本。
- 新增 `activity_registration` 后台和 `activity_registration_public` 公开云函数与函数配置；既有页面仅新增 Console router/module/i18n/活动入口，不改 `admin.html`。
- 新增四张 `public` 表和服务端 API key；不改现有业务字段、视图、Person 创建流程或历史活动参与者。
- 回滚前需先停止公开入口/函数并评估是否有真实报名数据；migration rollback 会在发现数据时失败，不自动删除报名数据。

## 验收记录

见 [release-20261110-activity-registration.md](../testing/release-20261110-activity-registration.md)。

## 发布状态（2026-11-10）

- 本地测试已通过：活动报名 10/10，PC16/17/18 相邻回归 11/11，public catalog 单元测试 8/8，模块化门禁与共享模块哈希通过。
- 两条 public-schema 活动报名 migration 已应用并核验；报名表无记录。表授权仍仅为服务角色。
- WP01 发布门禁因五个设备委托/上传对象不在当前安全基线而阻断。数据库目录显示其中 `public.crm_device_delegate_v1(p_op text, p_args jsonb)` 为 SECURITY DEFINER 且 anon 可执行。相关代码/迁移是并行工作区变更，本工作包没有修改或纳入基线。
- 因安全门禁阻断，本轮没有创建服务 API key、部署公开/后台函数、更新线上 OPA、上传静态页，也没有 Git 提交/推送/发布标签。待设备对象获得独立审查并更新其安全基线后，再从发布门禁重新开始。
