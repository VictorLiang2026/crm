'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('PC19 candidate creation resolves identity, waits for human selection, then writes', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.openConsole('#/more');
    await browser.evaluate(`(async()=>{
      const i18n=await import('/crm/js/modules/console/i18n.js');i18n.setLang('zh-CN');
      const {openRecruitCandidateCreate}=await import('/crm/js/modules/console/recruit-write.js');
      window.pc19={calls:[],async call(name,args){this.calls.push({name,args});
        if(name==='person_360'&&args.action==='resolveRecruitCandidateName')return {candidates:[{id:'9201',displayName:'【系统测试·勿联系】陈宁',occupation:'虚构顾问',customerId:null}]};
        if(name==='person_360'&&args.action==='createRecruitCandidate')return {id:'9202',personId:'9201',customerId:null};
        throw Error('Unexpected '+name+' '+JSON.stringify(args));
      }};
      const ctx={api:{call:(name,args)=>window.pc19.call(name,args)},operator:{name:'Test'},toast:()=>{}};
      openRecruitCandidateCreate(ctx,{initialName:'【系统测试·勿联系】陈宁',onDone:(personId,candidateId)=>window.pc19.done={personId,candidateId}});
    })()`);
    await browser.wait("document.querySelector('.recruit-person-choice')");
    await browser.click('button', '【系统测试·勿联系】陈宁');
    await browser.wait("document.querySelector('.sheet-actions .btn-primary') && !document.querySelector('.sheet-actions .btn-primary').disabled");
    await browser.click('.sheet-overlay button', '保存');
    await browser.wait('window.pc19.done && window.pc19.calls.some(x=>x.args.action===\'createRecruitCandidate\')');
    const result = await browser.evaluate('window.pc19');
    assert.deepEqual(result.calls.map(call => call.args.action), ['resolveRecruitCandidateName', 'createRecruitCandidate']);
    assert.deepEqual(result.calls[1].args.data, {
      personId: '9201', selectedDisplayName: '【系统测试·勿联系】陈宁', operator: 'Test',
    });
    assert.deepEqual(result.done, { personId: '9201', candidateId: '9202' });
    await browser.healthy();
  } finally { await browser.close(); }
});

test('PC19 Person 360 exposes stage, profile, files, milestone history, and follow-up operations', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.openConsole('#/more');
    await browser.evaluate(`(async()=>{
      const i18n=await import('/crm/js/modules/console/i18n.js');i18n.setLang('zh-CN');
      const {renderRecruitSection}=await import('/crm/js/modules/console/recruit-write.js');
      const candidate={id:9202,person_id:9201,stage:'新增人才',updated_at:'2026-10-16T05:00:00.000Z',
        motivation:'虚构动机',concerns:'',work_experience:'',family_situation:'',personality_tags:'',career_plan:'',
        next_action:'',next_action_date:null,recruitment_priority:null};
      window.pc19ui={calls:[],async call(name,args){this.calls.push({name,args});
        if(name==='person_360'&&args.action==='listRecruitContext')return {rows:[{id:'9202',stage:'新增人才'}]};
        if(name==='person_360'&&args.action==='get')return {person:{display_name:'【系统测试·勿联系】陈宁'}};
        if(name==='person_360'&&args.action==='getRecruitCandidate')return {candidate,milestones:[{id:3,from_stage:null,to_stage:'新增人才',happened_at:'2026-10-15T00:00:00Z',note:'创建候选人'}],followups:[]};
        if(name==='person_360'&&args.action==='transitionRecruitStage')return {ok:true,changed:true};
        if(name==='recruit_followups'&&args.action==='create')return {id:'9203'};
        if(name==='recruit_candidates'&&args.action==='update')return {ok:true,updated:1};
        throw Error('Unexpected '+name+' '+JSON.stringify(args));
      }};
      const ctx={api:{call:(name,args)=>window.pc19ui.call(name,args)},operator:{name:'Test'},toast:()=>{}};
      const host=document.createElement('div');host.id='pc19-host';document.body.appendChild(host);
      host.replaceChildren(await renderRecruitSection(ctx,'9201',()=>window.pc19ui.refreshed=(window.pc19ui.refreshed||0)+1));
      window.pc19ui.host=host;
    })()`);
    await browser.wait("document.querySelector('#pc19-host .recruit-followups-empty, #pc19-host .card')");
    assert.equal(await browser.evaluate("document.querySelector('#pc19-host').textContent.includes('阶段历史')"), true);
    await browser.evaluate("document.querySelector('#pc19-host select').value='精准面谈'");
    await browser.click('#pc19-host button', '保存阶段');
    await browser.wait("window.pc19ui.calls.some(x=>x.args.action==='transitionRecruitStage')");
    await browser.click('#pc19-host button', '新增跟进');
    await browser.wait("document.querySelector('.sheet-overlay')");
    await browser.evaluate(`(()=>{const date=document.querySelector('.sheet-overlay input[type=date]');date.value='2026-10-16';
      const notes=[...document.querySelectorAll('.sheet-overlay textarea')].find(x=>x.getAttribute('aria-label')==='跟进内容');notes.value='【系统测试·勿联系】虚构招募跟进';})()`);
    await browser.click('.sheet-overlay button', '保存');
    await browser.wait("window.pc19ui.calls.some(x=>x.name==='recruit_followups'&&x.args.action==='create')");
    const calls = await browser.evaluate('window.pc19ui.calls');
    const transition = calls.find(call => call.args.action === 'transitionRecruitStage');
    assert.equal(transition.args.data.personId, '9201');
    assert.equal(transition.args.data.stage, '精准面谈');
    const followup = calls.find(call => call.name === 'recruit_followups' && call.args.action === 'create');
    assert.equal(followup.args.data.candidate_id, '9202');
    assert.equal(followup.args.data.followup_notes, '【系统测试·勿联系】虚构招募跟进');
    await browser.healthy();
  } finally { await browser.close(); }
});

test('PC19 attachment upload failure never writes file metadata', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.openConsole('#/more');
    await browser.evaluate(`(async()=>{
      const i18n=await import('/crm/js/modules/console/i18n.js');i18n.setLang('zh-CN');
      const {renderRecruitSection}=await import('/crm/js/modules/console/recruit-write.js');
      const candidate={id:9302,person_id:9301,stage:'新增人才',updated_at:'2026-10-16T05:00:00.000Z'};
      window.pc19file={calls:[],async call(name,args){this.calls.push({name,args});
        if(name==='person_360'&&args.action==='listRecruitContext')return {rows:[{id:'9302',stage:'新增人才'}]};
        if(name==='person_360'&&args.action==='get')return {person:{display_name:'【系统测试·勿联系】赵七'}};
        if(name==='person_360'&&args.action==='getRecruitCandidate')return {candidate,milestones:[],followups:[]};
        if(name==='recruit_candidates'&&args.action==='update')return {ok:true,updated:1};
        throw Error('Unexpected '+name+' '+JSON.stringify(args));
      }};
      const ctx={api:{call:(name,args)=>window.pc19file.call(name,args)},operator:{name:'Test'},toast:message=>window.pc19file.toasts=(window.pc19file.toasts||[]).concat(message),
        recruitFiles:{async upload(){return {error:{message:'虚构网络失败'}}},async remove(){return {}}}};
      const host=document.createElement('div');host.id='pc19-file-host';document.body.appendChild(host);
      host.replaceChildren(await renderRecruitSection(ctx,'9301',()=>{}));
    })()`);
    await browser.wait("document.querySelector('#pc19-file-host input[type=file]')");
    await browser.evaluate(`(()=>{const input=document.querySelector('#pc19-file-host input[type=file]');
      const file=new File(['fake image'],'fake.png',{type:'image/png'});
      Object.defineProperty(input,'files',{configurable:true,value:[file]});
      input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await browser.wait("window.pc19file.toasts && window.pc19file.toasts.length");
    const result = await browser.evaluate('window.pc19file');
    assert.equal(result.calls.some(call => call.name === 'recruit_candidates' && call.args.action === 'update'), false);
    assert.ok(result.toasts.some(message => message.includes('虚构网络失败')));
    await browser.healthy();
  } finally { await browser.close(); }
});
