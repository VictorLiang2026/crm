# PC35 设计

`#/people-trash` 沿用 `person_360.listPersonTrash/restorePerson`；新增 `#/recycle/customers` 调用 `customers.trashList/restore`，`#/recycle/recruit` 合并 `recruit_candidates.trashList` 和 `person_360.listPersonOnlyRecruitTrash`，根据来源分别调用原恢复动作。每行展示删除时间、批次范围、同批跟进计数及逐条确认入口。旧 `admin.html` 路由从 More 的兼容区继续可达。新文案集中于 Console `i18n.js`。

浏览器夹具提供非空、历史无批次、成功和失败结果；先复现人物页异常，再修复。生产写入只针对已登记虚构 #786，并经应用登录及人工预览确认。若服务端返回权限或并发错误，界面保留错误并允许重新加载，不自动重试写入。
