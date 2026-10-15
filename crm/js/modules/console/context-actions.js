import { h } from './dom.js';
import { t } from './i18n.js';
import { openSheet } from './write.js';

function uuid() {
  try { if (window.crypto?.randomUUID) return window.crypto.randomUUID(); } catch (_) { /* fallback below */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 3 | 8)).toString(16);
  });
}
function fieldRow(label, input) { return h('div', { class: 'sheet-field' }, [h('label', {}, label), input]); }
function valueRow(label, value) {
  return h('div', { class: 'kv-line' }, [h('span', { class: 'kv-k' }, label), h('span', {}, value || '—')]);
}
function stateText(state) {
  if (!state || typeof state !== 'object') return String(state ?? '—');
  return [state.type, state.category, state.content,
    state.confirmed === true ? t('context_confirmed') : state.confirmed === false ? t('context_candidate') : '',
    state.validTo ? `${t('context_valid_to')} ${state.validTo}` : ''].filter(Boolean).join(' · ');
}
function errorText(error, fallback) {
  const message = String(error?.message || error || '');
  if (/permission denied|42501/i.test(message)) return t('context_permission_denied');
  if (/source is unavailable|source.*unavailable/i.test(message)) return t('context_source_missing');
  if (/changed|state changed|no longer current|stale|expired/i.test(message)) return t('context_stale_preview');
  return fallback;
}

export function openContextItemAction(ctx, { personId, item, operation, onDone } = {}) {
  if (!/^[1-9]\d*$/.test(String(personId || '')) || !item?.id ||
      !['confirm', 'correct', 'expire', 'withdraw', 'promote'].includes(operation)) return;
  const editing = operation === 'correct' || operation === 'promote';
  const titleKey = `context_action_${operation}`;
  const category = h('input', { class: 'sheet-input', maxlength: '64', required: true, value: item.category || 'general' });
  const content = h('textarea', { class: 'sheet-textarea', maxlength: '4000', required: true }, item.content || '');
  const form = h('div', {}, [
    editing ? fieldRow(t('context_category'), category) : null,
    editing ? fieldRow(t('context_content'), content) : null,
    h('p', { class: 'sheet-note' }, t('context_preview_note')),
    h('div', { class: 'sheet-actions' }, [
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: preview }, t('context_get_preview')),
    ]),
  ]);
  const sheet = openSheet({ title: t(titleKey), sub: `${t('context_person')} #${personId} · ${t('context_item')} #${item.id}`, body: form });
  document.body.appendChild(sheet.overlay);
  if (!editing) preview();

  async function preview() {
    const draft = editing ? { category: category.value.trim(), content: content.value.trim() } : {};
    if (editing && (!draft.category || !draft.content)) {
      sheet.showErr(t('context_required_fields')); return;
    }
    const button = form.querySelector('.btn-primary');
    if (button?.disabled) return;
    if (button) button.disabled = true;
    try {
      const res = await ctx.api.call('person_360', { action: 'previewContextItem', data: {
        idempotencyKey: uuid(), personId: String(personId), itemId: String(item.id), operation, payload: draft,
      } });
      if (res?.error) throw new Error(String(res.error));
      if (res?.status === 'executed') {
        sheet.swap(h('p', { class: 'sheet-note' }, t('context_already_executed')));
        return;
      }
      const pv = res?.preview || {};
      const source = pv.source?.evidence || {};
      const sourceText = source.summary || source.content || '';
      const summary = h('div', {}, [
        h('p', { class: 'sheet-note' }, t('context_human_review_note')),
        valueRow(t('context_person'), pv.personName || `#${personId}`),
        valueRow(t('context_before'), stateText(pv.before)),
        valueRow(t('context_after'), stateText(pv.after)),
        sourceText ? h('div', { class: 'sheet-preview' }, [
          h('div', { class: 'sheet-preview-label' }, t('context_source_text')),
          h('p', {}, sourceText),
          source.rawNote ? h('p', { class: 'sheet-note' }, source.rawNote) : null,
        ]) : valueRow(t('context_source'), `${pv.source?.sourceType || ''}${pv.source?.sourceId ? `#${pv.source.sourceId}` : ''}`),
        res.expiresAt ? h('p', { class: 'sheet-note' }, `${t('context_preview_expires')} ${String(res.expiresAt).replace('T', ' ').slice(0, 16)}`) : null,
        h('div', { class: 'sheet-actions' }, [
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: event => execute(event.currentTarget, res.previewId) }, t('context_confirm_execute')),
        ]),
      ]);
      sheet.swap(summary);
    } catch (error) {
      sheet.showErr(errorText(error, t('context_preview_failed')));
      if (button) button.disabled = false;
    }
  }

  async function execute(button, previewId) {
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = t('saving');
    try {
      const res = await ctx.api.call('person_360', { action: 'executeContextItem', previewId });
      if (res?.error || res?.ok === false) throw new Error(String(res?.error || t('context_execute_failed')));
      sheet.overlay.remove();
      ctx.toast(t('context_saved'), 'ok');
      onDone?.();
    } catch (error) {
      button.disabled = false;
      button.textContent = t('context_confirm_execute');
      sheet.showErr(errorText(error, t('context_execute_failed')));
    }
  }
}
