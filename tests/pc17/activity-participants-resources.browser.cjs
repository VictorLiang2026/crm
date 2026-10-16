'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {Browser}=require('../regression/browser.cjs');

test('PC17 resolves and confirms Person links, stages names explicitly, and manages speaker/topic resources',async()=>{
  const browser=new Browser(path.resolve(__dirname,'../..'));
  try{
    await browser.start();await browser.open('#/more');
    await browser.evaluate(`(async()=>{
      const {renderActivityParticipants,renderActivityResources}=await import('/crm/js/modules/console/activity-people.js');
      const activity={id:42,name:'【系统测试·勿联系】PC17活动',activity_date:'2026-10-20',topic_ids:[],updated_at:'2026-10-16T04:00:00.000Z'};
      const candidates={张三:{id:'9001',displayName:'张三',occupation:'虚构职业',organization:'虚构机构'},李四:{id:'9002',displayName:'李四',occupation:'虚构职业',organization:'虚构机构'},王五:{id:'9003',displayName:'王五',occupation:'虚构职业',organization:'虚构机构'}};
      const participants=[{id:2,activity_id:42,person_type:'customer',person_id:null,person_name:'李四',canonical_person_id:null,status:'invited',updated_at:'2026-10-16T04:01:00.000Z'}];
      const speakers=[{id:8,name:'王五',person_id:null,customer_id:null,position:'旧职务',expertise:'旧领域',topic_summary:'旧主题',relationship_stage:'new',status:'active',cooperation_count:0,updated_at:'2026-10-16T04:02:00.000Z'}];
      const topics=[{id:5,topic_name:'虚构养老主题',category:'虚构分类',keywords:[],status:'active',use_count:0,updated_at:'2026-10-16T04:03:00.000Z'}];
      window.pc17={activity,participants,speakers,topics,calls:[],writes:[],
        async call(name,args){this.calls.push({name,args});
          if(name==='person_360'&&args.action==='resolveIdentity'){const candidate=candidates[args.name];return {candidates:candidate?[candidate]:[]};}
          if(name==='person_360'&&args.action==='addCanonicalParticipant'){this.writes.push(args.data);const row={id:10,activity_id:42,person_type:args.data.personType,person_id:null,person_name:args.data.selectedDisplayName,canonical_person_id:Number(args.data.canonicalPersonId),status:args.data.status,relationship_note:args.data.relationshipNote,updated_at:'2026-10-16T04:10:00.000Z'};this.participants.push(row);return {id:row.id,canonicalPersonId:args.data.canonicalPersonId};}
          if(name==='person_360'&&args.action==='linkCanonicalParticipant'){this.writes.push(args.data);const row=this.participants.find(x=>x.id===Number(args.data.participantId));row.canonical_person_id=Number(args.data.canonicalPersonId);row.person_name=args.data.selectedDisplayName;row.updated_at='2026-10-16T04:11:00.000Z';return {ok:true};}
          if(name==='activities'&&args.action==='addParticipant'){this.participants.push({id:11,activity_id:42,person_type:args.data.person_type,person_id:null,person_name:args.data.person_name,status:'invited',updated_at:'2026-10-16T04:12:00.000Z'});return {id:11,linked:false};}
          if(name==='activities'&&args.action==='updateParticipantConsole'){this.writes.push(args);const row=this.participants.find(x=>x.id===args.id);if(row){row.status=args.status;row.updated_at='2026-10-16T04:13:00.000Z';}return {ok:true};}
          if(name==='activities'&&args.action==='get')return {activity:this.activity,participants:this.participants};
          if(name==='activity_speakers'&&args.action==='list')return {rows:this.speakers};
          if(name==='person_360'&&args.action==='createSpeakerProfile'){this.writes.push(args.data);this.speakers.push({id:9,name:args.data.selectedDisplayName,person_id:Number(args.data.personId),linked_person:{id:Number(args.data.personId),name:args.data.selectedDisplayName},status:'active',relationship_stage:'new',cooperation_count:0});return {id:9};}
          if(name==='activity_speakers'&&args.action==='create'){this.speakers.push({id:10,...args.data});return {id:10};}
          if(name==='activity_speakers'&&args.action==='update'){this.writes.push(args);return {ok:true};}
          if(name==='person_360'&&args.action==='linkSpeakerPerson'){this.writes.push(args.data);return {ok:true};}
          if(name==='activity_speakers'&&args.action==='previewRemoveConsole')return {speaker:{...this.speakers[0],updated_at:this.speakers[0].updated_at},impact:{participantRows:1}};
          if(name==='activity_topics'&&args.action==='list')return {rows:this.topics};
          if(name==='activity_topics'&&args.action==='create'){this.topics.push({id:6,...args.data});return {id:6};}
          if(name==='activity_topics'&&args.action==='update')return {ok:true};
          if(name==='activities'&&args.action==='applyTopicsConsole'){this.writes.push(args);return {ok:true};}
          if(name==='activity_topics'&&args.action==='previewRemoveConsole')return {topic:{...this.topics[0],updated_at:this.topics[0].updated_at},impact:{activityReferences:1}};
          throw Error('Unexpected '+name+' '+JSON.stringify(args));
        }};
      const host=document.createElement('div');host.id='pc17-host';document.body.appendChild(host);
      const ctx={main:host,api:{call:(name,args)=>window.pc17.call(name,args)},toast:(message,type)=>{window.pc17.lastToast={message,type}}};
      window.pc17ctx=ctx;window.pc17render={renderActivityParticipants,renderActivityResources};
      host.replaceChildren(await renderActivityParticipants(ctx,activity,participants,()=>{}));
    })()`);
    await browser.wait("document.querySelector('#pc17-host .act-participant-add-title')||document.querySelector('#pc17-host .act-note-row button')");
    await browser.click('#pc17-host button','添加参与者');
    await browser.wait("document.querySelector('.sheet input[type=search]')");
    await browser.evaluate(`(()=>{document.querySelector('.sheet input[type=search]').value='张三';document.querySelector('.sheet input[type=search]').dispatchEvent(new Event('input',{bubbles:true}));[...document.querySelectorAll('.sheet .btn-ghost')].find(x=>x.innerText.includes('解析 Person')).click()})()`);
    await browser.wait("document.querySelector('.sheet .act-person-candidate')");
    await browser.click('.sheet .act-person-candidate','张三');
    assert.equal(await browser.evaluate("document.querySelector('.sheet .btn-primary').disabled"),false,'Person must be selected before writing');
    await browser.click('.sheet .btn-primary','确认添加参与者');
    await browser.wait("window.pc17.writes.some(x=>x.canonicalPersonId==='9001')");
    assert.equal(await browser.evaluate("window.pc17.writes.find(x=>x.canonicalPersonId==='9001').confirmed"),true);
    await browser.evaluate(`(async()=>document.querySelector('#pc17-host').replaceChildren(await window.pc17render.renderActivityParticipants(window.pc17ctx,window.pc17.activity,window.pc17.participants,()=>{})))()`);
    await browser.click('#pc17-host button','更改状态');
    await browser.wait("document.querySelector('.sheet select')");
    await browser.evaluate(`(()=>{document.querySelector('.sheet select').value='attended';document.querySelector('.sheet .btn-primary').click()})()`);
    await browser.wait("window.pc17.writes.some(x=>x.action==='updateParticipantConsole'&&x.status==='attended')");
    await browser.evaluate(`(async()=>document.querySelector('#pc17-host').replaceChildren(await window.pc17render.renderActivityParticipants(window.pc17ctx,window.pc17.activity,window.pc17.participants,()=>{})))()`);
    await browser.click('#pc17-host button','更改状态');
    await browser.wait("document.querySelector('.sheet select')");
    await browser.evaluate(`(()=>{document.querySelector('.sheet select').value='invited';document.querySelector('.sheet .btn-primary').click()})()`);
    await browser.wait("window.pc17.writes.some(x=>x.action==='updateParticipantConsole'&&x.expectedStatus==='attended'&&x.status==='invited')");
    await browser.click('#pc17-host button','关联 Person');
    await browser.wait("document.querySelector('.sheet input[type=search]')");
    await browser.evaluate(`(()=>{const i=document.querySelector('.sheet input[type=search]');i.value='李四';i.dispatchEvent(new Event('input',{bubbles:true}));[...document.querySelectorAll('.sheet .btn-ghost')].find(x=>x.innerText.includes('解析 Person')).click()})()`);
    await browser.wait("document.querySelector('.sheet .act-person-candidate')");
    await browser.click('.sheet .act-person-candidate','李四');
    await browser.click('.sheet .act-link-confirm','确认关联');
    await browser.wait("window.pc17.writes.some(x=>x.participantId==='2')");
    assert.equal(await browser.evaluate("window.pc17.writes.find(x=>x.participantId==='2').confirmed"),true);
    await browser.click('#pc17-host button','暂存姓名');
    await browser.wait("document.querySelector('.sheet .act-warning')");
    await browser.evaluate(`(()=>{document.querySelector('.sheet input[type=text]').value='【系统测试·勿联系】临时嘉宾';[...document.querySelectorAll('.sheet .btn-primary')].find(x=>x.innerText.includes('确认暂存')).click()})()`);
    await browser.wait("window.pc17.participants.some(x=>x.person_name.includes('临时嘉宾'))");
    assert.equal(await browser.evaluate("window.pc17.participants.find(x=>x.person_name.includes('临时嘉宾')).canonical_person_id||null"),null);
    await browser.evaluate(`(async()=>document.querySelector('#pc17-host').replaceChildren(await window.pc17render.renderActivityResources(window.pc17ctx,42)))()`);
    await browser.wait("document.querySelector('#pc17-host .act-resource-delete')");
    await browser.click('#pc17-host button','新增嘉宾档案');
    await browser.wait("document.querySelector('.sheet .act-speaker-save')");
    await browser.evaluate(`(()=>{const i=document.querySelector('.sheet input[type=text]');i.value='张三';i.dispatchEvent(new Event('input',{bubbles:true}));[...document.querySelectorAll('.sheet .btn-ghost')].find(x=>x.innerText.includes('解析 Person')).click()})()`);
    await browser.wait("document.querySelector('.sheet .act-person-candidate')");
    await browser.click('.sheet .act-person-candidate','张三');
    await browser.click('.sheet .act-speaker-save','确认创建嘉宾');
    await browser.wait("window.pc17.writes.some(x=>x.selectedDisplayName==='张三')");
    await browser.click('#pc17-host button','新建主题');
    await browser.wait("document.querySelector('.sheet input[type=text]')");
    await browser.evaluate(`(()=>{document.querySelector('.sheet input[type=text]').value='【系统测试·勿联系】PC17虚构主题';[...document.querySelectorAll('.sheet .btn-primary')].find(x=>x.innerText.includes('确认创建主题')).click()})()`);
    await browser.wait("window.pc17.topics.some(x=>x.topic_name.includes('PC17虚构主题'))");
    await browser.wait("document.querySelector('#pc17-host .act-topic-pick')");
    await browser.evaluate(`(()=>{const row=[...document.querySelectorAll('#pc17-host .act-topic-pick')].find(x=>x.innerText.includes('PC17虚构主题'));const c=row.querySelector('input');c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#pc17-host .act-topics-save button').click()})()`);
    await browser.wait("window.pc17.writes.some(x=>x.action==='applyTopicsConsole')");
    const topicWrite=await browser.evaluate("window.pc17.writes.find(x=>x.action==='applyTopicsConsole')");
    assert.ok(topicWrite.topic_ids.map(String).includes('6'));
    assert.equal(await browser.evaluate("window.pc17.calls.some(c=>c.name==='person_360'&&c.args.action==='recordActivityInteraction')"),false,'check-in never creates an Interaction');
    await browser.evaluate(`(async()=>{const i=await import('/crm/js/modules/console/i18n.js');i.setLang('en');document.querySelector('#pc17-host').replaceChildren(await window.pc17render.renderActivityResources(window.pc17ctx,42))})()`);
    await browser.wait("document.querySelector('#pc17-host').innerText.includes('Speaker Profiles')");
    for(const [width,height] of [[820,1180],[1180,820]]){
      await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      const m=await browser.evaluate(`(()=>({doc:document.documentElement.scrollWidth,host:document.querySelector('#pc17-host').scrollWidth,client:document.querySelector('#pc17-host').clientWidth}))()`);
      assert.ok(m.doc<=width+1&&m.host<=m.client+1,`iPad overflow ${JSON.stringify(m)}`);
    }
    await browser.healthy();
  }finally{await browser.close();}
});
