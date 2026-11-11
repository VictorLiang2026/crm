'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Browser}=require('../regression/browser.cjs');
test('version feedback stays readable across devices and languages and requires server preview',async()=>{
  const b=new Browser(path.resolve(__dirname,'../..'));
  try {
    await b.start();await b.openConsole('#/more','authCase=1');await b.wait("document.querySelector('.more-primary')");
    await b.evaluate(`(async()=>{
      const {setLang}=await import('/crm/js/modules/console/i18n.js');
      const {data}=await import('/crm/js/modules/console/data.js');
      const {versionFeedback,strategyEvidence}=await import('/crm/js/modules/console/advice-evidence.js');
      window.wp8={calls:[],rows:[],draw(lang){
        setLang(lang);
        const target={lane:'gpt',adviceId:'17',subjectId:'7',updatedAt:'2026-11-10T01:02:03Z'};
        const panel=versionFeedback({},target,strategyEvidence('Hypothesis\\nNext step: Call\\nQuestion to confirm: When?'));
        panel.id='wp8';document.querySelector('.console-main').replaceChildren(panel);panel.open=true;
      }};
      data.adviceFeedback=async(ctx,op,input)=>{
        wp8.calls.push([op,input]);
        if(op==='read')return {ok:true,versionKey:'v',facts:[],rows:wp8.rows};
        if(op==='preview')return {previewId:'server-receipt',decision:input.decision,note:input.note,title:'Draft',version:1};
        if(op==='confirm'){wp8.rows.push({id:1,title:'Draft',version:1,decision:'modified',note:'Recorded change'});return {ok:true};}
      };
    })()`);
    for(const lang of ['en','zh-CN']){
      await b.evaluate(`wp8.draw('${lang}')`);
      await b.wait("document.querySelector('#wp8 textarea')");
      for(const [width,height] of [[390,844],[820,1180],[1440,900]]){
        await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width===390});
        assert.ok(await b.evaluate("document.documentElement.scrollWidth<=innerWidth+1"));
      }
    }
    await b.evaluate("document.querySelector('#wp8 select').value='modified';document.querySelector('#wp8 textarea').value='Recorded change';document.querySelector('#wp8 button').click()");
    await b.wait("wp8.calls.at(-1)[0]==='preview' && document.querySelector('#wp8 strong')?.textContent==='修改后采纳'");
    assert.equal(await b.evaluate('wp8.rows.length'),0);
    await b.evaluate("document.querySelector('#wp8 button').click()");
    await b.wait("wp8.rows.length===1 && document.querySelector('#wp8 textarea')");
    assert.deepEqual(await b.evaluate("wp8.calls.find(c=>c[0]==='confirm')[1]"),{previewId:'server-receipt'});
    await b.healthy();
  }finally{await b.close();}
});
