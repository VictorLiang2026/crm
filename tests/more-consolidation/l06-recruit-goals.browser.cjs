'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {Browser}=require('../regression/browser.cjs');
test('L06 goal drafts require explicit save; assumptions validate and retain version conflicts; bilingual iPad',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.openConsole('#/more','authCase=1');await b.wait("document.querySelector('.more-primary')");
  await b.evaluate(`(async()=>{
   const {renderRecruitGoals}=await import('/crm/js/modules/console/recruit-goals.js');
   const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang('zh-CN');
   const stages=['新增人才','互动暖客','初次面谈','增员活动','精准面谈','入职申请','签约入司'];
   window.l06={calls:[],missing:false,conflict:false,failRead:false,version:1};
   window.l06ctx={main:document.querySelector('#console-main'),operator:{name:'[CRM_TEST_ONLY]'},api:{call:async(name,args)=>{
    if(name!=='recruit_goals')throw Error('Unexpected function');window.l06.calls.push(args);
    if(args.action==='listGoals')return {rows:window.l06.missing?[]:[{stage:stages[0],target_count:args.startMonth==='2026-12'?12:5},{stage:stages[6],target_count:2}]};
    if(args.action==='getProgress')return{rows:[{stage:stages[0],target:0,actual:0},{stage:stages[1],target:1,actual:3,conv_rate:150}],trends:[],overall:{new_count:0,sign_count:3,rate:0}};
    if(args.action==='listBenchmarks'){if(window.l06.failRead)throw Error('TEST_READ_FAILED');return{rows:stages.slice(0,-1).map((s,i)=>({stage_from:s,stage_to:stages[i+1],conversion_min:25,conversion_avg:50,conversion_good:75,source:'[CRM_TEST_ONLY] unverified',updated_at:'2026-10-25T00:00:0'+window.l06.version+'Z'}))};}
    if(args.action==='saveBenchmarks'){if(window.l06.conflict)throw Error('Assumption changed; reload before saving');window.l06.version++;return{ok:true,updated:6};}
    if(args.action==='saveGoals')return{ok:true};
    throw Error('Unexpected action');
   }}};
   window.l06render=renderRecruitGoals;renderRecruitGoals(window.l06ctx);
  })()`);
  await b.wait("document.querySelector('.recruit-goals-advanced')");
  assert.equal(await b.evaluate("document.querySelectorAll('#console-main input[type=number]').length"),7);
  assert.equal(await b.evaluate("window.l06.calls.some(c=>c.action==='listBenchmarks')"),false);
  assert.equal(await b.evaluate("document.querySelector('#console-main a[href*=admin]')"),null);
  await b.evaluate("const month=[...document.querySelectorAll('input[type=month]')].at(-1);month.value='2027-01';month.dispatchEvent(new Event('change'))");
  await b.wait("document.querySelector('.l06-goal-fields input')?.value==='5' && document.querySelector('#console-main').textContent.includes('2027-01')");
  await b.evaluate("document.querySelector('.l06-goal-fields input').value='9';document.querySelector('.recruit-goals-advanced summary').click()");
  await b.wait("document.querySelectorAll('.l06-assumptions tbody tr').length===6");
  await b.click('#console-main button','沿用上月目标为草稿');
  await b.wait("document.querySelector('.l06-goal-fields input')?.value==='12'");
  assert.equal(await b.evaluate("window.l06.calls.filter(c=>c.action==='saveGoals'||c.action==='saveBenchmarks').length"),0);
  assert.equal(await b.evaluate("window.l06.calls.some(c=>c.action==='listGoals'&&c.startMonth==='2026-12'&&c.endMonth==='2026-12')"),true);
  await b.click('#console-main button','撤销草稿填入');
  assert.equal(await b.evaluate("document.querySelector('.l06-goal-fields input').value"),'9');
  await b.evaluate('window.l06.missing=true');
  await b.click('#console-main button','沿用上月目标为草稿');await b.wait("document.querySelector('#console-main').textContent.includes('上月没有目标')");
  assert.equal(await b.evaluate("document.querySelector('.l06-goal-fields input').value"),'9');
  await b.evaluate('window.l06.missing=false');
  await b.click('#console-main button','测算为目标草稿');
  assert.deepEqual(await b.evaluate("[...document.querySelectorAll('.l06-goal-fields input')].map(x=>Number(x.value))"),[128,64,32,16,8,4,2]);
  await b.evaluate("document.querySelector('.l06-tools input[type=number]').value='0'");
  await b.click('#console-main button','测算为目标草稿');
  assert.equal(await b.evaluate("[...document.querySelectorAll('.l06-goal-fields input')].every(x=>x.value==='0')"),true);
  await b.click('#console-main button','撤销草稿填入');
  assert.equal(await b.evaluate("document.querySelector('.l06-goal-fields input').value"),'9');
  await b.evaluate("document.querySelector('.l06-assumptions tbody input').value='0'");
  await b.click('#console-main button','保存个人假设');
  assert.equal(await b.evaluate("window.l06.calls.some(c=>c.action==='saveBenchmarks')"),false);
  await b.click('#console-main button','测算为目标草稿');
  assert.equal(await b.evaluate("document.querySelector('.l06-goal-fields input').value"),'9');
  await b.evaluate("document.querySelector('.l06-assumptions tbody input').value='25';window.l06.conflict=true");
  await b.click('#console-main button','保存个人假设');
  await b.wait("document.querySelector('#console-main').textContent.includes('假设已被其他操作更新')");
  assert.equal(await b.evaluate("document.querySelector('.l06-goal-fields input').value"),'9');
  assert.equal(await b.evaluate("window.l06.calls.find(c=>c.action==='saveBenchmarks').atomic"),true);
  await b.evaluate("window.l06.conflict=false");
  await b.click('#console-main button','重新读取假设');await b.wait("document.querySelectorAll('.l06-assumptions tbody tr').length===6 && ![...document.querySelectorAll('button')].find(x=>x.textContent==='保存个人假设').disabled");
  await b.click('#console-main button','保存个人假设');await b.wait("document.querySelector('#console-main').textContent.includes('个人假设已保存')");
  assert.equal(await b.evaluate("window.l06.calls.some(c=>c.action==='saveGoals')"),false);
  await b.click('#console-main button','保存本月目标');await b.wait("window.l06.calls.some(c=>c.action==='saveGoals')");
  assert.equal(await b.evaluate("window.l06.calls.find(c=>c.action==='saveGoals').goalMonth"),'2027-01');
  assert.equal(await b.evaluate("window.l06.calls.find(c=>c.action==='saveGoals').goals['新增人才']"),9);
  await b.wait("document.querySelector('.recruit-goals-advanced')");
  for(const lang of ['zh-CN','en']){
   await b.evaluate('(async()=>{const {setLang}=await import("/crm/js/modules/console/i18n.js");setLang('+JSON.stringify(lang)+');window.l06render(window.l06ctx)})()');
   await b.wait("document.querySelector('.recruit-goals-advanced')");
   await b.evaluate("document.querySelector('.recruit-goals-advanced summary').click()");
   await b.wait("document.querySelectorAll('.l06-assumptions tbody tr').length===6");
   if(lang==='en')assert.match(await b.evaluate("document.querySelector('.l06-assumptions tbody th').title"),/New Talent → Relationship Building/);
   for(const [width,height]of[[820,1180],[1180,820]]){
    await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await b.evaluate("document.querySelector('.recruit-goals-advanced').scrollIntoView({block:'start'})");
    assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
    assert.equal(await b.evaluate("document.querySelector('#console-main').textContent.includes('l06_')"),false);
    const shot=await b.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.resolve(__dirname,'../security/.results/l06-'+lang+'-'+width+'.png'),Buffer.from(shot.data,'base64'));
   }
  }
  await b.healthy();
 }finally{await b.close();}
});

test('L06 ignores stale month responses and leaves current inputs untouched when prior-month reading fails',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.openConsole('#/more','authCase=1');await b.wait("document.querySelector('.more-primary')");
  await b.evaluate(`(async()=>{
   const {renderRecruitGoals}=await import('/crm/js/modules/console/recruit-goals.js');
   const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang('zh-CN');
   window.l06race={resolve:null,calls:[]};
   renderRecruitGoals({main:document.querySelector('#console-main'),api:{call:async(name,args)=>{
    window.l06race.calls.push(args);
    if(args.action==='getProgress')return{rows:[],trends:[],overall:{}};
    if(args.action==='listGoals'){
     if(args.startMonth==='2030-01')return new Promise(resolve=>{window.l06race.resolve=resolve;});
     if(args.startMonth==='2030-03')throw Error('TEST_READ_FAILED');
     return{rows:[{stage:'新增人才',target_count:8}]};
    }
    if(args.action==='listBenchmarks')return{rows:[]};
    throw Error('No writes expected');
   }}});
  })()`);
  await b.wait("document.querySelector('.l06-goal-fields input')");
  await b.evaluate("(()=>{const input=[...document.querySelectorAll('input[type=month]')].at(-1);input.value='2030-01';input.dispatchEvent(new Event('change'))})()");
  await b.wait('window.l06race.resolve!==null');
  await b.evaluate("(()=>{const input=[...document.querySelectorAll('input[type=month]')].at(-1);input.value='2030-04';input.dispatchEvent(new Event('change'))})()");
  await b.wait("document.querySelector('.l06-goal-fields input')?.value==='8'");
  await b.evaluate("window.l06race.resolve({rows:[{stage:'新增人才',target_count:99}]})");
  await b.wait("document.querySelector('#console-main').textContent.includes('2030-04')");
  assert.equal(await b.evaluate("document.querySelector('.l06-goal-fields input').value"),'8');
  await b.evaluate("document.querySelector('.recruit-goals-advanced summary').click()");
  await b.wait("document.querySelector('.l06-tools').textContent.includes('暂无可用假设')");
  await b.click('#console-main button','沿用上月目标为草稿');
  await b.wait("document.querySelector('.l06-tools').textContent.includes('读取失败')");
  assert.equal(await b.evaluate("document.querySelector('.l06-goal-fields input').value"),'8');
  assert.equal(await b.evaluate("window.l06race.calls.some(c=>/^save/.test(c.action))"),false);
  await b.healthy();
 }finally{await b.close();}
});
