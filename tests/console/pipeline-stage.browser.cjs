const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {Browser}=require('../regression/browser.cjs');

test('pipeline transition shows the server preview and confirms only its receipt in both tracks',async()=>{
  const b=new Browser(path.resolve(__dirname,'../..'));
  try {
    await b.start();await b.openConsole('#/people','authCase=1');
    await b.wait("document.querySelector('.console-main')");
    await b.evaluate(`(async()=>{
      const {openPipelineStage}=await import('/crm/js/modules/console/pipeline-stage.js');
      const {setLang}=await import('/crm/js/modules/console/i18n.js');
      window.commands=[];window.completed=0;
      const ctx={toast(){},api:{async call(name,args){
        window.commands.push(args);
        if(args.action==='getPipelineState')return {stage:'新增人才',source:''};
        if(args.action==='previewPipelineStage')return {previewId:'server-receipt',preview:{
          ...args.data,before:'新增人才',personName:'【系统测试·勿联系】核实身份'}};
        if(args.action==='confirmPipelineStage')return {confirmedAt:'2026-11-11'};
        throw Error('Unexpected command');
      }}};
      window.showStage=(track,lang)=>{setLang(lang);openPipelineStage(ctx,{track,personId:11,recordId:21},()=>window.completed++);};
    })()`);
    for(const [track,lang,result] of [['recruitment','zh-CN','继续培养'],['protection','en','已成交']]){
      await b.evaluate(`window.showStage('${track}','${lang}')`);
      await b.wait("document.querySelector('.sheet select')");
      assert.equal(await b.evaluate("document.querySelector('.sheet select').options.length"),9);
      await b.evaluate(`document.querySelector('.sheet select').value='${result}';document.querySelector('.sheet .btn-primary').click()`);
      assert.equal(await b.evaluate("document.querySelector('.sheet-err').style.display==='none'"),false);
      const prior=await b.evaluate("window.completed");
      await b.evaluate("document.querySelector('.sheet textarea').value='Fixture reason';document.querySelectorAll('.sheet select')[1].value='referral';document.querySelector('.sheet .btn-primary').click()");
      await b.wait("document.querySelector('.sheet-preview')?.innerText.includes('核实身份')");
      assert.equal(await b.evaluate("window.completed"),prior);
      await b.evaluate("document.querySelector('.sheet-preview .btn-primary').click()");
      await b.wait("!document.querySelector('.sheet-overlay')");
      assert.deepEqual(await b.evaluate("window.commands.at(-1).data"),{previewId:'server-receipt'});
      assert.equal(await b.evaluate("window.completed"),prior+1);
    }
    await b.healthy();
  }finally{await b.close();}
});
