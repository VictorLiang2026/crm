# 招募目标设定和分析工作包

日期：2026-10-26。发布前 GitHub `master` / 本地基线 `a7ded2faec245aef7efa83639074994cb6c514ac`，回退标签 `release-20261026-220131`。依据用户对招募报表和入口的明确要求，独立于正在修改的招募目录工作包实施。

## 影响与兼容

- 招募列表仍是候选人目录；仅把原“月度目标”按钮改为左侧“目标设定和分析”，置于“自然语言删除”之前。原 `#/recruit/goals` 路由不变。
- 统一页新增目标与实际阶段图、当前八阶段存量图、三项区间指标；原区间表、逐月表、月目标编辑、上月草稿、个人转化假设及事务保存保留。
- 区间目标/实际沿用 `recruit_goals.getProgress` 的里程碑次数口径；当前存量沿用 `recruit_candidates.funnel`，不受月份筛选。两个口径在页面明确区分。旧记录 ID、权限、数据库对象及云函数均不改变。
- 新增文案全部经 `i18n.js` 提供简体中文与英文；仅按 iPad 验收界面。

## 模拟验证

- `tests/pc21/recruit-goals.browser.cjs`：模拟起止月查询、当前八阶段分布、月目标原事务保存与页面布局，已通过。
- `tests/more-consolidation/l06-recruit-goals.browser.cjs`：上月草稿不自动保存、个人假设版本冲突、中英文及 820/1180 宽布局，2 项通过。
- `tests/more-consolidation/m07-recruit-goals.browser.cjs`：目标差额与保存后刷新，1 项通过。
- 完整 WP01 发布门禁 `PASS_WITH_LIMITATIONS`：跨模块回归 108 PASS / 0 FAIL / 5 既有 SKIP；匿名探测 76/76，public 对象 1122 项无漂移；PC34 权限、service_role 只读访问、Person 链路、iPad 双语均通过。
- 浏览器模拟截图 `tests/security/.results/recruit-goal-analysis-zh.png` 已检查，1180px 页面三项指标与两列阶段图可读，无横向溢出。真实账号和生产目标写入未执行；不使用真实客户数据做写入试验。
- 仅上传 `crm/css/console.css`、`crm/js/modules/console/i18n.js`、`crm/js/modules/console/pages/recruit.js`、`crm/js/modules/console/recruit-goals.js`；线上 HTTP 内容 SHA-256 与本地 4/4 一致。CloudBase 函数与 public 数据库对象没有本轮变更。
- GitHub 发布标签：`release-20261026-230432`；提交与主目录快进核对见本轮发布输出。

## 回退

从 `release-20261026-220131` 取回本轮四个静态文件并重新部署，创建恢复提交与标签；数据库和业务数据无需回滚。若新分析图加载失败，原区间表与目标编辑按原服务接口继续可用。
