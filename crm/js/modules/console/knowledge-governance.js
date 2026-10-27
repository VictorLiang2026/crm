import { h } from './dom.js';
import { pageHead, emptyNote } from './ui.js';
import { t } from './i18n.js';
import { data } from './data.js';

const text = key => t(`kg_${key}`);
const CATEGORIES = ['on_sale_product','existing_service','recruitment_policy','industry_development',
  'marketing_activity','legal_tax','health_wealth_sharing','top_performer_sharing','customer_case','recruitment_case',
  'conversation_strategy','objection_handling','company_information','other'];
const LEGACY = {product:'on_sale_product',company:'company_information',service:'existing_service',
  recruitment:'recruitment_policy',industry:'industry_development',campaign:'marketing_activity',
  health_wealth_seminar:'health_wealth_sharing',top_performer_sharing:'top_performer_sharing',
  legal_tax:'legal_tax',case:'customer_case',playbook:'conversation_strategy'};
const categoriesOf = row => Array.isArray(row.metadata?.categories) && row.metadata.categories.length ? row.metadata.categories
  : Array.isArray(row.categories)&&row.categories.length?row.categories
    : [LEGACY[row.metadata?.domain] || (row.table === 'playbooks' ? 'conversation_strategy' : 'other')];
const active = row => (row.lifecycle_status || (row.verified ? 'verified' : 'draft')) === 'verified';
const titleOf = row => row.table === 'playbooks' ? `${row.scenario || ''}${row.objection ? ` · ${row.objection}` : ''}`
  : row.table === 'knowledge_sources' ? row.title || row.fileName || '' : row.source || '';
const summaryOf = row => row.table === 'playbooks' ? row.response_logic || ''
  : row.table === 'knowledge_sources' ? text('source_pending_summary') : row.metadata?.summary || String(row.content || '').slice(0,220);

export function renderKnowledgeGovernance(ctx) {
  let records={knowledge:[],playbooks:[],sources:[]},categoryFilter=[],statusFilter='all',keyword='',fullText=false;
  let sortField='updated_at',sortDir='desc',page=1,categoryFilterOpen=false;
  const main=ctx.main;
  const load=async()=>{
    const result=await data.knowledgeLibrary(ctx,'list');
    records={knowledge:result.knowledge||[],playbooks:result.playbooks||[],sources:result.sources||[]};
    draw();
  };
  const rows=()=>[
    ...records.knowledge.map(row=>({...row,table:'knowledge_items'})),
    ...records.playbooks.map(row=>({...row,table:'playbooks'})),
    ...records.sources.filter(source=>!records.knowledge.some(item=>String(item.source_id)===String(source.id)))
      .map(row=>({...row,table:'knowledge_sources'})),
  ];
  const setStatus=async row=>{
    const next=!active(row);
    const result=await data.knowledgeLibrary(ctx,'setValidity',{data:{table:row.table,id:row.id,
      valid:next,expectedUpdatedAt:row.updated_at}});
    if(!result?.ok)throw new Error(text('state_failed'));
    await load();
  };
  const remove=async row=>{
    if(!window.confirm(text('confirm_delete')))return;
    await data.knowledgeLibrary(ctx,'delete',{data:{table:row.table,id:row.id,expectedUpdatedAt:row.updated_at}});
    await load();
  };
  const retry=async row=>{
    const result=await data.knowledgeLibrary(ctx,'retry',{sourceId:row.id});
    if(!result?.ok)throw new Error(result?.errorCode||text('retry_failed'));
    ctx.toast(text('retry_success'),'ok');await load();
  };
  const draw=()=>{
    const all=rows(),query=keyword.trim().toLocaleLowerCase();
    const filtered=all.filter(row=>{
      if(categoryFilter.length&&!categoriesOf(row).some(category=>categoryFilter.includes(category)))return false;
      if(statusFilter==='active'&&!active(row))return false;
      if(statusFilter==='invalid'&&active(row))return false;
      if(query){const title=titleOf(row),search=fullText?`${title} ${summaryOf(row)}`:title;
        if(!search.toLocaleLowerCase().includes(query))return false;}
      return true;
    });
    const sortValue=row=>sortField==='id'?row.id:sortField==='title'?titleOf(row):sortField==='category'?categoriesOf(row).join(' '):
      sortField==='summary'?summaryOf(row):sortField==='status'?(active(row)?'1':'0'):row.updated_at||'';
    filtered.sort((a,b)=>{const cmp=String(sortValue(a)).localeCompare(String(sortValue(b)),undefined,{numeric:true,sensitivity:'base'});
      return sortDir==='asc'?cmp:-cmp;});
    const size=20,totalPages=Math.max(1,Math.ceil(filtered.length/size));page=Math.min(page,totalPages);
    const pageRows=filtered.slice((page-1)*size,page*size);
    const header=(field,label)=>h('th',{class:'kg-sortable',onclick:()=>{
      sortDir=sortField===field&&sortDir==='asc'?'desc':'asc';sortField=field;draw();
    }},`${label}${sortField===field?(sortDir==='asc'?' ↑':' ↓'):''}`);
    const table=h('div',{class:'kg-table-wrap'},h('table',{class:'kg-table'},[
      h('thead',{},h('tr',{},[header('id',text('number')),header('title',text('title_column')),header('category',text('category')),
        header('summary',text('summary')),header('status',text('status')),header('updated_at',text('updated_at')),h('th',{},text('actions'))])),
      h('tbody',{},pageRows.length?pageRows.map(row=>{
        const live=active(row),isSource=row.table==='knowledge_sources',isPlaybook=row.table==='playbooks';
        const superseded=row.lifecycle_status==='superseded';
        const editHref=isSource?'':`#/knowledge/edit/${row.table}/${row.id}`;
        const summary=summaryOf(row);
        const actions=[
          !isSource&&!superseded?h('a',{class:'btn btn-ghost btn-sm',href:editHref},text('edit')):null,
          isSource&&row.extractionStatus==='failed'?h('button',{class:'btn btn-ghost btn-sm',type:'button',
            onclick:()=>retry(row).catch(error=>ctx.toast(error.message,'error'))},text('retry')):null,
          !isSource&&!superseded?h('button',{class:'btn btn-ghost btn-sm',type:'button',onclick:()=>setStatus(row).catch(error=>ctx.toast(error.message,'error'))},text(live?'mark_invalid':'mark_valid')):null,
          h('button',{class:'btn btn-ghost btn-sm',type:'button',onclick:()=>remove(row).catch(error=>ctx.toast(error.message,'error'))},text('delete')),
        ].filter(Boolean);
        return h('tr',{'data-kg-id':String(row.id)},[
          h('td',{class:'kg-number-cell'},`${row.table==='knowledge_items'?'K':isPlaybook?'P':'S'}-${row.id}`),
          h('td',{},[h('b',{},titleOf(row)||'—'),isPlaybook?h('small',{class:'kg-table-meta'},text('playbook')):null]),
          h('td',{class:'kg-category-tags'},categoriesOf(row).map(category=>h('span',{class:'kg-category-chip'},text(`category_${category}`)))),
          h('td',{class:'kg-summary-cell'},[summary||'—',
            !isSource?h('details',{class:'kg-row-content-details'},[h('summary',{},text('view_content')),
              h('div',{class:'kg-full-content'},isPlaybook?row.response_logic:row.content)]):null]),
          h('td',{},h('span',{class:`kg-status ${live?'kg-verified':'kg-invalidated'}`},text(live?'status_active':'status_invalid'))),
          h('td',{},row.updated_at?String(row.updated_at).slice(0,10):'—'),
          h('td',{class:'kg-table-actions'},actions),
        ]);
      }):h('tr',{},h('td',{colspan:'7',class:'kg-empty-cell'},text('no_results')))),
    ]));
    const pager=h('div',{class:'kg-pager'},[
      h('span',{},text('result_count').replace('{count}',String(filtered.length))),
      h('button',{class:'btn btn-ghost btn-sm',type:'button',disabled:page<=1,onclick:()=>{page--;draw();}},text('previous')),
      h('span',{},`${page} / ${totalPages}`),
      h('button',{class:'btn btn-ghost btn-sm',type:'button',disabled:page>=totalPages,onclick:()=>{page++;draw();}},text('next')),
    ]);
    main.querySelector('.kg-table-wrap')?.replaceWith(table);
    main.querySelector('.kg-pager')?.replaceWith(pager);
    main.querySelector('.kg-category-filter')?.replaceWith(categoryFilterNode());
    main.querySelector('.kg-status-filter')?.replaceWith(statusNode());
  };
  const searchInput=h('input',{type:'search',maxlength:'160',placeholder:text('search_title_hint'),'aria-label':text('search_title_hint'),value:keyword});
  const fullSearch=h('input',{type:'checkbox',checked:fullText});
  const categoryFilterNode=()=>h('details',{class:'kg-category-filter',open:categoryFilterOpen},[
    h('summary',{},`${text('filter_category')}${categoryFilter.length?` · ${categoryFilter.length}`:''}`),
    h('div',{class:'kg-category-options'},CATEGORIES.map(category=>h('label',{},[
      h('input',{type:'checkbox',checked:categoryFilter.includes(category),onchange:event=>{
        categoryFilterOpen=event.currentTarget.closest('details').open;
        categoryFilter=event.target.checked?[...categoryFilter,category]:categoryFilter.filter(item=>item!==category);page=1;draw();
      }}),text(`category_${category}`)]))),
  ]);
  const statusNode=()=>h('select',{class:'kg-status-filter','aria-label':text('filter_status'),
    onchange:event=>{statusFilter=event.target.value;page=1;draw();}},
    [['all','filter_status'],['active','status_active'],['invalid','status_invalid']]
      .map(([value,label])=>h('option',{value,selected:statusFilter===value},text(label))));
  const searchForm=h('form',{class:'kg-search',onsubmit:event=>{event.preventDefault();keyword=searchInput.value;fullText=fullSearch.checked;page=1;draw();}},[
    searchInput,h('label',{class:'kg-full-search'},[fullSearch,text('full_search')]),h('button',{class:'btn btn-primary',type:'submit'},text('search')),
  ]);
  main.replaceChildren(pageHead({kicker:text('kicker'),title:text('title'),sub:text('description'),actions:[
    h('a',{class:'btn btn-ghost',href:'#/knowledge/upload'},text('upload_button')),
    h('a',{class:'btn btn-primary',href:'#/knowledge/new'},text('new_knowledge_button')),
    h('a',{class:'btn btn-ghost',href:'#/knowledge/playbook'},text('new_playbook_button')),
    h('a',{class:'btn btn-ghost',href:'#/knowledge/trash'},text('trash_button')),
  ]}),h('section',{class:'card kg-home-card'},[
    h('div',{class:'card-body kg-list-tools'},[
      searchForm,h('div',{class:'kg-filters'},[categoryFilterNode(),statusNode()]),
      h('div',{class:'kg-table-wrap'}),h('div',{class:'kg-pager'}),
    ]),
  ]));
  load().catch(error=>{main.querySelector('.kg-table-wrap').replaceChildren(emptyNote(text('load_failed'),String(error.message||'')));});
}
