'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Browser } = require('../regression/browser.cjs');
const root = path.resolve(__dirname, '../..');
const iterations = Number(process.env.CRM_PERF_ITERATIONS || 10);
if (!Number.isInteger(iterations) || iterations < 5 || iterations > 30) throw Error('CRM_PERF_ITERATIONS must be between 5 and 30');
const percentile = (values, p) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? null;
};
const summary = values => ({ p50: percentile(values, .50), p95: percentile(values, .95), min: Math.min(...values), max: Math.max(...values) });
const script = `(async () => {
  const ITERATIONS = ${iterations};
  const PAGE_SIZE = 30;
  const now = new Date().toISOString();
  const marker = '【性能基线虚构数据】';
  const longTasks=[];
  const pendingLongTasks=[];
  const longTaskObserver=typeof PerformanceObserver==='function' && PerformanceObserver.supportedEntryTypes?.includes('longtask')
    ? new PerformanceObserver(list=>pendingLongTasks.push(...list.getEntries().map(entry=>({durationMs:entry.duration,startTime:entry.startTime})))) : null;
  // Do not include work completed while Browser.openConsole bootstrapped the shell.
  longTaskObserver?.observe({type:'longtask'});
  const rows = (kind, count, offset=0) => Array.from({length:count}, (_, i) => {
    const id = 700000 + offset + i;
    if (kind === 'person') return {id:String(id), display_name:marker+'人物'+i, roles:['customer'], customer_id:800000+i,
      customer_stage:'关系维护', sales_priority:['A','B','C'][i%3], recruitment_priority:'B', referral_priority:'C',
      latest_followup_date:'2026-10-01', next_followup_date:'2026-10-20', updated_at:'2026-10-15T08:00:00Z', organization:marker+'机构'};
    if (kind === 'recruit') return {candidate_id:String(id), person_id:String(id), customer_id:800000+i, customer_name:marker+'候选人'+i,
      stage:'新增人才', recruitment_priority:'B', potential_score:60+i%40, next_action_date:'2026-10-20', idle_days:i%20,
      updated_at:'2026-10-15T08:00:00Z', occupation:'顾问', next_action:marker+'核实意向'};
    if (kind === 'activity') return {id, name:marker+'活动'+i, activity_date:'2026-10-20', activity_type:'分享会',
      location:marker+'场地', status:'preparing', description:marker+'说明', updated_at:'2026-10-15T08:00:00Z'};
    if (kind === 'timeline') return {id:String(id), type:'followup', summary:marker+'跟进记录'+i, at:'2026-10-15T08:00:00Z',
      source:'public.followups#'+id, customerId:'800001', editable:false};
    if (kind === 'source') return {id, title:marker+'导入文件'+i, fileName:marker+'材料'+i+'.pdf', table:'knowledge_sources',
      lifecycle_status:'draft', extractionStatus:i%4===0?'extracting':'completed', ocrProgress:i%4===0?{stage:'extract',completedPages:8,totalPages:24}:null,
      created_at:'2026-10-15T08:00:00Z', updated_at:'2026-10-15T08:00:00Z', status:'queued', file_name:marker+'队列文件'+i+'.pdf'};
    return {id, file_name:marker+'队列文件'+i+'.pdf', status:['queued','parsing','completed','failed'][i%4],
      created_at:'2026-10-15T08:00:00Z', error_code:i%4===3?'PDF_NO_TEXT':null, content_type:'application/pdf', draftAvailable:false};
  });
  const reply = (name, args) => {
    if (name==='person_360' && args.action==='listPeople') {const size=args.pageSize||PAGE_SIZE,page=args.page||1;return {rows:rows('person',size,(page-1)*size),page,pageSize:size,total:1240,totalPages:Math.ceil(1240/size),hasMore:page<Math.ceil(1240/size)};}
    if (name==='person_360' && args.action==='getCustomerProfile') return {personId:'700001', customerId:'800001', status:'linked', roles:[{role:'customer'}], fields:{customer_name:marker+'人物0',customer_stage:'关系维护',sales_priority:'A',profile:{}}};
    if (name==='person_360' && args.action==='getTimelinePage') {const size=args.pageSize||20,page=args.page||1;return {rows:rows('timeline',size,(page-1)*size),page,pageSize:size,hasMore:true,total:null};}
    if (name==='person_360' && args.action==='get') return {person:{id:'700001',display_name:marker+'人物0'}, roles:[{role:'customer'}]};
    if (name==='person_360' && args.action==='listPersonWorkItems') return {rows:[],personName:marker+'人物0'};
    if (name==='person_360' && args.action==='listInteractions') return {rows:[],limit:5,hasMore:false};
    if (name==='person_360' && args.action==='listFileImports') return {rows:rows('file',20,((args.page||1)-1)*20),page:args.page||1,hasMore:true};
    if (name==='person_360' && args.action==='listPersonFiles') return {rows:rows('file',20,((args.page||1)-1)*20),page:args.page||1,hasMore:true};
    if (name==='person_360' && args.action==='getContextGroups') return {groups:{fact:[],signal:[],inference:[]}};
    if (name==='person_360' && args.action==='getInsuranceContext') return {policies:[],reports:[]};
    if (name==='person_360' && args.action==='listOpportunities') return {rows:[],total:0};
    if (name==='person_360' && args.action==='listRecruitContext') return {rows:[]};
    if (name==='person_360' && args.action==='getRelationshipDecay') return {status:'insufficient_data',relationships:[]};
    if (name==='person_360' && args.action==='listInteractions') return {rows:[],hasMore:false};
    if (name==='person_360' && args.action==='listPersonFiles') return {rows:files,page:1,hasMore:true};
    if (name==='person_360' && args.action==='getCustomerProfile') return {personId:'700001',customerId:'800001',status:'linked',roles:[],fields:{customer_name:marker+'人物0',profile:{}}};
    if (name==='person_360' && args.action==='getTimelinePage') return {rows:timelineRows,page:1,pageSize:20,hasMore:true};
    if (name==='person_360' && args.action==='listRecruitDirectory') {const size=args.pageSize||PAGE_SIZE,page=args.page||1;return {rows:rows('recruit',size,(page-1)*size),page,pageSize:size,total:1240,totalPages:Math.ceil(1240/size),hasMore:page<Math.ceil(1240/size)};}
    if (name==='recruit_candidates' && args.action==='funnel') return {funnel:{'新增人才':320,'初次面谈':240,'流失':48},total:1240};
    if (name==='recruit_goals' && args.action==='getProgress') return {rows:[]};
    if (name==='activities' && args.action==='directory') {const size=args.pageSize||PAGE_SIZE,page=args.page||1;return {rows:rows('activity',size,(page-1)*size),page,pageSize:size,total:1240,totalPages:Math.ceil(1240/size),hasMore:page<Math.ceil(1240/size)};}
    if (name==='assistant' && args.action==='knowledgeLibrary' && args.operation==='list') return {knowledge:[],playbooks:[],sources:rows('source',120)};
    if (name==='assistant' && args.action==='knowledgeLibrary') return {ok:true,rows:[]};
    return {};
  };
  const waitFor = async (ready, pending) => {
    const end=performance.now()+12000;
    while(performance.now()<end){ if(ready() && pending()===0) return; await new Promise(requestAnimationFrame); }
    throw Error('Benchmark view did not settle: '+String(ready()));
  };
  const makeContext = (main, requests) => ({main,toast(){},api:{call:async(name,args={})=>{
    const started=performance.now(); const result=reply(name,args); const bytes=new TextEncoder().encode(JSON.stringify(result)).length;
    await Promise.resolve(); const finished=performance.now();
    const requestBytes=new TextEncoder().encode(JSON.stringify(args)).length;
    requests.push({name,action:args.action||null,operation:args.operation||null,page:args.page||null,pageSize:args.pageSize||null,
      started,finished,latencyMs:finished-started,responseBytes:bytes,rows:Array.isArray(result.rows)?result.rows.length:null,
      requestBytes,total:result.total??null,hasMore:result.hasMore??null,
      argsKey:JSON.stringify([name,args])});
    return structuredClone(result);
  }}});
  const percentile = (values,p) => {const a=values.slice().sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.ceil(a.length*p)-1)]??null;};
  const aggregate = samples => ({
    interactiveMs:{p50:percentile(samples.map(x=>x.interactiveMs),.5),p95:percentile(samples.map(x=>x.interactiveMs),.95),min:Math.min(...samples.map(x=>x.interactiveMs)),max:Math.max(...samples.map(x=>x.interactiveMs))},
    requestCount:{p50:percentile(samples.map(x=>x.requestCount),.5),p95:percentile(samples.map(x=>x.requestCount),.95)},
    requestBytes:{p50:percentile(samples.map(x=>x.requestBytes),.5),p95:percentile(samples.map(x=>x.requestBytes),.95)},
    responseBytes:{p50:percentile(samples.map(x=>x.responseBytes),.5),p95:percentile(samples.map(x=>x.responseBytes),.95)},
    apiFixtureLatencyMs:{p50:percentile(samples.flatMap(x=>x.apiFixtureLatencyMs),.5),p95:percentile(samples.flatMap(x=>x.apiFixtureLatencyMs),.95)},
    paginationMs:{p50:percentile(samples.filter(x=>x.pagination?.available).map(x=>x.pagination.elapsedMs),.5),
      p95:percentile(samples.filter(x=>x.pagination?.available).map(x=>x.pagination.elapsedMs),.95)},
    rowsRendered:{p50:percentile(samples.map(x=>x.rowsRendered),.5),p95:percentile(samples.map(x=>x.rowsRendered),.95)},
    longTaskCount:{p50:percentile(samples.map(x=>x.longTaskCount),.5),p95:percentile(samples.map(x=>x.longTaskCount),.95)},
    longTaskDurationMs:{p50:percentile(samples.map(x=>x.longTaskDurationMs),.5),p95:percentile(samples.map(x=>x.longTaskDurationMs),.95)},
    duplicateRequests:{p50:percentile(samples.map(x=>x.duplicateRequests),.5),p95:percentile(samples.map(x=>x.duplicateRequests),.95)},
    domNodes:{p50:percentile(samples.map(x=>x.domNodes),.5),p95:percentile(samples.map(x=>x.domNodes),.95)},
  });
  const results=[];
  async function measure(id, mount, selector, extraReady=async()=>{}, paginate=null) {
    const samples=[];
    for(let i=0;i<ITERATIONS;i++){
      const main=document.createElement('main'); document.body.append(main);
      const requests=[];
      const ctx=makeContext(main,requests);
      await new Promise(requestAnimationFrame);
      pendingLongTasks.length=0;longTaskObserver?.takeRecords();
      const start=performance.now();
      await mount(ctx,main,requests);
      await waitFor(()=>!!main.querySelector(selector),()=>0);
      await extraReady(ctx,main,requests);
      await waitFor(()=>!!main.querySelector(selector),()=>0);
      const interactiveMs=Number(main.dataset.interactionMs||performance.now()-start);
      const rowsRendered=main.querySelectorAll('tbody tr').length || main.querySelectorAll('.tl-item').length || main.querySelectorAll('[data-import-id]').length;
      const keys=requests.map(x=>x.argsKey); const duplicateRequests=keys.length-new Set(keys).size;
      const initialRequests=requests.slice();
      const pagination=paginate?await paginate(main,requests,waitFor):null;
      await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
      const measuredLongTasks=[...pendingLongTasks,...(longTaskObserver?.takeRecords()||[]).map(entry=>({durationMs:entry.duration,startTime:entry.startTime}))]
        .filter(entry=>entry.startTime>=start&&entry.startTime<=performance.now());
      longTasks.push(...measuredLongTasks);
      samples.push({interactiveMs,requestCount:initialRequests.length,responseBytes:initialRequests.reduce((sum,x)=>sum+x.responseBytes,0),
        requestBytes:initialRequests.reduce((sum,x)=>sum+x.requestBytes,0),
        apiFixtureLatencyMs:initialRequests.map(x=>x.latencyMs),rowsRendered,duplicateRequests,domNodes:main.querySelectorAll('*').length,
        pagination,longTaskCount:measuredLongTasks.length,longTaskDurationMs:measuredLongTasks.reduce((sum,x)=>sum+x.durationMs,0),
        requests:requests.map(({name,action,operation,page,pageSize,latencyMs,requestBytes,responseBytes,rows,total,hasMore})=>({name,action,operation,page,pageSize,latencyMs,requestBytes,responseBytes,rows,total,hasMore}))});
      main.remove();
    }
    results.push({id,iterations:ITERATIONS,fixture:'synthetic; iPad directory pages 30 rows, Person/OCR pages 20 rows, directory total 1,240 where applicable',metrics:aggregate(samples),samples});
  }
  const modules=await Promise.all([
    import('/crm/js/modules/console/pages/people.js'),
    import('/crm/js/modules/console/pages/recruit.js'),
    import('/crm/js/modules/console/pages/activities.js'),
    import('/crm/js/modules/console/pages/person.js'),
    import('/crm/js/modules/console/knowledge-governance.js'),
    import('/crm/js/modules/console/file-import.js'),
  ]);
  const [people,recruit,activities,person,knowledge,fileImport]=modules;
  const pageTurn=(selector,requestMatch)=>async(main,requests,waitFor)=>{
    const before=requests.length,start=performance.now(),control=main.querySelector(selector);
    if(!control||control.disabled)return {available:false};
    control.click();
    await waitFor(()=>requests.slice(before).some(requestMatch),()=>0);
    return {available:true,elapsedMs:performance.now()-start,request:requests.slice(before).find(requestMatch)||null};
  };
  await measure('people.directory', (ctx)=>people.renderPeople(ctx), '.people-directory-table tbody tr', async()=>{},
    pageTurn('.card-foot .pager button:last-child', request=>request.action==='listPeople'&&request.page===2));
  await measure('people.customer-operations-view', async(ctx,main,requests)=>{
    people.renderPeople(ctx);
    await waitFor(()=>!!main.querySelector('.people-directory-table tbody tr'),()=>0);
    requests.length=0;
    const start=performance.now(); main.querySelector('[aria-pressed]').click();
    await waitFor(()=>requests.some(x=>x.action==='listPeople'&&JSON.parse(x.argsKey)[1].roles?.includes('customer'))&&!!main.querySelector('.people-directory-table tbody tr'),()=>0);
    main.dataset.interactionMs=String(performance.now()-start);
  }, '.people-directory-table tbody tr', async(ctx,main,requests)=>{},
    pageTurn('.card-foot .pager button:last-child', request=>request.action==='listPeople'&&request.page===2));
  await measure('person.detail.overview', (ctx)=>person.renderPerson(ctx,'700001','overview'), '.stack-head');
  await measure('person.followup.timeline', (ctx)=>person.renderPerson(ctx,'700001','timeline'), '.tl-item');
  await measure('recruit.directory', (ctx)=>recruit.renderRecruit(ctx), '.recruit-directory-table tbody tr', async()=>{},
    pageTurn('.recruit-directory .pager button:last-child', request=>request.action==='listRecruitDirectory'&&request.page===2));
  await measure('activities.directory', (ctx)=>activities.renderActivities(ctx), '.activity-directory-table tbody tr', async()=>{},
    pageTurn('.pager button:last-child', request=>request.name==='activities'&&request.page===2));
  await measure('knowledge.ocr-queue-status', async(ctx,main)=>{main.append(await fileImport.fileImportNode(ctx,'700001','800001'));}, '.file-import-history [data-import-id]', async()=>{},
    async(main,requests,waitFor)=>{
      const details=main.querySelector('.file-import-history')?.closest('details');
      if(!details)return {available:false};details.open=true;
      const control=details.querySelector('.care-record-actions button:nth-child(2)');if(!control)return {available:false};
      const before=requests.length,start=performance.now();control.click();
      await waitFor(()=>requests.slice(before).some(request=>request.action==='listFileImports'&&request.page===2),()=>0);
      return {available:true,elapsedMs:performance.now()-start,page:2};
    });
  await measure('knowledge.governance-import-status', (ctx)=>knowledge.renderKnowledgeGovernance(ctx), '.kg-table tbody tr', async()=>{},
    async(main)=>{const next=main.querySelector('.kg-pager button:last-child');if(!next)return {available:false};const start=performance.now();next.click();return {available:true,elapsedMs:performance.now()-start,kind:'client-side'};});
  longTaskObserver?.disconnect();
  return {timestamp:now,viewport:{width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio},iterations:ITERATIONS,
    syntheticPageRows:PAGE_SIZE,syntheticDirectoryTotal:1240,longTaskSupported:!!longTaskObserver,longTasks,results};
})()`;
(async()=>{
  if (iterations < 5) throw Error('At least five samples are required for a baseline');
  const browser=new Browser(root);
  try {
    await browser.start();
    await browser.send('Emulation.setDeviceMetricsOverride',{width:1024,height:768,deviceScaleFactor:1,mobile:false});
    await browser.openConsole('#/more');
    const run=await browser.evaluate(script);
    const result={version:1,head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),node:process.version,
      browser:browser.browserVersion?.product||null,fixtureMode:'isolated-local-only',productionData:false,productionWrites:false,run};
    const out=path.join(__dirname,'.results');fs.mkdirSync(out,{recursive:true});
    const runId=run.timestamp.replace(/[:.]/g,'-')+'-'+result.head.slice(0,8);
    fs.writeFileSync(path.join(out,`baseline-${runId}.json`),JSON.stringify(result,null,2)+'\n');
    fs.writeFileSync(path.join(out,'baseline.json'),JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify({head:result.head,browser:result.browser,viewport:run.viewport,iterations,
      results:run.results.map(x=>({id:x.id,interactiveMs:x.metrics.interactiveMs,requestCount:x.metrics.requestCount,
        apiFixtureLatencyMs:x.metrics.apiFixtureLatencyMs,requestBytes:x.metrics.requestBytes,responseBytes:x.metrics.responseBytes,
        paginationMs:x.metrics.paginationMs,rowsRendered:x.metrics.rowsRendered,duplicateRequests:x.metrics.duplicateRequests,
        longTaskCount:x.metrics.longTaskCount,longTaskDurationMs:x.metrics.longTaskDurationMs,domNodes:x.metrics.domNodes}))},null,2));
  } catch(error) {
    const out=path.join(__dirname,'.results');fs.mkdirSync(out,{recursive:true});
    let diagnostics=null;try{diagnostics=await browser.diagnostics({captureScreenshot:false});}catch{}
    const failure={timestamp:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
      code:error.code||null,stage:error.stage||diagnostics?.stage||null,message:error.message,diagnostics};
    fs.writeFileSync(path.join(out,`baseline-failure-${Date.now()}-${failure.head.slice(0,8)}.json`),JSON.stringify(failure,null,2)+'\n');
    throw error;
  } finally { await browser.close(); }
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
