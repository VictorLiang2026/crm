const MAX_FILE_BYTES=5*1024*1024;
const MAX_ROWS=80;
const MAX_COLUMNS=40;

function splitDelimited(source,delimiter){
  const rows=[];let row=[],cell='',quoted=false;
  const text=String(source??'').replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++){
    const char=text[i];
    if(quoted){
      if(char==='"'&&text[i+1]==='"'){cell+='"';i++;}
      else if(char==='"')quoted=false;else cell+=char;
    }else if(char==='"'&&cell==='')quoted=true;
    else if(char===delimiter){row.push(cell);cell='';}
    else if(char==='\n'||char==='\r'){
      if(char==='\r'&&text[i+1]==='\n')i++;
      row.push(cell);rows.push(row);row=[];cell='';
      if(rows.length>MAX_ROWS+1)throw new Error('FILE_ROW_LIMIT');
    }else cell+=char;
  }
  if(quoted)throw new Error('CSV_UNCLOSED_QUOTE');
  if(cell!==''||row.length){row.push(cell);rows.push(row);}
  if(rows.length>MAX_ROWS+1)throw new Error('FILE_ROW_LIMIT');
  return rows;
}

function loadXlsx(){
  if(window.XLSX)return Promise.resolve(window.XLSX);
  if(window.__crmXlsxLoading)return window.__crmXlsxLoading;
  window.__crmXlsxLoading=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=new URL('../../vendor/sheetjs-0.20.3.full.min.js',import.meta.url).href;
    script.onload=()=>window.XLSX?resolve(window.XLSX):reject(new Error('XLSX_UNAVAILABLE'));
    script.onerror=()=>reject(new Error('XLSX_UNAVAILABLE'));
    document.head.appendChild(script);
  }).catch(error=>{window.__crmXlsxLoading=null;throw error;});
  return window.__crmXlsxLoading;
}

const aliases={
  quoteZh:['quotezh','quote_zh','中文语录','中文内容','中文译文','简体中文','中文','chinese quote','chinese','quote zh'],
  quoteEn:['quoteen','quote_en','英文语录','英文内容','英文','english quote','english','quote en'],
  theme:['theme','主题','类别'],sourceOrg:['sourceorg','source_org','来源组织','来源机构','平台/组织','组织','机构'],
  sourceTitle:['sourcetitle','source_title','来源材料','来源标题','出处'],
  sourceUrl:['sourceurl','source_url','来源链接','出处链接','url','链接'],
  editorialRewrite:['editorialrewrite','editorial_rewrite','编辑改写','是否改写'],
  quoteType:['引述类型'],
  attribution:['讲者/归属'],
  recommendationScore:['recommendationscore','recommendation_score','推荐值','推荐分','score','分数'],
  id:['id','quoteid','quote_id','语录id','语录编号'],
};
const keyOf=value=>String(value??'').normalize('NFKC').trim().toLowerCase()
  .replace(/^((?:推荐值|推荐分|分数|recommendation\s*score|score))\s*\(0\s*[-–—~至]\s*10\)$/,'$1')
  .replace(/[\s_-]+/g,'');
const fieldByHeader=new Map(Object.entries(aliases).flatMap(([field,values])=>values.map(alias=>[keyOf(alias),field])));

// The published quote workbook uses more specific topics than the CRM library.
const workbookTopics = {
  business_development: ['AI与顾问价值','卓越执行','战略与组织能力','伙伴协作','创新与协作','行动与执行'],
  customer_trust: ['信任与规划','信任与销售','信任','顾问专业形象','信任与培训','合作与信任','品牌信任与简化','品牌信任','倾听与信任','顾问价值','长期信任'],
  customer_service: ['客户体验','客户沟通','数字化服务','客户导向','换位思考','AI与服务文化','倾听与服务','服务评估与复盘'],
  long_term: ['客户关系','退休与家庭','退休规划','综合规划与关系','客户关系维护'],
  protection: ['客户行动与保障','需求发现'],
  team_leadership: ['领导与培养','领导力','团队合作','以身作则','自我领导','领导与管理','以人为本','授权与人才','授权与信任','责任与领导','领导担当','主动担当'],
  team_growth: ['心态与成长','招募与增员','执行与自律','学习与成长','招聘与增员','新人培养与留存','人才与消费者需求','职业意义与招募','行业使命','人才培养'],
};
const themeByTopic = new Map(Object.entries(workbookTopics).flatMap(([theme,topics]) => topics.map(topic => [keyOf(topic),theme])));

function toBoolean(value){
  const normalized=String(value??'').trim().toLowerCase();
  if(['true','1','yes','y','是','编辑改写','改写'].includes(normalized))return true;
  if(['false','0','no','n','否','原文'].includes(normalized))return false;
  return null;
}

function matrixRows(matrix){
  const [header,...body]=Array.isArray(matrix)?matrix:[];
  if(!Array.isArray(header)||!header.length)throw new Error('FILE_HEADER_REQUIRED');
  const headers=header.map(value=>String(value??'').trim());
  if(headers.length>MAX_COLUMNS||body.some(row=>Array.isArray(row)&&row.length>MAX_COLUMNS))throw new Error('FILE_COLUMN_LIMIT');
  if(headers.some((value,index)=>!value&&body.some(row=>String(row?.[index]??'').trim())))throw new Error('FILE_BLANK_HEADER');
  const seen=new Set();
  for(const value of headers){const key=keyOf(value);if(key&&seen.has(key))throw new Error('FILE_DUPLICATE_HEADER');if(key)seen.add(key);}
  const rows=body.filter(row=>Array.isArray(row)&&row.some(value=>String(value??'').trim()!==''));
  if(rows.length>MAX_ROWS)throw new Error('FILE_ROW_LIMIT');
  return {headers,rows:rows.map(row=>Object.fromEntries(headers.map((header,column)=>[header,String(row?.[column]??'').trim()]))) };
}

function parseTable(table){
  const mapped=matrixRows(table),fieldColumns=new Map();
  mapped.headers.forEach((header,index)=>{const field=fieldByHeader.get(keyOf(header));if(field&&!fieldColumns.has(field))fieldColumns.set(field,header);});
  const quotes=[],fillMissingScores=[];
  for(let index=0;index<mapped.rows.length;index++){
    const row=mapped.rows[index],get=field=>String(row[fieldColumns.get(field)]??'').trim();
    const id=get('id'),scoreText=get('recommendationScore');
    if(id&&scoreText){const score=Number(scoreText);if(!/^\d{1,18}$/.test(id)||!Number.isInteger(score)||score<0||score>10)throw new Error('INVALID_SCORE');
      fillMissingScores.push({id,recommendationScore:score});continue;}
    const topic = get('theme');
    const sourceTitle = get('sourceTitle');
    const attribution = get('attribution');
    const attributedTitle = `${sourceTitle}（引述：${attribution}）`;
    const quote={quoteZh:get('quoteZh'),quoteEn:get('quoteEn'),theme:themeByTopic.get(keyOf(topic)) ?? topic,sourceOrg:get('sourceOrg'),
      sourceTitle:sourceTitle && attribution && attributedTitle.length <= 240 ? attributedTitle : sourceTitle,
      sourceUrl:get('sourceUrl'),editorialRewrite:toBoolean(get('editorialRewrite')) ?? /转述|改写/.test(get('quoteType'))};
    if(!quote.quoteZh||!quote.quoteEn)throw new Error('MISSING_BILINGUAL_TEXT');
    if(scoreText){quote.recommendationScore=Number(scoreText);if(!Number.isInteger(quote.recommendationScore)||quote.recommendationScore<0||quote.recommendationScore>10)throw new Error('INVALID_SCORE');}
    quotes.push(quote);
  }
  return {quotes,fillMissingScores};
}

export async function parseDailyInspirationFile(file){
  if(!file||!Number.isFinite(file.size)||file.size<1||file.size>MAX_FILE_BYTES)throw new Error('FILE_SIZE_LIMIT');
  const extension=String(file.name||'').split('.').pop().toLowerCase();
  if(extension==='json'){
    const bundle=JSON.parse(await file.text());
    if(!bundle||bundle.formatVersion!==1||!Array.isArray(bundle.quotes)||!Array.isArray(bundle.fillMissingScores)||
      bundle.quotes.length>MAX_ROWS||bundle.fillMissingScores.length>MAX_ROWS)throw new Error('INVALID_JSON_BUNDLE');
    // Source identifiers and speaker names are metadata in the published JSON bundle.
    const quotes = bundle.quotes.map(quote => {
      if (!quote || typeof quote !== 'object' || Array.isArray(quote)) throw new Error('INVALID_JSON_BUNDLE');
      const {sourceEntryId, attribution, ...fields} = quote;
      return fields;
    });
    return {...bundle, quotes};
  }
  let matrix;
  if(extension==='csv')matrix=splitDelimited(await file.text(),',');
  else if(extension==='tsv')matrix=splitDelimited(await file.text(),'\t');
  else if(extension==='xlsx'){
    const XLSX=await loadXlsx();
    const workbook=XLSX.read(await file.arrayBuffer(),{type:'array',sheetRows:MAX_ROWS+1,WTF:true});
    const first=workbook.SheetNames?.[0];if(!first)throw new Error('FILE_EMPTY_WORKBOOK');
    matrix=XLSX.utils.sheet_to_json(workbook.Sheets[first],{header:1,raw:false,defval:''});
  }else throw new Error('FILE_TYPE_UNSUPPORTED');
  return {...parseTable(matrix),formatVersion:1};
}
