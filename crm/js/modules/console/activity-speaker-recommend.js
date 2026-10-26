// AI Gateway suggestions; identity and activity writes remain in the existing human flow.
import { h } from './dom.js';
import { data } from './data.js';
import { t, getLang } from './i18n.js';

function messageFor(error) {
  const code = String(error?.message || '');
  if (code.includes('PARTICIPANTS_LIMIT')) return t('act_ai_speaker_participants_limit');
  if (code.includes('ACTIVITY_NOT_PREPARING')) return t('act_ai_speaker_activity_ended');
  if (code.includes('UNAUTHORIZED')) return t('act_ai_speaker_login_required');
  return t('act_ai_speaker_invalid');
}

export function renderSpeakerRecommendations(ctx, activity, onChoose) {
  if (!['idea', 'preparing', 'confirmed', 'in_progress'].includes(activity.status)) return null;
  const result = h('div', { class: 'act-ai-speaker-results' });
  const generate = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, t('act_ai_speaker_generate'));
  generate.onclick = async () => {
    generate.disabled = true;
    result.replaceChildren(h('p', { class: 'sheet-note' }, t('act_ai_speaker_loading')));
    try {
      const response = await data.activityRecommendSpeakersV2(ctx, activity.id, getLang());
      if (response.error || response.business_data_written !== false ||
          response.requires_confirmation !== true || !Array.isArray(response.recommendations)) {
        throw new Error(response.message || response.error || t('act_ai_speaker_invalid'));
      }
      const rows = response.recommendations;
      result.replaceChildren(...[
        response.result_id ? h('p', { class: 'foot-note' }, `${t('act_ai_prepare_result_id')} #${response.result_id}`) : null,
        response.pool_limited ? h('p', { class: 'sheet-note' }, t('act_ai_speaker_pool_limited')) : null,
        response.note ? h('p', { class: 'sheet-note' }, response.note) : null,
        rows.length ? h('div', {}, rows.map(row => h('article', { class: 'list-row act-resource-row' }, [
          h('div', { class: 'act-resource-main' }, [
            h('div', { class: 'row-title' }, `${row.speaker_name} · #${row.speaker_id}`),
            h('div', { class: 'row-sub' }, `${t('act_ai_speaker_score')} ${row.score}`),
            h('div', { class: 'row-sub' }, row.reason),
            h('div', { class: 'row-sub' }, `${t('act_ai_speaker_topic')}: ${row.suggested_topic}`),
            h('div', { class: 'row-sub' }, `${t('act_ai_speaker_contact')}: ${row.contact_suggestion}`),
          ]),
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', title: t('act_ai_speaker_review_add_full'),
            onclick: () => onChoose(row.speaker_name) }, t('act_ai_speaker_review_add')),
        ]))) : h('p', { class: 'sheet-note' }, t('act_ai_speaker_empty')),
        h('p', { class: 'sheet-note' }, t('act_ai_speaker_identity_note')),
      ].filter(Boolean));
    } catch (error) {
      result.replaceChildren(h('p', { class: 'form-msg error' },
        `${t('act_ai_speaker_failed')}: ${messageFor(error)}`));
    } finally { generate.disabled = false; }
  };
  return h('section', { class: 'act-ai-speaker card' }, [h('div', { class: 'card-body' }, [
    h('h3', {}, t('act_ai_speaker_title')),
    h('p', { class: 'sheet-note' }, t('act_ai_speaker_intro')),
    generate, result,
  ])]);
}
