import { h } from './dom.js';
import { pageHead } from './ui.js';
import { t } from './i18n.js';
import { data } from './data.js';

const text = (key) => t(`kg_${key}`);
const label = (name, control) => h('label', { class: 'kg-field' }, [h('span', {}, text(name)), control]);
const input = (name, type = 'text', value = '') => h('input', { name, type, value, maxlength: name === 'content' ? 8000 : 500 });
function status(row) { return text(`status_${row.lifecycle_status || (row.verified ? 'verified' : 'draft')}`); }
export function knowledgeValidity(row, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const from = row.valid_from || null, to = row.valid_to || null;
  const valid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
  if ((from && !valid(from)) || (to && !valid(to)) || (from && to && from > to)) return 'invalid';
  if (to && to < today) return 'expired';
  if (from && from > today) return 'future';
  return from || to ? 'within' : 'unspecified';
}
function rowDomain(row, table = 'knowledge_items') {
  if (table === 'playbooks') return 'playbook';
  const domain = row.metadata?.domain;
  if (domain) return domain;
  return ({product:'product',company:'company',regulation:'legal_tax',case:'case',story:'top_performer_sharing'})[row.item_type] || 'industry';
}
function renderRow(ctx, table, row, reload, onEdit, sourceRecord = null) {
  const isPlaybook = table === 'playbooks';
  const title = isPlaybook ? `${row.scenario} · ${row.objection}` : row.source;
  const summary = isPlaybook ? row.response_logic : (row.metadata?.summary || String(row.content || '').slice(0, 220));
  const state = row.lifecycle_status || (row.verified ? 'verified' : 'draft');
  const controls = [];
  const review = async action => {
    if (row.source_id && sourceRecord && !row.supersedes_id) {
      await data.knowledgeLibrary(ctx,'review',{data:{sourceId:sourceRecord.id,itemId:row.id,decision:action,
        expectedUpdatedAt:sourceRecord.updatedAt}});
    } else {
      await data.reviewKnowledgeGovernance(ctx, { table, id: row.id, action, expectedUpdatedAt: row.updated_at });
    }
    await reload();
  };
  if (state === 'draft') controls.push(h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => {
    if (!window.confirm(text('confirm_verify'))) return;
    await review('verify');
  } }, text('verify')));
  if (!isPlaybook && ['draft','verified'].includes(state)) controls.push(h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => onEdit(row) }, text(state === 'verified' ? 'revise' : 'edit')));
  if (['draft','verified'].includes(state)) controls.push(h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => {
    if (!window.confirm(text('confirm_invalidate'))) return;
    await review('invalidate');
  } }, text('invalidate')));
  const validity = isPlaybook ? '' : `${text('validity')}: ${text(`validity_${knowledgeValidity(row)}`)}`;
  return h('tr', { 'data-kg-id': String(row.id) }, [
    h('td', {}, [h('b', {}, title || '—'), h('small', { class: 'kg-table-meta' }, `${text('version')}: ${row.version_no || 1}`)]),
    h('td', {}, text(`domain_${rowDomain(row, table)}`)),
    h('td', { class: 'kg-summary-cell' }, [
      summary || '—',
      !isPlaybook && !row.metadata?.summary ? h('small', { class: 'kg-summary-note' }, text('summary_legacy')) : null,
      h('details',{class:'kg-row-content-details'},[
        h('summary',{},text('view_content')),
        h('div',{class:'kg-full-content'},isPlaybook?row.response_logic:row.content),
        ...(isPlaybook?['evidence_refs','case_refs','story_refs'].map(key=>h('small',{},`${text(key)}: ${(row[key]||[]).join(', ')||'—'}`)):[]),
      ]),
    ]),
    h('td', {}, row.source_date || row.valid_from || '—'),
    h('td', {}, validity),
    h('td', {}, h('span', { class: `kg-status kg-${state}` }, status(row))),
    h('td', { class: 'kg-table-actions' }, controls),
  ]);
}

export function renderKnowledgeGovernance(ctx, { focusItemId = null } = {}) {
  const main = ctx.main;
  let records = { knowledge: [], playbooks: [], sources: [], libraryKnowledge: [] };
  let typeFilter = 'all'; let statusFilter = 'all'; let domainFilter = []; let categoryFilterOpen = false;
  let keyword = ''; let fullText = false; let sortField = 'updated_at'; let sortDir = 'desc'; let page = 1;
  const refresh = async () => {
    const [governance, library] = await Promise.all([data.knowledgeGovernance(ctx), data.knowledgeLibrary(ctx, 'list')]);
    records = { ...governance, sources: library.sources || [], libraryKnowledge: library.knowledge || [] };
    const byId = new Map((records.knowledge || []).map(row => [String(row.id), row]));
    records.libraryKnowledge.forEach(row => {
      const prior = byId.get(String(row.id)) || {};
      byId.set(String(row.id), { ...row, ...prior, metadata:{...(row.metadata||{}),...(prior.metadata||{})} });
    });
    records.knowledge = [...byId.values()];
    draw();
    if (focusItemId) requestAnimationFrame(() => document.getElementById('kg-focused-item')?.scrollIntoView({ behavior: 'smooth', block: 'center' })); };
  const sourceStatus = h('p', { class: 'foot-note', role: 'status' });
  const sourceForm = h('form', { class: 'kg-form', onsubmit: async event => {
    event.preventDefault();
    const form = event.currentTarget, fd = new FormData(form), file = fd.get('file');
    if (!(file instanceof File) || !file.size) { sourceStatus.textContent = text('source_file_required'); return; }
    if (file.size > 3 * 1024 * 1024) { sourceStatus.textContent = text('source_file_too_large'); return; }
    const reader = new FileReader();
    reader.onerror = () => { sourceStatus.textContent = text('source_upload_failed'); };
    reader.onload = async () => {
      sourceStatus.textContent = text('source_extracting');
      const values = Object.fromEntries([...fd.entries()].filter(([key]) => key !== 'file'));
      try {
        const response = await data.knowledgeLibrary(ctx, 'upload', { data: { ...values, fileName: file.name,
          contentType: file.type || 'application/octet-stream', fileBase64: String(reader.result).split(',')[1],
          sharingAuthorized: fd.get('sharingAuthorized') === 'on', anonymized: fd.get('anonymized') === 'on' } });
        sourceStatus.textContent = response.ok ? (response.duplicate ? text('source_duplicate') : text('source_draft_created'))
          : text('source_upload_failed');
        if (response.ok) { form.reset(); await refresh(); }
      } catch (_) { sourceStatus.textContent = text('source_upload_failed'); }
    };
    reader.readAsDataURL(file);
  } }, [
    h('h2', {}, text('source_upload_title')),
    label('source_domain', h('select', { name: 'domain', required: true }, [
      ...['product','company','service','recruitment','industry','campaign','health_wealth_seminar','top_performer_sharing','legal_tax','case','playbook']
        .map(value => h('option', { value }, text(`domain_${value}`))),
    ])),
    label('source_title', h('input', { name: 'title', maxlength: 500, required: true })),
    label('source_publisher', h('input', { name: 'publisher', maxlength: 500 })),
    label('source_jurisdiction', h('input', { name: 'jurisdiction', maxlength: 160, placeholder: text('source_jurisdiction_hint') })),
    label('source_uri', h('input', { name: 'sourceUri', type: 'url', maxlength: 2000, placeholder: text('source_uri_hint') })),
    label('source_published_at', h('input', { name: 'publishedAt', type: 'date' })),
    label('source_valid_from', h('input', { name: 'validFrom', type: 'date' })),
    label('source_valid_to', h('input', { name: 'validTo', type: 'date' })),
    label('source_review_at', h('input', { name: 'reviewAt', type: 'date' })),
    label('source_file', h('input', { name: 'file', type: 'file', required: true, accept: '.pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain' })),
    label('source_sharing_authorized', h('input', { name: 'sharingAuthorized', type: 'checkbox' })),
    label('source_anonymized', h('input', { name: 'anonymized', type: 'checkbox' })),
    h('p', { class: 'foot-note' }, text('source_upload_help')),
    h('button', { class: 'btn btn-primary', type: 'submit' }, text('source_upload')),
    sourceStatus,
  ]);
  const sourceDetails = h('details', { class:'kg-source-details' }, [
    h('summary', {}, text('source_upload_title')), sourceForm,
  ]);
  const editorStatus = h('p', { class: 'foot-note', role: 'status' });
  const form = h('form', { class: 'kg-form kg-editor-form', onsubmit: async event => {
    event.preventDefault();
    const currentForm = event.currentTarget, values = Object.fromEntries(new FormData(currentForm).entries());
    try {
      const response = await data.knowledgeLibrary(ctx, 'save', { data: { ...values,
        confidence: values.confidence === '' ? 0.8 : Number(values.confidence),
        sharingAuthorized:currentForm.elements.sharingAuthorized.checked,
        anonymized:currentForm.elements.anonymized.checked } });
      if (!response?.ok) throw new Error(response?.error?.message || 'save failed');
      editorStatus.textContent = response.revision ? text('revision_created') : text('saved_draft');
      currentForm.reset(); currentForm.elements.id.value = ''; currentForm.elements.expectedUpdatedAt.value = '';
      editorDetails.open = false; await refresh();
    } catch (error) { editorStatus.textContent = error.message || text('save_failed'); }
  } }, [
    h('h2', {}, text('new_title')),
    label('source_domain', h('select', { name: 'domain', required: true }, [
      ...['product','company','service','recruitment','industry','campaign','health_wealth_seminar','top_performer_sharing','legal_tax','case','playbook']
        .map(value => h('option', { value }, text(`domain_${value}`))),
    ])),
    label('title', h('input', { name: 'title', maxlength: '500', required: true })),
    label('summary', h('textarea', { name: 'summary', rows: 2, maxlength: 1200, placeholder: text('summary_ai_hint') })),
    label('content', h('textarea', { name: 'content', rows: 5, maxlength: 8000, required: true })),
    label('source_jurisdiction', h('input', { name: 'jurisdiction', maxlength: 160, placeholder: text('source_jurisdiction_hint') })),
    label('source_uri', h('input', { name: 'sourceUri', type: 'url', maxlength: 2000, placeholder: text('source_uri_hint') })),
    label('source_date', h('input', { name: 'sourceDate', type: 'date' })),
    label('valid_from', h('input', { name: 'validFrom', type: 'date' })),
    label('valid_to', h('input', { name: 'validTo', type: 'date' })),
    label('confidence', h('input', { name: 'confidence', type: 'number', min: '0', max: '1', step: '0.01', value: '0.8' })),
    label('source_sharing_authorized', h('input', { name: 'sharingAuthorized', type: 'checkbox' })),
    label('source_anonymized', h('input', { name: 'anonymized', type: 'checkbox' })),
    h('input', { type: 'hidden', name: 'id', value: '' }),
    h('input', { type: 'hidden', name: 'expectedUpdatedAt', value: '' }),
    h('button', { class: 'btn btn-primary', type: 'submit' }, text('save_draft')),
    editorStatus,
  ]);
  const editorDetails = h('details', { class: 'kg-editor-details' }, [
    h('summary', {}, text('new_title')), form,
  ]);
  const referencePreview = h('div', { class: 'kg-reference-preview', 'aria-live': 'polite' });
  const updateReferencePreview = () => {
    referencePreview.replaceChildren(...['evidence', 'case', 'story'].map(type => {
      const raw = playbookForm.elements[`${type}_refs`]?.value || '';
      const ids = raw.split(',').map(value => value.trim()).filter(Boolean).slice(0, 20);
      const shown = ids.map(id => {
        const item = records.knowledge.find(entry => String(entry.id) === id);
        return item ? `#${id} · ${item.source || item.content?.slice(0, 80) || ''}` : `#${id} · ${text(`${type}_missing`)}`;
      });
      return h('p', {}, [text(`${type}_refs`), ': ', shown.length ? shown.join(' · ') : '—']);
    }));
  };
  const playbookForm = h('form', { class: 'kg-form kg-playbook-form', onsubmit: async event => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    await data.saveKnowledgeGovernance(ctx, { table: 'playbooks', ...Object.fromEntries(fd.entries()) });
    event.currentTarget.reset();
    await refresh();
  } }, [
    h('h2', {}, text('new_playbook')),
    label('scenario', input('scenario')),
    label('objection', input('objection')),
    label('response_logic', h('textarea', { name: 'response_logic', rows: 4, maxlength: 4000, required: true })),
    label('evidence_refs', h('input', { name: 'evidence_refs', maxlength: '500', oninput: updateReferencePreview })),
    label('case_refs', h('input', { name: 'case_refs', maxlength: '500', oninput: updateReferencePreview })),
    label('story_refs', h('input', { name: 'story_refs', maxlength: '500', oninput: updateReferencePreview })),
    referencePreview,
    label('source', h('input', { name: 'source', maxlength: '500', required: true })),
    label('valid_from', input('valid_from', 'date')),
    label('valid_to', input('valid_to', 'date')),
    label('confidence', h('input', { name: 'confidence', type: 'number', min: '0', max: '1', step: '0.01', value: '0.8', required: true })),
    h('button', { class: 'btn btn-primary', type: 'submit' }, text('save_draft')),
  ]);
  const playbookDetails = h('details', { class:'kg-playbook-details' }, [
    h('summary', {}, text('new_playbook')), playbookForm,
  ]);
  const searchInput = h('input', { type:'search', maxlength:'160', placeholder:text('search_title_hint'),
    'aria-label':text('search_title_hint'), value:keyword });
  const fullTextInput = h('input', { type:'checkbox', checked:fullText });
  const draw = () => {
    const allRows = [
      ...records.knowledge.map(row => ({ table:'knowledge_items', row, domain:rowDomain(row) })),
      ...records.playbooks.map(row => ({ table:'playbooks', row, domain:'playbook' })),
    ];
    const query = keyword.trim().toLocaleLowerCase();
    const filtered = allRows.filter(({row,domain,table}) => {
      const state = row.lifecycle_status || (row.verified ? 'verified' : 'draft');
      if (domainFilter.length && !domainFilter.includes(domain)) return false;
      if (typeFilter !== 'all' && (table === 'playbooks' ? typeFilter !== 'playbook' : row.item_type !== typeFilter)) return false;
      if (statusFilter !== 'all' && state !== statusFilter) return false;
      if (query) {
        const title = table === 'playbooks' ? `${row.scenario} ${row.objection}` : row.source || '';
        const haystack = fullText ? `${title} ${row.metadata?.summary || ''}` : title;
        if (!haystack.toLocaleLowerCase().includes(query)) return false;
      }
      return true;
    });
    const valueFor = ({row,domain,table}) => {
      if (sortField === 'title') return table === 'playbooks' ? row.scenario : row.source;
      if (sortField === 'domain') return domain;
      if (sortField === 'summary') return table === 'playbooks' ? row.response_logic : row.metadata?.summary || row.content;
      if (sortField === 'status') return row.lifecycle_status || (row.verified ? 'verified' : 'draft');
      return row[sortField] || '';
    };
    filtered.sort((a,b) => {
      const av = valueFor(a), bv = valueFor(b);
      const cmp = String(av).localeCompare(String(bv), undefined, {numeric:true, sensitivity:'base'});
      return sortDir === 'asc' ? cmp : -cmp;
    });
    const pageSize = 20, totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    page = Math.min(page, totalPages);
    const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
    const sourceItemIds = new Set(records.knowledge.filter(row => row.source_id).map(row => String(row.source_id)));
    const pendingSources = (records.sources || []).filter(source => !sourceItemIds.has(String(source.id)));
    const sortHeader = (key,labelText) => h('th', { class:'kg-sortable', onclick:() => {
      sortDir = sortField === key && sortDir === 'asc' ? 'desc' : 'asc'; sortField = key; draw();
    } }, `${labelText}${sortField === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}`);
    const domainChoices = ['product','company','service','recruitment','industry','campaign','health_wealth_seminar',
      'top_performer_sharing','legal_tax','case','playbook'];
    const table = h('div', { class:'kg-table-wrap' }, h('table', { class:'kg-table' }, [
      h('thead', {}, h('tr', {}, [sortHeader('title',text('title_column')),sortHeader('domain',text('category')),
        sortHeader('summary',text('summary')),sortHeader('source_date',text('source_date')),
        sortHeader('valid_to',text('valid_to')),sortHeader('status',text('status')),h('th',{},text('actions'))])),
      h('tbody', {}, pageRows.length ? pageRows.map(({row,table:rowTable}) => renderRow(ctx,rowTable,row,refresh,item => {
        editorDetails.open = true;
        form.elements.id.value = String(item.id);
        form.elements.expectedUpdatedAt.value = item.updated_at || '';
        form.elements.domain.value = rowDomain(item);
        form.elements.title.value = item.source || '';
        form.elements.summary.value = item.metadata?.summary || '';
        form.elements.content.value = item.content || '';
        form.elements.jurisdiction.value = item.metadata?.jurisdiction || '';
        form.elements.sourceUri.value = item.metadata?.source_uri || '';
        form.elements.sourceDate.value = item.source_date || '';
        form.elements.validFrom.value = item.valid_from || '';
        form.elements.validTo.value = item.valid_to || '';
        form.elements.confidence.value = String(item.confidence ?? 0.8);
        form.elements.sharingAuthorized.checked = item.metadata?.sharing_authorized === true;
        form.elements.anonymized.checked = item.metadata?.anonymized === true;
        editorStatus.textContent = item.lifecycle_status === 'verified' ? text('revision_hint') : '';
        editorDetails.scrollIntoView({behavior:'smooth',block:'start'});
      }, records.sources.find(source=>String(source.id)===String(row.source_id)))) : [
        h('tr',{},h('td',{colspan:'7',class:'kg-empty-cell'},text('no_results'))),
      ]),
    ]));
    const searchForm = h('form', { class:'kg-search', onsubmit:event => {
      event.preventDefault(); keyword = searchInput.value; fullText = fullTextInput.checked; page = 1; draw();
    } }, [searchInput, h('label',{class:'kg-full-search'},[fullTextInput,text('full_search')]), h('button',{class:'btn btn-primary',type:'submit'},text('search'))]);
    const filters = h('div', { class:'kg-filters' }, [
      h('label',{class:'kg-field'},[h('span',{},text('filter_type')),h('select',{'aria-label':text('filter_type'),onchange:event=>{typeFilter=event.target.value;page=1;draw();}},
        [['all','filter_all'],['evidence','evidence'],['case','case'],['story','story'],['playbook','playbook']].map(([value,key])=>h('option',{value,selected:typeFilter===value},text(key))))]),
      h('label',{class:'kg-field'},[h('span',{},text('filter_status')),h('select',{'aria-label':text('filter_status'),onchange:event=>{statusFilter=event.target.value;page=1;draw();}},
        [['all','filter_all'],['draft','status_draft'],['verified','status_verified'],['superseded','status_superseded'],['invalidated','status_invalidated']].map(([value,key])=>h('option',{value,selected:statusFilter===value},text(key))))]),
      h('details',{class:'kg-category-filter',open:categoryFilterOpen},[h('summary',{},text('filter_category')),
        h('div',{class:'kg-category-options'},domainChoices.map(domain=>h('label',{},[
          h('input',{type:'checkbox',value:domain,checked:domainFilter.includes(domain),onchange:event=>{
            categoryFilterOpen=event.currentTarget.closest('details').open;
            domainFilter=event.target.checked?[...domainFilter,domain]:domainFilter.filter(value=>value!==domain);page=1;draw();
          }}),text(`domain_${domain}`)])))]),
    ]);
    const toolbar = h('div',{class:'kg-list-tools'},[
      searchForm,filters,
      h('div',{class:'kg-list-buttons'},[
        h('button',{class:'btn btn-primary',type:'button',onclick:()=>{
          form.reset();form.elements.id.value='';form.elements.expectedUpdatedAt.value='';editorStatus.textContent='';
          editorDetails.open=true;editorDetails.scrollIntoView({behavior:'smooth',block:'start'});
        }},text('new_title')),
        h('button',{class:'btn btn-ghost',type:'button',onclick:async()=>{if(!window.confirm(text('confirm_fixtures')))return;await data.createKnowledgeFixtures(ctx);await refresh();}},text('fixtures')),
        h('button',{class:'btn btn-ghost',type:'button',onclick:refresh},text('refresh')),
      ]),
      h('div',{class:'kg-pager'},[
        h('span',{},text('result_count').replace('{count}',String(filtered.length))),
        h('button',{class:'btn btn-ghost btn-sm',type:'button',disabled:page<=1,onclick:()=>{page--;draw();}},text('previous')),
        h('span',{},`${page} / ${totalPages}`),
        h('button',{class:'btn btn-ghost btn-sm',type:'button',disabled:page>=totalPages,onclick:()=>{page++;draw();}},text('next')),
      ]),
    ]);
    const extraSources = pendingSources.length ? h('details',{class:'kg-pending-sources'},[
      h('summary',{},`${text('pending_sources')} (${pendingSources.length})`),
      ...pendingSources.map(source=>h('article',{class:'kg-pending-source'},[
        h('b',{},`${text(`domain_${source.domain}`)} · ${source.title}`),
        h('small',{},`${text('source_file')}: ${source.fileName||'—'} · ${text('source_extraction')}: ${text(`extraction_${source.extractionStatus}`)}`),
        source.extractionStatus==='failed'?h('button',{class:'btn btn-ghost btn-sm',type:'button',onclick:async()=>{await data.knowledgeLibrary(ctx,'retry',{sourceId:source.id});await refresh();}},text('source_retry')):null,
      ])),
    ]) : null;
    main.replaceChildren(pageHead({ kicker:text('kicker'),title:text('title'),sub:text('description'),
      actions:[h('button',{class:'btn btn-ghost',type:'button',onclick:()=>{sourceDetails.open=!sourceDetails.open;}},text('source_upload_title'))] }),
      h('p',{class:'foot-note'},text('validity_scope')),
      sourceDetails, editorDetails, playbookDetails,
      h('section',{class:'kg-list kg-library-list'},[
        h('div',{class:'kg-toolbar'},[h('h2',{},text('items')),h('span',{class:'foot-note'},text('loaded_scope'))]),
        toolbar,table,extraSources,
      ]));
  };
  draw();
  refresh().catch(error => main.append(h('p', { class: 'form-error' }, error.message || text('load_failed'))));
}
