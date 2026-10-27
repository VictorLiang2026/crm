import { h } from './dom.js';
import { pageHead, emptyNote } from './ui.js';
import { t } from './i18n.js';
import { data } from './data.js';

const text=key=>t(`kg_${key}`);
const CATEGORIES=['on_sale_product','existing_service','recruitment_policy','industry_development',
  'marketing_activity','legal_tax','health_wealth_sharing','top_performer_sharing','customer_case','recruitment_case',
  'conversation_strategy','objection_handling','company_information','other'];
const LEGACY={product:'on_sale_product',company:'company_information',service:'existing_service',
  recruitment:'recruitment_policy',industry:'industry_development',campaign:'marketing_activity',
  health_wealth_seminar:'health_wealth_sharing',top_performer_sharing:'top_performer_sharing',legal_tax:'legal_tax',
  case:'customer_case',playbook:'conversation_strategy'};
const categoriesOf=row=>Array.isArray(row?.metadata?.categories)&&row.metadata.categories.length?row.metadata.categories
  :Array.isArray(row?.categories)&&row.categories.length?row.categories
    :[LEGACY[row?.metadata?.domain]||(row?.table==='playbooks'?'conversation_strategy':'other')];
const field=(key,control)=>h('label',{class:'kg-field'},[h('span',{},text(key)),control]);
const textInput=(name,{value='',required=false,type='text',max=500,min=null,step=null,placeholder=''}={})=>h('input',
  {name,type,value,required,...(type==='number'?{max:String(max),...(min==null?{}:{min:String(min)}),...(step==null?{}:{step:String(step)})}:{maxlength:String(max)}),
    ...(placeholder?{placeholder:text(placeholder)}:{})});
const area=(name,{value='',rows=4,max=8000,required=false,placeholder=''}={})=>h('textarea',
  {name,rows, maxlength:String(max),required,...(placeholder?{placeholder:text(placeholder)}:{})},value);
function categoryChooser(selected=[]){
  const chosen=new Set(selected);
  const node=h('fieldset',{class:'kg-categories-field'},[
    h('legend',{},text('categories')),
    h('div',{class:'kg-categories-grid'},CATEGORIES.map(category=>h('label',{class:'kg-category-choice'},[
      h('input',{type:'checkbox',name:'categories',value:category,checked:chosen.has(category)}),
      h('span',{},text(`category_${category}`)),
    ]))),
  ]);
  return node;
}
function selectedCategories(form){return [...form.querySelectorAll('input[name="categories"]:checked')].map(input=>input.value);}
function setCategories(form,values){
  const chosen=new Set(values||[]);
  form.querySelectorAll('input[name="categories"]').forEach(input=>{input.checked=chosen.has(input.value);});
}
const backLink=()=>h('a',{class:'btn btn-ghost',href:'#/knowledge-governance'},text('back_to_library'));

export function renderKnowledgeEditor(ctx,{mode='new',table='knowledge_items',id=null}={}){
  const isUpload=mode==='upload',isPlaybook=mode==='playbook'||table==='playbooks';
  const formStatus=h('p',{class:'foot-note',role:'status'});
  const categoryNode=categoryChooser(isPlaybook?['conversation_strategy']:[]);
  const form=h('form',{class:'kg-form kg-page-form',onsubmit:async event=>{
    event.preventDefault();const current=event.currentTarget,values=Object.fromEntries(new FormData(current).entries());
    values.categories=selectedCategories(current);
    if(!values.categories.length){formStatus.textContent=text('category_required');return;}
    const submit=current.querySelector('[type="submit"]');submit.disabled=true;
    try{
      if(isUpload){
        const file=current.elements.file.files?.[0];
        if(!file)throw new Error(text('source_file_required'));
        if(file.size>3*1024*1024)throw new Error(text('source_file_too_large'));
        const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();
          reader.onerror=()=>reject(new Error(text('source_upload_failed')));
          reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file);});
        const result=await data.knowledgeLibrary(ctx,'upload',{data:{...values,fileName:file.name,
          contentType:file.type||'application/octet-stream',fileBase64:base64,
          sharingAuthorized:current.elements.sharingAuthorized.checked,anonymized:current.elements.anonymized.checked}});
        if(!result?.ok)throw new Error(text(result?.errorCode==='PERSONAL_DATA_DETECTED'?'sensitive_blocked':'source_upload_failed'));
      }else if(isPlaybook){
        for(const key of ['possible_underlying_reasons','clarifying_questions','do_not_say'])
          values[key]=String(values[key]||'').split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
        await data.saveKnowledgeGovernance(ctx,{table:'playbooks',...values,
          id:mode==='edit'?id:undefined,expectedUpdatedAt:current.elements.expectedUpdatedAt?.value,
          confidence:values.confidence===''?0.8:Number(values.confidence)});
      }else{
        const result=await data.knowledgeLibrary(ctx,'save',{data:{...values,
          id:mode==='edit'?id:undefined,expectedUpdatedAt:current.elements.expectedUpdatedAt?.value,
          confidence:values.confidence===''?0.8:Number(values.confidence),
          sharingAuthorized:current.elements.sharingAuthorized.checked,anonymized:current.elements.anonymized.checked}});
        if(!result?.ok)throw new Error(result?.error?.message||text('save_failed'));
      }
      ctx.toast(text(isUpload?'upload_success':'save_success'),'ok');location.hash='#/knowledge-governance';
    }catch(error){formStatus.textContent=error.message||text('save_failed');submit.disabled=false;}
  }},[]);
  const elements=[];
  if(isUpload){
    elements.push(
      field('item_title',textInput('title',{required:true,max:500})),categoryNode,
      field('source_publisher',textInput('publisher',{max:500})),
      field('source_jurisdiction',textInput('jurisdiction',{max:160,placeholder:'source_jurisdiction_hint'})),
      field('source_uri',textInput('sourceUri',{type:'url',max:2000,placeholder:'source_uri_hint'})),
      field('source_published_at',textInput('publishedAt',{type:'date'})),
      field('source_valid_from',textInput('validFrom',{type:'date'})),
      field('source_valid_to',textInput('validTo',{type:'date'})),
      field('source_review_at',textInput('reviewAt',{type:'date'})),
      field('source_file',h('input',{name:'file',type:'file',required:true,accept:'.pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain'})),
      field('source_sharing_authorized',h('input',{name:'sharingAuthorized',type:'checkbox'})),
      field('source_anonymized',h('input',{name:'anonymized',type:'checkbox'})),
      h('p',{class:'foot-note'},text('source_upload_help')),
    );
  }else if(isPlaybook){
    elements.push(
      categoryNode,
      field('scenario',textInput('scenario',{required:true,max:256})),
      field('objection',textInput('objection',{max:500})),
      field('possible_underlying_reasons',area('possible_underlying_reasons',{rows:2,max:2000,placeholder:'list_lines_hint'})),
      field('clarifying_questions',area('clarifying_questions',{rows:2,max:2000,placeholder:'list_lines_hint'})),
      field('response_logic',area('response_logic',{required:true,rows:5,max:4000})),
      field('next_objective',textInput('next_objective',{required:true,max:500})),
      field('do_not_say',area('do_not_say',{rows:2,max:2000,placeholder:'list_lines_hint'})),
      field('evidence_refs',textInput('evidence_refs',{max:500,placeholder:'reference_ids_hint'})),
      field('case_refs',textInput('case_refs',{max:500,placeholder:'reference_ids_hint'})),
      field('story_refs',textInput('story_refs',{max:500,placeholder:'reference_ids_hint'})),
      field('source',textInput('source',{required:true,max:500})),
      field('valid_from',textInput('valid_from',{type:'date'})),
      field('valid_to',textInput('valid_to',{type:'date'})),
      field('confidence',textInput('confidence',{type:'number',min:0,max:1,step:0.01,value:'0.8'})),
    );
  }else{
    elements.push(
      categoryNode,
      field('item_title',textInput('title',{required:true,max:500})),
      field('summary',area('summary',{rows:2,max:1200,placeholder:'summary_ai_hint'})),
      field('content',area('content',{required:true,rows:8,max:8000})),
      field('source_jurisdiction',textInput('jurisdiction',{max:160,placeholder:'source_jurisdiction_hint'})),
      field('source_uri',textInput('sourceUri',{type:'url',max:2000,placeholder:'source_uri_hint'})),
      field('source_date',textInput('sourceDate',{type:'date'})),
      field('valid_from',textInput('validFrom',{type:'date'})),
      field('valid_to',textInput('validTo',{type:'date'})),
      field('confidence',textInput('confidence',{type:'number',min:0,max:1,step:0.01,value:'0.8'})),
      field('source_sharing_authorized',h('input',{name:'sharingAuthorized',type:'checkbox'})),
      field('source_anonymized',h('input',{name:'anonymized',type:'checkbox'})),
    );
  }
  if(mode==='edit')elements.push(h('input',{type:'hidden',name:'expectedUpdatedAt',value:''}));
  form.replaceChildren(...elements,h('div',{class:'kg-form-actions'},[
    h('a',{class:'btn btn-ghost',href:'#/knowledge-governance'},text('cancel')),
    h('button',{class:'btn btn-primary',type:'submit'},text(isUpload?'upload_button':mode==='edit'?'save_changes':'save_knowledge')),
  ]),formStatus);
  const pageTitle=isUpload?'upload_page_title':isPlaybook?(mode==='edit'?'edit_playbook':'new_playbook_button'):
    mode==='edit'?'edit_knowledge':'new_knowledge_button';
  ctx.main.replaceChildren(pageHead({kicker:text('kicker'),title:text(pageTitle),sub:text(isUpload?'upload_page_note':'editor_page_note'),actions:[backLink()]}),
    h('section',{class:'card'},[h('div',{class:'card-body'},form)]));
  if(mode==='edit'){
    data.knowledgeLibrary(ctx,'list').then(result=>{
      const source=table==='playbooks'?result.playbooks?.find(row=>String(row.id)===String(id)):
        result.knowledge?.find(row=>String(row.id)===String(id));
      if(!source)throw new Error(text('edit_not_found'));
      form.elements.expectedUpdatedAt.value=source.updated_at||'';
      setCategories(form,categoriesOf({...source,table}));
      const assign=(name,value)=>{if(form.elements[name]&&value!=null)form.elements[name].value=String(value);};
      if(table==='playbooks'){
        assign('scenario',source.scenario);assign('objection',source.objection);assign('response_logic',source.response_logic);
        assign('next_objective',source.next_objective);assign('source',source.source);assign('valid_from',source.valid_from);
        assign('valid_to',source.valid_to);assign('confidence',source.confidence??0.8);
        assign('possible_underlying_reasons',(source.possible_underlying_reasons||[]).join('\n'));
        assign('clarifying_questions',(source.clarifying_questions||[]).join('\n'));assign('do_not_say',(source.do_not_say||[]).join('\n'));
        assign('evidence_refs',(source.evidence_refs||[]).join(','));assign('case_refs',(source.case_refs||[]).join(','));
        assign('story_refs',(source.story_refs||[]).join(','));
      }else{
        assign('title',source.source);assign('summary',source.metadata?.summary||'');assign('content',source.content);
        assign('jurisdiction',source.metadata?.jurisdiction||'');assign('sourceUri',source.metadata?.source_uri||'');
        assign('sourceDate',source.source_date);assign('validFrom',source.valid_from);assign('validTo',source.valid_to);
        assign('confidence',source.confidence??0.8);
        if(form.elements.sharingAuthorized)form.elements.sharingAuthorized.checked=source.metadata?.sharing_authorized===true;
        if(form.elements.anonymized)form.elements.anonymized.checked=source.metadata?.anonymized===true;
      }
    }).catch(error=>{formStatus.textContent=error.message||text('edit_not_found');});
  }
}

export function renderKnowledgeTrash(ctx){
  const list=h('div',{class:'kg-trash-list'}),status=h('p',{class:'foot-note',role:'status'});
  const load=async()=>{
    const result=await data.knowledgeLibrary(ctx,'trashList');const rows=result.rows||[];
    if(!rows.length){list.replaceChildren(emptyNote(text('trash_empty'),text('trash_empty_note')));return;}
    list.replaceChildren(h('div',{class:'kg-table-wrap'},h('table',{class:'kg-table'},[
      h('thead',{},h('tr',{},[h('th',{},text('title_column')),h('th',{},text('category')),
        h('th',{},text('deleted_at')),h('th',{},text('actions'))])),
      h('tbody',{},rows.map(row=>h('tr',{},[
        h('td',{},row.title||row.source||row.scenario||row.file_name||'—'),
        h('td',{class:'kg-category-tags'},categoriesOf({...row,table:row.table}).map(category=>h('span',{class:'kg-category-chip'},text(`category_${category}`)))),
        h('td',{},String(row.deleted_at||'').slice(0,16).replace('T',' ')),
        h('td',{},h('button',{class:'btn btn-ghost btn-sm',type:'button',onclick:async()=>{
          try{await data.knowledgeLibrary(ctx,'restore',{data:{table:row.table,id:row.id}});ctx.toast(text('restore_success'),'ok');await load();}
          catch(error){status.textContent=error.message||text('restore_failed');}
        }},text('restore'))),
      ]))),
    ])));
  };
  ctx.main.replaceChildren(pageHead({kicker:text('kicker'),title:text('trash_title'),sub:text('trash_note'),actions:[backLink()]}),
    h('section',{class:'card'},[h('div',{class:'card-body'},[status,list])]));
  load().catch(error=>{list.replaceChildren(emptyNote(text('load_failed'),String(error.message||'')));});
}
