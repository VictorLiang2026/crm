'use strict';

const { CONTENT_COLUMNS, projectContent } = require('./knowledge-content');
const { disclose } = require('./test-data');

const categories = {
  recruitment: ['recruitment_policy','recruitment_case','conversation_strategy','objection_handling'],
  activity: ['marketing_activity','health_wealth_sharing','conversation_strategy'],
};
const legacy = {recruitment:'recruitment_policy',campaign:'marketing_activity',
  health_wealth_seminar:'health_wealth_sharing',playbook:'conversation_strategy'};

async function readScenarioKnowledge(scenario, {env = process.env.TCB_ENV, key, fetchImpl = fetch,
  check = disclose, today = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})} = {}) {
  if (!Object.hasOwn(categories,scenario)) throw new Error('Unsupported knowledge scenario');
  if (!/^crm-[a-z0-9]+$/.test(env || '') || !key) throw new Error('Knowledge reader unavailable');
  async function get(table, params) {
    const url = new URL(`https://${env}.api.tcloudbasegateway.com/v1/rdb/rest/${table}`);
    url.search = new URLSearchParams(params);
    const response = await fetchImpl(url,{headers:{Authorization:`Bearer ${key}`,'Accept-Profile':'public'},signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error('Reviewed knowledge unavailable');
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('Invalid reviewed knowledge response');
    return rows;
  }
  const kinds = categories[scenario];
  const filter = kinds.map(kind => `metadata->categories.cs.["${kind}"]`);
  for (const [domain,kind] of Object.entries(legacy)) if (kinds.includes(kind)) filter.push(`metadata->>domain.eq.${domain}`);
  const rows = await get('knowledge_items',{select:'id,source_id,source,source_date,verified,lifecycle_status,version_no,content,metadata,deleted_at,'+CONTENT_COLUMNS,
    verified:'eq.true',lifecycle_status:'eq.verified',deleted_at:'is.null',or:'('+filter.join(',')+')',order:'updated_at.desc.nullslast,id.desc',limit:40});
  const ids = [...new Set(rows.map(row=>row.source_id).filter(id=>/^[1-9]\d*$/.test(String(id))))];
  const sources = ids.length ? await get('knowledge_sources',{select:'id,title,review_at,lifecycle_status,version_no,sha256,deleted_at,valid_from,valid_to,published_at',
    id:`in.(${ids.join(',')})`,deleted_at:'is.null',limit:40}) : [];
  const parents = new Map(sources.map(source=>[String(source.id),source]));
  const refs = [];
  for (const row of rows) {
    const tags = row.metadata?.categories?.length ? row.metadata.categories : [legacy[row.metadata?.domain]];
    if (!tags.some(tag=>kinds.includes(tag)) || row.verified!==true || row.lifecycle_status!=='verified') continue;
    const parent = parents.get(String(row.source_id));
    const eligible = projectContent(row,'knowledge_items',parent,today);
    if (!eligible) continue;
    if (tags.includes('top_performer_sharing') && /(?<!\d)1[3-9]\d{9}(?!\d)|(?<!\d)\d{17}[\dXx](?!\d)|身份证号|保单号|被保险人|健康告知|诊断结果/.test(eligible.content)) continue;
    const text = String(eligible.metadata.summary || eligible.content).slice(0,900);
    if (/【系统测试·勿联系】/.test(text) || /【系统测试·勿联系】/.test(row.source||'')) continue;
    refs.push({schema:'public',table:'knowledge_items',id:String(row.id),title:row.source||parent?.title||'',
      sourceDate:row.source_date||parent?.published_at||null,versionNo:row.version_no||1,...eligible.contentReference,
      checkedOn:today,reviewStatus:'verified',excerpt:text});
  }
  if (!refs.length) return [];
  const batch = await check(refs.map(({table,id})=>({table,id})));
  if (batch?.status!=='verified' || typeof batch.containsTestData!=='boolean') throw new Error('Knowledge provenance unavailable');
  if (!batch.containsTestData) return refs.slice(0,4);
  const clean = [];
  for (const ref of refs) {
    const result = await check([{table:ref.table,id:ref.id}]);
    if (result?.status!=='verified' || typeof result.containsTestData!=='boolean') throw new Error('Knowledge provenance unavailable');
    if (!result.containsTestData) clean.push(ref);
    if (clean.length===4) break;
  }
  return clean;
}

// Missing library access leaves the operator's recorded business evidence usable.
async function knowledgeSnapshot(scenario, options) {
  try { return {status:'checked',sources:await readScenarioKnowledge(scenario,options)}; }
  catch { return {status:'unavailable',sources:[]}; }
}
module.exports = {readScenarioKnowledge,knowledgeSnapshot};
