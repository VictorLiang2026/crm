# 嘉宾与主题统一维护工作包

日期：2026-10-26。发布前本地及 GitHub `master` 为 `efe6f104406e90242b81df546e8100a2deca3c90`，回退标签 `release-20261026-230432`。

## 影响与兼容

- Console 的 `#/activity-resources` 增加明显的“嘉宾资料 / 活动主题”切换，分别沿用现有搜索、分页、新增、编辑和受控删除流程；活动内嘉宾和主题引用不变。
- 嘉宾卡片提供 Person 主资料入口；已关联嘉宾编辑时姓名只读，活动展示头衔、合作阶段、话题、联系安排等保存在嘉宾资源中。Console 优先展示 Person 主数据。
- 按用户确认，Console 新建嘉宾须先解析并人工选择 Person；无匹配时引导先到人物页建立或核实 Person。关闭 Console 的“暂存未识别嘉宾姓名”入口。
- 线上只读核对：5 位在用嘉宾全部关联有效 Person，无姓名快照差异；在用主题 1 条。`public.activity_speakers.name` 历史快照列、记录 ID、旧 `admin.html` 和既有函数都保留。旧入口仍可创建未关联 Person 的嘉宾；若要求全系统强制约束，需单独评估并确认对旧流程的影响。
- 没有数据库、云函数和权限变更。新增或调整的界面文案经 `i18n.js` 提供中英文。

## 验证

- M06 资源目录模拟浏览器用例：Person 链接、只读姓名、无匹配引导、临时姓名入口关闭、嘉宾/主题切换、筛选分页、异常重试、中英文和 820/1180px iPad 宽度，通过。
- PC17 嘉宾/主题与 Person 身份、写入范围用例 4/4 通过；既有 L05 嘉宾目录用例保持通过。
- 完整 WP01 门禁 `PASS_WITH_LIMITATIONS`：跨模块 108 PASS / 0 FAIL / 5 既有 SKIP；匿名探测 76/76；public 对象 1122 项无漂移；PC34 身份、权限及双语 iPad 检查通过。真实账号登录、生产写入和手机验收未执行。

## 发布与回退

仅发布 `crm/js/modules/console/activity-people.js`、`crm/js/modules/console/i18n.js`、`crm/css/console.css`；发布后核对线上 HTTP SHA-256、GitHub `master` 与本地提交。回退时从 `release-20261026-230432` 恢复以上三个静态文件并重新部署，另建恢复提交与标签；无需数据库回滚。
