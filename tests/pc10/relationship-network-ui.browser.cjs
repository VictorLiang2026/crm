'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

test('Person network shows real directed edge evidence, separates family, and keeps AI advice non-writing', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.open('#/more');
    await browser.evaluate(`(async()=>{
      const {relationshipNetworkNode}=await import('/crm/js/modules/console/relationship-network.js');
      const i18n=await import('/crm/js/modules/console/i18n.js');window.networkI18n=i18n;
      window.networkCalls=[];
      const edge=(id,from,to,fromName,toName,updatedAt)=>({id:String(id),fromPersonId:String(from),toPersonId:String(to),fromName,toName,
        direction:'outgoing',relationshipType:'business',source:'manual',status:'confirmed',confirmedAt:'2026-10-01T00:00:00Z',updatedAt,strength:'known',importance:4});
      window.networkCtx={api:{call:async(name,args)=>{
        window.networkCalls.push({name,...args});
        if(args.action==='listRelationshipNetwork')return{adjacency:{personId:'71',rows:[edge(801,71,72,'根人物','同名人物','2026-10-03T00:00:00Z')],page:1,hasMore:false},
          family:{rows:[{personId:'74',personName:'同名人物',relationshipToAnchor:'sibling',confirmedAt:'2026-10-02T00:00:00Z',updatedAt:'2026-10-04T00:00:00Z'}]}};
        if(args.action==='listRelationshipIntroductionPaths')return{paths:[{pathId:'801:802',targetPersonId:'73',targetName:'同名人物',hops:[
          {edgeId:'801',fromPersonId:'71',fromName:'根人物',toPersonId:'72',toName:'同名人物',relationshipType:'business',source:'manual',confirmedAt:'2026-10-01',updatedAt:'2026-10-03',strength:'known',importance:4},
          {edgeId:'802',fromPersonId:'72',fromName:'同名人物',toPersonId:'73',toName:'同名人物',relationshipType:'referral',source:'manual',confirmedAt:'2026-10-02',updatedAt:'2026-10-04',strength:'known',importance:3},
        ]}],truncated:false};
        if(args.action==='expandRelationshipNetwork')return{personId:'72',rows:[edge(801,71,72,'根人物','同名人物','2026-10-03'),
          edge(802,72,73,'同名人物','同名人物','2026-10-04')],hasMore:false};
        if(args.action==='suggestRelationshipIntroduction')return{path:{pathId:'801:802',hops:[{edgeId:'801'},{edgeId:'802'}]},
          suggestion:{suitable:true,confidence:'中',reason:'建议先由中间人核实双方意愿。',timing:'双方方便时',approach:'先征求中间人同意。',message:'可以先问中间人是否愿意引荐。'}};
        if(args.action==='listRelationships')return{rows:[]};
        throw Error('unexpected '+args.action);
      }}};
      document.getElementById('view').replaceChildren(await relationshipNetworkNode(window.networkCtx,'71'));
    })()`);
    await browser.wait("document.querySelector('.relationship-network-path')?.innerText.includes('关系记录: #802')");
    const view = await browser.evaluate("document.querySelector('.relationship-network').innerText");
    for (const text of ['已确认关系','可核验的有向路径','家庭成员','关系记录']) assert.ok(view.includes(text), `missing ${text}`);
    const familyLink = await browser.evaluate("[...document.querySelectorAll('.relationship-network-family a')].find(a=>a.textContent.includes('同名人物'))?.getAttribute('href')");
    const pathLink = await browser.evaluate("[...document.querySelectorAll('.relationship-network-path a')].find(a=>a.textContent.includes('同名人物'))?.getAttribute('href')");
    assert.equal(familyLink, '#/person/74');
    assert.equal(pathLink, '#/person/73');
    await browser.evaluate("[...document.querySelectorAll('.relationship-network-path button')].find(b=>b.textContent.includes('生成介绍建议')).click()");
    await browser.wait("document.querySelector('.relationship-network-advice')?.innerText.includes('建议先由中间人')");
    assert.equal(await browser.evaluate("window.networkCalls.some(call=>/preview|execute|create/i.test(call.action))"), false);
    for (const [width,height] of [[820,1180],[1180,820]]) {
      await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,`${width}x${height} overflow`);
    }
    const english = await browser.evaluate(`(()=>{window.networkI18n.setLang('en');const result={title:window.networkI18n.t('network_title'),family:window.networkI18n.t('network_family_legend'),advice:window.networkI18n.t('network_ai_suggestion')};window.networkI18n.setLang('zh-CN');return result})()`);
    assert.deepEqual(english,{title:'Relationship Network & Referral Paths',family:'Household',advice:'AI suggestion (review only)'});
    await browser.healthy();
    assert.deepEqual(browser.networkViolations,[]);
  } finally { await browser.close(); }
});

test('empty network never invokes AI and makes insufficient confirmed evidence explicit', async () => {
  const browser = new Browser(path.resolve(__dirname, '../..'));
  try {
    await browser.start();
    await browser.open('#/more');
    await browser.evaluate(`(async()=>{
      const {relationshipNetworkNode}=await import('/crm/js/modules/console/relationship-network.js');
      window.emptyNetworkCalls=[];
      const ctx={api:{call:async(_name,args)=>{window.emptyNetworkCalls.push(args.action);
        if(args.action==='listRelationshipNetwork')return{adjacency:{rows:[],hasMore:false},family:{rows:[]}};
        if(args.action==='listRelationshipIntroductionPaths')return{paths:[],truncated:false};
        throw Error('AI must not run on an empty path');
      }}};
      document.getElementById('view').replaceChildren(await relationshipNetworkNode(ctx,'71'));
    })()`);
    await browser.wait("document.querySelector('.relationship-network').innerText.includes('暂无可用的已确认路径')");
    assert.equal(await browser.evaluate("window.emptyNetworkCalls.includes('suggestRelationshipIntroduction')"),false);
  } finally { await browser.close(); }
});
