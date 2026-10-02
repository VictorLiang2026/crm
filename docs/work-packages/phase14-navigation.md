# Phase 14｜主导航与 Legacy Governance

## 范围

2026-10-02 的工作包仅调整导航与入口。主导航为「今日、AI助手、人、机会、活动、招募、更多」，顶部持续提供「＋ 快速记录」。新增人物、机会的只读分页目录和「更多」入口；Person 360 成为人物主入口。

原 `#/`、`#/customer/:id` 及其他旧路由继续由原处理函数提供。旧客户详情、Today、活动、招募、回收站、Quick Capture 的业务写入流程不变。Person 360 保留进入传统客户详情的链接。没有数据库迁移、权限或模型配置变更。

## 影响与验证

- 页面：`admin.html` 主导航、Person 360 返回入口、新增 `#/ai`、`#/people`、`#/opportunities`、`#/more` 及「更多」内旧功能选择器。
- 接口：`person_360` 增加需真实登录的只读 `listPeople`、`listOpportunityDirectory`；仅从 `public` 读取有限字段，最多每页 50 条。不改旧接口返回。
- 数据：不新增、不更新、不删除业务记录。
- 回滚：恢复本工作包的 `admin.html`、`crm/js/modules/person-360.js`、`cloudfunctions/person_360/index.js`；删除本工作包新增的静态资源，并重新部署这些明确产物。Git 使用上一发布标签恢复源码；不需要数据库回滚。

## 回归记录

本地隔离回归：`npm test`，94 PASS、0 FAIL、5 SKIP；新增页面路由、主导航、人物/机会目录、旧跟进入口、登录、客户详情、Today、活动、招募、回收站与快速记录均通过。`node --test tests/phase14/person-directory.cjs`：3 PASS、0 FAIL。线上业务操作需在部署后单独核对；源码哈希一致不代替业务验证。

本轮只发布 `person_360` 函数，以及 `admin.html`、`person-360.js`、`phase14-hubs.js`、`phase14-navigation.css` 四个静态文件。部署后 `sync-check.ps1 -CloudOnly` 核对线上首页与 28 个函数、147 个源码/配置文件一致；本轮新增/修改的三个模块与样式文件也分别通过线上 SHA-256 核对。独立证据目录：`D:\Temp\crm-cloud-audit-da88fd1052044b9497c3586437225a06`。尚未执行真实登录后的线上人物/机会目录浏览。
