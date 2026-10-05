/* ============================================================
   虚构演示数据（所有人物/公司/互动均为虚构，仅用于界面评审）
   ============================================================ */
const ICONS = {
  home:'<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  spark:'<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>',
  users:'<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20c.6-3.1 2.8-4.8 5.5-4.8s4.9 1.7 5.5 4.8"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6"/><path d="M17.5 15.4c2 .6 3.4 2.1 3.8 4.6"/>',
  target:'<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  calendar:'<rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
  grid:'<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/>',
  check:'<path d="m4.5 12.5 5 5 10-11"/>',
  x:'<path d="M6 6l12 12M18 6 6 18"/>',
  chevronR:'<path d="m9 5 7 7-7 7"/>',
  chevronD:'<path d="m5 9 7 7 7-7"/>',
  phone:'<path d="M6.5 3.5h3l1.5 4.5-2 1.5a12 12 0 0 0 5.5 5.5l1.5-2 4.5 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5z"/>',
  msg:'<path d="M21 12a8.5 8.5 0 0 1-12.4 7.6L4 21l1.5-4.4A8.5 8.5 0 1 1 21 12z"/>',
  gift:'<rect x="3.5" y="8" width="17" height="13" rx="1.5"/><path d="M3.5 12h17M12 8v13"/><path d="M12 8C10 8 6.5 7.8 6.5 5.3 6.5 3.5 8.5 3 10 4.2 11.3 5.2 12 8 12 8Zm0 0c2 0 5.5-.2 5.5-2.7C17.5 3.5 15.5 3 14 4.2 12.7 5.2 12 8 12 8Z"/>',
  shield:'<path d="M12 3 5 6v5.5c0 4.5 3 7.7 7 9.5 4-1.8 7-5 7-9.5V6l-7-3z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  alert:'<path d="M12 4 2.8 20h18.4L12 4z"/><path d="M12 10v5M12 18v.5"/>',
  star:'<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5z"/>',
  edit:'<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="m14.5 6.5 3 3"/>',
  trash:'<path d="M4.5 7h15M9 7V5h6v2M6.5 7l1 13h9l1-13"/>',
  refresh:'<path d="M20 11a8 8 0 0 0-14-5.3L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14 5.3L20 16"/><path d="M16 16h4v4"/>',
  mic:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>',
  file:'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  filter:'<path d="M3 5h18l-7 8v6l-4 2v-8L3 5z"/>',
  list:'<path d="M8 6h12M8 12h12M8 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  map:'<path d="m9 4 6 2 6-2v14l-6 2-6-2-6 2V6z"/><path d="M9 4v14M15 6v14"/>',
  settings:'<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3"/>',
  logout:'<path d="M14 4H6v16h8"/><path d="M18 8l4 4-4 4M22 12H10"/>',
  key:'<circle cx="8" cy="8" r="4.5"/><path d="m11.2 11.2 9 9M17 16l2.5-2.5M14.5 13.5 17 16"/>',
  book:'<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 1 2-2h13"/>',
  flag:'<path d="M5 21V4"/><path d="M5 4h12l-2.5 4L17 12H5"/>',
  heart:'<path d="M12 20s-7-4.6-9.2-9C1.3 7.9 2.8 4.8 6 4.5c2-.2 3.5 1 4 2 .5-1 2-2.2 4-2 3.2.3 4.7 3.4 3.2 6.5C19 15.4 12 20 12 20z"/>',
  send:'<path d="M21 3 3 10.5l7 2.5 2.5 7L21 3z"/><path d="m10 13 11-10"/>',
  arrowUp:'<path d="M12 19V5M5 12l7-7 7 7"/>',
  link:'<path d="M9 15 15 9"/><path d="M10.5 5.5 12 4a5 5 0 0 1 7 7l-1.5 1.5"/><path d="M13.5 18.5 12 20a5 5 0 0 1-7-7l1.5-1.5"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4.5 21c.8-3.9 3.7-6 7.5-6s6.7 2.1 7.5 6"/>',
  wallet:'<path d="M4 7a2 2 0 0 1 2-2h12v4"/><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M16 13.5h2"/>',
  chart:'<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
  scissors:'<circle cx="6.5" cy="6.5" r="2.5"/><circle cx="6.5" cy="17.5" r="2.5"/><path d="m8.5 8.5 11 9M8.5 15.5 19.5 4.5"/>',
  camera:'<path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13.5" r="3.2"/>',
  award:'<circle cx="12" cy="9" r="5.5"/><path d="m8.5 13.5-1.5 7 5-2.5 5 2.5-1.5-7"/>',
  signal:'<path d="M4 20v-3M9 20v-7M14 20v-11M19 20V4"/>',
};
const ic = (name, extra) => `<svg ${extra||''}>${ICONS[name]||''}</svg>`;

const DEMO = {
  user:{name:'Victor 梁', initials:'VL'},
  dateCN:'2026年10月5日 星期一',
  brief:{
    date:'MONDAY · OCT 5',
    items:[
      {p:'<b>林悦</b>的家庭规划需先澄清年度预算，建议 10:00 通话先确认留学时间线，再进入方案。', src:'来源：互动 #301 · 承诺“本周给预算口径”', act:'会前准备 →'},
      {p:'<b>王宁</b>活动后回访价值高，客户已口头表达检视意愿，建议今天预约保单检视时间。', src:'来源：活动 #501 · 到场 #511 · 需求意向', act:'生成回访话术 →'},
      {p:'<b>陈昊</b>距上次实质沟通已 46 天，超过其历史间隔，可安排一次轻问候而非推销。', src:'来源：关系衰减信号 · 置信中 · 需你确认', act:'查看依据 →'},
    ],
  },
  stats:[
    {n:2,l:'待办行动',h:'按优先级排序',c:'red'},
    {n:2,l:'待履承诺',h:'双方约定可追溯',c:''},
    {n:2,l:'待确认候选',h:'确认后才进入业务',c:'gold'},
    {n:1,l:'近期活动',h:'下一场 10/10',c:'jade'},
  ],
  actions:[
    {id:1,t:'确认留学时间与年度预算',person:'林悦',tag:'行动',prio:'must',due:'今天 10:00',state:'进行中',src:'互动 #301 · 先确认需求，再准备保障资料',ops:['编辑','撤销','查看来源']},
    {id:2,t:'活动后回访，预约保单检视',person:'王宁',tag:'行动',prio:'must',due:'今天 15:00',state:'进行中',src:'活动 #501 · 到场 #511 · 客户已表达检视意愿',ops:['编辑','撤销','查看来源']},
    {id:3,t:'发送家庭保障整理清单',person:'林悦',tag:'我承诺',prio:'rec',due:'10-07 前',state:'进行中',src:'承诺 · 互动 #301 · 仅发送已人工核实的资料',ops:['完成','改期','查看来源']},
    {id:4,t:'入职资料清单与面试时间确认',person:'周涛',tag:'招募',prio:'rec',due:'明天',state:'签约入司',src:'候选人 #601 · 阶段：签约入司',ops:['完成','改期','查看来源']},
    {id:5,t:'整理朋友圈健康专题素材',person:'',tag:'自定',prio:'opt',due:'本周',state:'',src:'个人经营节奏 · 每周一条专业内容',ops:['完成','编辑']},
  ],
  candidates:[
    {id:'c1',t:'留学保障需求候选',person:'林悦',meta:'互动 #301 · 2026-10-04',desc:'子女明年海外学习，预算口径待确认，可能涉及教育金与海外医疗。',kind:'机会候选'},
    {id:'c2',t:'活动后医疗检视行动',person:'王宁',meta:'活动 #501 · 实际到场 #511',desc:'活动现场两次提及体检异常与既往住院史，建议预约年度医疗检视。',kind:'行动候选'},
  ],
  rhythm:[
    {time:'10:00',t:'与林悦澄清保障需求',act:'会前查看'},
    {time:'15:00',t:'王宁 · 活动后回访',act:'打开客户'},
  ],
  commitments:[
    {t:'周三发送家庭保障整理清单',who:'我承诺',due:'2026-10-07 12:00',kind:'mine'},
    {t:'对方确认下次职业沟通时间',who:'对方承诺',due:'2026-10-04 18:00',overdue:true,kind:'theirs'},
  ],
  risks:[
    {t:'陈昊的下一次沟通时间尚未确认',d:'先了解近况，再判断节奏变化。',src:'承诺 #104 · 不推断未回应的原因'},
  ],
  opportunities:[
    {id:201,t:'家庭留学保障规划',person:'林悦',stage:'沟通',value:'待报价',updated:'10-04'},
    {id:202,t:'年度医疗保障检视',person:'王宁',stage:'发现',value:'—',updated:'10-03'},
    {id:203,t:'高净值年金配置',person:'苏晴',stage:'方案',value:'¥200万/年',updated:'10-02'},
    {id:204,t:'家庭保单托管转介绍',person:'李婉',stage:'发现',value:'—',updated:'09-30'},
    {id:205,t:'夫妻互保补充方案',person:'赵磊',stage:'成交',value:'¥2.4万',updated:'09-28'},
    {id:206,t:'企业主团财险咨询',person:'高远',stage:'关闭',value:'—',updated:'09-20'},
  ],
  people:[
    {id:1,n:'林悦',initial:'林',alt:'',city:'上海',title:'品牌负责人',co:'晨光设计（虚构）',tags:['客户','稳定'],stage:'需求挖掘',priority:'A'},
    {id:2,n:'王宁',initial:'王',alt:'',city:'上海',title:'私企业主',co:'宁和贸易（虚构）',tags:['客户','活动嘉宾'],stage:'方案沟通',priority:'A'},
    {id:3,n:'陈昊',initial:'陈',alt:'alt',city:'杭州',title:'工程师',co:'云启科技（虚构）',tags:['客户'],stage:'关系维护',priority:'B'},
    {id:4,n:'苏晴',initial:'苏',alt:'gold',city:'上海',title:'合伙人',co:'晴见律所（虚构）',tags:['客户','高净值'],stage:'方案沟通',priority:'A'},
    {id:5,n:'赵磊',initial:'赵',alt:'',city:'苏州',title:'门店经理',co:'磊达连锁（虚构）',tags:['客户','转介绍'],stage:'成交推进',priority:'B'},
    {id:6,n:'周涛',initial:'周',alt:'gold',city:'上海',title:'前教培主管',co:'—',tags:['招募候选人'],stage:'签约入司',priority:'A'},
    {id:7,n:'李婉',initial:'李',alt:'alt',city:'上海',title:'财务总监',co:'婉信财务（虚构）',tags:['客户','嘉宾'],stage:'转介绍经营',priority:'B'},
    {id:8,n:'高远',initial:'高',alt:'alt',city:'宁波',title:'制造企业主',co:'远达机械（虚构）',tags:['客户'],stage:'新认识',priority:'C'},
  ],
  timeline:[
    {t:'电话沟通',dot:'',badge:'重要互动',badgeCls:'red',text:'孩子明年可能赴海外学习，预算还没有确定，约定本周给预算口径。',time:'2026-10-04 10:32 · 时长 18 分钟'},
    {t:'活动到场',dot:'gold',badge:'活动 #501',badgeCls:'gold',text:'参加家庭健康沙龙，现场与王宁同桌，主动询问子女教育金安排。',time:'2026-10-03 14:00'},
    {t:'资料发送',dot:'jade',badge:'我承诺已履行',badgeCls:'jade',text:'已发送家庭保单整理模板（仅含公开样例字段）。',time:'2026-09-28 16:10'},
    {t:'面谈记录',dot:'gray',badge:'传统跟进',badgeCls:'',text:'咖啡店面谈，确认家庭结构：已婚一女，配偶有基础社保。',time:'2026-09-20 15:00'},
  ],
  context:{
    fact:[
      {t:'已婚，育有一女（10 岁）',src:'互动 #288 · 已确认'},
      {t:'配偶有基础社保，无商业医疗',src:'客户自述 · 已确认'},
      {t:'现有保单 2 份：重疾 50 万、意外 100 万',src:'保单资料 · 2026-09-15'},
    ],
    signal:[
      {t:'子女留学计划提上日程，时间线未定',src:'互动 #301 · 待核实'},
      {t:'年度保费预算口径未明确',src:'两次沟通均未给出数字 · 待核实'},
    ],
    inference:[
      {t:'家庭保障缺口集中在教育金与女性医疗',src:'AI 推断 · 置信中 · 需人工评估'},
    ],
  },
  covers:[
    {n:'寿险',s:'有',c:'jade'},{n:'重疾险',s:'50万 · 待评估',c:'gold'},
    {n:'医疗险',s:'无',c:'red'},{n:'意外险',s:'100万',c:'jade'},
    {n:'年金/养老',s:'无',c:'red'},{n:'教育金',s:'无',c:'red'},
    {n:'配偶保障',s:'仅社保',c:'gold'},{n:'子女保障',s:'学平险',c:'gold'},
  ],
  activities:[
    {id:501,n:'家庭健康 · 秋日私享沙龙',date:'2026-10-03',place:'城市会客厅（虚构）',status:'已结束',statusCls:'',attended:11,invited:18,tasks:3},
    {id:502,n:'高端养老社区参观日',date:'2026-10-10',place:'青浦颐养社区（虚构）',status:'筹备中',statusCls:'gold',attended:0,invited:9,tasks:5},
    {id:503,n:'亲子财商工作坊',date:'2026-10-19',place:'浦东体验中心（虚构）',status:'已确认',statusCls:'blue',attended:0,invited:14,tasks:2},
  ],
  participants:[
    {n:'林悦',r:'客户 · Person #1',state:'attended',stateText:'已到场',note:'两次提到子女留学'},
    {n:'王宁',r:'嘉宾 · Person #2',state:'attended',stateText:'已到场',note:'询问医疗检视'},
    {n:'李婉',r:'客户 · Person #7',state:'attended',stateText:'已到场',note:'带朋友到场'},
    {n:'苏晴',r:'客户 · Person #4',state:'invited',stateText:'已邀请',note:'未确认'},
    {n:'陈昊',r:'客户 · Person #3',state:'absent',stateText:'缺席',note:'已致歉，约改期'},
  ],
  actTasks:[
    {t:'确认场地与茶歇',who:'Victor',due:'10-02',done:true},
    {t:'逐人发送会前提醒',who:'Victor',due:'10-02',done:true},
    {t:'回收嘉宾资料并打印',who:'Victor',due:'10-03',done:false},
  ],
  recruitStages:[
    {n:'新增人才',c:12},{n:'互动暖客',c:8},{n:'初次面谈',c:6},{n:'增员活动',c:5},
    {n:'精准面谈',c:3},{n:'入职申请',c:2},{n:'签约入司',c:1},{n:'流失',c:2},
  ],
  recruitCands:[
    {n:'周涛',stage:'签约入司',score:88,tags:['教培转型','增员意愿强'],updated:'10-04'},
    {n:'郑楠',stage:'入职申请',score:81,tags:['本地资源丰富'],updated:'10-02'},
    {n:'何静',stage:'精准面谈',score:74,tags:['时间自由诉求'],updated:'09-30'},
    {n:'罗斌',stage:'增员活动',score:66,tags:['观望中'],updated:'09-27'},
  ],
  searchTemplates:[
    {id:'t1',t:'活动后 14 天未跟进的已到场客户',icon:'calendar',q:'上周沙龙结束后，哪些到场客户还没有跟进？'},
    {id:'t2',t:'有子女教育记录但未见教育金保障',icon:'book',q:'记录里提到孩子教育，但没有教育金保单的家庭？'},
    {id:'t3',t:'A/B 级重点客户中关系在降温的人',icon:'signal',q:'最近哪些重点客户联系变少、关系可能在降温？'},
  ],
  searchResults:[
    {n:'王宁',id:2,reason:'活动 #501 已到场（10-03），至今 2 天无互动记录',tags:['A 级','活动嘉宾']},
    {n:'李婉',id:7,reason:'活动 #501 已到场并带朋友，至今无跟进记录',tags:['B 级','转介绍经营']},
  ],
};

/* 全局可交互状态 */
const state = {
  logged:new URLSearchParams(location.search).has('demo'),
  done:{},
  cand:{c1:'pending',c2:'pending'},
  briefOpen:true,
  personTab:0,
  activityTab:0,
  searchRan:false,
  commandStep:0,
  opps:DEMO.opportunities.map(o=>({...o})),
};
