// One manually confirmed interaction editor. No AI business command execution.
import { h } from './dom.js';
import { t } from './i18n.js';
import { openSheet } from './write.js';

const localTime = value => {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const field = (key, node) => h('div', { class: 'sheet-field' }, [h('label', {}, t(key)), node]);
const select = (name, choices, value) => h('select', { class: 'sheet-input', name }, choices.map(([key, label]) =>
  h('option', { value: key, selected: String(value) === String(key) }, label)));
const input = (name, value = '', type = 'text') => h('input', { class: 'sheet-input', name, type, value: value ?? '' });

export function openUnifiedInteraction(ctx, { personId, customerId = null, interactionId = null, onDone } = {}) {
  const editing = interactionId != null;
  const requestKey = crypto.randomUUID();
  const sheet = openSheet({ title: t(editing ? 'ui_interaction_edit' : 'ui_interaction_add'),
    body: h('p', { class: 'sheet-note' }, t('edit_loading')) });
  document.body.appendChild(sheet.overlay);
  const call = async (action, data) => {
    const res = await ctx.api.call('person_360', { action, personId: String(personId), data });
    if (res?.error || !res) throw Error(res?.error || 'INTERACTION_FAILED');
    return res;
  };
  const errorText = error => t(String(error?.message).includes('INTERACTION_STALE') ? 'ui_interaction_stale' : 'ui_interaction_failed');
  (async () => {
    try {
      const snapshot = editing ? await call('getUnifiedInteraction', { id: Number(interactionId) }) : {};
      const row = snapshot.interaction || {}, followup = snapshot.followup || {};
      const linkedCustomer = followup.customer_id || customerId;
      const scene = select('scene', [['general', t('ui_interaction_general')],
        ...(linkedCustomer ? [['customer', t('ui_interaction_customer')]] : [])], followup.Id ? 'customer' : 'general');
      scene.disabled = editing;
      const at = input('interaction_at', editing ? localTime(row.interaction_at) : localTime(new Date()), 'datetime-local');
      const type = select('interaction_type', ['meeting','call','message','note','followup'].map(key => [key, t(`type_${key}`)]), row.interaction_type || 'meeting');
      const channel = select('channel', [['',t('channel_none')],['in_person',t('interaction_type_meet')],['phone',t('interaction_type_call')],
        ['wechat',t('interaction_type_wechat')],['email',t('channel_email')],['other',t('interaction_type_other')]], row.channel || '');
      const summary = h('textarea', { class: 'sheet-textarea', name: 'summary', maxlength: '2000', required: true }, row.summary || '');
      const note = h('textarea', { class: 'sheet-textarea', name: 'raw_note', maxlength: '10000' }, row.raw_note || '');
      const nextDate = input('next_followup_date', followup.next_followup_date || '', 'date');
      const nextGoal = input('next_followup_goal', followup.next_followup_goal || ''); nextGoal.maxLength = 1000;
      const nextAction = input('next_action', followup.next_action || ''); nextAction.maxLength = 1000;
      const actionDate = input('next_action_date', followup.next_action_date || '', 'date');
      const rec = input('recommendation_id', followup.recommendation_id || '', 'number'); rec.min = '1'; rec.step = '1';
      const activity = input('activity_id', row.activity_id || '', 'number'); activity.min = '1'; activity.step = '1';
      const sales = h('div', {}, [field('followup_next_date_label', nextDate), field('followup_next_goal_label', nextGoal),
        h('details', {}, [h('summary', {}, t('ui_interaction_advanced')), field('followup_recommendation_label', rec),
          field('followup_next_action_label', nextAction),field('followup_next_action_date_label',actionDate)])]);
      const showScene = () => { sales.hidden = scene.value !== 'customer'; };
      scene.onchange = showScene; showScene();
      const save = h('button', { class: 'btn btn-primary', type: 'button', onclick: persist }, t('btn_save'));
      const form = h('div', {}, [field('ui_interaction_scene',scene),field('interaction_at_label',at),
        !row.interaction_at && editing ? h('p', { class: 'sheet-note' }, t('ui_interaction_unknown_date')) : null,
        field('interaction_type_label',type),field('interaction_channel_label',channel),field('followup_summary_label',summary),
        field('interaction_raw_note_label',note),field('followup_activity_label',activity),sales,
        h('div', { class: 'sheet-actions' }, [followup.Id ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: confirmRemove }, t('delete_followup')) : null,
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),save])]);
      sheet.swap(form);
      async function persist() {
        if (save.disabled) return;
        if (!summary.value.trim() || (!at.value && (!editing || row.interaction_at)) ||
          (at.value && !Number.isFinite(new Date(at.value).getTime())) ||
          [rec,activity].some(el => el.value && !/^[1-9]\d*$/.test(el.value))) {
          sheet.showErr(t('ui_interaction_required')); return;
        }
        const customer = scene.value === 'customer';
        const payload = { ...(editing ? { id: Number(interactionId), version: snapshot.version } : { requestKey }),
          customer_id: customer ? Number(linkedCustomer) : null,
          interaction_at: at.value ? new Date(at.value).toISOString() : null,
          time_precision: at.value === localTime(row.interaction_at) ? (row.time_precision || 'instant') : 'instant',
          interaction_type: type.value, channel: channel.value || null, summary: summary.value.trim(), raw_note: note.value || null,
          activity_id: activity.value ? Number(activity.value) : null,
          ...(customer ? { next_followup_date: nextDate.value || null, next_followup_goal: nextGoal.value || null,
            next_action: nextAction.value || null, next_action_date: actionDate.value || null, recommendation_id: rec.value ? Number(rec.value) : null } : {}) };
        // Preserve seconds and the original timestamp when an editor did not change it.
        if (editing && at.value === localTime(row.interaction_at)) payload.interaction_at = row.interaction_at;
        save.disabled = true; save.textContent = t('saving');
        try {
          const result = await call('saveUnifiedInteraction', payload);
          if (!result.interaction?.id) throw Error('INTERACTION_FAILED');
          sheet.overlay.remove(); ctx.toast(t('interaction_recorded'), 'ok'); onDone?.();
        } catch (error) { sheet.showErr(errorText(error)); save.disabled = false; save.textContent = t('btn_save'); }
      }
      function confirmRemove() {
        const remove = h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
          if (remove.disabled) return;
          remove.disabled = true; remove.textContent = t('deleting');
          try {
            const result = await call('removeUnifiedInteraction', { id: Number(interactionId), version: snapshot.version });
            if (!result.ok) throw Error('INTERACTION_FAILED');
            sheet.overlay.remove(); ctx.toast(t('followup_deleted'), 'ok'); onDone?.();
          } catch (error) { sheet.showErr(errorText(error)); remove.disabled = false; remove.textContent = t('delete_followup'); }
        } }, t('delete_followup'));
        sheet.swap(h('div', {}, [h('p', { class: 'sheet-note' }, t('followup_delete_confirm')),
          h('div', { class: 'sheet-actions' }, [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.swap(form) },t('cancel')),remove])]));
      }
    } catch (error) { sheet.showErr(errorText(error)); }
  })();
}
