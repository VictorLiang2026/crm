import { h } from './dom.js';
import { pageHead, card } from './ui.js';
import { t } from './i18n.js';
import { data } from './data.js';

const text = (key) => t(`kg_${key}`);
const label = (name, control) => h('label', { class: 'kg-field' }, [h('span', {}, text(name)), control]);
const input = (name, type = 'text', value = '') => h('input', { name, type, value, maxlength: name === 'content' ? 8000 : 500 });
const select = () => h('select', { name: 'item_type' }, [
  h('option', { value: 'evidence' }, text('evidence')),
  h('option', { value: 'case' }, text('case')),
  h('option', { value: 'story' }, text('story')),
]);

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
function renderRow(ctx, table, row, reload, onRevision, resolveRef, focusItemId) {
  const content = table === 'playbooks' ? `${row.scenario} · ${row.objection}\n${row.response_logic}` : row.content;
  const validity = knowledgeValidity(row);
  const controls = [];
  if (!row.source_id && (row.lifecycle_status === 'draft' || (!row.lifecycle_status && !row.verified))) {
    controls.push(h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
      if (!window.confirm(text('confirm_verify'))) return;
      await data.reviewKnowledgeGovernance(ctx, { table, id: row.id, action: 'verify', expectedUpdatedAt: row.updated_at });
      await reload();
    } }, text('verify')));
  }
  if (!row.source_id && row.lifecycle_status === 'verified') {
    if (table === 'knowledge_items') controls.push(h('button', { class: 'btn btn-ghost', type: 'button',
      onclick: () => onRevision(row) }, text('revise')));
    controls.push(h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => {
      if (!window.confirm(text('confirm_invalidate'))) return;
      await data.reviewKnowledgeGovernance(ctx, { table, id: row.id, action: 'invalidate', expectedUpdatedAt: row.updated_at });
      await reload();
    } }, text('invalidate')));
  }
  return h('article', { class: 'kg-row', 'data-kg-id': String(row.id), ...(String(row.id) === String(focusItemId || '') ? { id: 'kg-focused-item' } : {}) }, [
    h('div', { class: 'kg-row-head' }, [h('b', {}, table === 'playbooks' ? text('playbook') : text(row.item_type || 'evidence')),
      h('span', { class: `kg-status kg-${row.lifecycle_status || (row.verified ? 'verified' : 'draft')}` }, status(row))]),
    h('p', { class: 'kg-copy' }, content || ''),
    h('p', {class:'foot-note'}, text(table === 'playbooks' ? 'playbook_boundary' : `kind_${row.item_type || 'evidence'}_note`)),
    h('small', {}, `${text('source')}: ${row.source || text('source_unspecified')}`),
    h('small', {}, `${text('source_date')}: ${row.source_date || '—'} · ${text('version')}: ${row.version_no || 1} · ${text('confidence')}: ${row.confidence == null ? '—' : Number(row.confidence).toFixed(2)}`),
    h('small', {'data-kg-validity':validity}, `${text('date_validity')}: ${text(`validity_${validity}`)}`),
    h('small', {}, `${text('valid_from')}: ${row.valid_from || '—'} · ${text('valid_to')}: ${row.valid_to || '—'}`),
    ...(table === 'playbooks' && Array.isArray(row.possible_underlying_reasons) && row.possible_underlying_reasons.some(value=>typeof value==='string') ? [
      h('details', {}, [h('summary', {}, text('possible_reasons')),
        h('ul', {}, row.possible_underlying_reasons.filter(value=>typeof value==='string').map(value=>h('li',{},value)))])
    ] : []),
    ...(table === 'playbooks' ? ['evidence_refs', 'case_refs', 'story_refs'].map(kind => {
      const type = kind.replace('_refs', '');
      const entries = (Array.isArray(row[kind]) ? row[kind] : []).map(id => resolveRef(type, id));
      return h('small', { class: 'kg-reference' }, [text(kind), ': ', entries.length ? entries.join(' · ') : '—']);
    }) : []),
    controls.length ? h('div', { class: 'kg-actions' }, controls) : null,
  ]);
}

export function renderKnowledgeGovernance(ctx, { focusItemId = null } = {}) {
  const main = ctx.main;
  let records = { knowledge: [], playbooks: [], sources: [], libraryKnowledge: [] };
  let typeFilter = 'all'; let statusFilter = 'all';
  const refresh = async () => {
    const [governance, library] = await Promise.all([data.knowledgeGovernance(ctx), data.knowledgeLibrary(ctx, 'list')]);
    records = { ...governance, sources: library.sources || [], libraryKnowledge: library.knowledge || [] };
    const byId = new Map((records.knowledge || []).map(row => [String(row.id), row]));
    records.libraryKnowledge.forEach(row => byId.set(String(row.id), row));
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
  const form = h('form', { class: 'kg-form', onsubmit: async event => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    await data.saveKnowledgeGovernance(ctx, Object.fromEntries(fd.entries()));
    event.currentTarget.reset();
    await refresh();
  } }, [
    h('h2', {}, text('new_title')),
    label('kind', select()),
    label('source', h('input', { name: 'source', maxlength: '500', required: true })),
    label('source_date', input('source_date', 'date')),
    label('valid_from', input('valid_from', 'date')),
    label('valid_to', input('valid_to', 'date')),
    label('confidence', h('input', { name: 'confidence', type: 'number', min: '0', max: '1', step: '0.01', value: '0.8', required: true })),
    label('content', h('textarea', { name: 'content', rows: 5, maxlength: 8000, required: true })),
    label('person_id', input('personId', 'number')),
    h('input', { type: 'hidden', name: 'supersedesId', value: '' }),
    h('button', { class: 'btn btn-primary', type: 'submit' }, text('save_draft')),
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
  const draw = () => {
    const visibleKnowledge = records.knowledge.filter(row => (typeFilter === 'all' || typeFilter === 'playbook' || row.item_type === typeFilter) &&
      (statusFilter === 'all' || (row.lifecycle_status || (row.verified ? 'verified' : 'draft')) === statusFilter));
    const visiblePlaybooks = records.playbooks.filter(row => (typeFilter === 'all' || typeFilter === 'playbook') &&
      (statusFilter === 'all' || row.lifecycle_status === statusFilter));
    main.replaceChildren(pageHead({ kicker: text('kicker'), title: text('title'), sub: text('description') }),
      h('p', {class:'foot-note'}, text('validity_scope')),
      h('div', { class: 'kg-layout' }, [
        card({ body: [sourceForm, h('hr'), form, playbookForm] }),
        h('section', { class: 'kg-list' }, [
          h('p', {class:'foot-note'}, text('loaded_scope')),
          h('div', { class: 'kg-toolbar' }, [h('h2', {}, text('items')),
            h('div', { class: 'kg-actions' }, [
              h('select', { 'aria-label': text('filter_type'), onchange: event => { typeFilter = event.target.value; draw(); } }, [
                ...[['all','filter_all'],['evidence','evidence'],['case','case'],['story','story'],['playbook','playbook']].map(([value,key]) => h('option', { value, selected: typeFilter === value }, text(key))),
              ]),
              h('select', { 'aria-label': text('filter_status'), onchange: event => { statusFilter = event.target.value; draw(); } }, [
                ...[['all','filter_all'],['draft','status_draft'],['verified','status_verified'],['superseded','status_superseded'],['invalidated','status_invalidated']].map(([value,key]) => h('option', { value, selected: statusFilter === value }, text(key))),
              ]),
              h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => {
                if (!window.confirm(text('confirm_fixtures'))) return;
                await data.createKnowledgeFixtures(ctx);
                await refresh();
              } }, text('fixtures')),
              h('button', { class: 'btn btn-ghost', type: 'button', onclick: refresh }, text('refresh')),
            ])]),
          ...visibleKnowledge.map(row => renderRow(ctx, 'knowledge_items', row, refresh, row => {
            form.elements.supersedesId.value = String(row.id);
            form.elements.item_type.value = row.item_type || 'evidence';
            form.elements.source.value = row.source || '';
            form.elements.source_date.value = row.source_date || '';
            form.elements.confidence.value = String(row.confidence ?? 0.8);
            form.elements.content.value = row.content || '';
            form.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, (_type, id) => String(id), focusItemId)),
          ...(records.sources || []).map(source => {
            const item = records.libraryKnowledge.find(row => String(row.source_id) === String(source.id));
            return h('article', { class: 'kg-row' }, [
              h('div', { class: 'kg-row-head' }, [h('b', {}, `${text(`domain_${source.domain}`)} · ${source.title}`),
                h('span', { class: `kg-status kg-${source.lifecycleStatus}` }, text(`status_${source.lifecycleStatus}`))]),
              h('small', {}, `${text('source_file')}: ${source.fileName || '—'} · ${text('source_extraction')}: ${text(`extraction_${source.extractionStatus}`)}`),
              source.jurisdiction ? h('small', {}, `${text('source_jurisdiction')}: ${source.jurisdiction}`) : null,
              item ? h('p', { class: 'kg-copy' }, item.content || '') : null,
              h('div', { class: 'kg-actions' }, [
                source.extractionStatus === 'failed' ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => {
                  await data.knowledgeLibrary(ctx, 'retry', { sourceId: source.id }); await refresh();
                } }, text('source_retry')) : null,
                source.lifecycleStatus === 'draft' && item ? h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
                  if (!window.confirm(text('source_confirm_verify'))) return;
                  await data.knowledgeLibrary(ctx, 'review', { data: { sourceId: source.id, itemId: item.id,
                    decision: 'verify', expectedUpdatedAt: source.updatedAt } }); await refresh();
                } }, text('verify')) : null,
                source.lifecycleStatus === 'verified' && item ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => {
                  if (!window.confirm(text('confirm_invalidate'))) return;
                  await data.knowledgeLibrary(ctx, 'review', { data: { sourceId: source.id, itemId: item.id, decision: 'invalidate' } }); await refresh();
                } }, text('invalidate')) : null,
              ]),
            ]);
          }),
          ...visiblePlaybooks.map(row => renderRow(ctx, 'playbooks', row, refresh, null, (type, id) => {
            const item = records.knowledge.find(entry => String(entry.id) === String(id));
            return item ? `#${id} · ${item.source || item.content?.slice(0, 80) || ''}` : `#${id} · ${text(`${type}_missing`)}`;
          }, focusItemId)),
        ]),
      ]));
  };
  draw();
  refresh().catch(error => main.append(h('p', { class: 'form-error' }, error.message || text('load_failed'))));
}
