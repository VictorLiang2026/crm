# 技术设计：每日行业激励语

## 页面与交互

- 今日页新增窄幅语录区，放在页面标题下方；显示短句、主题、来源和时段标签。
- 右侧小型菜单提供“更换”和“保持”。更换成功后立即更新当前展示；保持只关闭菜单。
- “更多”增加“每日激励语”入口，进入原生 console 子路由；维护列表支持中英文本、主题、来源组织/材料/URL、启停状态、编辑和时段设置。
- 视觉继承现有 CRM console 组件、暖色调和图标；新增所有 UI 文本进入 `i18n.js`。

## 服务与数据

- 复用 `assistant` 函数的已认证路由、服务端 `CRM_ASSISTANT_DB_API_KEY` 和 `public` RPC；不新增 Cloud Function，不在浏览器暴露 API Key。
- 新 Skill `daily_inspiration` 注册输入/输出 Schema；AI 输出仅为 `quoteId`。Gateway 继续使用 `AI_GATEWAY_GROUP` / `AI_GATEWAY_MODEL`，默认 CloudBase `cloudbase` 组，不绑定模型厂商或型号。
- 新表：`public.daily_inspiration_quotes`（语录与来源）、`public.daily_inspiration_settings`（UID、时区、两个生效边界及待生效配置）、`public.daily_inspiration_slots`（用户/本地日期/时段的稳定选择）、`public.daily_inspiration_history`（展示与更换历史）。均启用并强制 RLS，直接访问只授予 `service_role`。
- 新 RPC `public.crm_daily_inspiration_v1(text,text,jsonb)` 只授予 `service_role`。每次操作校验 `crm_access_members.enabled` 中的服务端 actor；允许列表/编辑/启停/设置/候选读取/选择与更换。客户端不得传 actor UID。
- `get` 若槽位已存在，直接读稳定结果；否则取候选、调用 AI、再由 RPC 在事务中复核启用状态并幂等写入。AI 不可用时按日期/时段稳定散列回退。改动时段后次日本地日生效。
- 历史保留 90 天；正常选取排除近 30 天展示项；近期更换项额外排除 60 天；候选不足时放宽至 14 天再回退到所有启用语录。

## 兼容与安全

- 首页原问候、其他卡片、更多既有入口与 `admin.html` 旧实现保持不变。
- 新接口只接收白名单字段，身份从 `assistant` 已验证会话取得；操作落在单一参数化 public RPC，函数 `SECURITY DEFINER` 使用固定 `pg_catalog` 搜索路径并检查 `current_user='service_role'`。
- 语录只能由人工编辑；AI 不创建、编辑、启停语录，不写入客户/活动/销售业务数据。
- migration 与配套 rollback 均提供；rollback 对含真实数据的表采取拒绝删除策略。

## 验证策略

- 检查 Skill Schema、Gateway 选择与候选验证、RPC 白名单/授权、日期时段边界、重复避让和不足回退。
- 浏览器回归：今日页读取/更换/保持；More 入口、编辑、启停和时段保存；英文和简体中文切换。
- 旧流程回归：登录/会话、首页数据卡片、More 既有导航；CloudBase assistant 相邻 AI 路由保持可用。
- 发布时只部署 `assistant` 和明确变更的 JS/CSS 模块；数据库只运行新 migration。
