import { h } from './dom.js';
import { ic } from './icons.js';
import { data } from './data.js';
import { pageHead, emptyNote } from './ui.js';
import { getLang, t } from './i18n.js';
import { PERSON_EXPORT_COLUMNS, mapMappedValues, mergeContinuationRows, readRosterFile, toCsv, toXlsx } from './person-list-transfer-file.js';

const IMPORT_FIELDS = PERSON_EXPORT_COLUMNS.filter(field => !field.fixed).map(field => field.key);
const NAME_ALIASES = new Set(['姓名','姓名或称呼','名字','人物姓名','客户姓名','name','display_name','person name','full name']);
const PERSON_ID_ALIASES = new Set(['personid','person id','person_id']);
const ALIASES = Object.freeze({
  phone: ['电话','手机','手机号','联系电话','phone','mobile'],
  wechat: ['微信','微信号','wechat','wechat id'], gender: ['性别','gender'], birthday: ['生日','出生日期','birthday'],
  occupation: ['职业','职位','occupation','job','title'], organization: ['机构','单位','公司','组织','organization','company','institution'],
  education: ['教育','学历','education'], source: ['来源','介绍来源','source'], hobbies: ['兴趣','爱好','hobbies','interests'],
  customer_stage: ['客户阶段','customer_stage','customer stage'], sales_priority: ['销售优先级','sales_priority','sales priority'],
  referral_priority: ['转介绍优先级','referral_priority','referral priority'], marital_status: ['婚姻状况','婚姻','marital_status','marital status'],
  first_contact_date: ['首次联系日期','初次联系日期','first_contact_date','first contact date'],
  notes: ['备注','说明','基本信息','故事经历','学生案例','教育观点','notes','note'],
});
const SKIP = '__skip__';
const errorMessage = error => {
  const code = error?.code || String(error?.message || '').split(':')[0];
  const key = ({ FILE_SIZE_LIMIT:'plt_load_failed', FILE_ROW_LIMIT:'plt_load_failed', FILE_COLUMN_LIMIT:'plt_load_failed',
    FILE_TYPE_UNSUPPORTED:'plt_load_failed', FILE_DUPLICATE_HEADER:'plt_load_failed', NAME_REQUIRED:'plt_name_required',
    IMPORT_PREVIEW_TOO_LARGE:'plt_preview_too_large', PREVIEW_EXPIRED:'plt_preview_expired', CONFIRMATION_REQUIRED:'plt_decision_required',
    IMPORT_HAS_BLOCKED_ROWS:'plt_blocked_source_help', IDENTITY_DECISION_REQUIRED:'plt_decision_required',
    INVALID_IMPORT_ROW_NUMBER:'plt_load_failed', DUPLICATE_FIELD_MAPPING:'plt_duplicate_mapping',
    QUALIFIER_CONFLICT:'plt_qualifier_conflict', QUALIFIER_REQUIRED:'plt_qualifier_conflict',
    EXISTING_QUALIFIER_REQUIRED:'plt_qualifier_conflict', PERSON_NOT_IN_PREVIEW:'plt_preview_expired',
    INVALID_FIELD_POLICY:'plt_import_failed', PREVIEW_STALE:'plt_preview_expired' })[code];
  return t(key || 'plt_load_failed');
};
const newUuid = () => globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
  const value = Math.random() * 16 | 0; return (char === 'x' ? value : (value & 3 | 8)).toString(16);
});
const normalizedHeader = value => String(value || '').trim().toLocaleLowerCase();

function localHeaderField(header) {
  const key = normalizedHeader(header);
  if (NAME_ALIASES.has(key)) return 'display_name';
  if (PERSON_ID_ALIASES.has(key)) return 'PersonID';
  for (const [field, aliases] of Object.entries(ALIASES)) if (aliases.includes(key)) return field;
  return null;
}

function translateField(key) {
  const definition = PERSON_EXPORT_COLUMNS.find(field => field.key === key);
  return definition ? t(definition.labelKey) : key;
}

function fieldOptions(selected) {
  return [h('option', { value: SKIP }, t('plt_skip_column')),
    ...(selected === 'PersonID' || selected === 'display_name' ? [] : []),
    h('option', { value: 'display_name' }, `display_name · ${translateField('display_name')}`),
    h('option', { value: 'PersonID' }, 'PersonID'),
    ...IMPORT_FIELDS.map(field => h('option', { value: field }, `${field} · ${translateField(field)}`)),
  ];
}

function findCandidate(row, personId) {
  return row.candidates.find(candidate => String(candidate.id) === String(personId));
}

function conflictRows(preview, decisions, fieldPolicy) {
  const results = [];
  for (const row of preview?.rows || []) {
    const decision = decisions[String(row.rowNumber)];
    const candidate = decision?.kind === 'same' ? findCandidate(row, decision.personId) : null;
    if (!candidate) continue;
    for (const field of IMPORT_FIELDS) {
      const incoming = row.values[field];
      const current = candidate[field];
      if (incoming == null || String(incoming).trim() === '' || String(current ?? '').trim() === '' || String(current) === String(incoming)) continue;
      const override = fieldPolicy.fieldOverrides?.[field];
      const action = override || (fieldPolicy.mergeText && ['notes','hobbies'].includes(field) ? 'merge' : fieldPolicy.mode || 'keep');
      let next = action === 'import' ? String(incoming) : String(current);
      if (action === 'merge' && ['notes','hobbies'].includes(field)) {
        next = [...new Set([String(current),String(incoming)].flatMap(text => text.split('；')).map(text => text.trim()).filter(Boolean))].join('；');
      }
      results.push({ rowNumber: row.rowNumber, field, current: String(current), incoming: String(incoming), next });
    }
  }
  return results;
}

export function renderPersonListTransfer(ctx) {
  let tab = 'import';
  let fileData = null;
  let mappings = [];
  let aiConfidence = [];
  let mergeUnnamedRows = false;
  let continuationSummary = null;
  let preview = null;
  let previewId = '';
  let decisions = {};
  let draftDifferent = {};
  let policy = { mode: 'keep', mergeText: false, fieldOverrides: {} };
  let results = null;
  let selectedExportFields = new Set(['phone','wechat','gender','birthday','occupation','organization','education','source','hobbies','notes']);
  let exportFormat = 'csv';
  let statusMessage = '';
  let statusError = false;
  let busy = false;
  ctx.main.replaceChildren();

  function setStatus(message, error = false) {
    statusMessage = message || '';
    statusError = error;
    const node = ctx.main.querySelector('[data-plt-status]');
    if (!node) return;
    node.textContent = statusMessage;
    node.classList.toggle('is-error', statusError);
  }

  function render() {
    const importTab = h('button', { class: 'plt-tab' + (tab === 'import' ? ' is-active' : ''), type: 'button',
      'aria-pressed': String(tab === 'import'), onclick: () => { tab = 'import'; render(); } }, t('plt_tab_import'));
    const exportTab = h('button', { class: 'plt-tab' + (tab === 'export' ? ' is-active' : ''), type: 'button',
      'aria-pressed': String(tab === 'export'), onclick: () => { tab = 'export'; render(); } }, t('plt_tab_export'));
    const status = h('div', { class: 'plt-status' + (statusError ? ' is-error' : ''), 'data-plt-status': '', role: 'status', 'aria-live': 'polite' }, statusMessage);
    const page = [pageHead({ kicker: t('m17_tools'), title: t('plt_title'), sub: t('plt_subtitle') }),
      h('a', { class: 'btn btn-ghost plt-back', href: '#/more' }, [ic('grid'), t('plt_back_more')]),
      h('div', { class: 'plt-tabs', role: 'tablist' }, [importTab, exportTab]), status,
      tab === 'import' ? renderImport() : renderExport()];
    ctx.main.replaceChildren(...page);
  }

  function renderImport() {
    if (results) return renderResults();
    const fileInput = h('input', { class: 'plt-file-input', type: 'file', accept: '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'aria-label': t('plt_browse'), onchange: async event => {
        const file = event.target.files?.[0]; if (!file) return;
        setStatus('');
        try {
          busy = true; render();
          fileData = await readRosterFile(file);
          fileData.fileName = file.name;
          mappings = fileData.headers.map(localHeaderField);
          aiConfidence = mappings.map(field => field ? 100 : 0);
          mergeUnnamedRows = false; continuationSummary = null;
          preview = null; previewId = ''; decisions = {}; results = null;
          busy = false; render();
        } catch (error) { busy = false; fileData = null; render(); setStatus(errorMessage(error), true); }
      } });
    const drop = h('div', { class: 'plt-drop', ondragover: event => { event.preventDefault(); event.currentTarget.classList.add('is-dragging'); },
      ondragleave: event => event.currentTarget.classList.remove('is-dragging'), ondrop: event => {
        event.preventDefault(); event.currentTarget.classList.remove('is-dragging');
        const input = event.currentTarget.querySelector('input[type=file]');
        if (event.dataTransfer?.files?.length && input) { const transfer = new DataTransfer(); transfer.items.add(event.dataTransfer.files[0]); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); }
      } }, [ic('file'), h('div', { class: 'plt-drop-copy' }, [
      h('strong', {}, fileData?.fileName || t('plt_drop_title')),
      h('span', { class: 'foot-note' }, fileData ? `${fileData.rows.length} ${t('plt_rows')}` : t('plt_drop_help')),
    ]), h('label', { class: 'btn btn-ghost' }, [t('plt_browse'), fileInput])]);
    const body = [
      h('div', { class: 'plt-step-row' }, [h('span', { class: 'plt-step is-active' }, `1 · ${t('plt_step_upload')}`),
        h('span', { class: 'plt-step' + (preview ? ' is-active' : '') }, `2 · ${t('plt_step_review')}`)]),
      h('section', { class: 'card plt-section' }, [h('div', { class: 'plt-section-head' }, [
        h('div', {}, [h('h2', {}, t('plt_upload_title')), h('p', { class: 'foot-note' }, t('plt_upload_help'))]),
        h('button', { class: 'btn btn-soft', type: 'button', disabled: busy, onclick: async () => { try { await loadDemo(); } catch { setStatus(t('plt_load_failed'), true); } } }, t('plt_demo_file')),
      ]), drop, fileData ? renderMapping() : null,
      ]),
    ];
    if (preview) body.push(renderPreview());
    return h('div', { class: 'person-list-transfer' }, body);
  }

  async function loadDemo() {
    setStatus('');
    const matrix = [
      ['姓名','电话','机构','备注'],
      ['王芳（讲师）','13800000000','远山教育','课程交流'],
      ['陈晓（讲师）','13900000000','南城学院','行业分享'],
      ['陈晓（讲师）','13900000000','南城学院','行业分享'],
      ['刘雨（教授）','13700000000','东海大学','活动认识'],
    ];
    const { rowsFromMatrix } = await import('./person-list-transfer-file.js');
    fileData = { ...rowsFromMatrix(matrix), fileName: 'people-demo.csv' };
    mappings = fileData.headers.map(localHeaderField); aiConfidence = mappings.map(field => field ? 100 : 0);
    preview = null; previewId = ''; decisions = {}; results = null; render();
  }

  function renderMapping() {
    const mapBtn = h('button', { class: 'btn btn-soft', type: 'button', disabled: busy, onclick: runAiMapping }, [ic('sparkle'), t('plt_ai_map')]);
    const rows = fileData.headers.map((header, index) => {
      const sample = fileData.rows.slice(0, 3).map(row => row.values[header]).find(value => value) || '';
      const select = h('select', { class: 'plt-select', value: mappings[index] || SKIP,
        onchange: event => { mappings[index] = event.target.value; aiConfidence[index] = 100; render(); } }, fieldOptions(mappings[index]));
      select.value = mappings[index] || SKIP;
      const level = aiConfidence[index] >= 80 ? 'plt-confidence high' : aiConfidence[index] >= 50 ? 'plt-confidence medium' : 'plt-confidence low';
      const confidence = aiConfidence[index] ? `${aiConfidence[index]}%` : t('plt_not_mapped');
      return h('tr', {}, [h('td', {}, header), h('td', {}, select), h('td', { class: 'plt-sample-cell' }, sample),
        h('td', { class: level }, confidence)]);
    });
    const nameHeader = fileData.headers[mappings.findIndex(field => field === 'display_name')];
    const unnamedCount = nameHeader ? fileData.rows.filter(row => !String(row.values[nameHeader] || '').trim()).length : 0;
    return h('div', { class: 'plt-mapping' }, [h('div', { class: 'plt-section-head' }, [
      h('div', {}, [h('h2', {}, t('plt_mapping_title')), h('p', { class: 'foot-note' }, t('plt_mapping_help'))]), mapBtn,
    ]), h('div', { class: 'plt-table-scroll' }, h('table', { class: 'plt-table' }, [
      h('thead', {}, h('tr', {}, [h('th', {}, t('plt_column')), h('th', {}, t('plt_target_field')),
        h('th', {}, t('plt_sample')), h('th', {}, t('plt_confidence'))])), h('tbody', {}, rows),
    ])), h('p', { class: 'plt-inline-help' }, t('plt_notes_multi_mapping')),
    unnamedCount ? h('label', { class: 'plt-check plt-continuation-check' }, [h('input', { type: 'checkbox', checked: mergeUnnamedRows,
      onchange: event => { mergeUnnamedRows = event.target.checked; continuationSummary = null; } }),
      h('span', {}, t('plt_merge_unnamed_rows').replace('{count}', String(unnamedCount)))]) : null,
    h('p', { class: 'plt-privacy' }, [ic('lock'), t('plt_ai_privacy')]),
    h('div', { class: 'plt-actions align-end' }, h('button', { class: 'btn btn-primary', type: 'button', disabled: busy,
      onclick: analyze }, [ic(busy ? 'clock' : 'search'), busy ? t('plt_analyzing') : t('plt_analyze')]))]);
  }

  async function runAiMapping() {
    if (!fileData) return;
    setStatus('');
    busy = true; render();
    try {
      const response = await data.mapPersonListFields(ctx, fileData.headers, getLang() === 'en' ? 'en' : 'zh-CN');
      if (!response?.ok || !Array.isArray(response.mappings)) throw new Error(response?.error?.code || 'AI_MAPPING_FAILED');
      for (const mapping of response.mappings) {
        if (mappings[mapping.columnIndex] && mappings[mapping.columnIndex] !== SKIP) continue;
        mappings[mapping.columnIndex] = mapping.field || SKIP;
        aiConfidence[mapping.columnIndex] = mapping.confidence || 0;
      }
      setStatus(t('plt_ai_mapped'));
    } catch (_) { setStatus(t('plt_mapping_failed'), true); }
    finally { busy = false; render(); }
  }

  async function analyze() {
    if (!fileData) return;
    setStatus('');
    let nameColumns = mappings.filter(field => field === 'display_name').length;
    if (nameColumns !== 1) { setStatus(t('plt_name_required'), true); return; }
    try {
      setStatus(t('plt_analyzing'));
      busy = true; render();
      let sourceRows = fileData.rows;
      const nameHeader = fileData.headers[mappings.findIndex(field => field === 'display_name')];
      if (mergeUnnamedRows) {
        continuationSummary = mergeContinuationRows(fileData.rows, nameHeader);
        if (continuationSummary.unresolvedRowNumbers.length) {
          busy = false; render();
          setStatus(t('plt_leading_unnamed_rows').replace('{rows}', continuationSummary.unresolvedRowNumbers.join(', ')), true);
          return;
        }
        sourceRows = continuationSummary.rows;
      } else {
        const unnamedCount = fileData.rows.filter(row => !String(row.values[nameHeader] || '').trim()).length;
        if (unnamedCount) {
          busy = false; render(); setStatus(t('plt_unnamed_rows_need_action').replace('{count}', String(unnamedCount)), true); return;
        }
      }
      const rows = sourceRows.map(row => ({ rowNumber: row.rowNumber, values: mapMappedValues(row, fileData.headers, mappings, SKIP) }));
      const response = await data.previewPersonListTransfer(ctx, { rows, idempotencyKey: newUuid() });
      if (!response?.previewId || !Array.isArray(response?.preview?.rows)) throw new Error('IMPORT_PREVIEW_FAILED');
      preview = response.preview; previewId = response.previewId; decisions = {}; draftDifferent = {}; results = null;
      for (const row of preview?.rows || []) {
        if (row.personId && row.candidates.some(candidate => String(candidate.id) === String(row.personId))) {
          decisions[String(row.rowNumber)] = { kind: 'same', personId: String(row.personId) };
        }
      }
      setStatus(t('plt_analysis_ready'));
      busy = false; render();
      const target = preview.rows.some(row => ['needs_identity','blocked'].includes(row.status))
        ? ctx.main.querySelector('.plt-review-list, .plt-blocked-help')
        : ctx.main.querySelector('.plt-confirm-bar');
      target?.scrollIntoView({ behavior: 'auto', block: 'center' });
    } catch (error) { busy = false; render(); setStatus(errorMessage(error), true); }
  }

  function renderPreview() {
    const rows = preview?.rows || [];
    const unresolved = rows.filter(row => ['needs_identity'].includes(row.status) && !decisions[String(row.rowNumber)]);
    const plan = rows.reduce((result,row) => {
      if (row.status === 'new') { result.new += 1; return result; }
      if (row.status !== 'needs_identity') return result;
      const decision = decisions[String(row.rowNumber)];
      if (decision?.kind === 'different') { result.new += 1; result.rename += (decision.renameExisting || []).length; return result; }
      if (decision?.kind !== 'same') return result;
      const candidate = findCandidate(row, decision.personId);
      const changed = candidate && IMPORT_FIELDS.some(field => {
        const incoming = row.values[field];
        if (incoming == null || String(incoming).trim() === '') return false;
        const current = String(candidate[field] ?? '');
        if (current === '') return true;
        if ((policy.fieldOverrides[field] === 'import' || (!policy.fieldOverrides[field] && policy.mode === 'import')) && current !== String(incoming)) return true;
        if ((policy.fieldOverrides[field] === 'merge' || (!policy.fieldOverrides[field] && policy.mergeText)) && ['notes','hobbies'].includes(field)) {
          const merged = [...new Set([current,String(incoming)].flatMap(text=>text.split('；')).map(text=>text.trim()).filter(Boolean))].join('；');
          return merged !== current;
        }
        return false;
      });
      result[changed ? 'update' : 'unchanged'] += 1;
      return result;
    },{new:0,update:0,unchanged:0,rename:0});
    const readyCount = plan.new + plan.update + plan.unchanged;
    const stats = h('div', { class: 'plt-stats' }, [
      stat(plan.new, 'plt_new_count'), stat(plan.update, 'plt_update_count'),
      stat(plan.unchanged, 'plt_unchanged_count'), stat(plan.rename, 'plt_rename_count'),
      stat(preview?.counts?.duplicate || 0, 'plt_duplicate'), stat(unresolved.length, 'plt_review_count'),
      stat(preview?.counts?.blocked || 0, 'plt_blocked_count'),
    ]);
    const continuationNote = continuationSummary?.mergedInto?.length
      ? h('p', { class: 'plt-inline-help' }, t('plt_merged_rows_summary').replace('{rows}',
        continuationSummary.mergedInto.map(item => `${item.rowNumber}→${item.mergedIntoRowNumber}`).join('、'))) : null;
    const highMatches = rows.filter(row => row.status === 'needs_identity' && row.candidates.some(candidate => candidate.suggested));
    const accept = h('button', { class: 'btn btn-soft', type: 'button', disabled: !highMatches.length || busy,
      onclick: () => { for (const row of highMatches) {
        const candidate = row.candidates.find(item => item.suggested);
        if (candidate) decisions[String(row.rowNumber)] = { kind: 'same', personId: String(candidate.id) };
      } render(); } }, [ic('check'), t('plt_accept_high')]);
    const reviewCards = rows.filter(row => row.status === 'needs_identity' || row.status === 'blocked')
      .map(row => renderIdentityRow(row));
    const conflicts = conflictRows(preview, decisions, policy);
    const blockedRows = rows.filter(row => row.status === 'blocked');
    const blockedMeta = [t('plt_error_row'),t('plt_error_status'),t('plt_error_code')];
    const blockedCsvRows = blockedRows.map(row => ({
      ...(fileData?.rows.find(source => source.rowNumber === row.rowNumber)?.values || {}),
      [blockedMeta[0]]:row.rowNumber, [blockedMeta[1]]:t('plt_blocked_count'), [blockedMeta[2]]:row.reason || '',
    }));
    const footer = h('div', { class: 'plt-confirm-bar' }, [h('div', {}, [h('strong', {}, t('plt_final_summary')),
      h('p', { class: 'foot-note' }, `${plan.new} ${t('plt_new_count')} · ${plan.update} ${t('plt_update_count')} · ${plan.rename} ${t('plt_rename_count')} · ${plan.unchanged} ${t('plt_unchanged_count')} · ${unresolved.length} ${t('plt_review_count')}`)]),
      h('button', { class: 'btn btn-primary', type: 'button', disabled: busy || unresolved.length > 0 || (preview?.counts?.blocked || 0) > 0,
        onclick: () => executeImport(readyCount) }, [ic(busy ? 'clock' : 'check'), t('plt_confirm_count').replace('{count}', String(readyCount))])]);
    return h('section', { class: 'card plt-section plt-preview' }, [
      h('div', { class: 'plt-section-head' }, [h('div', {}, [h('h2', {}, t('plt_review_title')), h('p', { class: 'foot-note' }, t('plt_review_help'))]), accept]),
      continuationNote, stats,
      blockedRows.length ? h('div',{class:'plt-blocked-help'},[h('p',{class:'foot-note'},t('plt_blocked_source_help')),
        h('button',{class:'btn btn-ghost',type:'button',onclick:()=>downloadFile(toCsv([...(fileData?.headers||[]),...blockedMeta],blockedCsvRows),
          'people-import-blocked.csv','text/csv;charset=utf-8')},t('plt_download_errors'))]) : null,
      reviewCards.length ? h('div', { class: 'plt-review-list' }, reviewCards) : emptyNote(t('plt_no_identity_exceptions'), ''),
      renderPolicy(conflicts), footer,
    ]);
  }

  function stat(value, key) { return h('div', { class: 'plt-stat' }, [h('strong', {}, String(value)), h('span', {}, t(key))]); }

  function renderIdentityRow(row) {
    if (row.status === 'blocked') return h('article', { class: 'plt-identity is-blocked' }, [
      h('div', {}, [h('strong', {}, row.values.display_name), h('p', { class: 'foot-note' },
        t(row.reason === 'TOO_MANY_NAME_MATCHES' ? 'plt_too_many_matches' : 'plt_person_id_mismatch'))]),
      h('span', { class: 'plt-chip danger' }, t('plt_blocked_count')),
    ]);
    const rowDecision = decisions[String(row.rowNumber)];
    const draft = draftDifferent[String(row.rowNumber)] || {};
    const card = h('article', { class: 'plt-identity' }, [
      h('div', { class: 'plt-identity-head' }, [h('div', {}, [h('h3', {}, row.values.display_name),
        h('p', { class: 'foot-note' }, `${t('plt_base_name')} · ${row.baseName}`)]),
        row.candidates.some(candidate => candidate.suggested) ? h('span', { class: 'plt-chip suggested' }, t('plt_likely_same')) : null]),
    ]);
    for (const candidate of row.candidates) {
      const candidateBlock = h('div', { class: 'plt-candidate' }, [h('div', {}, [h('strong', {}, `Person #${candidate.id} · ${candidate.display_name}`),
        h('p', { class: 'foot-note' }, [candidate.organization || '', candidate.occupation || ''].filter(Boolean).join(' · ')),
        h('div', { class: 'plt-evidence' }, (candidate.evidence || []).map(key => t(({exact_name:'plt_evidence_name',exact_phone:'plt_evidence_phone',exact_wechat:'plt_evidence_wechat',same_organization:'plt_evidence_org'}[key] || 'plt_evidence_name'))).join(' · '))]),
        h('button', { class: 'btn ' + (rowDecision?.kind === 'same' && rowDecision.personId === String(candidate.id) ? 'btn-primary' : 'btn-soft'),
          type: 'button', onclick: () => { decisions[String(row.rowNumber)] = { kind:'same', personId:String(candidate.id) }; delete draftDifferent[String(row.rowNumber)]; render(); } }, t('plt_same_person'))]);
      card.append(candidateBlock);
    }
    const differentButton = h('button', { class: 'btn ' + (rowDecision?.kind === 'different' ? 'btn-primary' : 'btn-ghost'), type:'button',
      onclick: () => {
        const plain = row.candidates.filter(candidate => {
          try { return !candidate.display_name.match(/(?:（[^（）]*）|\([^()]*\))+$/); } catch { return false; }
        });
        const existing = {};
        for (const candidate of plain) existing[candidate.id] = `${row.baseName}（${t('plt_qualifier_default')}）`;
        draftDifferent[String(row.rowNumber)] = { displayName: row.values.display_name, renameExisting: existing };
        decisions[String(row.rowNumber)] = null; render();
      } }, t('plt_different_person'));
    card.append(h('div', { class: 'plt-different-choice' }, [differentButton,
      row.candidates.length > 1 ? h('span', { class: 'foot-note' }, t('plt_multiple_candidates_help')) : null]));
    if (draftDifferent[String(row.rowNumber)]) {
      const fields = [];
      for (const candidate of row.candidates.filter(item => Object.hasOwn(draft.renameExisting || {}, String(item.id)))) {
        fields.push(qualifierInput(t('plt_rename_existing'), draft.renameExisting[candidate.id], value => { draft.renameExisting[candidate.id] = value; }));
      }
      fields.push(qualifierInput(t('plt_incoming_name'), draft.displayName, value => { draft.displayName = value; }));
      card.append(h('div', { class: 'plt-qualifiers' }, fields), h('p', { class: 'plt-inline-help' }, t('plt_qualifier_help')),
        h('button', { class: 'btn btn-primary', type:'button', onclick: () => {
          const renameExisting = Object.entries(draft.renameExisting || {}).map(([personId, displayName]) => ({ personId, displayName }));
          decisions[String(row.rowNumber)] = { kind:'different', displayName:draft.displayName, renameExisting };
          render();
        } }, t('plt_apply_identity')));
    }
    return card;
  }

  function qualifierInput(labelText, value, onChange) {
    const input = h('input', { type:'text', value, maxlength:'160', oninput: event => onChange(event.target.value) });
    input.value = value || '';
    return h('label', { class:'plt-qualifier-field' }, [h('span', {}, labelText), input]);
  }

  function renderPolicy(conflicts) {
    const modeControl = h('div', { class:'plt-radio-row' }, [
      radio('plt-policy-mode','keep',policy.mode === 'keep',() => { policy.mode='keep'; render(); },'plt_policy_keep'),
      radio('plt-policy-mode','import',policy.mode === 'import',() => { policy.mode='import'; render(); },'plt_policy_import'),
    ]);
    const merge = h('label', { class:'plt-check' }, [h('input', { type:'checkbox', checked:policy.mergeText, onchange:event=>{policy.mergeText=event.target.checked;render();} }),
      h('span',{},t('plt_merge_text'))]);
    const overrides = [...new Set(conflicts.map(item => item.field))].map(field => {
      const select = h('select', { class:'plt-select plt-field-policy', value:policy.fieldOverrides[field] || 'batch',
        onchange:event=>{ if(event.target.value==='batch') delete policy.fieldOverrides[field]; else policy.fieldOverrides[field]=event.target.value; render(); } }, [
        h('option',{value:'batch'},t('plt_policy_follow_batch')),
        h('option',{value:'keep'},t('plt_policy_keep')),
        h('option',{value:'import'},t('plt_policy_import')),
        ...(['notes','hobbies'].includes(field)?[h('option',{value:'merge'},t('plt_merge_text'))]:[]),
      ]);
      select.value=policy.fieldOverrides[field]||'batch';
      return h('label',{class:'plt-field-policy-row'},[h('span',{},translateField(field)),select]);
    });
    const previewRows = conflicts.slice(0, 30).map(item => h('tr',{},[
      h('td',{},`#${item.rowNumber} · ${translateField(item.field)}`),h('td',{},item.current),h('td',{},item.incoming),h('td',{},item.next),
    ]));
    return h('section',{class:'plt-policy-section'},[
      h('div',{},[h('h3',{},t('plt_policy_title')),h('p',{class:'foot-note'},t('plt_policy_help'))]),modeControl,merge,
      overrides.length ? h('div',{class:'plt-field-policies'},overrides) : null,
      conflicts.length ? h('div',{class:'plt-table-scroll plt-conflicts'},h('table',{class:'plt-table'},[
        h('thead',{},h('tr',{},[h('th',{},t('plt_conflict')),h('th',{},t('plt_current_value')),h('th',{},t('plt_import_value')),h('th',{},t('plt_result_value'))])),
        h('tbody',{},previewRows)])) : null,
    ]);
  }

  function radio(name,value,checked,onChange,labelKey) {
    return h('label',{class:'plt-radio'},[h('input',{type:'radio',name,value,checked,onchange:onChange}),h('span',{},t(labelKey))]);
  }

  async function executeImport(readyCount) {
    setStatus('');
    try {
      busy = true; render();
      const decisionsList = Object.entries(decisions).filter(([,decision]) => decision).map(([rowNumber,decision]) => ({rowNumber:Number(rowNumber),decision}));
      const saved = await data.savePersonListTransferDecisions(ctx,{previewId,decisions:decisionsList,fieldPolicy:policy});
      if (!saved?.ok) throw new Error(saved?.error?.code || 'DECISIONS_SAVE_FAILED');
      results = await data.executePersonListTransfer(ctx,previewId);
      busy = false; render();
      if (results?.ok) setStatus(t('plt_import_complete')); else setStatus(t('plt_import_failed'),true);
    } catch (error) { busy = false; render(); setStatus(errorMessage(error), true); }
  }

  function renderResults() {
    const successful = results?.counts?.succeeded || 0;
    const failed = (results?.counts?.failed || 0) + (results?.counts?.blocked || 0);
    const rows = results?.rows || [];
    const failedRows = rows.filter(row => ['failed','needs_review','blocked'].includes(row.status));
    const errorMeta = [t('plt_error_row'),t('plt_error_status'),t('plt_error_code')];
    const csvColumns = [...(fileData?.headers || []), ...errorMeta];
    const csvRows = failedRows.map(result => ({
      ...(fileData?.rows.find(row => row.rowNumber === result.rowNumber)?.values || {}),
      [errorMeta[0]]:result.rowNumber,
      [errorMeta[1]]:t(result.status === 'blocked' ? 'plt_blocked_count' : result.status === 'needs_review' ? 'plt_review_count' : 'plt_failed'),
      [errorMeta[2]]:result.code || '',
    }));
    return h('section',{class:'card plt-section'},[
      h('h2',{},t('plt_import_complete')),
      h('div',{class:'plt-stats'},[stat(successful,'plt_success'),stat(failed,'plt_failed'),stat(results?.counts?.skipped||0,'plt_duplicate')]),
      failed ? h('button',{class:'btn btn-ghost',type:'button',onclick:()=>downloadFile(toCsv(csvColumns,csvRows),'people-import-errors.csv','text/csv;charset=utf-8')},t('plt_download_errors')) : null,
      h('button',{class:'btn btn-soft',type:'button',onclick:()=>{results=null;preview=null;fileData=null;render();}},t('plt_analyze_again')),
    ]);
  }

  function renderExport() {
    const format = h('select',{class:'plt-select',id:'plt-export-format'},[
      h('option',{value:'csv'},t('plt_export_csv')),h('option',{value:'xlsx'},t('plt_export_xlsx')),
    ]);
    format.value = exportFormat;
    format.onchange = event => { exportFormat = event.target.value; };
    const checks = PERSON_EXPORT_COLUMNS.map(field => {
      const fixed = field.fixed === true;
      const input = h('input',{type:'checkbox',checked:fixed || selectedExportFields.has(field.key),disabled:fixed,
        onchange:event=>event.target.checked?selectedExportFields.add(field.key):selectedExportFields.delete(field.key)});
      return h('label',{class:'plt-export-field' + (fixed?' is-fixed':'')},[input,h('span',{},
        field.fixed ? `${field.key} · ${t(field.labelKey)} · ${t('plt_required')}` : `${field.key} · ${t(field.labelKey)}`)]);
    });
    const resultBox = h('div',{class:'plt-export-result hidden','data-export-result':''},'');
    const exportButton = h('button',{class:'btn btn-primary',type:'button',onclick:async()=>{
      try {
        exportButton.disabled=true;exportButton.textContent=t('plt_loading');
        const fields=[...selectedExportFields];
        const rows=[];
        let afterId=null;
        let response;
        do {
          response=await data.exportPersonList(ctx,fields,afterId);
          if(response?.error || !Array.isArray(response?.rows)) throw new Error('EXPORT_FAILED');
          rows.push(...response.rows);
          if(response.hasMore && (!response.nextAfterId || String(response.nextAfterId) === String(afterId))) throw new Error('EXPORT_FAILED');
          afterId=response.nextAfterId||null;
          exportButton.textContent=t('plt_export_count').replace('{count}',String(rows.length));
        } while(response?.hasMore);
        const columns=['PersonID','display_name',...fields];
        const blob=exportFormat==='xlsx'
          ? new Blob([await toXlsx(columns,rows)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
          : new Blob([toCsv(columns,rows)],{type:'text/csv;charset=utf-8'});
        downloadBlob(blob,`people-${new Date().toISOString().slice(0,10)}.${exportFormat}`);
        resultBox.textContent=t('plt_export_count').replace('{count}',String(rows.length));resultBox.classList.remove('hidden');
      } catch { resultBox.textContent=t('plt_export_failed');resultBox.classList.remove('hidden'); }
      finally {exportButton.disabled=false;exportButton.textContent=t('plt_export_button');}
    }},t('plt_export_button'));
    return h('section',{class:'card plt-section plt-export'},[
      h('div',{class:'plt-section-head'},[h('div',{},[h('h2',{},t('plt_export_title')),h('p',{class:'foot-note'},t('plt_export_help'))]),h('span',{class:'plt-chip'},t('plt_active_people'))]),
      h('div',{class:'plt-export-fields'},checks),
      h('div',{class:'plt-export-footer'},[h('label',{class:'plt-format-label'},[t('plt_export_format'),format]),exportButton]),resultBox,
    ]);
  }

  render();
}

function downloadBlob(blob, filename) {
  const url=URL.createObjectURL(blob); const link=document.createElement('a');
  link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function downloadFile(text, filename, type) { downloadBlob(new Blob([text],{type}),filename); }
