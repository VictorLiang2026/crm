import { h } from './dom.js';
import { data } from './data.js';
import { t } from './i18n.js';
import { emptyNote, fmtDate, sectionTitle } from './ui.js';

const FIELDS = [
  ['phone', 'ocr_field_phone'], ['gender', 'ocr_field_gender'], ['birthday', 'ocr_field_birthday'],
  ['occupation', 'ocr_field_occupation'], ['education', 'ocr_field_education'],
  ['marital_status', 'ocr_field_marital'], ['customer_stage', 'ocr_field_stage'],
  ['sales_priority', 'ocr_field_sales_priority'], ['referral_priority', 'ocr_field_referral_priority'],
  ['hobbies', 'ocr_field_hobbies'], ['source', 'ocr_field_source'], ['additional_info', 'ocr_field_additional'],
];

function jsonArray(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch { return []; }
}

function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  if (bytes.every(value => value === 0)) throw new Error(t('ocr_secure_ids_unavailable'));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function timestamp(value) { return value ? fmtDate(value) : t('ocr_unknown_date'); }

function fieldLabel(key) { return t(FIELDS.find(([field]) => field === key)?.[1] || 'ocr_unknown_field'); }

function diffRows(before, after) {
  return Object.keys(after || {}).map((key) => h('div', { class: 'ocr-diff-row' }, [
    h('strong', {}, fieldLabel(key)),
    h('span', {}, `${t('ocr_before')}: ${before?.[key] == null ? t('label_none') : String(before[key])}`),
    h('span', {}, `${t('ocr_after')}: ${after[key] == null ? t('label_none') : String(after[key])}`),
  ]));
}

function messageNode(text, kind = 'info') {
  return h('p', { class: `ocr-message ocr-message-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, text);
}

async function imageInputs(ctx, record) {
  const ids = jsonArray(record.file_ids);
  if (!ids.length) return [];
  if (ids.length > 6) throw new Error(t('ocr_too_many_images'));
  const photos = await Promise.all(ids.map(async id => {
    const result = await data.getPhoto(ctx, id, record.customer_id);
    const photo = result.photo;
    if (!photo || typeof photo.photo_url !== 'string') throw new Error(t('ocr_source_missing'));
    const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i.exec(photo.photo_url);
    if (!match) throw new Error(t('ocr_image_type_unsupported'));
    if (match[2].length > 12 * 1024 * 1024) throw new Error(t('ocr_image_too_large'));
    return { base64: match[2], content_type: match[1], file_name: photo.file_name || '' };
  }));
  return photos;
}

function sourceButton(ctx, customerId, fileId, fileName, viewer, errorSlot) {
  const button = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, `${t('ocr_open_source')}: ${fileName || t('ocr_source_file')}`);
  button.addEventListener('click', async () => {
    button.disabled = true;
    errorSlot.replaceChildren();
    try {
      const result = await data.getPhoto(ctx, fileId, customerId);
      const photo = result.photo;
      if (!photo?.photo_url || typeof photo.photo_url !== 'string') throw new Error(t('ocr_source_missing'));
      const source = photo.content_type?.startsWith('image/')
        ? h('img', { class: 'ocr-source-image', src: photo.photo_url, alt: photo.file_name || t('ocr_source_file') })
        : photo.content_type === 'application/pdf'
          ? h('object', { class: 'ocr-source-pdf', data: photo.photo_url, type: 'application/pdf', title: photo.file_name || t('ocr_source_file') },
            h('a', { href: photo.photo_url, target: '_blank', rel: 'noopener noreferrer' }, t('ocr_open_new_window')))
          : h('a', { href: photo.photo_url, target: '_blank', rel: 'noopener noreferrer' }, t('ocr_download_source'));
      viewer.replaceChildren(source);
    } catch (error) { errorSlot.replaceChildren(messageNode(error.message || t('ocr_load_failed'), 'error')); }
    finally { button.disabled = false; }
  });
  return button;
}

function commandHistory(rows, ctx, personId, changed) {
  if (!rows?.length) return emptyNote(t('ocr_no_applied_records'), t('ocr_history_note'));
  return h('div', { class: 'ocr-history-list' }, rows.map(row => {
    const canUndo = row.operation === 'apply' && row.status === 'executed';
    const item = h('div', { class: 'ocr-history-row' }, [
      h('div', { class: 'ocr-history-summary' }, [
        h('strong', {}, row.operation === 'undo' ? t('ocr_undo_applied') : t('ocr_applied')),
        h('span', {}, `${timestamp(row.executed_at || row.created_at)} · ${t('ocr_record_id')} ${row.ocr_record_id}`),
        h('span', {}, row.status === 'undone' ? t('ocr_undone') : row.status === 'executed' ? t('ocr_status_done') : t('ocr_status_preview')),
      ]),
      canUndo ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button',
        onclick: (event) => openUndo(ctx, row, personId, changed, event.currentTarget) }, t('ocr_undo_parse')) : null,
    ]);
    return item;
  }));
}

function openUndo(ctx, row, personId, changed, trigger) {
  const panel = h('div', { class: 'ocr-preview-panel' }, [
    h('p', {}, t('ocr_undo_safety_note')),
    h('button', { class: 'btn btn-soft btn-sm', type: 'button', onclick: async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      panel.querySelector('.ocr-inline-message')?.remove();
      try {
        const preview = await data.previewOcrUndo(ctx, { commandId: row.id, idempotencyKey: uid(), confirmed: true });
        if (!preview?.previewId || !preview.preview?.before || !preview.preview?.after) throw new Error(t('ocr_preview_invalid'));
        panel.append(h('div', { class: 'ocr-diff-list' }, diffRows(preview.preview.before, preview.preview.after)));
        const confirm = h('label', { class: 'ocr-confirm-row' }, [
          h('input', { type: 'checkbox' }), h('span', {}, t('ocr_confirm_undo')),
        ]);
        const execute = h('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: true }, t('ocr_execute_undo'));
        const checkbox = confirm.querySelector('input');
        checkbox.addEventListener('change', () => { execute.disabled = !checkbox.checked; });
        execute.addEventListener('click', async () => {
          execute.disabled = true;
          try {
            await data.executeOcrParse(ctx, preview.previewId);
            panel.replaceChildren(messageNode(t('ocr_undo_success'), 'success'));
            changed();
          } catch (error) { panel.append(messageNode(error.message || t('ocr_undo_conflict'), 'error')); }
          finally { execute.disabled = false; }
        });
        panel.append(confirm, execute);
      } catch (error) { panel.append(messageNode(error.message || t('ocr_undo_conflict'), 'error')); }
      finally { button.disabled = false; }
    } }, t('ocr_preview_undo')),
  ]);
  const host = trigger.closest('.ocr-history-row');
  if (host) {
    host.querySelector('.ocr-preview-panel')?.remove();
    host.append(panel);
  }
}

function recordNode(ctx, personId, personName, customerId, record, changed) {
  const sourceViewer = h('div', { class: 'ocr-source-viewer' });
  const errorSlot = h('div', { class: 'ocr-error-slot' });
  const fileIds = jsonArray(record.file_ids);
  const fileNames = jsonArray(record.file_names);
  const sourceButtons = fileIds.map((fileId, index) => sourceButton(ctx, customerId, fileId,
    fileNames[index] || `${t('ocr_source_file')} ${index + 1}`, sourceViewer, errorSlot));
  const content = h('div', { class: 'ocr-record-content' }, [
    h('div', { class: 'ocr-record-meta' }, [
      h('span', {}, `${t('ocr_record_id')} ${record.id}`),
      h('span', {}, timestamp(record.created_at)),
      record.updated_at ? h('span', {}, `${t('ocr_updated')} ${timestamp(record.updated_at)}`) : null,
    ]),
    sourceButtons.length ? h('div', { class: 'ocr-source-actions' }, sourceButtons) : messageNode(t('ocr_no_source_file')),
    sourceViewer,
    errorSlot,
    record.summary ? h('div', { class: 'ocr-summary' }, [sectionTitle(t('ocr_summary')), h('p', {}, record.summary)]) : null,
    record.raw_text ? h('details', { class: 'ocr-raw-details' }, [
      h('summary', {}, t('ocr_view_raw_text')),
      h('pre', { class: 'ocr-raw-text' }, record.raw_text),
    ]) : messageNode(t('ocr_no_recognition_text')),
  ]);
  const working = h('div', { class: 'ocr-working-area' });
  const parseBtn = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, t('ocr_parse_fields'));
  parseBtn.addEventListener('click', async () => {
    parseBtn.disabled = true;
    working.replaceChildren(messageNode(t('ocr_parsing')));
    try {
      const input = record.raw_text?.trim()
        ? { text: record.raw_text }
        : { images: await imageInputs(ctx, record), text: '' };
      if (!input.text && !input.images?.length) throw new Error(t('ocr_nothing_to_parse'));
      const result = await data.parseOcr(ctx, input);
      if (result.error || !result.parsed || typeof result.parsed !== 'object') throw new Error(result.error || t('ocr_parse_failed'));
      renderCandidate(ctx, personId, personName, customerId, record, result.parsed,
        ctx.profileFields || {}, working, changed);
    } catch (error) { working.replaceChildren(messageNode(error.message || t('ocr_parse_failed'), 'error')); }
    finally { parseBtn.disabled = false; }
  });
  content.append(h('div', { class: 'ocr-record-actions' }, [parseBtn]), working);
  return h('details', { class: 'ocr-record' }, [
    h('summary', {}, [h('strong', {}, record.summary || fileNames.join(', ') || `${t('ocr_record_id')} ${record.id}`),
      h('span', { class: 'ocr-record-date' }, timestamp(record.created_at))]),
    content,
  ]);
}

function renderCandidate(ctx, personId, personName, customerId, record, parsed, currentValues, host, changed) {
  const candidateName = typeof parsed.customer_name === 'string' ? parsed.customer_name : '';
  const nameInput = h('input', { class: 'form-input', type: 'text', value: candidateName || personName, maxlength: '160' });
  const resolveButton = h('button', { class: 'btn btn-soft btn-sm', type: 'button' }, t('ocr_resolve_identity'));
  const identityRows = h('div', { class: 'ocr-identity-candidates' });
  const identityCheck = h('label', { class: 'ocr-confirm-row' }, [
    h('input', { type: 'checkbox', disabled: true }), h('span', {}, t('ocr_identity_confirm')),
  ]);
  const identityCheckbox = identityCheck.querySelector('input');
  let selectedPersonId = '';
  let identityResolved = false;
  const identityError = h('div', { class: 'ocr-error-slot' });
  resolveButton.addEventListener('click', async () => {
    resolveButton.disabled = true;
    identityRows.replaceChildren(messageNode(t('ocr_resolving_identity')));
    identityError.replaceChildren();
    identityCheckbox.checked = false;
    identityCheckbox.disabled = true;
    identityResolved = false;
    selectedPersonId = '';
    invalidatePreview();
    updatePreviewButton();
    try {
      const result = await data.resolvePersonName(ctx, nameInput.value.trim());
      const candidates = result?.candidates || [];
      if (!candidates.some(candidate => String(candidate.id) === String(personId))) {
        throw new Error(t('ocr_identity_mismatch'));
      }
      selectedPersonId = '';
      identityRows.replaceChildren(...candidates.map(candidate => {
        const radio = h('input', { type: 'radio', name: `ocr-person-${record.id}`, value: String(candidate.id) });
        radio.addEventListener('change', () => {
          selectedPersonId = String(candidate.id);
          identityCheckbox.checked = false;
          identityCheckbox.disabled = selectedPersonId !== String(personId);
          invalidatePreview();
          updatePreviewButton();
        });
        return h('label', { class: 'ocr-candidate-person' }, [radio,
          h('span', {}, candidate.displayName),
          h('small', {}, candidate.legacyCustomerId ? t('ocr_candidate_customer') : t('ocr_candidate_person_only')),
          String(candidate.id) === String(personId) ? h('b', {}, t('ocr_current_person')) : null,
        ]);
      }));
      identityResolved = true;
    } catch (error) {
      identityRows.replaceChildren();
      identityError.replaceChildren(messageNode(error.message || t('ocr_identity_failed'), 'error'));
    } finally { resolveButton.disabled = false; }
  });

  const fieldRows = [];
  const selectedFields = new Set();
  for (const [key, labelKey] of FIELDS) {
    const value = parsed[key];
    if (typeof value !== 'string' || !value.trim()) continue;
    const checkbox = h('input', { type: 'checkbox' });
    const current = currentValues?.[key];
    const row = h('div', { class: 'ocr-field-row', 'data-field': key }, [
      checkbox,
      h('div', { class: 'ocr-field-content' }, [
        h('strong', {}, t(labelKey)),
        h('textarea', { class: 'form-input ocr-field-value', rows: key === 'additional_info' ? 3 : 1,
          maxlength: key === 'additional_info' ? 8000 : 500, value }),
        h('small', {}, `${t('ocr_current_value')}: ${current == null ? t('label_none') : String(current)}`),
      ]),
    ]);
    fieldRows.push(row);
    const rowTextarea = row.querySelector('textarea');
    rowTextarea.value = value;
    rowTextarea.addEventListener('input', () => {
      if (checkbox.checked && rowTextarea.value.trim()) selectedFields.add(key);
      else selectedFields.delete(key);
      if (!rowTextarea.value.trim()) checkbox.checked = false;
      invalidatePreview();
      updatePreviewButton();
    });
    checkbox.addEventListener('change', () => {
      if (checkbox.checked && rowTextarea.value.trim()) selectedFields.add(key);
      else selectedFields.delete(key);
      invalidatePreview();
      updatePreviewButton();
    });
  }

  const previewHost = h('div', { class: 'ocr-preview-host' });
  const previewButton = h('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: true }, t('ocr_server_preview'));
  const confirmed = identityCheck.querySelector('input');
  function invalidatePreview() { previewHost.replaceChildren(); }
  function updatePreviewButton() {
    previewButton.disabled = !identityResolved || selectedPersonId !== String(personId) ||
      !confirmed.checked || selectedFields.size === 0;
  }
  nameInput.addEventListener('input', () => {
    identityResolved = false;
    selectedPersonId = '';
    identityCheckbox.checked = false;
    identityCheckbox.disabled = true;
    identityRows.replaceChildren();
    identityError.replaceChildren();
    invalidatePreview();
    updatePreviewButton();
  });
  confirmed.addEventListener('change', () => {
    invalidatePreview();
    updatePreviewButton();
  });
  previewButton.addEventListener('click', async () => {
    previewButton.disabled = true;
    previewHost.replaceChildren(messageNode(t('ocr_preview_loading')));
    try {
      if (!identityResolved || selectedPersonId !== String(personId) || !confirmed.checked) throw new Error(t('ocr_identity_confirm_required'));
      const fields = {};
      for (const row of fieldRows) {
        const checkbox = row.querySelector('input[type="checkbox"]');
        if (!checkbox.checked) continue;
        const key = row.dataset.field;
        const value = row.querySelector('textarea')?.value?.trim();
        if (key && value) fields[key] = value;
      }
      const result = await data.previewOcrParse(ctx, {
        personId: String(personId), customerId, ocrRecordId: String(record.id),
        identityName: nameInput.value.trim(), selectedPersonId, confirmed: true,
        fields, selectedFields: [...selectedFields], idempotencyKey: uid(),
      });
      if (!result.previewId || !result.preview?.before || !result.preview?.after) throw new Error(t('ocr_preview_invalid'));
      renderApplyPreview(ctx, result, previewHost, changed);
    } catch (error) { previewHost.replaceChildren(messageNode(error.message || t('ocr_preview_failed'), 'error')); }
    finally { updatePreviewButton(); }
  });

  host.replaceChildren(h('div', { class: 'ocr-candidate-panel' }, [
    h('p', { class: 'sheet-note' }, t('ocr_candidate_note')),
    h('div', { class: 'ocr-identity-block' }, [
      sectionTitle(t('ocr_identity_heading')),
      h('label', { class: 'ocr-label' }, [h('span', {}, t('ocr_identity_name')), nameInput]),
      resolveButton, identityRows, identityError, identityCheck,
    ]),
    sectionTitle(t('ocr_fields_heading')),
    fieldRows.length ? h('div', { class: 'ocr-field-list' }, fieldRows)
      : messageNode(t('ocr_no_fields')),
    previewButton, previewHost,
  ]));
}

function renderApplyPreview(ctx, result, host, changed) {
  const preview = result.preview;
  const checkbox = h('input', { type: 'checkbox' });
  const confirm = h('label', { class: 'ocr-confirm-row' }, [checkbox, h('span', {}, t('ocr_confirm_apply'))]);
  const execute = h('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: true }, t('ocr_apply_fields'));
  checkbox.addEventListener('change', () => { execute.disabled = !checkbox.checked; });
  execute.addEventListener('click', async () => {
    execute.disabled = true;
    try {
      const applied = await data.executeOcrParse(ctx, result.previewId);
      host.replaceChildren(messageNode(t('ocr_apply_success'), 'success'));
      if (applied?.commandId) host.append(h('p', { class: 'ocr-command-id' }, `${t('ocr_command_id')} ${applied.commandId}`));
      changed();
    } catch (error) { host.append(messageNode(error.message || t('ocr_execute_failed'), 'error')); }
    finally { execute.disabled = false; }
  });
  host.replaceChildren(
    h('div', { class: 'ocr-preview-panel' }, [
      sectionTitle(t('ocr_preview_heading')),
      h('p', { class: 'sheet-note' }, t('ocr_preview_note')),
      h('p', { class: 'ocr-identity-target' }, `${t('ocr_identity_target')}: ${result.identity?.displayName || t('ocr_current_person')}`),
      h('div', { class: 'ocr-diff-list' }, diffRows(preview.before, preview.after)),
      h('p', { class: 'ocr-preview-expiry' }, `${t('ocr_expires')}: ${timestamp(result.expiresAt)}`),
      confirm, execute,
    ]),
  );
}

export async function renderOcrReview(ctx, personId) {
  const profile = await data.customerProfile(ctx, personId);
  if (profile.status !== 'linked' || !profile.customerId) {
    return h('div', { class: 'tab-stack' }, [
      sectionTitle(t('ocr_title')),
      emptyNote(t('ocr_customer_required'), t('ocr_customer_required_note')),
    ]);
  }
  const customerId = profile.customerId;
  const personName = profile.fields?.customer_name || profile.person?.display_name || '';
  const [recordsResult, commands] = await Promise.all([
    data.ocrRecords(ctx, customerId), data.ocrParseCommands(ctx, personId),
  ]);
  const rows = Array.isArray(recordsResult.rows) ? recordsResult.rows : [];
  const historyHost = h('div', { class: 'ocr-history-host' });
  const changed = () => ctx.onWriteDone?.();
  historyHost.replaceChildren(commandHistory(commands, ctx, personId, changed));
  return h('div', { class: 'tab-stack ocr-review' }, [
    sectionTitle(t('ocr_title')),
    h('p', { class: 'sheet-note' }, t('ocr_safety_note')),
    sectionTitle(`${t('ocr_records')} (${rows.length})`),
    rows.length ? h('div', { class: 'ocr-record-list' }, rows.map(row =>
      recordNode({ ...ctx, profileFields: profile.fields }, personId, personName, customerId, row, changed)))
      : emptyNote(t('ocr_no_records'), t('ocr_no_records_note')),
    sectionTitle(t('ocr_applied_history')),
    historyHost,
  ]);
}
