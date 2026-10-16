import { h } from './dom.js';
import { openSheet } from './write.js';
import { data } from './data.js';
import { t, translateEnum } from './i18n.js';

const ACTIVITY_TYPES = ['客户答谢', '产说会', '沙龙', '酒会', '增员活动', '联谊会', '其他'];
const ACTIVITY_STATUSES = ['idea', 'preparing', 'confirmed', 'in_progress', 'ended', 'reviewed'];
const TASK_TYPES = ['preparation', 'invitation', 'speaker', 'onsite', 'followup', 'review', 'other'];
const TASK_STATUSES = ['pending', 'in_progress', 'completed', 'skipped'];
const TASK_PRIORITIES = ['high', 'medium', 'low'];
const dateOnly = value => String(value || '').slice(0, 10);
const validDate = value => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);

function field(label, control, note) {
  return h('div', { class: 'sheet-field' }, [
    h('label', {}, label), control,
    note ? h('div', { class: 'sheet-note' }, note) : null,
  ]);
}
function input(type, value, attrs = {}) {
  return h('input', { class: 'sheet-input', type, value: value || '', ...attrs });
}
function textarea(value, attrs = {}) {
  const el = h('textarea', { class: 'sheet-textarea', ...attrs });
  el.value = value || '';
  return el;
}
function select(options, value) {
  return h('select', { class: 'sheet-select' }, options.map(([key, label]) =>
    h('option', { value: key, ...(String(key) === String(value) ? { selected: true } : {}) }, label)));
}
function actions(cancel, submit, submitLabel, dangerous = false) {
  return h('div', { class: 'sheet-actions' }, [
    h('button', { class: 'btn btn-ghost', type: 'button', onclick: cancel }, t('cancel')),
    h('button', { class: dangerous ? 'btn btn-primary act-danger' : 'btn btn-primary', type: 'button', onclick: submit }, submitLabel),
  ]);
}
function setBusy(button, yes, label) {
  button.disabled = yes;
  if (label) button.textContent = label;
}

export function openActivityEditor(ctx, { activity = null, onDone } = {}) {
  const editing = !!activity;
  const name = input('text', activity?.name, { maxlength: '160', required: true });
  const date = input('date', dateOnly(activity?.activity_date));
  const typeOptions = [['', t('act_type_unspecified')], ...ACTIVITY_TYPES.map(value =>
    [value, translateEnum('activity_type', value)])];
  if (activity?.activity_type && !ACTIVITY_TYPES.includes(activity.activity_type)) {
    typeOptions.push([activity.activity_type, activity.activity_type]);
  }
  const type = select(typeOptions, activity?.activity_type || '');
  const statusOptions = ACTIVITY_STATUSES.map(value => [value, translateEnum('activity_status', value)]);
  const legacyStatus = activity?.status && !ACTIVITY_STATUSES.includes(activity.status) ? activity.status : null;
  if (legacyStatus) statusOptions.unshift([legacyStatus, `${t('act_legacy_status')} · ${translateEnum('activity_status', legacyStatus)}`]);
  const status = select(statusOptions, activity?.status || 'idea');
  const location = input('text', activity?.location, { maxlength: '240' });
  const description = textarea(activity?.description, { maxlength: '4000', rows: '4' });
  const sheet = openSheet({
    title: t(editing ? 'act_edit_title' : 'act_create_title'),
    sub: editing ? `#${activity.id}` : t('act_create_sub'),
    body: h('div', {}, [
      field(t('act_name'), name),
      field(t('act_date'), date, t('act_date_help')),
      field(t('act_type'), type),
      field(t('act_status'), status),
      field(t('act_location'), location),
      field(t('act_desc'), description),
      actions(() => sheet.overlay.remove(), () => submit(), t('btn_save')),
    ]),
  });
  document.body.appendChild(sheet.overlay);
  const submitButton = sheet.overlay.querySelector('.sheet-actions .btn-primary');
  submitButton.onclick = submit;

  async function submit() {
    if (submitButton.disabled) return;
    if (!name.value.trim()) { sheet.showErr(t('act_name_required')); return; }
    if (!validDate(date.value)) { sheet.showErr(t('act_date_invalid')); return; }
    const payload = {
      name: name.value.trim(), activity_date: date.value || null,
      activity_type: type.value || null, location: location.value.trim() || null,
      description: description.value.trim() || null,
    };
    if (!editing || !legacyStatus || status.value !== legacyStatus) payload.status = status.value;
    setBusy(submitButton, true, t('saving'));
    try {
      const result = editing
        ? await data.updateActivity(ctx, activity.id, activity.updated_at, payload)
        : await data.createActivity(ctx, { status: 'idea', ...payload });
      if (editing ? result.ok !== true : !result.id) throw new Error(result.error || t('save_failed'));
      sheet.overlay.remove();
      ctx.toast(t(editing ? 'act_saved' : 'act_created'), 'ok');
      onDone?.(result);
    } catch (error) {
      setBusy(submitButton, false, t('btn_save'));
      sheet.showErr(error.message || t('save_failed'));
    }
  }
}

export function confirmActivityRemoval(ctx, { activity, onDone } = {}) {
  const sheet = openSheet({ title: t('act_delete_title'), sub: `#${activity.id}`, body: h('p', { class: 'muted' }, t('loading')) });
  document.body.appendChild(sheet.overlay);
  (async () => {
    try {
      const preview = await data.previewRemoveActivity(ctx, activity.id);
      if (!preview?.activity?.updated_at || !preview.impact) throw new Error(t('act_delete_preview_failed'));
      const count = preview.impact.participantsSoftDeleted;
      const previewBody = h('div', {}, [
        h('p', { class: 'sheet-note' }, t('act_delete_preview_note')),
        h('div', { class: 'kv-grid' }, [
          h('div', { class: 'kv-line' }, [h('span', { class: 'kv-k' }, t('act_delete_event')), h('span', {}, preview.activity.name || `#${activity.id}`)]),
          h('div', { class: 'kv-line' }, [h('span', { class: 'kv-k' }, t('act_delete_participants')), h('span', {}, String(count))]),
          h('div', { class: 'kv-line' }, [h('span', { class: 'kv-k' }, t('act_delete_tasks_retained')), h('span', {}, String(preview.impact.preparationTasksRetained))]),
          h('div', { class: 'kv-line' }, [h('span', { class: 'kv-k' }, t('act_delete_actions_retained')), h('span', {}, String(preview.impact.actionsRetained))]),
        ]),
        h('p', { class: 'sheet-note' }, t('act_delete_soft_semantics')),
      ]);
      const confirm = h('button', { class: 'btn btn-primary act-danger', type: 'button' }, t('act_delete_confirm'));
      confirm.onclick = async () => {
        if (confirm.disabled) return;
        setBusy(confirm, true, t('deleting'));
        try {
          const result = await data.removeActivity(ctx, activity.id, preview.activity.updated_at, count);
          if (result.ok !== true) throw new Error(result.error || t('act_delete_preview_stale'));
          sheet.overlay.remove(); ctx.toast(t('act_deleted'), 'ok'); onDone?.();
        } catch (error) { setBusy(confirm, false, t('act_delete_confirm')); sheet.showErr(error.message || t('delete_failed')); }
      };
      sheet.swap(h('div', {}, [previewBody, h('div', { class: 'sheet-actions' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
        confirm,
      ])]));
    } catch (error) { sheet.showErr(error.message || t('act_delete_preview_failed')); }
  })();
}

export function openActivityTaskEditor(ctx, { activityId, task = null, onDone } = {}) {
  const editing = !!task;
  const title = input('text', task?.task_title, { maxlength: '160', required: true });
  const type = select(TASK_TYPES.map(value => [value, t(`act_task_type_${value}`)]), task?.task_type || 'preparation');
  const status = select(TASK_STATUSES.map(value => [value, t(`act_task_status_${value}`)]), task?.status || 'pending');
  const priority = select(TASK_PRIORITIES.map(value => [value, t(`act_task_priority_${value}`)]), task?.priority || 'medium');
  const due = input('date', dateOnly(task?.due_date));
  const note = textarea(task?.note, { maxlength: '2000', rows: '3' });
  const sheet = openSheet({
    title: t(editing ? 'act_task_edit_title' : 'act_task_create_title'),
    sub: `${t('act_task_activity')} #${activityId}`,
    body: h('div', {}, [
      field(t('act_task_title'), title), field(t('act_task_type'), type),
      field(t('act_task_status'), status), field(t('act_task_priority'), priority),
      field(t('act_due'), due, t('act_task_due_help')), field(t('act_task_note'), note),
      h('p', { class: 'sheet-note' }, t('act_task_no_action_copy')),
      actions(() => sheet.overlay.remove(), async () => {
        const button = sheet.overlay.querySelector('.sheet-actions .btn-primary');
        if (button.disabled) return;
        if (!title.value.trim()) { sheet.showErr(t('act_task_title_required')); return; }
        if (!validDate(due.value)) { sheet.showErr(t('act_date_invalid')); return; }
        const payload = {
          task_title: title.value.trim(), task_type: type.value, status: status.value,
          priority: priority.value, due_date: due.value || null, note: note.value.trim() || null,
        };
        setBusy(button, true, t('saving'));
        try {
          const result = editing
            ? await data.updateActivityTask(ctx, task.id, activityId, task.updated_at, payload)
            : await data.createActivityTask(ctx, { activity_id: Number(activityId), source: 'manual', related_type: 'none', ...payload });
          if (result.ok !== true && editing) throw new Error(result.error || t('act_task_conflict'));
          if (!editing && !result.id) throw new Error(result.error || t('save_failed'));
          sheet.overlay.remove(); ctx.toast(t(editing ? 'act_task_saved' : 'act_task_created'), 'ok'); onDone?.();
        } catch (error) { setBusy(button, false, t('btn_save')); sheet.showErr(error.message || t('save_failed')); }
      }, t('btn_save')),
    ]),
  });
  document.body.appendChild(sheet.overlay);
}

export function changeActivityTaskStatus(ctx, { activityId, task, status, onDone } = {}) {
  if (!['completed', 'skipped'].includes(status)) return;
  (async () => {
    try {
      const result = await data.transitionActivityTask(ctx, task.id, activityId, task.updated_at, status);
      if (result.ok !== true) throw new Error(result.error || t('act_task_conflict'));
      ctx.toast(t(status === 'completed' ? 'act_task_completed' : 'act_task_skipped'), 'ok'); onDone?.();
    } catch (error) { ctx.toast(error.message || t('save_failed'), 'err'); }
  })();
}

export function confirmActivityTaskRemoval(ctx, { activityId, task, onDone } = {}) {
  const sheet = openSheet({ title: t('act_task_delete_title'), sub: task.task_title, body: h('div', {}, [
    h('p', { class: 'sheet-note' }, t('act_task_delete_note')),
    actions(() => sheet.overlay.remove(), async () => {
      const button = sheet.overlay.querySelector('.sheet-actions .btn-primary');
      if (button.disabled) return;
      setBusy(button, true, t('deleting'));
      try {
        const result = await data.removeActivityTask(ctx, task.id, activityId, task.updated_at);
        if (result.ok !== true) throw new Error(result.error || t('act_task_conflict'));
        sheet.overlay.remove(); ctx.toast(t('act_task_deleted'), 'ok'); onDone?.();
      } catch (error) { setBusy(button, false, t('act_task_delete_confirm')); sheet.showErr(error.message || t('delete_failed')); }
    }, t('act_task_delete_confirm'), true),
  ]) });
  document.body.appendChild(sheet.overlay);
}
