'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

for (const [width, device] of [[1440,'Desktop'],[820,'iPad'],[390,'iPhone']]) {
  test('Person sorting, accessible names and business labels on ' + device, async () => {
    const b = new Browser(path.resolve(__dirname, '../..'));
    async function key(key, code, number) {
      for (const type of ['keyDown','keyUp']) {
        await b.send('Input.dispatchKeyEvent', {type, key, code, windowsVirtualKeyCode:number,
          ...(type==='keyDown' && key!=='Tab' ? {text:key==='Enter'?'\r':' '} : {})});
      }
    }
    try {
      await b.start();
      if (device !== 'Desktop') await b.send('Network.setUserAgentOverride', {
        userAgent:'Mozilla/5.0 ('+device+'; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1'});
      await b.send('Emulation.setDeviceMetricsOverride', {width,height:844,deviceScaleFactor:1,mobile:device==='iPhone'});
      for (const lang of ['en','zh-CN']) {
        await b.openConsole('#/people','authCase=1');
        await b.wait("document.querySelector('.people-table tbody tr')");
        await b.evaluate("(async()=>{(await import('/crm/js/modules/console/i18n.js')).setLang("+JSON.stringify(lang)+");window.dispatchEvent(new Event('popstate'))})()");
        await b.wait("document.querySelector('.people-sort-button')");
        assert.equal(await b.evaluate("document.querySelectorAll('th[aria-sort]').length"),1);
        assert.equal(await b.evaluate("document.querySelector('th[aria-sort]').getAttribute('aria-sort')"),'descending');
        assert.equal(await b.evaluate("document.querySelector('th.people-col-convert_customer button')"),null);
        const field = 'display_name';
        const selector = '[data-sort-field="display_name"]';
        const sortName = await b.evaluate("document.querySelector("+JSON.stringify(selector)+").getAttribute('aria-label')");
        assert.equal(sortName, await b.evaluate("(async()=>(await import('/crm/js/modules/console/i18n.js')).t('col_name'))()"));
        await b.evaluate("document.querySelector('[data-directory-view=participant]').focus()");
        await key('Tab','Tab',9);
        assert.equal(await b.evaluate("document.activeElement.dataset.sortField"),field);
        const count = () => b.evaluate("window.__crmTest.calls.filter(c=>c.action==='listPeople').length");
        for (const [name,code,num,direction] of [['Enter','Enter',13,'ascending'],[' ','Space',32,'descending']]) {
          const before=await count();
          await key(name,code,num);
          await b.wait("document.querySelector('th.people-col-name')?.getAttribute('aria-sort')==="+JSON.stringify(direction));
          assert.equal(await count(),before+1);
          assert.equal(await b.evaluate("document.activeElement.dataset.sortField"),field);
        }
        const {nodes} = await b.send('Accessibility.getFullAXTree');
        assert.ok(nodes.some(node=>node.role?.value==='button' && node.name?.value===sortName));
        assert.equal(await b.evaluate("document.querySelectorAll('th[aria-sort]').length"),1);
        assert.ok(await b.evaluate("document.documentElement.scrollWidth<=innerWidth+1"));
        // Provide the reporting read missing from the shared navigation fixture.
        await b.evaluate("(async()=>{const {data}=await import('/crm/js/modules/console/data.js');data.recruitProgress=async()=>({rows:[],overall:{}})})()");
        for (const [route,ready] of [['people','.people-table'],['person/980001','.head-actions'],['recruit','.recruit-layout'],['ai','.ai-assistant-links']]) {
          await b.evaluate('location.hash='+JSON.stringify('#/'+route));
          await b.wait("document.querySelector("+JSON.stringify(ready)+") && location.hash==="+JSON.stringify('#/'+route));
          assert.doesNotMatch(await b.evaluate("document.querySelector('.page-title').textContent"),/WP\d+/i);
          if(route==='ai') assert.equal(await b.evaluate("document.querySelector('.card-head .wp-tag')?.textContent"),
            await b.evaluate("(async()=>(await import('/crm/js/modules/console/i18n.js')).t('ai_status_live'))()"));
        }
        await b.healthy();
      }
    } finally {await b.close();}
  });
}

test('read-only directory can sort; a denied refresh retains the error and keyboard retry', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await b.start();
    await b.openComponent();
    await b.evaluate(`(async()=>{
      const {renderPeople}=await import('/crm/js/modules/console/pages/people.js');
      window.reads=[];window.deny=false;
      renderPeople({main:document.querySelector('#view'),api:{call:async(name,q)=>{
        if(name!=='person_360' || q.action!=='listPeople') throw Error('Unexpected write');
        reads.push(q.sortField);
        if(deny) return {error:{code:'ACCESS_DENIED',message:'Fixture denied the read'}};
        return {rows:[{id:5,display_name:'Fixture',roles:[]}],page:1,total:1,totalPages:1};
      }}});
    })()`);
    const name="[data-sort-field=display_name]";
    await b.wait("document.querySelector('.people-sort-button')");
    await b.evaluate("document.querySelector('"+name+"').click()");
    await b.wait("document.querySelector('th.people-col-name')?.ariaSort==='ascending'");
    await b.evaluate("deny=true;const btn=document.querySelector('"+name+"');btn.focus();btn.click()");
    await b.wait("document.querySelector('.error-box')?.textContent.includes('ACCESS_DENIED')");
    assert.equal(await b.evaluate("document.activeElement===document.querySelector('.error-box button')"),true);
    await b.evaluate("deny=false;document.activeElement.click()");
    await b.wait("document.querySelector('th.people-col-name')?.ariaSort==='descending'");
    assert.deepEqual(await b.evaluate('reads'),['id','display_name','display_name','display_name']);
    await b.healthy();
  } finally {await b.close();}
});
