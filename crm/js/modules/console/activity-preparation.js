// Gateway-backed planning advice; applying a suggestion uses the existing manual task editor.
import { h } from './dom.js';
import { data } from './data.js';
import { t, getLang } from './i18n.js';

function lines(items) {
  return h('ul', { class: 'summary-list' }, (Array.isArray(items) ? items : []).map(value => h('li', {}, String(value))));
}

export function renderActivityPreparation(ctx, activityId, status) {
  if (!['idea', 'preparing', 'confirmed', 'in_progress'].includes(status)) return null;
  const result = h('div', { class: 'act-ai-prepare-result' });
  const prepare = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, t('act_ai_prepare_generate'));
  const decompose = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, t('act_ai_prepare_decompose'));
  async function generate(mode) {
    prepare.disabled = decompose.disabled = true;
    result.replaceChildren(h('p', { class: 'sheet-note' }, t('act_ai_prepare_loading')));
    try {
      const response = await data.activityPrepareV2(ctx, activityId, mode, getLang());
      if (response.error || !response.plan || response.business_data_written !== false) {
        throw new Error(response.message || response.error || t('act_ai_prepare_invalid'));
      }
      const plan = response.plan;
      result.replaceChildren(
        h('p', { class: 'foot-note' }, `${t('act_ai_prepare_result_id')} #${response.result_id || '—'}`),
        h('p', { class: 'summary-text' }, String(plan.brief || '')),
        h('b', {}, t('act_ai_prepare_checklist')), lines(plan.checklist),
        h('b', {}, t('act_ai_prepare_outreach')), lines(plan.outreach),
        h('b', {}, t('act_ai_prepare_risks')), lines(plan.risks),
        h('p', { class: 'sheet-note' }, t('act_ai_prepare_manual_note')),
      );
    } catch (error) {
      result.replaceChildren(h('p', { class: 'form-msg error' }, `${t('act_ai_prepare_failed')}: ${error.message || ''}`));
    } finally { prepare.disabled = decompose.disabled = false; }
  }
  prepare.onclick = () => generate('prepare');
  decompose.onclick = () => generate('decompose');
  return h('section', { class: 'act-ai-prepare card' }, [h('div', { class: 'card-body' }, [
    h('h3', {}, t('act_ai_prepare_title')),
    h('p', { class: 'sheet-note' }, t('act_ai_prepare_intro')),
    h('div', { class: 'sheet-actions' }, [prepare, decompose]), result,
  ])]);
}
