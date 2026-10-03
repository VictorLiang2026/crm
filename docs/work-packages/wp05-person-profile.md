# WP05 Person 360 身份与客户资料操作补齐

状态：WP05 实现与业务验收通过；发布标记以提交、推送、标签和三端核对成功为准。用户已专项确认本 WP 范围。

## 基线与范围

2026-10-03 修改前，本地/GitHub/云端一致：`5f83345f6ed0b9f9abf536787d7b011e8fd7566f`，标签 `release-20261003-134000`。20 个静态产物、28 个函数的 159 个源码/配置文件一致，56 份共享副本一致。证据目录 `C:\Users\victor\AppData\Local\Temp\crm-cloud-audit-a772a047f932402e941d7dd9338d0ec1`。

已读取根 AGENTS、环境和安全边界，以及 `specs/target-crm-v1/` 三份需求/设计/任务文件。只核对 public：customers 29 列、persons 16 列、person_roles 6 列。人物/角色仍仅服务端角色有表权限，没有扩大 GRANT/RLS。

影响 Person 360 页面、新的 person_360.getCustomerProfile 只读动作、admin.html 的旧详情页签桥接。客户编辑仍由原 customers.update 和原表单负责；旧 URL、家庭/机会/活动/招募/回收站和身份映射保持现有行为。无 schema 变更，无 migration/rollback 要求，无数据库写入，无新增样本。

## 逐字段对应

| 旧客户字段 | Person 360 拟实现查看位置 | 唯一编辑入口 |
| --- | --- | --- |
| customer_name 姓名 | 常用资料 | 旧详情基本信息 |
| phone 电话 | 常用资料/手动复制 | 旧详情基本信息 |
| source 来源 | 常用资料 | 旧详情基本信息 |
| gender 性别 | 常用资料 | 旧详情基本信息 |
| birthday 生日 | 常用资料 | 旧详情基本信息 |
| occupation 职业 | 常用资料 | 旧详情基本信息 |
| hobbies 爱好 | 常用资料 | 旧详情基本信息 |
| customer_stage 经营阶段 | 常用资料 | 旧详情基本信息 |
| sales_priority 销售优先级 | 常用资料 | 旧详情基本信息 |
| recruitment_priority 招募优先级 | 常用资料 | 旧详情基本信息 |
| referral_priority 转介绍优先级 | 常用资料 | 旧详情基本信息 |
| additional_info 附加信息 | 更多资料 | 旧详情基本信息 |
| marital_status 婚况 | 更多资料 | 旧详情基本信息 |
| tags 标签 | 更多资料 | 旧详情基本信息 |
| annual_income 年收入 | 更多资料 | 旧详情基本信息 |
| household_income 家庭收入 | 更多资料 | 旧详情基本信息 |
| properties_info 房产信息 | 更多资料 | 旧详情基本信息 |
| first_contact_date 首次接触日期 | 更多资料 | 旧详情基本信息 |
| profile 的 family/children/parents/career/needs/relationship/events | 单一跳转至旧客户画像 | 旧详情客户画像 |

customers.wx_account/education/mbti 已存在，但不在旧客户基本信息编辑白名单；本轮只读展示，不增加第二套编辑器。独立人物展示 persons 相应字段和 organization；已关联客户不混用 Person 历史值。角色显示 person_roles.role/origin，明确是登记身份而非当前经营阶段。Person 名称是身份名称，客户资料姓名取客户最新值，不自动合并或同步身份。

设计延续项目资料卡；现有字体 Segoe UI/PingFang SC/Microsoft YaHei 等继承，不引入新字体或框架。色值沿用 #ffffff、#0f172a、#64748b、#e5e7eb；资料两列/手机单列、按钮换行、联系按钮最小 44px。测试数据或标记未核验时禁用复制；无拨号、短信、微信启动或其他外发。

## 验证与恢复

- 新服务及前端语法检查、模块边界检查通过；原家庭服务 5 项通过。
- WP05 专项 8 项通过：只读实时来源、空联系方式不回退、客户不可用、独立人物、样本联系禁用、非法身份、来源/角色、旧编辑入口、异常重试和手机尺寸场景。360/390/768px 为隔离浏览器模拟，不是真机。
- 本轮权限目录检查 646 项通过。
- 首次完整门槛在 guard-tests 阶段停止：新 critical 项 `wp05-profile` 已加入运行器，但门槛自测夹具遗漏。用户要求继续验收后，仅补齐该夹具，保留 WP05 必检项。复跑 12/12 门槛自测通过；WP01 报告 `PASS_WITH_LIMITATIONS`，646 项权限、50 项匿名拒绝、WP02 17、WP03 18、WP04 8、WP05 8、旧功能 94 项通过，旧回归 0 失败、5 项标注跳过。
- `person_360` 一项函数与 `admin.html`、`person-360.js`、`person-profile.js`、`person-360.css` 四个静态文件已单独部署。静态 21 个实际可达引用文件 SHA-256 与云端相同；28 个函数、160 个源码/配置文件与云端一致，云端只读证据 `C:\Users\victor\AppData\Local\Temp\crm-cloud-audit-d752e004b2004e9a9288d8f0a4b43a80`。GitHub/标签由发布后的完整 sync-check 核对。
- `prtest` 已在隔离真实窗口登录。先跑 14 项只读 dry-run，再按原客户表单“确定”保存：public.customers #788（已登记虚构样本）的 occupation 从 NULL 改为 `【系统测试·勿联系】虚构资料验收职业`，初始/衍生/AI 审计新行均为 0。Person #783 返回后立即显示新职业，其他客户资料字段不变，台账计数仍 10/2/3。测试样本复制按钮禁用，未外发。报告 `tests/security/.results/wp05-live.json`。
- 真实相邻只读回归 66 项通过：登录、53 个 authenticated 直接读拒绝、无效种子拒绝、测试场景/Person/旧客户/活动/漏斗及 390px 模拟页面。报告 `tests/security/.results/wp03-readonly-live.json`。这不等于实体手机测试。

## 新文件、未验证与回滚

新增 `cloudfunctions/person_360/customer-profile-service.js`、`crm/js/modules/person-profile.js`、`tests/wp05/profile.test.cjs`、`browser.test.cjs`、`live.cjs`、`README.md` 和本报告。改动涉及旧页面桥接、Person 360 模块/样式、函数分发、测试夹具、测试运行器和 package 脚本。

未验证项：实体手机操作、服务角色独立运行时探针，以及非本 WP 的真实外发。登录和虚构客户旧表单写入已由上述真实验收覆盖。Git 提交/推送/标签及最终三端核对以发布脚本输出为准，不由本报告预先宣称通过。

代码回滚基于 WP04 标签 `release-20261003-134000`，只恢复本轮 `person_360` 与四个静态文件并创建恢复提交，不强推、不删除原有对象。数据库无结构变更；真实测试职业原值 NULL 已由受保护的 `wp05-live.json` dryRun.before 留存，必要时经原客户表单清空恢复，不直接批量写库。
