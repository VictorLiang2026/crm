// Gateway topic advice only marks a local checkbox; the operator saves the assignment.
import { h } from './dom.js';
import { data } from './data.js';
import { t, getLang } from './i18n.js';

function messageFor(error) {
  const code = String(error?.message || '');
  if (code.includes('ACTIVITY_NOT_PREPARING')) return t('act_ai_topic_activity_ended');
  if (code.includes('UNAUTHORIZED')) return t('act_ai_topic_login_required');
  return t('act_ai_topic_invalid');
}

export function renderTopicRecommendations(ctx, activity, onChoose) {
  if (!['idea', 'preparing', 'confirmed', 'in_progress'].includes(activity.status)) return null;
  const result = h('div', { class: 'act-ai-topic-results' });
  const generate = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, t('act_ai_topic_generate'));
  generate.onclick = async () => {
    generate.disabled = true;
    result.replaceChildren(h('p', { class: 'sheet-note' }, t('act_ai_topic_loading')));
    try {
      const response = await data.activityRecommendTopicsV2(ctx, activity.id, getLang());
      if (response.error || response.business_data_written !== false ||
          response.requires_confirmation !== true || !Array.isArray(response.recommendations)) {
        throw new Error(response.message || response.error || t('act_ai_topic_invalid'));
      }
      result.replaceChildren(...[
        response.result_id ? h('p', { class: 'foot-note' }, `${t('act_ai_prepare_result_id')} #${response.result_id}`) : null,
        response.pool_limited ? h('p', { class: 'sheet-note' }, t('act_ai_topic_pool_limited')) : null,
        response.note ? h('p', { class: 'sheet-note' }, response.note) : null,
        response.recommendations.length ? h('div', {}, response.recommendations.map(row =>
          h('article', { class: 'list-row act-resource-row' }, [
            h('div', { class: 'act-resource-main' }, [
              h('div', { class: 'row-title' }, `${row.topic_name} · #${row.topic_id}`),
              h('div', { class: 'row-sub' }, `${t('act_ai_topic_score')} ${row.score}`),
              h('div', { class: 'row-sub' }, row.reason),
            ]),
            h('button', { class: 'btn btn-ghost btn-sm', type: 'button',
              onclick: () => onChoose(row.topic_id) }, t('act_ai_topic_select')),
          ]))) : h('p', { class: 'sheet-note' }, t('act_ai_topic_empty')),
        h('p', { class: 'sheet-note' }, t('act_ai_topic_confirm_note')),
      ].filter(Boolean));
    } catch (error) {
      result.replaceChildren(h('p', { class: 'form-msg error' },
        `${t('act_ai_topic_failed')}: ${messageFor(error)}`));
    } finally { generate.disabled = false; }
  };
  return h('section', { class: 'act-ai-topic card' }, [h('div', { class: 'card-body' }, [
    h('h3', {}, t('act_ai_topic_title')),
    h('p', { class: 'sheet-note' }, t('act_ai_topic_intro')),
    generate, result,
  ])]);
}
