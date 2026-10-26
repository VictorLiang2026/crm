# 设计与兼容

采用现有 Console 品牌色：红色表示主操作，墨色为结构，金色表示目标，翠色表示实际/达成。沿用 Console 现有中英文字体与卡片组件，iPad 采用上方区间筛选、三张关键指标、两列阶段可视化、下方月度明细和目标编辑的层级。

`recruit_candidates.funnel` 返回当前候选人存量；`recruit_goals.getProgress(startMonth,endMonth)` 返回区间里程碑达成与目标。两类结果分别标注来源，原服务口径不变。失败时分别显示错误，另一块可用数据不受遮蔽。历史表、目标编辑及高级假设控件继续复用现有实现。

改动范围：`pages/recruit.js` 入口位置与名称，`recruit-goals.js` 展示结构，`i18n.js` 文案，`console.css` 样式及相邻模拟浏览器测试。发布只上传这四个静态文件，不改后端和数据库。
