'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { Browser } = require('../regression/browser.cjs');

test('PC21 saves a complete month through the existing atomic goal action and displays history', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.openConsole('#/more');
    await browser.evaluate(`(async()=>{
      const i18n=await import('/crm/js/modules/console/i18n.js');i18n.setLang('zh-CN');
      const {renderRecruitGoals}=await import('/crm/js/modules/console/recruit-goals.js');
      const stages=['新增人才','互动暖客','初次面谈','增员活动','精准面谈','入职申请','签约入司'];
      window.pc21={calls:[],async call(name,args){this.calls.push({name,args});
        if(name==='recruit_goals'&&args.action==='listGoals')return {rows:[{stage:'新增人才',target_count:3}]};
        if(name==='recruit_goals'&&args.action==='getProgress')return {rows:stages.map(stage=>({stage,target:3,actual:2,achieve_rate:66.7,conv_rate:null,conv_bench:null})),
          trends:[{month:'2026-10',stages:Object.fromEntries(stages.map(stage=>[stage,{target:3,actual:2}]))}],
          overall:{new_count:2,sign_count:0,rate:0},testData:{status:'verified',containsTestData:false,recordCount:0,sources:[]}};
        if(name==='recruit_candidates'&&args.action==='funnel')return {funnel:{'新增人才':4,'互动暖客':2,'流失':1},total:7};
        if(name==='recruit_goals'&&args.action==='saveGoals')return {ok:true};
        throw Error('Unexpected '+name+' '+JSON.stringify(args));
      }};
      const host=document.createElement('main');host.id='pc21-host';document.body.appendChild(host);
      renderRecruitGoals({main:host,api:{call:(name,args)=>window.pc21.call(name,args)},operator:{name:'Test'},toast:()=>{}});
    })()`);
    await browser.wait("document.querySelector('#pc21-host button') && document.querySelector('#pc21-host').textContent.includes('逐月历史')");
    assert.match(await browser.evaluate("document.querySelector('#pc21-host').textContent"),/目标设定和分析/);
    assert.match(await browser.evaluate("document.querySelector('.recruit-analysis-current-list').textContent"),/4/);
    await browser.send('Emulation.setDeviceMetricsOverride',{width:1180,height:820,deviceScaleFactor:1,mobile:false});
    await browser.evaluate("document.querySelector('#pc21-host').scrollIntoView({block:'start'})");
    const shot=await browser.send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.resolve(__dirname,'../security/.results/recruit-goal-analysis-zh.png'),Buffer.from(shot.data,'base64'));
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
    await browser.evaluate(`(()=>{const months=document.querySelectorAll('#pc21-host input[type=month]');months[0].value='2026-08';months[1].value='2026-10';})()`);
    await browser.click('#pc21-host button', '查询进度');
    await browser.wait("window.pc21.calls.some(x=>x.name==='recruit_goals'&&x.args.action==='getProgress'&&x.args.startMonth==='2026-08'&&x.args.endMonth==='2026-10')");
    assert.match(await browser.evaluate("document.querySelector('.recruit-analysis-stage-list').textContent"),/2 \/ 3/);
    await browser.evaluate(`(()=>{const fields=document.querySelectorAll('#pc21-host .card:last-child input[type=number]');if(!fields.length)throw Error('target inputs missing');fields[0].value='4';fields[1].value='2';})()`);
    await browser.click('#pc21-host button', '保存本月目标');
    await browser.wait("window.pc21.calls.some(x=>x.name==='recruit_goals'&&x.args.action==='saveGoals')");
    const calls = await browser.evaluate('window.pc21.calls');
    const save = calls.find(x => x.args.action === 'saveGoals');
    assert.equal(save.args.operator, 'Test');
    assert.equal(Object.keys(save.args.goals).length, 7);
    assert.equal(save.args.goals['新增人才'], 4);
    assert.equal(save.args.goals['互动暖客'], 2);
    assert.equal(calls.some(x => x.args.action === 'delete' || x.args.action === 'insert'), false);
    await browser.healthy();
  } finally { await browser.close(); }
});
