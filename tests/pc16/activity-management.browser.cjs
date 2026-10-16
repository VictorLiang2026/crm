'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {Browser}=require('../regression/browser.cjs');

test('PC16 activity create/edit/delete and task CRUD retain review, legacy report, bilingual iPad layout',async()=>{
  const browser=new Browser(path.resolve(__dirname,'../..'));
  try{
    await browser.start();await browser.open('#/more');
    await browser.evaluate(`(async()=>{
      const i18n=await import('/crm/js/modules/console/i18n.js');window.pc16I18n=i18n;
      const {renderActivities,renderActivity}=await import('/crm/js/modules/console/pages/activities.js');
      const activity={id:42,name:'【系统测试·勿联系】虚构活动甲',activity_date:'2026-10-15',activity_type:'沙龙',
        status:'preparing',location:'虚构地点',description:'虚构说明',updated_at:'2026-10-16T01:00:00.000Z'};
      const task={id:6,activity_id:42,task_title:'【系统测试·勿联系】准备名单',task_type:'preparation',status:'pending',
        priority:'high',due_date:'2026-10-18',note:'虚构备注',source:'manual',updated_at:'2026-10-16T01:05:00.000Z'};
      window.pc16={calls:[],activity,task,created:[],updated:[],removed:[],
        async call(name,args){this.calls.push({name,args});
          if(name==='activities'&&args.action==='list')return {rows:[this.activity]};
          if(name==='activities'&&args.action==='create'){this.created.push(args.data);return {id:43};}
          if(name==='activities'&&args.action==='get')return {activity:this.activity,participants:[]};
          if(name==='activities'&&args.action==='updateConsole'){this.updated.push(args);return {ok:true};}
          if(name==='activities'&&args.action==='previewRemove')return {activity:this.activity,impact:{participantsSoftDeleted:2,preparationTasksRetained:1,actionsRetained:1}};
          if(name==='activities'&&args.action==='removeConsole'){this.removed.push(args);return {ok:true};}
          if(name==='activity_tasks'&&args.action==='list')return {rows:[this.task]};
          if(name==='activity_tasks'&&args.action==='create'){this.created.push(args.data);return {id:7};}
          if(name==='activity_tasks'&&args.action==='updateConsole'){this.updated.push(args);return {ok:true};}
          if(name==='activity_tasks'&&args.action==='transitionConsole'){this.updated.push(args);return {ok:true};}
          if(name==='activity_tasks'&&args.action==='removeConsole'){this.removed.push(args);return {ok:true};}
          throw Error('Unexpected '+name+' '+JSON.stringify(args));
        }};
      const host=document.createElement('div');host.id='pc16-host';document.body.appendChild(host);
      const ctx={main:host,api:{call:(name,args)=>window.pc16.call(name,args)},toast:(message,type)=>{window.pc16.lastToast={message,type}}};
      window.pc16ctx=ctx;window.pc16render={renderActivities,renderActivity};renderActivities(ctx);
    })()`);
    await browser.wait("document.querySelector('#pc16-host .data-row')");
    const newButton=await browser.evaluate(`(()=>[...document.querySelectorAll('#pc16-host button')].find(b=>b.innerText.includes('新建活动'))?.innerText)()`);
    assert.ok(newButton,'new activity button is live');
    await browser.evaluate(`(()=>[...document.querySelectorAll('#pc16-host button')].find(b=>b.innerText.includes('新建活动')).click())()`);
    await browser.wait("document.querySelector('.sheet input[type=text]')");
    await browser.evaluate(`(()=>{const fields=[...document.querySelectorAll('.sheet input')];fields.find(x=>x.type==='text').value='【系统测试·勿联系】活动乙';fields.find(x=>x.type==='date').value='2026-10-20';document.querySelector('.sheet .btn-primary').click()})()`);
    await browser.wait("window.pc16.created.some(x=>x.name.includes('活动乙'))");
    const created=await browser.evaluate("window.pc16.created[0]");
    assert.equal(created.activity_date,'2026-10-20');assert.equal(created.status,'idea');
    assert.ok((await browser.evaluate(`(()=>{const b=[...document.querySelectorAll('#pc16-host button')].find(x=>x.innerText.includes('活动量日报'));return b?.onclick?.toString()||''})()`)).includes('/activity/customer'),'daily report keeps the legacy route');
    await browser.evaluate("window.pc16render.renderActivity(window.pc16ctx,42)");
    await browser.wait("document.querySelector('#pc16-host .act-task-actions')");
    assert.ok((await browser.evaluate("document.querySelector('#pc16-host').innerText")).includes('虚构活动甲'));
    await browser.evaluate(`(()=>[...document.querySelectorAll('#pc16-host button')].find(b=>b.innerText.includes('添加任务')).click())()`);
    await browser.wait("document.querySelector('.sheet input[type=text]')");
    await browser.evaluate(`(()=>{const s=document.querySelector('.sheet input[type=text]');s.value='【系统测试·勿联系】新任务';document.querySelector('.sheet .btn-primary').click()})()`);
    await browser.wait("window.pc16.created.some(x=>x.task_title?.includes('新任务'))");
    const taskCreate=await browser.evaluate("window.pc16.created.find(x=>x.task_title)");
    assert.equal(taskCreate.source,'manual');assert.equal(taskCreate.related_type,'none');
    assert.equal(await browser.evaluate("window.pc16.calls.some(c=>c.name==='person_360'&&/Action/i.test(JSON.stringify(c.args)))"),false);
    await browser.evaluate(`(()=>{const b=[...document.querySelectorAll('#pc16-host .act-task-actions button')].find(x=>x.innerText==='编辑');b.click()})()`);
    await browser.wait("document.querySelector('.sheet input[type=text]')");
    await browser.evaluate(`(()=>{document.querySelector('.sheet input[type=text]').value='【系统测试·勿联系】更新任务';document.querySelector('.sheet .btn-primary').click()})()`);
    await browser.wait("window.pc16.updated.some(x=>x.action==='updateConsole'&&x.expectedUpdatedAt)");
    await browser.evaluate(`(()=>{const b=[...document.querySelectorAll('#pc16-host .act-task-actions button')].find(x=>x.innerText.includes('完成'));b.click()})()`);
    await browser.wait("window.pc16.calls.some(c=>c.args.action==='transitionConsole'&&c.args.status==='completed')");
    await browser.evaluate(`(()=>{const b=[...document.querySelectorAll('#pc16-host .act-task-actions button')].find(x=>x.innerText==='删除');b.click()})()`);
    await browser.wait("document.querySelector('.sheet .act-danger')");
    assert.equal(await browser.evaluate("window.pc16.removed.length"),0,'task delete waits for explicit confirmation');
    await browser.evaluate("document.querySelector('.sheet .act-danger').click()");
    await browser.wait("window.pc16.removed.some(x=>x.action==='removeConsole')");
    await browser.evaluate(`(()=>[...document.querySelectorAll('#pc16-host button')].find(b=>b.innerText.includes('编辑活动')).click())()`);
    await browser.wait("document.querySelector('.sheet input[type=text]')");
    await browser.evaluate(`(()=>{document.querySelector('.sheet input[type=text]').value='【系统测试·勿联系】已编辑活动';document.querySelector('.sheet .btn-primary').click()})()`);
    await browser.wait("window.pc16.updated.some(x=>x.action==='updateConsole'&&x.expectedUpdatedAt)");
    await browser.evaluate(`(()=>document.querySelector('#pc16-host .act-delete-button').click())()`);
    await browser.wait("document.querySelector('.sheet .act-delete-confirm')||document.querySelector('.sheet .act-danger')");
    assert.equal(await browser.evaluate("window.pc16.removed.length"),1,'activity preview does not delete before confirmation');
    assert.ok((await browser.evaluate("document.querySelector('.sheet').innerText")).includes('2'));
    await browser.evaluate("document.querySelector('.sheet .act-danger').click()");
    await browser.wait("window.pc16.removed.some(x=>x.action==='removeConsole')");
    await browser.evaluate(`(()=>{window.pc16I18n.setLang('en');window.pc16render.renderActivity(window.pc16ctx,42)})()`);
    await browser.wait("document.querySelector('#pc16-host').innerText.includes('Prep Tasks')");
    for(const [width,height] of [[820,1180],[1180,820]]){
      await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      const m=await browser.evaluate(`(()=>({doc:document.documentElement.scrollWidth,host:document.querySelector('#pc16-host').scrollWidth,client:document.querySelector('#pc16-host').clientWidth}))()`);
      assert.ok(m.doc<=width+1&&m.host<=m.client+1,`iPad overflow ${JSON.stringify(m)}`);
    }
    await browser.healthy();
  }finally{await browser.close();}
});
