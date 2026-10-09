/**
 * 生成 Victor's CRM UI/交互优化方案 Word 文档
 * 依赖: docx@9.7.1（项目已安装）
 * 运行: node tools/gen-ui-optimization-doc.cjs
 * 输出: docs/CRM-UI交互优化方案.docx
 */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType,
  PageBreak, ShadingType,
} = require('docx');

const RED = 'D31145';
const INK = '2E333B';
const GOLD = 'A87A1E';
const MUTED = '8A93A1';

function run(text, opts = {}) { return new TextRun({ text, ...opts }); }
function h(text, level) {
  return new Paragraph({
    children: [run(text, { bold: true, color: level === HeadingLevel.HEADING_1 ? RED : INK })],
    heading: level, spacing: { before: 320, after: 140 },
  });
}
function p(text, opts = {}) {
  return new Paragraph({ children: [run(text, opts)], spacing: { after: 80, line: 340 } });
}
function pMix(runs) {
  return new Paragraph({ children: runs, spacing: { after: 80, line: 340 } });
}
function bullet(text, level = 0) {
  return new Paragraph({ children: [run(text)], bullet: { level }, spacing: { after: 50, line: 320 } });
}
function cell(text, opts = {}) {
  return new TableCell({
    children: [new Paragraph({ children: [run(text, { bold: !!opts.bold, size: opts.size || 18, color: opts.color || INK })] })],
    shading: opts.shading ? { fill: opts.shading, type: ShadingType.CLEAR, color: 'auto' } : undefined,
    width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
  });
}
function table(rows) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((r, i) => new TableRow({
      children: r.map((c) => {
        if (c instanceof TableCell) return c;
        return cell(c, { bold: i === 0, shading: i === 0 ? INK : undefined, color: i === 0 ? 'FFFFFF' : INK });
      }),
    })),
  });
}
function spacer(n = 1) { return new Paragraph({ spacing: { after: n * 60 }, children: [] }); }

const children = [];

// 封面
children.push(new Paragraph({ spacing: { before: 1800 } }));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  children: [run("Victor's CRM", { bold: true, size: 52, color: RED })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { before: 120 },
  children: [run('UI 与交互优化方案', { bold: true, size: 44, color: INK })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { before: 280 },
  children: [run('面向 console.html 新入口 · iPad / iPhone 双端', { size: 26, color: MUTED })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { before: 60 },
  children: [run('先进性 · 便捷性 · 前瞻性', { size: 24, color: GOLD, italics: true })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { before: 600 },
  children: [run('版本：v1.0  |  日期：2026-10-10', { size: 22, color: MUTED })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { before: 80 },
  children: [run('维护者：Victor', { size: 22, color: MUTED })],
}));
children.push(new Paragraph({ children: [new PageBreak()] }));

// 目录
children.push(h('目  录', HeadingLevel.HEADING_1));
[
  '一、执行摘要',
  '二、当前系统现状评估',
  '  2.1 console.html 架构概览',
  '  2.2 设计系统现状',
  '  2.3 响应式与双端适配现状',
  '  2.4 admin.html 功能清单与整合缺口',
  '三、iPad 优化方案',
  '  3.1 导航与信息架构',
  '  3.2 布局与分栏体验',
  '  3.3 触控与手势交互',
  '  3.4 键盘快捷操作',
  '  3.5 Apple Pencil / 手写输入',
  '四、iPhone 优化方案',
  '  4.1 底部导航与层级',
  '  4.2 手势与单手操作',
  '  4.3 安全区域与刘海适配',
  '  4.4 录入与表单体验',
  '五、通用交互与设计系统优化',
  '  5.1 全局搜索（Command Palette）',
  '  5.2 加载、刷新与骨架屏',
  '  5.3 反馈机制（Toast / Dialog / ActionSheet）',
  '  5.4 空态与错误态引导',
  '  5.5 设计系统升级',
  '六、admin.html 功能整合方案',
  '  6.1 功能映射与迁移优先级',
  '  6.2 整合实施策略',
  '七、前瞻性功能规划',
  '  7.1 PWA 与离线能力',
  '  7.2 AI 对话式交互',
  '  7.3 通知中心与提醒',
  '  7.4 数据可视化增强',
  '八、实施路线图与优先级',
  '九、风险与注意事项',
].forEach((t) => children.push(p(t, { size: 22, color: t.startsWith('  ') ? MUTED : INK })));
children.push(new Paragraph({ children: [new PageBreak()] }));

// 一、执行摘要
children.push(h('一、执行摘要', HeadingLevel.HEADING_1));
children.push(p('本方案基于 Victor\'s CRM 当前开发阶段（console.html 新入口已完成 WP0~WP3 骨架、admin.html 为存量单文件实现），从先进性、便捷性、前瞻性三个维度，针对 iPad 与 iPhone 双端提出系统化的 UI 与交互优化建议。'));
children.push(p('核心结论：'));
children.push(bullet('console.html 已建立清晰的模块化架构与友邦红设计系统，具备良好的扩展基础；但在导航层级、触控反馈、动效体系、全局搜索等方面仍有较大提升空间。'));
children.push(bullet('iPad 端应充分利用大屏优势，引入侧边栏导航、左右分栏、浮窗预览、键盘快捷键与 Apple Pencil 手写支持，实现「生产力工具」级体验。'));
children.push(bullet('iPhone 端应聚焦单手操作与即时记录，优化底部导航层级、手势交互、安全区域适配与表单录入效率，让快速记录成为肌肉记忆。'));
children.push(bullet('admin.html 的存量功能（保单检视、伴手礼、照片、OCR、转介绍、今日教练、漏斗分析）需按优先级逐步迁移到 console.html，最终实现单入口整合。'));
children.push(bullet('前瞻性方向包括 PWA 离线支持、AI 对话式交互、通知中心、数据可视化增强与暗色模式，为未来 12 个月的演进奠定基础。'));
children.push(new Paragraph({ children: [new PageBreak()] }));

// 二、当前系统现状评估
children.push(h('二、当前系统现状评估', HeadingLevel.HEADING_1));
children.push(h('2.1 console.html 架构概览', HeadingLevel.HEADING_2));
children.push(p('console.html 采用模块化前端架构（crm/js/modules/console/），核心结构如下：'));
children.push(table([
  ['模块', '文件', '职责'],
  ['引导层', 'app.js', 'CloudBase 认证、5 分钟会话超时、路由分发、与 admin.html 共享活动时间戳'],
  ['壳层', 'shell.js', 'iPad 顶部导航 / iPhone 底部五格 + 中央 FAB 记录键'],
  ['路由', 'router.js', 'hash 精确路由 + 详情正则（#/person/:id、#/activity/:id）'],
  ['国际化', 'i18n.js', 'zh-CN / en 双语字典，枚举翻译集中注册'],
  ['数据', 'data.js', '经既有云函数只读取数，不直连数据库'],
  ['写入闭环', 'write.js', '服务端 preview → 人工确认 → execute 三段式'],
  ['页面', 'pages/*.js', 'today / people / person / opportunities / activities / recruit / ai / more / settings'],
  ['样式', 'css/console.css', '友邦红设计系统 + 响应式断点（820px / 480px）'],
]));
children.push(spacer());
children.push(p('优势：架构清晰、职责分离、i18n 完整、写入闭环安全可控；劣势：导航项偏多（7 项）、缺少全局搜索、触控反馈依赖 hover、动效体系单薄。'));

children.push(h('2.2 设计系统现状', HeadingLevel.HEADING_2));
children.push(table([
  ['维度', '当前实现', '评估'],
  ['主色', '友邦红 #D31145', '品牌识别度高，语义明确'],
  ['语义色', '红=主行动 / 墨=中性 / 金=机会 / 翠=完成', '四色语义体系清晰，利于快速决策'],
  ['字体', '-apple-system, PingFang SC, 15px/1.55', '系统字体栈，渲染清晰'],
  ['圆角', '卡片 14px / 按钮 10px / 头像 16px', '统一但层级感不足'],
  ['阴影', '单层 0 1px 2px + 0 6px 18px', '偏平，缺少深度层级'],
  ['断点', '820px（iPad/桌面切换）、480px（小屏）', '断点合理，但缺少 1024px iPad Pro 细分'],
  ['动效', 'fadeIn / skim 骨架 / toastin', '仅基础加载反馈，缺少页面转场与微交互'],
  ['暗色模式', '未实现', '前瞻性缺口'],
]));

children.push(h('2.3 响应式与双端适配现状', HeadingLevel.HEADING_2));
children.push(pMix([run('iPad / 桌面（≥821px）：', { bold: true }), run('顶部固定导航栏 7 项 + 右侧快速记录按钮 + 头像；主区最大宽度 1180px 居中。')]));
children.push(pMix([run('iPhone（≤820px）：', { bold: true }), run('隐藏顶部导航，显示底部五格 Tab（今日 / 人物 / [FAB记录] / 机会 / 更多），活动/招募/AI 收进「更多」；主区 padding 适配 tabbar 高度。')]));
children.push(pMix([run('安全区域：', { bold: true }), run('底部 tabbar 已使用 env(safe-area-inset-bottom)；但顶部刘海区域未做 env(safe-area-inset-top) 适配，在 iPhone 刘海机型上顶栏可能被遮挡。')]));
children.push(pMix([run('触控目标：', { bold: true }), run('按钮高度 40px（低于 44px 推荐值），FAB 56px（达标），底部 Tab 触控区约 76px（达标）。')]));

children.push(h('2.4 admin.html 功能清单与整合缺口', HeadingLevel.HEADING_2));
children.push(p('admin.html 为存量单文件实现，包含三大模块（客户经营 / 组织发展 / 活动经营），以下功能尚未在 console.html 中落地：'));
children.push(table([
  ['功能模块', 'admin.html 实现', 'console.html 状态', '整合优先级'],
  ['客户详情-保单检视', '二维表浏览/编辑态，产品录入', '骨架（insurance 页签只读）', 'P1'],
  ['客户详情-伴手礼', '礼物记录与管理', '未实现', 'P2'],
  ['客户详情-照片', '照片网格、上传、备注', '未实现', 'P2'],
  ['客户详情-OCR', 'OCR 记录查看', '未实现', 'P3'],
  ['客户详情-转介绍', '转介绍表单 + AI 建议', '未实现', 'P2'],
  ['今日教练', '周期性辅导复盘', '未实现', 'P1'],
  ['漏斗分析', '客户/机会/招募三漏斗 + AI 洞察', '招募有漏斗，客户/机会缺', 'P1'],
  ['AI 画像分析', '客户画像 AI 分析', 'Person 页有 AI 摘要入口', 'P1'],
]));
children.push(new Paragraph({ children: [new PageBreak()] }));

// 三、iPad 优化方案
children.push(h('三、iPad 优化方案', HeadingLevel.HEADING_1));
children.push(p('iPad 是 CRM 的主力生产力场景，应充分利用 10.9~13 英寸大屏与多点触控优势，打造「专注、高效、沉浸式」的工作台体验。'));

children.push(h('3.1 导航与信息架构', HeadingLevel.HEADING_2));
children.push(pMix([run('现状问题：', { bold: true }), run('顶部导航 7 项在 iPad 上可接受，但活动/招募/AI 与今日/人物/机会的使用频率差异较大，平铺导致注意力分散；从列表进入详情后缺少面包屑，返回路径不清晰。')]));
children.push(p('优化方案：'));
children.push(bullet('引入左侧可折叠侧边栏导航（Drawer），将 7 项主功能垂直排列，当前页高亮，折叠时仅显示图标。释放顶部空间给全局搜索与上下文操作。'));
children.push(bullet('顶部栏改为「全局搜索框 + 页面标题 + 上下文操作 + 头像」，搜索框支持 Cmd+K 唤起，显示最近访问与快捷操作。'));
children.push(bullet('详情页增加面包屑导航（人物目录 > 张三 > 机会），支持逐级返回；在 iPad 上分屏时面包屑可帮助用户定位上下文。'));
children.push(bullet('支持 iPad 多窗口（Stage Manager）：在新窗口打开 Person 详情，实现列表与详情并排查看。'));

children.push(h('3.2 布局与分栏体验', HeadingLevel.HEADING_2));
children.push(p('优化方案：'));
children.push(bullet('Person 360 改为左右分栏：左侧为 8 个页签的垂直导航（240px），右侧为内容区（自适应）。当前水平 Tab 在 8 项时换行，体验不佳。'));
children.push(bullet('今日页采用三栏布局：左侧晨间简报 + 优先行动（主），中间待确认候选 + 承诺（次），右侧今日节奏 + 机会速览（辅）。充分利用 iPad 宽屏。'));
children.push(bullet('机会看板支持拖拽排序（Drag & Drop），将卡片在「发现→沟通→方案→成交」四列间拖动推进，比当前点击「推进」按钮更直观。'));
children.push(bullet('人物目录支持「表格 / 卡片」双视图切换：表格适合批量浏览，卡片适合触控点击与头像展示。'));
children.push(bullet('活动详情的 7 个页签改为顶部图标 Tab + 左右分栏，左侧显示活动基本信息，右侧显示当前页签内容。'));

children.push(h('3.3 触控与手势交互', HeadingLevel.HEADING_2));
children.push(p('当前交互大量依赖 :hover 状态，在 iPad 触控场景下无反馈。优化方案：'));
children.push(bullet('所有可点击元素增加 :active 态反馈（背景色变化、轻微缩放 transform: scale(0.98)），让用户感知到点击生效。'));
children.push(bullet('列表行支持左滑操作（Swipe Actions）：左滑显示「完成 / 编辑 / 删除」快捷按钮，减少进入详情的步骤。'));
children.push(bullet('长按（Long Press）呼出上下文菜单（Context Menu）：对人物卡片长按显示「快速记录 / 新建机会 / 标记优先」等操作。'));
children.push(bullet('双指缩放（Pinch to Zoom）：在照片墙、保单表格等场景支持捏合缩放。'));
children.push(bullet('触控目标统一提升至 44×44px 最小推荐值，当前 40px 按钮略小，在 iPad 上误触率较高。'));

children.push(h('3.4 键盘快捷操作', HeadingLevel.HEADING_2));
children.push(p('iPad 外接键盘场景下，快捷键能显著提升效率。优化方案：'));
children.push(table([
  ['快捷键', '功能', '适用场景'],
  ['Cmd + K', '唤起全局搜索', '所有页面'],
  ['Cmd + N', '新建人物/机会/活动（根据当前页）', '目录页'],
  ['Cmd + Enter', '提交当前表单', '所有录入表单'],
  ['Esc', '关闭当前弹层/Sheet', '所有弹层'],
  ['Cmd + ← / →', '切换上一个/下一个 Tab', 'Person 360 / 活动详情'],
  ['数字 1~8', '快速切换 Person 页签', 'Person 详情'],
  ['Cmd + D', '标记/取消优先', '人物列表'],
  ['Space', '完成当前行动项', '今日页优先行动'],
]));

children.push(h('3.5 Apple Pencil / 手写输入', HeadingLevel.HEADING_2));
children.push(p('CRM 有大量即时记录场景，Apple Pencil 手写能显著降低录入成本。优化方案：'));
children.push(bullet('快速记录（Quick Capture）支持手写输入：在 Sheet 中增加手写区域，使用 Scribble API 或 canvas 捕获笔迹，提交时可选择「原样保存笔迹」或「转文字后保存」。'));
children.push(bullet('活动复盘支持手写标注：在活动照片上手写圈注、标注重点人物，笔迹与照片关联保存。'));
children.push(bullet('客户画像支持手写笔记：在 Person 360 的「事实/信号」页签中，可手写补充观察笔记，笔迹与文字记录共存。'));
children.push(bullet('手势快捷：Pencil 双击切换工具（笔/橡皮/选择），悬停预览（Hover）显示工具提示。'));
children.push(new Paragraph({ children: [new PageBreak()] }));

// 四、iPhone 优化方案
children.push(h('四、iPhone 优化方案', HeadingLevel.HEADING_1));
children.push(p('iPhone 是「在路上」的即时记录与快速查询场景，应聚焦单手操作、即时反馈与肌肉记忆。'));

children.push(h('4.1 底部导航与层级', HeadingLevel.HEADING_2));
children.push(pMix([run('现状问题：', { bold: true }), run('底部五格将活动/招募/AI 收进「更多」，用户需两次点击才能到达；「更多」页是 4×2 宫格，信息密度低。')]));
children.push(p('优化方案：'));
children.push(bullet('底部 Tab 改为可自定义顺序，默认：今日 / 人物 / [FAB记录] / 机会 / 活动；招募与 AI 通过「更多」入口或左滑 Tab 栏访问。'));
children.push(bullet('Tab 栏支持左右滑动切换（Swipe between tabs），在今日/人物/机会间快速滑动，减少点击。'));
children.push(bullet('「更多」页改为分组列表而非宫格：按「经营」「工具」「设置」分组，每项带图标 + 描述，比宫格更易扫描。'));
children.push(bullet('FAB 长按展开快捷操作菜单（Quick Actions）：显示「记录跟进 / 新建机会 / 活动签到 / 转介绍」，比单一记录更高效。'));

children.push(h('4.2 手势与单手操作', HeadingLevel.HEADING_2));
children.push(p('优化方案：'));
children.push(bullet('全局左滑返回（Swipe Back）：从屏幕左边缘右滑返回上一页，替代左上角返回按钮，更符合单手操作。'));
children.push(bullet('下拉刷新（Pull to Refresh）：在所有列表页支持下拉刷新，显示刷新动画与最后更新时间。'));
children.push(bullet('上滑加载更多（Infinite Scroll）：人物、时间线等长列表改为滚动自动加载，替代当前「加载更多」按钮。'));
children.push(bullet('触达区域优化（Reachability）：将关键操作按钮（如保存、完成）置于屏幕底部 1/3 区域，避免拇指够不到顶部。'));
children.push(bullet('Sheet 支持下滑关闭（Drag to Dismiss）：从 Sheet 顶部向下拖动关闭，增加阻尼感与动画。'));

children.push(h('4.3 安全区域与刘海适配', HeadingLevel.HEADING_2));
children.push(pMix([run('现状问题：', { bold: true }), run('底部已适配 safe-area-inset-bottom，但顶部导航栏在刘海机型上可能被遮挡；console.html 的 viewport meta 已有 viewport-fit=cover。')]));
children.push(p('优化方案：'));
children.push(bullet('顶部栏增加 padding-top: env(safe-area-inset-top)，确保内容不被刘海/灵动岛遮挡。'));
children.push(bullet('登录页英雄区（login-hero）的装饰圆形已使用绝对定位，需检查在刘海机型上是否溢出，增加 overflow 保护。'));
children.push(bullet('底部 Sheet 增加顶部手柄（Grab Handle），视觉提示可下滑关闭，同时增加 safe-area 底部 padding。'));
children.push(bullet('横屏适配：当前未针对 iPhone 横屏做特殊处理，建议横屏时隐藏底部 Tab，改用顶部导航，避免键盘弹出时内容被遮挡。'));

children.push(h('4.4 录入与表单体验', HeadingLevel.HEADING_2));
children.push(p('优化方案：'));
children.push(bullet('表单输入框聚焦时自动滚动到可见区域（scrollIntoView），避免被键盘遮挡；当前 Sheet 未做键盘避让。'));
children.push(bullet('日期选择器改用 iOS 原生滚轮（type="date" + appearance），比当前 text 输入更符合手机习惯。'));
children.push(bullet('语音输入：快速记录的文本域支持语音听写（iOS 原生 dictation），在麦克风图标旁增加语音输入提示。'));
children.push(bullet('表单分步引导：新建机会/人物等多字段表单改为分步式（Step Form），每步 2~3 个字段，降低认知负荷。'));
children.push(bullet('智能默认值：根据操作者信息（Victor）与上下文（当前 Person）自动填充字段，减少手动输入。'));
children.push(new Paragraph({ children: [new PageBreak()] }));

// 五、通用交互与设计系统优化
children.push(h('五、通用交互与设计系统优化', HeadingLevel.HEADING_1));

children.push(h('5.1 全局搜索（Command Palette）', HeadingLevel.HEADING_2));
children.push(pMix([run('现状：', { bold: true }), run('仅人物页有搜索框，搜索范围限于姓名；缺少跨模块全局搜索。')]));
children.push(p('优化方案：'));
children.push(bullet('顶部常驻搜索框（iPad）/ 下滑搜索入口（iPhone），支持 Cmd+K / 点击唤起全屏 Command Palette。'));
children.push(bullet('搜索范围：人物姓名、机会标题、活动名称、行动内容、事实记录，按相关度排序，显示类型标签。'));
children.push(bullet('快捷操作：搜索结果支持「回车进入详情」「Cmd+Enter 快速记录」「Tab 切换结果类型」。'));
children.push(bullet('搜索建议：显示最近搜索、热门人物、快捷动作（新建人物、快速记录、晨间简报）。'));
children.push(bullet('AI 语义搜索：已在 AI 助手页实现（aiSearch），将其能力整合到全局搜索，支持自然语言查询（如「最近没跟进的高优先级客户」）。'));

children.push(h('5.2 加载、刷新与骨架屏', HeadingLevel.HEADING_2));
children.push(pMix([run('现状：', { bold: true }), run('已有骨架屏（sk）与 loadInto 异步加载，失败可重试；但缺少加载进度指示与刷新反馈。')]));
children.push(p('优化方案：'));
children.push(bullet('增加顶部进度条（Progress Bar）：页面切换或数据加载时，顶部显示 2~4px 红条进度，类似 YouTube/GitHub，缓解等待焦虑。'));
children.push(bullet('骨架屏优化：按页面真实布局定制骨架（如今日页 4 个统计卡 + 列表行），而非通用灰色条，提升感知速度。'));
children.push(bullet('乐观更新（Optimistic UI）：完成行动项、推进机会等操作时，先更新本地状态，后台同步，失败时回滚并提示。'));
children.push(bullet('下拉刷新统一：所有列表页支持下拉刷新，刷新成功后短暂显示「已更新 · HH:mm」。'));
children.push(bullet('加载状态聚合：多个并发请求时，只显示一次全局进度条，而非各卡片独立骨架，减少视觉噪音。'));

children.push(h('5.3 反馈机制（Toast / Dialog / ActionSheet）', HeadingLevel.HEADING_2));
children.push(pMix([run('现状：', { bold: true }), run('已有 Toast 提示（toast-root），但缺少确认对话框、操作菜单、成功/失败动画。')]));
children.push(p('优化方案：'));
children.push(table([
  ['组件', '适用场景', '设计要点'],
  ['Toast', '轻量通知（保存成功、加载失败）', '2 秒自动消失，支持撤销操作（如「已删除 · 撤销」）'],
  ['Dialog', '重要确认（删除、关闭机会）', '居中模态，标题 + 说明 + 取消/确认按钮，不可点击遮罩关闭'],
  ['ActionSheet', '多选项操作（分享、导出、更多操作）', '底部弹出，支持危险操作红色高亮，iPad 改为 Popover'],
  ['Snackbar', '需要操作的提示（离线、同步失败）', '底部悬浮，带操作按钮，不自动消失或延长时长'],
  ['Badge', '未读/待处理数量', 'Tab 与导航项上显示红点或数字，今日页待确认候选数'],
]));
children.push(bullet('所有写操作必须有明确反馈：成功显示绿色对勾 + Toast，失败显示红色错误 + 可重试，处理中显示加载态禁用按钮。'));

children.push(h('5.4 空态与错误态引导', HeadingLevel.HEADING_2));
children.push(pMix([run('现状：', { bold: true }), run('已有 emptyNote（标题 + 说明）与 errorBox（错误 + 重试），但空态缺少行动引导。')]));
children.push(p('优化方案：'));
children.push(bullet('空态增加插图 + 行动按钮：如人物目录为空时显示「开始添加你的第一个客户」按钮，而非纯文字说明。'));
children.push(bullet('错误态分级：网络错误提示「检查网络后重试」，权限错误提示「联系管理员」，数据错误显示错误码 + 反馈入口。'));
children.push(bullet('首次使用引导（Onboarding）：新用户首次进入时，高亮引导全局搜索、快速记录、Person 360 等核心功能。'));
children.push(bullet('结果为空时提供筛选建议：如搜索无结果时显示「试试其他关键词」或「清除筛选条件」。'));

children.push(h('5.5 设计系统升级', HeadingLevel.HEADING_2));
children.push(p('5.5.1 暗色模式（Dark Mode）'));
children.push(bullet('基于 prefers-color-scheme 自动切换，设置页可手动覆盖；暗色背景 #1C1F26，卡片 #262A33，文字 #E8EAED，主色保持友邦红（在暗色背景上需提高亮度至 #E83A6A）。'));
children.push(bullet('语义色在暗色模式下调整饱和度，确保对比度达标（WCAG AA 级 4.5:1）。'));
children.push(p('5.5.2 动效体系'));
children.push(bullet('页面转场：路由切换时内容区淡入上移（fade + translateY 8px），时长 200ms，缓动 ease-out。'));
children.push(bullet('微交互：按钮点击 scale(0.97)、卡片悬浮 translateY(-2px) + 阴影加深、列表项左滑露出操作按钮。'));
children.push(bullet('状态过渡：机会卡片在看板列间移动时使用 FLIP 动画，数字统计变化时使用滚动数字动画。'));
children.push(bullet('动效尊重 prefers-reduced-motion：用户开启「减少动态效果」时，所有动效降级为瞬时切换。'));
children.push(p('5.5.3 间距与栅格'));
children.push(bullet('统一 8px 栅格系统：间距取 4 / 8 / 12 / 16 / 24 / 32 / 48px，当前 13px / 14px / 18px 等非标值需收敛。'));
children.push(bullet('卡片内边距统一为 16px / 20px，当前 14px / 16px / 18px 混用，需标准化。'));
children.push(p('5.5.4 组件库'));
children.push(bullet('将按钮、卡片、表单、徽章、Tab、Sheet、Dialog 等抽象为可复用组件（dom.js 已提供 h 函数基础），统一 API 与样式，减少页面级重复定义。'));
children.push(new Paragraph({ children: [new PageBreak()] }));

// 六、admin.html 功能整合方案
children.push(h('六、admin.html 功能整合方案', HeadingLevel.HEADING_1));
children.push(p('最终目标：admin.html 仅作为兼容入口保留，所有功能逐步迁移到 console.html，实现单入口统一体验。'));

children.push(h('6.1 功能映射与迁移优先级', HeadingLevel.HEADING_2));
children.push(table([
  ['优先级', '功能', 'admin 位置', 'console 目标位置', '迁移复杂度'],
  ['P0', '客户列表与详情基础信息', '客户经营 > 列表/详情', '人物目录 + Person 360 总览', '已完成'],
  ['P1', '保单检视', '客户详情 > 保单', 'Person 360 保险页签', '中（二维表编辑）'],
  ['P1', '转介绍', '客户详情 > 转介绍', 'Person 360 机会页签', '低'],
  ['P1', '今日教练', '今日 > 教练', '今日页新增「教练」卡片', '中'],
  ['P1', '漏斗分析（客户/机会）', '更多 > 漏斗', '更多页新增「漏斗分析」', '中'],
  ['P2', '伴手礼管理', '客户详情 > 伴手礼', 'Person 360 新增页签', '低'],
  ['P2', '照片管理', '客户详情 > 照片', 'Person 360 新增页签 / 活动详情照片', '中'],
  ['P3', 'OCR 记录', '客户详情 > OCR', 'Person 360 事实页签', '低'],
]));

children.push(h('6.2 整合实施策略', HeadingLevel.HEADING_2));
children.push(bullet('逐模块迁移：每个功能独立迁移，迁移后在 console.html 验证完整，再下线 admin.html 对应入口，避免双写不一致。'));
children.push(bullet('复用数据层：迁移时复用 data.js 已有接口，新增接口按既有云函数扩展，不新建云函数（遵守 AGENTS.md 规则）。'));
children.push(bullet('样式统一：迁移的功能必须使用 console.css 设计系统，不保留 admin.html 的蓝色主题，确保视觉一致。'));
children.push(bullet('写入闭环：所有迁移的写操作必须接入 write.js 的 preview → confirm → execute 三段式，不得绕过。'));
children.push(bullet('渐进下线：admin.html 增加「已迁移至新控制台」提示横幅，引导用户使用 console.html；所有功能迁移完成后，admin.html 重定向到 console.html。'));
children.push(bullet('回归验证：每次迁移后执行登录、人物列表/详情、跟进、机会、活动、回收站的回归测试，确保不破坏相邻功能。'));
children.push(new Paragraph({ children: [new PageBreak()] }));

// 七、前瞻性功能规划
children.push(h('七、前瞻性功能规划', HeadingLevel.HEADING_1));

children.push(h('7.1 PWA 与离线能力', HeadingLevel.HEADING_2));
children.push(bullet('注册 Service Worker，缓存静态资源（console.html、console.css、modules JS），实现秒开与弱网可用。'));
children.push(bullet('离线队列：断网时的写操作进入本地 IndexedDB 队列，联网后自动同步，同步失败提示人工处理。'));
children.push(bullet('添加到主屏幕：配置 manifest.json，支持 iPad/iPhone 「添加到主屏幕」，全屏运行，隐藏浏览器栏。'));
children.push(bullet('后台同步：利用 Background Sync API，在网络恢复时自动同步待办队列。'));

children.push(h('7.2 AI 对话式交互', HeadingLevel.HEADING_2));
children.push(bullet('全局 AI 助手入口（浮动按钮或侧边抽屉），支持自然语言指令：「帮我记录刚才和张三的通话」「列出本周需要跟进的客户」。'));
children.push(bullet('遵循 AGENTS.md 规则：涉及 create/update/close/delete 的指令，必须经过 Command → Plan → 服务端 Preview → 人工 Confirm → Execute，AI 不得自行决定。'));
children.push(bullet('上下文感知：AI 助手能感知当前页面上下文（如正在查看 Person 详情），回答与操作更精准。'));
children.push(bullet('可追溯：所有 AI 建议必须标注数据来源与置信度，关键操作保留 human-in-the-loop。'));

children.push(h('7.3 通知中心与提醒', HeadingLevel.HEADING_2));
children.push(bullet('Web Push 通知：行动到期、承诺逾期、待确认候选时推送浏览器通知，点击直达对应页面。'));
children.push(bullet('通知中心：顶部头像下拉显示「待办提醒」列表，按优先级排序，支持一键处理。'));
children.push(bullet('智能提醒：基于跟进历史与客户阶段，AI 建议「该联系谁」「什么时候联系」，在今日页晨间简报中呈现。'));

children.push(h('7.4 数据可视化增强', HeadingLevel.HEADING_2));
children.push(bullet('机会看板增加转化漏斗图：显示各阶段数量与转化率，点击下钻到具体机会。'));
children.push(bullet('招募漏斗增加趋势图：按周/月展示各阶段人数变化，辅助决策。'));
children.push(bullet('今日节奏增加时间轴视图：将今日行动、承诺、活动按时间排列，可视化一天安排。'));
children.push(bullet('客户经营热力图：按跟进频率与价值评分，在人物目录显示颜色编码，快速识别高价值客户。'));
children.push(new Paragraph({ children: [new PageBreak()] }));

// 八、实施路线图与优先级
children.push(h('八、实施路线图与优先级', HeadingLevel.HEADING_1));
children.push(p('按「价值 × 可行性」排序，分为四个阶段实施：'));
children.push(table([
  ['阶段', '周期', '核心目标', '关键交付'],
  ['P0 体验打磨', '2 周', '修复当前体验痛点', '触控反馈/安全区域/全局搜索/进度条'],
  ['P1 iPad 生产力', '3 周', 'iPad 大屏效率提升', '侧边栏导航/左右分栏/键盘快捷键/拖拽看板'],
  ['P2 iPhone 优化', '2 周', '手机单手操作体验', '手势返回/下拉刷新/FAB 快捷菜单/表单优化'],
  ['P3 admin 整合', '4 周', '存量功能迁移', '保单检视/转介绍/今日教练/漏斗分析'],
  ['P4 前瞻性', '持续', '未来能力建设', 'PWA/AI 对话/通知中心/数据可视化'],
]));
children.push(spacer());
children.push(p('P0 优先级明细（建议立即启动）：'));
children.push(bullet('顶部栏 safe-area-inset-top 适配（刘海机型遮挡问题）'));
children.push(bullet('按钮触控目标提升至 44px，增加 :active 反馈'));
children.push(bullet('全局搜索（Cmd+K）覆盖人物/机会/活动'));
children.push(bullet('Sheet 键盘避让与下滑关闭'));
children.push(bullet('Toast 增加撤销操作（删除类）'));
children.push(bullet('骨架屏按页面布局定制'));
children.push(new Paragraph({ children: [new PageBreak()] }));

// 九、风险与注意事项
children.push(h('九、风险与注意事项', HeadingLevel.HEADING_1));
children.push(bullet('遵守 AGENTS.md 规则：所有写操作必须经 preview → confirm → execute；不新建云函数（除非单独批准）；不删除/重命名已有对象；新功能放在 crm/js/modules/，复用 core/ 与 components/。'));
children.push(bullet('admin.html 兼容期：迁移期间 admin.html 保持可用，不得因 console.html 优化而破坏 admin.html 功能；双入口期间需确保数据一致。'));
children.push(bullet('回归测试：每次 UI 改动必须执行登录、人物列表/详情、跟进、机会、活动、增员、回收站的回归，记录结果。'));
children.push(bullet('性能约束：动效与 PWA 缓存需关注 iPad/iPhone 性能，避免过度动画导致卡顿；Service Worker 缓存策略需谨慎，避免旧资源缓存导致功能异常。'));
children.push(bullet('安全边界：AI 对话式交互必须保留 human-in-the-loop，不得凭自然语言直接写入业务数据；模型选择走 AI Gateway，不硬编码厂商。'));
children.push(bullet('iPad 优先：按 AGENTS.md 规则，新功能默认只考虑 iPad，iPhone 适配仅在明确要求时纳入；但本方案中的安全区域、触控目标等基础适配对双端均有益。'));
children.push(bullet('双语要求：所有新界面文本必须通过 i18n.js 管理，提供 zh-CN 与 en 双版本，不得硬编码。'));

// 生成文档
const doc = new Document({
  sections: [{ children }],
  styles: { default: { document: { run: { font: 'Microsoft YaHei', size: 22 } } } },
});

const outDir = path.join(__dirname, '..', 'docs');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'CRM-UI交互优化方案.docx');

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outPath, buf);
  console.log('✅ 文档已生成:', outPath);
}).catch((e) => { console.error('❌ 生成失败:', e); process.exit(1); });
