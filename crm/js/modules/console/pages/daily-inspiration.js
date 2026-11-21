import { h } from '../dom.js';
import { ic } from '../icons.js';
import { data } from '../data.js';
import { t, getLang } from '../i18n.js';
import { pageHead, card, emptyNote, wpTag } from '../ui.js';
import { parseDailyInspirationFile } from '../daily-inspiration-import.js';

const THEMES = ['team_leadership','business_development','customer_service','customer_trust',
  'protection','long_term','team_growth'];

export function dailyInspirationHeading() {
  return h('span',{class:'daily-inspiration-heading','data-daily-inspiration-title':''},t('di_loading'));
}

function quoteText(quote) {
  return getLang()==='en' ? quote.quoteEn : quote.quoteZh;
}

function failureText(error) {
  return error?.code === 'DAILY_INSPIRATION_DENIED' ? t('di_access_denied') : t('di_load_failed');
}

export function dailyInspirationCard(ctx) {
  const root=h('section',{class:'daily-inspiration-strip','aria-label':t('di_home_title')},[
    h('div',{class:'daily-inspiration-loading',role:'status'},t('di_loading')),
  ]);
  let timer = null;
  let dueAt = null;
  let busy = false;
  let observer;
  const onVisible = () => {
    if (!document.hidden && dueAt !== null && Date.now() >= dueAt) loadCurrent();
  };
  const schedule = () => {
    clearTimeout(timer);
    if (root.isConnected && !busy && dueAt !== null) {
      timer = setTimeout(loadCurrent, Math.max(50, dueAt - Date.now()));
    }
  };
  const setDeadline = result => {
    const delay = result?.refreshInMs;
    dueAt = Number.isFinite(delay) && delay >= 0 ? Date.now() + delay : null;
  };
  const showQuote = result => {
    const heading=root.parentElement?.querySelector('[data-daily-inspiration-title]');
    const quote=result?.quote;
    if (!quote) {
      if(heading)heading.textContent=t('di_home_title');
      root.replaceChildren(h('div',{class:'daily-inspiration-empty'},[
        h('div',{class:'daily-inspiration-empty-main'},[ic('sparkle'),h('div',{},[
          h('b',{},t('di_home_title')),h('span',{},result?.noQuotes?t('di_empty_home'):t('di_load_failed')),
        ])]),h('a',{class:'btn btn-ghost btn-sm',href:'#/daily-inspiration'},t('di_manage_link')),
      ]));
      return;
    }
    if(heading)heading.textContent=quoteText(quote);
    const menu=h('details',{class:'daily-inspiration-menu'},[
      h('summary',{class:'daily-inspiration-menu-trigger','aria-label':t('di_actions'),title:t('di_actions')},'⋯'),
    ]);
    const status=h('span',{class:'daily-inspiration-status','aria-live':'polite'});
    const keep=h('button',{class:'daily-inspiration-menu-item',type:'button',onclick:event=>{
      menu.open=false;status.textContent=t('di_kept');
    }},t('di_keep'));
    const replace=h('button',{class:'daily-inspiration-menu-item',type:'button',onclick:async event=>{
      if (busy) return;
      busy = true;
      clearTimeout(timer);
      const button=event.currentTarget;button.disabled=true;status.textContent=t('di_replacing');
      try {
        const next=await data.dailyInspiration(ctx,'replace',{expectedQuoteId:quote.id});
        if (!next.ok) throw next.error;
        setDeadline(next);
        if (root.isConnected) {
          if (next.noAlternative) status.textContent=t('di_no_alternative');
          else showQuote(next);
        }
      } catch(error) { status.textContent=failureText(error); }
      finally { busy=false;button.disabled=false;schedule(); }
    }},[ic('refresh'),t('di_replace')]);
    menu.append(h('div',{class:'daily-inspiration-menu-list'},[replace,keep]));
    const source=h('a',{class:'daily-inspiration-source',href:quote.sourceUrl,target:'_blank',rel:'noopener noreferrer'},
      `${quote.sourceOrg} · ${quote.sourceTitle}${quote.editorialRewrite?` · ${t('di_edited_source')}`:''}`);
    root.replaceChildren(
      h('div',{class:'daily-inspiration-main'},[
        h('div',{class:'daily-inspiration-kicker'},[ic('sparkle'),t('di_home_title'),wpTag(t(result.segment==='first'?'di_period_first':'di_period_second'))]),
        h('div',{class:'daily-inspiration-meta'},[
          h('span',{},t(`di_theme_${quote.theme}`)),source,
        ]),status,
      ]),menu,
    );
  };
  async function loadCurrent() {
    if (!root.isConnected || busy) return;
    busy = true;
    clearTimeout(timer);
    try {
      const result = await data.dailyInspiration(ctx,'current');
      setDeadline(result);
      if (root.isConnected) showQuote(result);
    } catch(error) {
      if (!root.isConnected) return;
      dueAt = Date.now() + 30000;
      const heading=root.parentElement?.querySelector('[data-daily-inspiration-title]');
      if(heading)heading.textContent=t('di_home_title');
      root.replaceChildren(h('div',{class:'daily-inspiration-empty'},[
        h('span',{role:'status'},failureText(error)),h('a',{href:'#/daily-inspiration'},t('di_manage_link')),
      ]));
    } finally { busy = false; schedule(); }
  }
  // renderToday attaches the card after this function returns.
  queueMicrotask(() => {
    if (!root.isConnected) return;
    observer = new MutationObserver(() => {
      if (root.isConnected) return;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      observer.disconnect();
    });
    observer.observe(ctx.main, {childList:true});
    document.addEventListener('visibilitychange', onVisible);
    loadCurrent();
  });
  return root;
}

function inputField(labelKey, name, value, attrs={}) {
  const input=h('input',{class:'input',name,value:value??'',...attrs});
  return h('label',{class:'di-field'},[h('span',{},t(labelKey)),input]);
}

function quoteEditor(ctx, existing, onSaved) {
  const row=existing||{};
  const status=h('p',{class:'form-msg','aria-live':'polite'});
  const theme=h('select',{class:'input',name:'theme',required:true},THEMES.map(key=>
    h('option',{value:key,...(row.theme===key?{selected:true}:{})},t(`di_theme_${key}`))));
  const themeField=h('label',{class:'di-field'},[h('span',{},t('di_theme_label')),theme]);
  const rewrite=h('input',{type:'checkbox',name:'editorialRewrite',...(row.editorialRewrite?{checked:true}:{})});
  const form=h('form',{class:'di-quote-form',onsubmit:async event=>{
    event.preventDefault();const submit=form.querySelector('[type="submit"]');submit.disabled=true;status.textContent=t('di_saving');
    const fields=new FormData(form);
    const payload={quoteZh:String(fields.get('quoteZh')||''),quoteEn:String(fields.get('quoteEn')||''),
      theme:String(fields.get('theme')||''),sourceOrg:String(fields.get('sourceOrg')||''),
      sourceTitle:String(fields.get('sourceTitle')||''),sourceUrl:String(fields.get('sourceUrl')||''),
      editorialRewrite:rewrite.checked};
    const scoreValue=String(fields.get('recommendationScore')||'');
    if(scoreValue!=='')payload.recommendationScore=Number(scoreValue);
    if(row.id)payload.id=row.id;
    try {await data.dailyInspiration(ctx,'quoteSave',payload);status.textContent=t('di_saved');onSaved();}
    catch(error){status.classList.add('error');status.textContent=failureText(error);submit.disabled=false;}
  }},[
    row.id?h('input',{type:'hidden',name:'id',value:row.id}):null,
    inputField('di_quote_zh','quoteZh',row.quoteZh,{required:true,maxlength:'300'}),
    inputField('di_quote_en','quoteEn',row.quoteEn,{required:true,maxlength:'500'}),
    themeField,
    inputField('di_source_org','sourceOrg',row.sourceOrg,{required:true,maxlength:'120'}),
    inputField('di_source_title','sourceTitle',row.sourceTitle,{required:true,maxlength:'240'}),
    inputField('di_source_url','sourceUrl',row.sourceUrl,{required:true,type:'url',pattern:'https://.*',maxlength:'1000'}),
    inputField('di_recommendation_score','recommendationScore',row.recommendationScore ?? '',{type:'number',min:'0',max:'10',step:'1'}),
    h('label',{class:'di-checkbox'},[rewrite,h('span',{},t('di_editorial_rewrite'))]),
    h('div',{class:'di-form-actions'},[
      h('button',{class:'btn btn-primary',type:'submit'},[ic('check'),t('di_save_quote')]),
      h('button',{class:'btn btn-ghost',type:'button',onclick:()=>onSaved(true)},t('di_cancel')),
    ]),status,
  ]);
  return form;
}

function importPanel(ctx, existingQuotes, refresh, initialStatus='') {
  const status=h('p',{class:'form-msg','aria-live':'polite'});
  status.textContent=initialStatus;
  const preview=h('div',{class:'di-import-preview'});
  const submit=h('button',{class:'btn btn-primary',type:'button',disabled:true});
  let prepared=null;
  const renderPreview=()=>{
    if(!prepared){preview.replaceChildren();submit.disabled=true;return;}
    const {quotes,scores,exactDuplicates,nearDuplicates,decisions,autoScored}=prepared;
    const skippedNear=nearDuplicates.filter(item=>decisions.get(item.index)==='keep_existing').length;
    const imported=quotes.length-exactDuplicates.length-skippedNear;
    const decisionRows=nearDuplicates.map(item=>{
      const quote=quotes[item.index],match=item.matches[0]?.existing;
      return h('li',{class:'di-import-near-row'},[
        h('div',{class:'di-import-pair'},[
          h('div',{},[h('b',{},t('di_import_incoming')),h('p',{},quote.quoteZh),h('small',{},quote.quoteEn)]),
          h('div',{},[h('b',{},t('di_import_existing')),h('p',{},match?.quoteZh||''),h('small',{},match?.quoteEn||'')]),
        ]),
        h('label',{class:'di-radio'},[h('input',{type:'radio',name:`near-${item.index}`,value:'keep_existing',...(decisions.get(item.index)==='keep_existing'?{checked:true}:{}),onchange:()=>{decisions.set(item.index,'keep_existing');renderPreview();}}),t('di_import_keep_existing')]),
        h('label',{class:'di-radio'},[h('input',{type:'radio',name:`near-${item.index}`,value:'import_new',...(decisions.get(item.index)==='import_new'?{checked:true}:{}),onchange:()=>{decisions.set(item.index,'import_new');renderPreview();}}),t('di_import_new_anyway')]),
      ]);
    });
    preview.replaceChildren(h('div',{class:'di-import-summary'},[
      h('span',{},`${t('di_import_new')}: ${imported}`),
      h('span',{},`${t('di_import_duplicates')}: ${exactDuplicates.length+skippedNear}`),
      h('span',{},`${t('di_import_near')}: ${nearDuplicates.length}`),
      h('span',{},`${t('di_import_backfill')}: ${scores.length}`),
      h('span',{},`${t('di_import_auto_scores')}: ${autoScored}`),
    ]),
    exactDuplicates.length?h('p',{class:'di-import-exact'},`${t('di_import_exact_skipped')}: ${exactDuplicates.length}`):null,
    decisionRows.length?h('div',{class:'di-import-near'},[h('h4',{},t('di_import_near_review')),h('ul',{class:'di-import-list'},decisionRows)]):null,
    h('ul',{class:'di-import-list'},quotes.filter((_,index)=>!exactDuplicates.some(item=>item.index===index)&&!nearDuplicates.some(item=>item.index===index)).slice(0,6).map(quote=>h('li',{},[
      h('span',{},quote.quoteZh),h('span',{},`${quote.quoteEn} · ${t('di_recommendation_score')} ${quote.recommendationScore ?? t('di_auto_score')}`),
    ]))));
    submit.disabled=(!imported&&!scores.length&&!nearDuplicates.length)||nearDuplicates.some(item=>!decisions.has(item.index));
  };
  const fileInput=h('input',{class:'input',type:'file',accept:'.json,.xlsx,.csv,.tsv,application/json,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',onchange:async event=>{
    prepared=null;status.classList.remove('error');status.textContent='';
    const file=event.currentTarget.files?.[0];
    if(!file){renderPreview();return;}
    try {
      const bundle=await parseDailyInspirationFile(file);
      if(!Array.isArray(bundle.quotes)||!Array.isArray(bundle.fillMissingScores))throw new Error(t('di_import_invalid_file'));
      const themeAliases=new Map(THEMES.flatMap(key=>[[key,key],[t(`di_theme_${key}`).toLocaleLowerCase(),key]]));
      const quotes=bundle.quotes.map(item=>({...item,theme:themeAliases.get(String(item.theme||'').toLocaleLowerCase())||item.theme}));
      const previewResult=await data.dailyInspiration(ctx,'quoteBatchPreview',{quotes,fillMissingScores:bundle.fillMissingScores});
      const existingIds=new Set(previewResult.existingScoreIds||[]);
      const scores=bundle.fillMissingScores.filter(item=>existingIds.has(String(item.id)));
      prepared={quotes:previewResult.quotes,scores,exactDuplicates:previewResult.exactDuplicates||[],
        nearDuplicates:previewResult.nearDuplicates||[],decisions:new Map(),autoScored:previewResult.autoScored||0};
      renderPreview();status.textContent=t('di_import_preview_ready');
    } catch(error){prepared=null;renderPreview();status.classList.add('error');
      const parseErrors={FILE_SIZE_LIMIT:'di_import_file_size',FILE_TYPE_UNSUPPORTED:'di_import_unsupported',
        FILE_HEADER_REQUIRED:'di_import_invalid_file',FILE_EMPTY_WORKBOOK:'di_import_invalid_file',
        FILE_ROW_LIMIT:'di_import_invalid_file',FILE_COLUMN_LIMIT:'di_import_invalid_file',FILE_BLANK_HEADER:'di_import_invalid_file',
        FILE_DUPLICATE_HEADER:'di_import_invalid_file',CSV_UNCLOSED_QUOTE:'di_import_invalid_file',
        MISSING_BILINGUAL_TEXT:'di_import_missing_text',INVALID_SCORE:'di_import_bad_score',
        INVALID_JSON_BUNDLE:'di_import_invalid_file'};
      status.textContent=error.code==='DAILY_INSPIRATION_REVIEW_REQUIRED'?t('di_import_review_required'):
        parseErrors[error.message]?t(parseErrors[error.message]):error.code==='DAILY_INSPIRATION_FAILED'||error.code==='INVALID_INPUT'?
          t('di_import_invalid_file'):error.message||t('di_import_invalid_file');}
  }});
  submit.textContent=t('di_import_confirm');
  submit.addEventListener('click',async()=>{
    if(!prepared||submit.disabled)return;
    submit.disabled=true;status.classList.remove('error');status.textContent=t('di_import_saving');
    try {
      const result=await data.dailyInspiration(ctx,'quoteBatchImport',{quotes:prepared.quotes,fillMissingScores:prepared.scores,
        decisions:Array.from(prepared.decisions,([index,choice])=>({index,choice}))});
      if(!result.ok)throw Object.assign(new Error(t('di_import_partial')), {partial:result});
      const message=`${t('di_import_done')}: ${result.addedCount} · ${t('di_import_duplicates')} ${result.duplicateCount} · ${t('di_import_backfill')} ${result.scoreUpdatedCount}`;
      prepared=null;fileInput.value='';renderPreview();refresh(message);
    } catch(error){
      const partial=error.partial;
      status.classList.add('error');status.textContent=partial?
        `${t('di_import_partial')}: ${partial.addedCount} / ${prepared.quotes.length} · ${t('di_import_backfill')} ${partial.scoreUpdatedCount}`:
        (error.code==='DAILY_INSPIRATION_FAILED'||error.code==='DAILY_INSPIRATION_PERSISTENCE_ERROR'?t('di_import_failed'):failureText(error));
      submit.disabled=false;
    }
  });
  return card({title:t('di_import_title'),icon:'file',body:[
    h('p',{class:'foot-note'},t('di_import_desc')),
    h('label',{class:'di-field'},[h('span',{},t('di_import_file')),fileInput]),preview,submit,status,
  ]});
}

export async function renderDailyInspirationLibrary(ctx, importStatus='') {
  ctx.main.replaceChildren(pageHead({kicker:t('kicker_more'),title:t('di_library_title'),sub:t('di_library_desc')}),
    card({title:t('di_loading'),icon:'sparkle',body:emptyNote(t('di_loading'),t('di_loading_note'))}));
  let result;
  try {result=await data.dailyInspiration(ctx,'libraryList');}
  catch(error){ctx.main.replaceChildren(pageHead({kicker:t('kicker_more'),title:t('di_library_title')}),
    card({title:t('di_load_failed'),icon:'bell',body:emptyNote(failureText(error),t('di_load_failed'))}));return;}
  const settings=result.settings||{timezone:'Asia/Shanghai',firstPeriodStart:'01:00',secondPeriodStart:'12:00',minRecommendationScore:0,allowRepeatBeforeAllUsed:false};
  const refresh=(notice='')=>renderDailyInspirationLibrary(ctx,notice);
  const editor=h('div',{class:'di-editor-slot'});
  const settingsStatus=h('p',{class:'form-msg','aria-live':'polite'});
  const timeZone=inputField('di_timezone','timezone',settings.pendingTimezone||settings.timezone,{required:true,maxlength:'80'});
  const first=inputField('di_first_start','firstPeriodStart',settings.pendingFirstPeriodStart||settings.firstPeriodStart,{required:true,type:'time'});
  const second=inputField('di_second_start','secondPeriodStart',settings.pendingSecondPeriodStart||settings.secondPeriodStart,{required:true,type:'time'});
  const minScore=inputField('di_min_score','minRecommendationScore',settings.minRecommendationScore??0,{required:true,type:'number',min:'0',max:'10',step:'1'});
  const allowRepeat=h('input',{type:'checkbox',name:'allowRepeatBeforeAllUsed',...(settings.allowRepeatBeforeAllUsed?{checked:true}:{})});
  const settingsForm=h('form',{class:'di-settings-form',onsubmit:async event=>{
    event.preventDefault();const submit=settingsForm.querySelector('[type="submit"]');submit.disabled=true;
    settingsStatus.textContent=t('di_saving');
    try {const fields=new FormData(settingsForm);const saved=await data.dailyInspiration(ctx,'settingsSave',{
      timezone:String(fields.get('timezone')||''),firstPeriodStart:String(fields.get('firstPeriodStart')||''),
      secondPeriodStart:String(fields.get('secondPeriodStart')||''),
      minRecommendationScore:Number(fields.get('minRecommendationScore')),
      allowRepeatBeforeAllUsed:allowRepeat.checked,
    });settingsStatus.textContent=saved.settings?.effectiveDate?`${t('di_scheduled')} · ${saved.settings.effectiveDate}`:t('di_saved');}
    catch(error){settingsStatus.classList.add('error');settingsStatus.textContent=failureText(error);}
    finally {submit.disabled=false;}
  }},[
    timeZone,first,second,minScore,h('label',{class:'di-checkbox di-repeat-setting'},[allowRepeat,h('span',{},t('di_allow_repeat'))]),
    h('p',{class:'foot-note'},t('di_period_help')),
    h('button',{class:'btn btn-primary',type:'submit'},[ic('check'),t('di_save_settings')]),settingsStatus,
  ]);
  const quotes=result.quotes||[];
  const list=quotes.length?h('div',{class:'di-library-list'},quotes.map(row=>{
    const status=wpTag(t(row.enabled?'di_enabled':'di_disabled'),row.enabled);
    const themeLabel=t(`di_theme_${row.theme}`);
    return h('article',{class:'di-library-row'},[
      h('div',{class:'di-library-copy'},[
        h('div',{class:'di-library-topline'},[h('b',{},themeLabel),wpTag(row.recommendationScore==null?t('di_unrated'):`${t('di_recommendation_score')} ${row.recommendationScore}/10`),status]),
        h('p',{class:'di-library-quote'},row.quoteZh),
        h('p',{class:'di-library-english'},row.quoteEn),
        h('a',{href:row.sourceUrl,target:'_blank',rel:'noopener noreferrer'},`${row.sourceOrg} · ${row.sourceTitle}${row.editorialRewrite?` · ${t('di_edited_source')}`:''}`),
      ]),h('div',{class:'di-library-actions'},[
        h('button',{class:'btn btn-ghost btn-sm',type:'button',onclick:()=>{
          editor.replaceChildren(quoteEditor(ctx,row,closed=>{editor.replaceChildren();if(!closed)refresh();}));
        }},[ic('file'),t('di_edit')]),
        h('button',{class:'btn btn-ghost btn-sm',type:'button',onclick:async event=>{
          const button=event.currentTarget;button.disabled=true;
          try {await data.dailyInspiration(ctx,'quoteToggle',{id:row.id,enabled:!row.enabled});refresh();}
          catch(error){button.disabled=false;settingsStatus.classList.add('error');settingsStatus.textContent=failureText(error);}
        }},[ic('refresh'),t(row.enabled?'di_disable':'di_enable')]),
      ]),
    ]);
  })):emptyNote(t('di_empty_library'),t('di_empty_library_note'));
  ctx.main.replaceChildren(
    pageHead({kicker:t('kicker_more'),title:t('di_library_title'),sub:t('di_library_desc'),actions:[
      h('button',{class:'btn btn-primary',type:'button',onclick:()=>editor.replaceChildren(quoteEditor(ctx,null,closed=>{editor.replaceChildren();if(!closed)refresh();}))},[ic('plus'),t('di_add_quote')]),
    ]}),
    h('div',{class:'di-settings-import-grid'},[
      card({title:t('di_settings_title'),icon:'gear',body:[settingsForm]}),
      importPanel(ctx,quotes,refresh,importStatus),
    ]),
    h('section',{class:'di-library-section'},[editor,h('div',{class:'di-library-heading'},[
      h('h2',{},t('di_quotes_title')),wpTag(String(quotes.length)),
    ]),list]),
  );
}
