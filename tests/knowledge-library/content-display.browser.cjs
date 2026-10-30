'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {Browser}=require('../regression/browser.cjs');

test('Knowledge content folds in linked pairs, loads full GPT text once, retries, and invalidates changed versions',async()=>{
  const b=new Browser(path.resolve(__dirname,'../..'));
  const row=id=>`.kg-table tr[data-kg-id="${id}"]`;
  const button=(id,pair,part)=>`${row(id)} [data-kg-pair="${pair}"] [data-kg-part="${part}"]`;
  const body=(id,pair,part)=>`#kg-content-knowledge_items-${id}-${pair}-${part}`;
  const click=selector=>b.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const content=selector=>b.evaluate(`document.querySelector(${JSON.stringify(selector)}).innerText`);
  const count=()=>b.evaluate("window.kd.calls.filter(x=>x.operation==='content').length");
  try{
    await b.start();await b.openConsole('#/more','authCase=1');await b.wait("document.querySelector('.console-main')");
    await b.evaluate(`(async()=>{
      const {renderKnowledgeGovernance}=await import('/crm/js/modules/console/knowledge-governance.js');
      const i18n=await import('/crm/js/modules/console/i18n.js');
      const state={calls:[],revision:1,defer:true,fail:true,toasts:[]};window.kd=state;
      const ctx={main:document.querySelector('.console-main'),toast:(...x)=>state.toasts.push(x),api:{call:async(name,p)=>{
        state.calls.push(p);
        if(p.operation==='list')return {ok:true,knowledge:[
          {id:1,source:'Policy comparison',content:'System original',metadata:{summary:'System summary'},lifecycle_status:'verified',updated_at:'2026-10-30T00:00:0'+state.revision+'Z',contentVersion:state.revision,gpt_original_preview:'short preview',gpt_summary_preview:'short summary preview'},
          {id:2,source:'Partial content',content:'ORIGINAL_ONLY',metadata:{summary:null},contentManaged:true,lifecycle_status:'draft',gpt_original_preview:'',gpt_summary_preview:'G_ONLY'},
          {id:4,source:'Historical revision',content:'Historical system text',metadata:{summary:'Historical summary'},lifecycle_status:'superseded',gpt_original_preview:'Historical GPT preview'}
        ],playbooks:[{id:1,scenario:'Objection',response_logic:'Playbook original',metadata:{summary:'Playbook summary'}}],
        sources:[{id:55,title:'Pending scan',extractionStatus:'extracting',ocrProgress:{stage:'extract',completedPages:1,totalPages:5}}]};
        if(p.operation==='setValidity'){state.revision++;return {ok:true};}
        if(p.operation==='content'&&p.contentOperation==='get'){
          const version=state.revision;
          if(p.data.id===1&&state.defer){state.defer=false;await new Promise(resolve=>state.resolve=resolve);}
          if(p.data.id===2&&state.fail){state.fail=false;throw new Error('READ_FAILED');}
          return {ok:true,record:{table:p.data.table,id:p.data.id,version,
            original:{text:p.data.id===2?'ORIGINAL_ONLY':'System original',summary:p.data.id===2?null:'System summary'},
            gpt:{text:p.data.id===2?null:('Full line '+version+'\\n').repeat(100)+'<img src=x onerror="window.kdXss=1"> END-'+version,
              summary:p.data.id===2?'G_ONLY':('GPT summary '+version+'\\n').repeat(25)+'SUMMARY-END-'+version}}};
        }
        throw new Error('Unexpected operation');
      }}};
      state.render=()=>renderKnowledgeGovernance(ctx);state.i18n=i18n;state.render();
    })()`);
    await b.wait("document.querySelector('.kg-table [data-kg-pair]')");
    assert.equal(await count(),0,'default folded list makes no detail calls');
    assert.equal(await b.evaluate("document.querySelectorAll('.kg-content-toggle[aria-expanded=true]').length"),0);
    assert.equal(await b.evaluate("document.querySelectorAll('.kg-content-body:not([hidden])').length"),0);
    assert.equal(await b.evaluate("document.querySelectorAll('.kg-table th').length"),8);
    await b.send('Emulation.setDeviceMetricsOverride',{width:820,height:1180,deviceScaleFactor:1,mobile:false});
    const foldedShot=await b.send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.resolve(__dirname,'../regression/.results/knowledge-display-folded-820.png'),Buffer.from(foldedShot.data,'base64'));
    assert.equal(await b.evaluate(`document.querySelector('${row(55)}').querySelectorAll('.kg-content-toggle').length`),0,'source-only rows show progress without unsupported detail calls');
    await click(button(1,'original','summary'));
    await b.wait('!!window.kd.resolve');
    assert.equal(await b.evaluate(`document.querySelector('${button(1,'gpt','summary')}').getAttribute('aria-expanded')`),'true');
    assert.equal(await b.evaluate(`document.querySelector('${button(1,'gpt','text')}').getAttribute('aria-expanded')`),'false');
    assert.equal(await b.evaluate(`document.querySelector('${button(2,'gpt','summary')}').getAttribute('aria-expanded')`),'false');
    assert.match(await content(body(1,'gpt','summary')),/正在加载/);
    // A sort redraw while the request is pending must retain state and update the new cells.
    await click('.kg-table th.kg-sortable');
    await click(button(1,'gpt','text'));
    assert.equal(await count(),1,'both sections and sort redraw share one pending read');
    await b.evaluate('window.kd.resolve()');
    await b.wait("document.querySelector('#kg-content-knowledge_items-1-gpt-text').innerText.includes('END-1')");
    assert.match(await content(body(1,'gpt','text')),/Full line 1[\s\S]+END-1/);
    assert.match(await content(body(1,'gpt','summary')),/SUMMARY-END-1/);
    assert.equal(await b.evaluate("!!window.kdXss||!!document.querySelector('.kg-content-body img')"),false,'content is plain text, not HTML');
    assert.equal(await b.evaluate("document.querySelector('#kg-content-playbooks-1-original-summary').hidden"),true,'same ID in another table stays folded');
    await click(button(1,'gpt','summary'));
    assert.equal(await b.evaluate(`document.querySelector('${body(1,'original','summary')}').hidden`),true);
    assert.equal(await b.evaluate(`document.querySelector('${body(1,'original','text')}').hidden`),false,'summary and original open states are independent');
    await click(button(1,'original','summary'));
    assert.equal(await count(),1,'reopening uses the cache');
    await click(button(2,'gpt','summary'));
    await b.wait("document.querySelector('tr[data-kg-id=\"2\"] .kg-content-retry')");
    assert.match(await content(body(2,'gpt','summary')),/加载失败/);
    await click(`${row(2)} .kg-content-retry`);
    await b.wait("document.querySelector('#kg-content-knowledge_items-2-gpt-summary').innerText==='G_ONLY'");
    assert.match(await content(body(2,'original','summary')),/已清空 \/ 未填写/,'empty system summary never falls back to system original or GPT');
    await click(button(2,'original','text'));
    assert.equal(await content(body(2,'original','text')),'ORIGINAL_ONLY');
    assert.match(await content(body(2,'gpt','text')),/已清空 \/ 未填写/,'empty GPT original never falls back to system original');
    const readsBeforeHistory=await count();
    await click(button(4,'original','text'));
    assert.match(await content(body(4,'gpt','text')),/历史版本：仅提供预览/);
    assert.equal(await content(body(4,'original','text')),'Historical system text');
    assert.equal(await count(),readsBeforeHistory,'historical rows do not call the write-oriented snapshot API');
    assert.equal(await b.evaluate("window.kd.calls.filter(x=>!['list','content'].includes(x.operation)).length"),0,'reading does not write');
    await click(`${row(1)} .kg-action-status`);
    await b.wait('window.kd.revision===2 && document.querySelectorAll(".kg-content-toggle[aria-expanded=true]").length===6');
    assert.equal(await b.evaluate(`document.querySelector('${body(1,'gpt','text')}').hidden`),true,'changed version discards cached content and folds');
    await click(button(1,'gpt','text'));
    await b.wait("document.querySelector('#kg-content-knowledge_items-1-gpt-text').innerText.includes('END-2')");
    assert.equal(await count(),readsBeforeHistory+1,'updated row performs a fresh read');
    assert.equal(await b.evaluate("window.kd.calls.filter(x=>x.operation==='content').every(x=>x.contentOperation==='get')"),true);
    for(const lang of ['zh-CN','en']){
      await b.evaluate(`window.kd.i18n.setLang('${lang}');window.kd.render()`);
      await b.wait("document.querySelector('.kg-table [data-kg-pair]')");
      assert.equal(await b.evaluate("document.querySelectorAll('.kg-content-toggle[aria-expanded=true]').length"),0,'new page instance starts folded');
      assert.equal(await content(button(1,'original','summary')),lang==='en'?'Summary':'摘要');
      assert.equal(await content(button(1,'gpt','text')),lang==='en'?'View original text':'查看原文');
      await click(button(1,'gpt','summary'));await click(button(1,'original','text'));
      await b.wait("document.querySelector('#kg-content-knowledge_items-1-gpt-text').innerText.includes('END-2')");
      for(const [width,height] of [[820,1180],[1180,820]]){
        await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
        const fit=await b.evaluate(`(()=>{const wrap=document.querySelector('.kg-table-wrap'),area=document.querySelector('#kg-content-knowledge_items-1-gpt-text .kg-full-content');return {page:document.documentElement.scrollWidth<=innerWidth+1,table:wrap.scrollWidth<=wrap.clientWidth+1,area:area.clientHeight,scroll:area.scrollHeight,horizontal:area.scrollWidth<=area.clientWidth+1};})()`);
        assert.equal(fit.page&&fit.table&&fit.horizontal,true,`${lang} ${width} layout fits`);
        assert.ok(fit.area<=220&&fit.scroll>fit.area,`${lang} ${width} full text scrolls in bounded area`);
        const shot=await b.send('Page.captureScreenshot',{format:'png'});
        fs.writeFileSync(path.resolve(__dirname,`../regression/.results/knowledge-display-${lang}-${width}.png`),Buffer.from(shot.data,'base64'));
      }
    }
    await b.healthy();
  }finally{await b.close();}
});
