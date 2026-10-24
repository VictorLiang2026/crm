import { h } from './dom.js';
import { data } from './data.js';
import { openSheet } from './write.js';
import { t, translateEnum } from './i18n.js';
import { bdg, emptyNote, sectionTitle, pageHead } from './ui.js';

const PARTICIPANT_TYPES = ['customer', 'recruit', 'speaker'];
const PARTICIPANT_STATUSES = ['invited', 'attended', 'absent'];
const SPEAKER_STAGES = ['new', 'contacted', 'cooperated', 'stable', 'deep', 'inactive'];
const statusTone = { invited: 'ink', attended: 'jade', absent: 'red' };
const dateOnly = value => String(value || '').slice(0, 10);

function field(label, control, note) {
  return h('div', { class: 'sheet-field' }, [h('label', {}, label), control,
    note ? h('div', { class: 'sheet-note' }, note) : null]);
}
function input(type, value, attrs = {}) {
  return h('input', { class: 'sheet-input', type, value: value || '', ...attrs });
}
function textarea(value, attrs = {}) {
  const node = h('textarea', { class: 'sheet-textarea', ...attrs });
  node.value = value || '';
  return node;
}
function select(options, value) {
  return h('select', { class: 'sheet-select' }, options.map(([key, label]) =>
    h('option', { value: key, ...(String(key) === String(value) ? { selected: true } : {}) }, label)));
}
function actions(cancel, submit, label, danger = false) {
  return h('div', { class: 'sheet-actions' }, [
    h('button', { class: 'btn btn-ghost', type: 'button', onclick: cancel }, t('cancel')),
    h('button', { class: danger ? 'btn btn-primary act-danger' : 'btn btn-primary', type: 'button', onclick: submit }, label),
  ]);
}
function errorText(error) { return error?.message || t('save_failed'); }
function setBusy(button, busy, label) { button.disabled = busy; if (label) button.textContent = label; }
function typeLabel(type) { return type === 'person' ? t('participant') : t(`act_participant_type_${type}`) || translateEnum('participant_type', type) || type; }

function openParticipantAdd(ctx, activity, onDone) {
  const name = input('search', '', { maxlength: '160', placeholder: t('act_person_search_placeholder') });
  const type = select(PARTICIPANT_TYPES.map(value => [value, typeLabel(value)]), 'customer');
  const status = select(PARTICIPANT_STATUSES.map(value => [value, t(`part_${value}`)]), 'invited');
  const note = textarea('', { maxlength: '4000', rows: '3' });
  const results = h('div', { class: 'act-person-results' });
  const selected = h('p', { class: 'sheet-note act-person-selected' }, t('act_person_not_selected'));
  const resolve = h('button', { class: 'btn btn-ghost', type: 'button' }, t('act_person_resolve'));
  const submit = h('button', { class: 'btn btn-primary', type: 'button', disabled: true }, t('act_participant_confirm_add'));
  let chosen = null;
  const sheet = openSheet({ title: t('act_participant_add_title'), sub: t('act_person_identity_note'), body: h('div', { class: 'sheet-stack' }, [
    field(t('act_participant_type'), type), field(t('act_person_name'), name),
    h('div', { class: 'sheet-actions' }, [resolve]), results, selected,
    field(t('act_participant_status'), status),
    field(t('act_participant_note'), note, t('act_attendance_not_interaction')),
    h('div', { class: 'sheet-note' }, t('act_attendance_not_interaction')),
    h('div', { class: 'sheet-actions' }, [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')), submit]),
  ]) });
  document.body.appendChild(sheet.overlay);
  name.oninput = () => {
    chosen = null; submit.disabled = true;
    selected.textContent = t('act_person_not_selected'); results.replaceChildren();
  };
  resolve.onclick = async () => {
    const query = name.value.trim();
    chosen = null; submit.disabled = true; results.replaceChildren();
    if (!query) { sheet.showErr(t('act_person_name_required')); return; }
    setBusy(resolve, true, t('loading'));
    try {
      const resolution = await data.resolveActivityPerson(ctx, query);
      const candidates = resolution.candidates || [];
      if (!candidates.length) { results.replaceChildren(h('p', { class: 'sheet-note' }, t('act_person_no_match'))); return; }
      results.replaceChildren(...candidates.map(candidate => h('button', {
        class: 'btn btn-ghost act-person-candidate', type: 'button',
        onclick: event => {
          chosen = candidate;
          selected.textContent = `${t('act_person_selected')}: ${candidate.displayName} · #${candidate.id}`;
          submit.disabled = false;
          results.querySelectorAll('.act-person-candidate').forEach(button => button.classList.remove('sel'));
          event.currentTarget.classList.add('sel');
        },
      }, `${candidate.displayName} · ${candidate.occupation || t('occupation_empty')} · ${candidate.organization || ''} · #${candidate.id}`)));
      if (resolution.hasMore) results.append(h('p', { class: 'sheet-note' }, t('relationship_candidates_limited')));
    } catch (error) { sheet.showErr(errorText(error)); }
    finally { setBusy(resolve, false, t('act_person_resolve')); }
  };
  submit.onclick = async () => {
    if (!chosen || submit.disabled) return;
    setBusy(submit, true, t('saving'));
    try {
      const saved = await data.addCanonicalParticipant(ctx, {
        activityId: String(activity.id), personType: type.value, canonicalPersonId: String(chosen.id),
        selectedDisplayName: chosen.displayName, status: status.value, relationshipNote: note.value.trim() || null,
        confirmed: true,
      });
      if (!saved.id || !saved.canonicalPersonId) throw new Error(t('save_failed'));
      sheet.overlay.remove(); ctx.toast(t('act_participant_added'), 'ok'); onDone?.();
    } catch (error) { setBusy(submit, false, t('act_participant_confirm_add')); sheet.showErr(errorText(error)); }
  };
}

function openTemporaryParticipant(ctx, activity, onDone) {
  const name = input('text', '', { maxlength: '160', required: true });
  const type = select(PARTICIPANT_TYPES.map(value => [value, typeLabel(value)]), 'customer');
  const note = textarea('', { maxlength: '4000', rows: '3' });
  const sheet = openSheet({ title: t('act_temp_participant_title'), sub: t('act_temp_participant_warning'), body: h('div', { class: 'sheet-stack' }, [
    h('div', { class: 'sheet-note act-warning' }, t('act_temp_participant_warning')),
    field(t('act_person_name'), name), field(t('act_participant_type'), type), field(t('act_participant_note'), note),
    actions(() => sheet.overlay.remove(), save, t('act_temp_participant_confirm')),
  ]) });
  document.body.appendChild(sheet.overlay);
  const button = sheet.overlay.querySelector('.sheet-actions .btn-primary');
  async function save() {
    if (!name.value.trim()) { sheet.showErr(t('act_person_name_required')); return; }
    setBusy(button, true, t('saving'));
    try {
      const result = await data.addTemporaryParticipant(ctx, { activity_id: Number(activity.id),
        person_type: type.value, person_name: name.value.trim(), status: 'invited',
        relationship_note: note.value.trim() || null });
      if (!result.id || result.linked !== false) throw new Error(t('save_failed'));
      sheet.overlay.remove(); ctx.toast(t('act_temp_participant_added'), 'ok'); onDone?.();
    } catch (error) { setBusy(button, false, t('act_temp_participant_confirm')); sheet.showErr(errorText(error)); }
  }
}

function openLinkParticipant(ctx, activity, participant, onDone) {
  const name = input('search', participant.person_name || '', { maxlength: '160' });
  const results = h('div', { class: 'act-person-results' });
  const selected = h('p', { class: 'sheet-note' }, t('act_person_not_selected'));
  const resolve = h('button', { class: 'btn btn-ghost', type: 'button' }, t('act_person_resolve'));
  let chosen = null;
  const sheet = openSheet({ title: t('act_link_person_title'), sub: t('act_link_person_note'), body: h('div', { class: 'sheet-stack' }, [
    field(t('act_person_name'), name), h('div', { class: 'sheet-actions' }, [resolve]), results, selected,
    h('div', { class: 'sheet-actions' }, [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
      h('button', { class: 'btn btn-primary act-link-confirm', type: 'button', disabled: true }, t('act_link_person_confirm'))]),
  ]) });
  document.body.appendChild(sheet.overlay);
  const confirm = sheet.overlay.querySelector('.act-link-confirm');
  name.oninput = () => { chosen = null; confirm.disabled = true; selected.textContent = t('act_person_not_selected'); results.replaceChildren(); };
  resolve.onclick = async () => {
    const query = name.value.trim(); chosen = null; confirm.disabled = true; results.replaceChildren();
    if (!query) { sheet.showErr(t('act_person_name_required')); return; }
    setBusy(resolve, true, t('loading'));
    try {
      const resolution = await data.resolveActivityPerson(ctx, query);
      const candidates = resolution.candidates || [];
      if (!candidates.length) { results.replaceChildren(h('p', { class: 'sheet-note' }, t('act_person_no_match'))); return; }
      results.replaceChildren(...candidates.map(candidate => h('button', { class: 'btn btn-ghost act-person-candidate', type: 'button', onclick: event => {
        chosen = candidate; confirm.disabled = false;
        selected.textContent = `${t('act_person_selected')}: ${candidate.displayName} · #${candidate.id}`;
        results.querySelectorAll('.act-person-candidate').forEach(button => button.classList.remove('sel'));
        event.currentTarget.classList.add('sel');
      } }, `${candidate.displayName} · #${candidate.id}`)));
    } catch (error) { sheet.showErr(errorText(error)); }
    finally { setBusy(resolve, false, t('act_person_resolve')); }
  };
  confirm.onclick = async () => {
    if (!chosen || confirm.disabled) return;
    setBusy(confirm, true, t('saving'));
    try {
      const result = await data.linkCanonicalParticipant(ctx, { participantId: String(participant.id),
        activityId: String(activity.id), canonicalPersonId: String(chosen.id), selectedDisplayName: chosen.displayName,
        expectedUpdatedAt: participant.updated_at, confirmed: true });
      if (result.ok !== true) throw new Error(t('save_failed'));
      sheet.overlay.remove(); ctx.toast(t('act_person_linked'), 'ok'); onDone?.();
    } catch (error) { setBusy(confirm, false, t('act_link_person_confirm')); sheet.showErr(errorText(error)); }
  };
}

function openParticipantStatus(ctx, activity, participant, onDone) {
  const status = select(PARTICIPANT_STATUSES.map(value => [value, t(`part_${value}`)]), participant.status || 'invited');
  const sheet = openSheet({ title: t('act_participant_status_title'), sub: participant.person_name || `#${participant.id}`, body: h('div', { class: 'sheet-stack' }, [
    field(t('act_participant_status'), status), h('div', { class: 'sheet-note' }, t('act_attendance_not_interaction')),
    actions(() => sheet.overlay.remove(), save, t('btn_save')),
  ]) });
  document.body.appendChild(sheet.overlay);
  const button = sheet.overlay.querySelector('.sheet-actions .btn-primary');
  async function save() {
    setBusy(button, true, t('saving'));
    try {
      const result = await data.updateActivityParticipant(ctx, participant.id, activity.id, participant.updated_at,
        participant.status || 'invited', status.value);
      if (result.ok !== true) throw new Error(result.error || t('act_participant_conflict'));
      sheet.overlay.remove(); ctx.toast(t('act_participant_status_saved'), 'ok'); onDone?.();
    } catch (error) { setBusy(button, false, t('btn_save')); sheet.showErr(errorText(error)); }
  }
}

export function renderActivityParticipants(ctx, activity, participants, onDone) {
  const refresh = onDone || (() => {});
  const groups = ['attended', 'invited', 'absent'];
  const blocks = [
    h('div', { class: 'act-note-row' }, [h('p', { class: 'sheet-note' }, t('act_attendance_not_interaction')),
      h('div', { class: 'sheet-actions' }, [
        h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => openParticipantAdd(ctx, activity, refresh) }, t('act_participant_add')),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => openTemporaryParticipant(ctx, activity, refresh) }, t('act_temp_participant_add')),
      ])]),
  ];
  for (const status of groups) {
    const rows = participants.filter(participant => (participant.status || 'invited') === status);
    if (!rows.length) continue;
    blocks.push(sectionTitle(`${t(`part_${status}`)}（${rows.length}）`, bdg(String(rows.length), statusTone[status])));
    blocks.push(h('div', {}, rows.map(participant => {
      const name = participant.person_name || (participant.person_id ? `#${participant.person_id}` : t('act_temp_name'));
      const label = participant.canonical_person_id ? typeLabel('person') : typeLabel(participant.person_type);
      const person = participant.canonical_person_id
        ? h('a', { href: `#/person/${participant.canonical_person_id}`, class: 'act-person-link' }, name)
        : h('span', {}, name);
      return h('article', { class: 'list-row act-resource-row' }, [
        h('div', { class: 'act-resource-main' }, [h('div', { class: 'row-title' }, [bdg(label, participant.person_type === 'recruit' ? 'gold' : 'ink'), person]),
          participant.relationship_note ? h('div', { class: 'row-sub' }, participant.relationship_note) : null,
          participant.canonical_person_id ? h('div', { class: 'row-sub' }, `Person #${participant.canonical_person_id}`) : null]),
        h('div', { class: 'act-resource-actions' }, [
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => openParticipantStatus(ctx, activity, participant, refresh) }, t('act_participant_change_status')),
          participant.canonical_person_id ? null : h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => openLinkParticipant(ctx, activity, participant, refresh) }, t('act_link_person')),
        ]),
      ]);
    })));
  }
  if (participants.length === 0) blocks.push(emptyNote(t('act_no_participants'), t('act_participant_empty_note')));
  return h('div', { class: 'tab-stack act-people' }, blocks);
}

function openSpeakerEditor(ctx, speaker, onDone) {
  const temporary = !!speaker?._temporary;
  const editing = !!speaker && !temporary;
  const linked = !!speaker?.person_id;
  const name = input('text', speaker?.name, { maxlength: '160', required: true, ...(linked ? { readonly: true } : {}) });
  const position = input('text', speaker?.position, { maxlength: '240' });
  const expertise = textarea(speaker?.expertise, { maxlength: '4000', rows: '2' });
  const topics = textarea(speaker?.topic_summary, { maxlength: '4000', rows: '2' });
  const stage = select(SPEAKER_STAGES.map(value => [value, translateEnum('speaker_stage', value) || t(`act_speaker_stage_${value}`)]), speaker?.relationship_stage || 'new');
  const status = select([['active', t('act_resource_active')], ['inactive', t('act_resource_inactive')]], speaker?.status || 'active');
  const next = input('date', dateOnly(speaker?.next_contact_date));
  const last = input('date', dateOnly(speaker?.last_contact_date));
  const lastNote = textarea(speaker?.last_contact_note, { maxlength: '2000', rows: '2' });
  const format = input('text', speaker?.preferred_format, { maxlength: '500' });
  const count = input('number', speaker?.cooperation_count ?? '0', { min: '0', max: '100000', step: '1' });
  const notes = textarea(speaker?.notes, { maxlength: '4000', rows: '3' });
  const results = h('div', { class: 'act-person-results' });
  const selected = h('p', { class: 'sheet-note' }, t('act_person_not_selected'));
  const resolve = h('button', { class: 'btn btn-ghost', type: 'button' }, t('act_person_resolve'));
  let chosen = null;
  const identityControls = !editing && !temporary ? [
    h('div', { class: 'sheet-actions' }, [resolve]), results, selected,
    h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => {
      const legacyName = name.value.trim();
      if (!legacyName) { sheet.showErr(t('act_speaker_name_required')); return; }
      sheet.overlay.remove(); openSpeakerEditor(ctx, { name: legacyName, _temporary: true }, onDone);
    } }, t('act_temp_speaker_add')),
  ] : temporary ? [h('div', { class: 'act-warning' }, t('act_temp_speaker_warning'))]
    : !linked ? [h('div', { class: 'sheet-note' }, t('act_speaker_unlinked_note'))]
      : [h('div', { class: 'sheet-note' }, `${t('act_speaker_person_linked')} · Person #${speaker.person_id}`)];
  const sheet = openSheet({ title: t(editing ? 'act_speaker_edit_title' : 'act_speaker_create_title'), sub: t('act_speaker_identity_note'), body: h('div', { class: 'sheet-stack' }, [
    field(t('act_speaker_name'), name), ...identityControls,
    field(t('act_speaker_position'), position), field(t('act_speaker_expertise'), expertise),
    field(t('act_speaker_topics'), topics), field(t('act_speaker_stage'), stage), field(t('act_resource_status'), status),
    field(t('act_speaker_last_date'), last), field(t('act_speaker_next_date'), next), field(t('act_speaker_last_note'), lastNote),
    field(t('act_speaker_format'), format), field(t('act_speaker_count'), count), field(t('act_speaker_notes'), notes),
    h('div', { class: 'sheet-actions' }, [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
      h('button', { class: 'btn btn-primary act-speaker-save', type: 'button' }, t(editing ? 'btn_save' : 'act_speaker_confirm_create'))]),
  ]) });
  document.body.appendChild(sheet.overlay);
  const save = sheet.overlay.querySelector('.act-speaker-save');
  if (!editing && !temporary) name.oninput = () => {
    chosen = null; save.disabled = true; selected.textContent = t('act_person_not_selected'); results.replaceChildren();
  };
  if (!editing) resolve.onclick = async () => {
    chosen = null; results.replaceChildren(); save.disabled = true;
    if (!name.value.trim()) { sheet.showErr(t('act_speaker_name_required')); return; }
    setBusy(resolve, true, t('loading'));
    try {
      const result = await data.resolveActivityPerson(ctx, name.value.trim());
      const candidates = result.candidates || [];
      if (!candidates.length) { results.replaceChildren(h('p', { class: 'sheet-note' }, t('act_person_no_match'))); return; }
      results.replaceChildren(...candidates.map(candidate => h('button', { class: 'btn btn-ghost act-person-candidate', type: 'button', onclick: event => {
        chosen = candidate; save.disabled = false; name.value = candidate.displayName;
        selected.textContent = `${t('act_person_selected')}: ${candidate.displayName} · #${candidate.id}`;
        results.querySelectorAll('.act-person-candidate').forEach(button => button.classList.remove('sel'));
        event.currentTarget.classList.add('sel');
      } }, `${candidate.displayName} · ${candidate.organization || candidate.occupation || ''} · #${candidate.id}`)));
    } catch (error) { sheet.showErr(errorText(error)); }
    finally { setBusy(resolve, false, t('act_person_resolve')); }
  };
  save.onclick = async () => {
    if (save.disabled) return;
    if (!name.value.trim() || (editing && linked && name.value !== speaker.name)) { sheet.showErr(t('act_speaker_name_required')); return; }
    const numericCount = Number(count.value);
    if (!Number.isSafeInteger(numericCount) || numericCount < 0) { sheet.showErr(t('act_speaker_count_invalid')); return; }
    const profile = { position: position.value.trim() || null, expertise: expertise.value.trim() || null,
      topic_summary: topics.value.trim() || null, relationship_stage: stage.value, status: status.value,
      last_contact_date: last.value || null, next_contact_date: next.value || null,
      last_contact_note: lastNote.value.trim() || null, preferred_format: format.value.trim() || null,
      cooperation_count: numericCount, notes: notes.value.trim() || null };
    setBusy(save, true, t('saving'));
    try {
      let result;
      if (temporary) {
        result = await ctx.api.call('activity_speakers', { action: 'create', data: { name: name.value.trim(), ...profile } });
        if (!result?.id) throw new Error(result?.error || t('save_failed'));
      } else if (editing) {
        result = await data.updateActivitySpeaker(ctx, speaker.id, profile);
        if (result.ok !== true) throw new Error(result.error || t('save_failed'));
      } else {
        if (!chosen) throw new Error(t('act_person_not_selected'));
        result = await data.createPersonSpeaker(ctx, { personId: String(chosen.id), selectedDisplayName: chosen.displayName,
          confirmed: true, profile });
        if (!result.id) throw new Error(result.error || t('save_failed'));
      }
      sheet.overlay.remove(); ctx.toast(t(editing ? 'act_speaker_saved' : 'act_speaker_created'), 'ok'); onDone?.();
    } catch (error) { setBusy(save, false, t(editing ? 'btn_save' : 'act_speaker_confirm_create')); sheet.showErr(errorText(error)); }
  };
  if (!editing && !temporary) save.disabled = true;
}

function openSpeakerLink(ctx, speaker, onDone) {
  const name = input('search', speaker.name || '', { maxlength: '160' });
  const results = h('div', { class: 'act-person-results' }), selected = h('p', { class: 'sheet-note' }, t('act_person_not_selected'));
  const resolve = h('button', { class: 'btn btn-ghost', type: 'button' }, t('act_person_resolve'));
  let chosen = null;
  const sheet = openSheet({ title: t('act_speaker_link_title'), sub: t('act_speaker_link_note'), body: h('div', { class: 'sheet-stack' }, [
    field(t('act_person_name'), name), h('div', { class: 'sheet-actions' }, [resolve]), results, selected,
    h('div', { class: 'sheet-actions' }, [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
      h('button', { class: 'btn btn-primary act-speaker-link-confirm', type: 'button', disabled: true }, t('act_speaker_link_confirm'))]),
  ]) });
  document.body.appendChild(sheet.overlay);
  const confirm = sheet.overlay.querySelector('.act-speaker-link-confirm');
  name.oninput = () => { chosen = null; confirm.disabled = true; selected.textContent = t('act_person_not_selected'); results.replaceChildren(); };
  resolve.onclick = async () => {
    chosen = null; confirm.disabled = true; results.replaceChildren();
    if (!name.value.trim()) { sheet.showErr(t('act_person_name_required')); return; }
    setBusy(resolve, true, t('loading'));
    try {
      const result = await data.resolveActivityPerson(ctx, name.value.trim());
      const candidates = result.candidates || [];
      if (!candidates.length) { results.replaceChildren(h('p', { class: 'sheet-note' }, t('act_person_no_match'))); return; }
      results.replaceChildren(...candidates.map(candidate => h('button', { class: 'btn btn-ghost act-person-candidate', type: 'button', onclick: event => {
        chosen = candidate; confirm.disabled = false;
        selected.textContent = `${t('act_person_selected')}: ${candidate.displayName} · #${candidate.id}`;
        results.querySelectorAll('.act-person-candidate').forEach(button => button.classList.remove('sel'));
        event.currentTarget.classList.add('sel');
      } }, `${candidate.displayName} · #${candidate.id}`)));
    } catch (error) { sheet.showErr(errorText(error)); }
    finally { setBusy(resolve, false, t('act_person_resolve')); }
  };
  confirm.onclick = async () => {
    if (!chosen || confirm.disabled) return;
    setBusy(confirm, true, t('saving'));
    try {
      const result = await data.linkSpeakerPerson(ctx, { speakerId: String(speaker.id), personId: String(chosen.id),
        selectedDisplayName: chosen.displayName, confirmed: true });
      if (result.ok !== true) throw new Error(result.error || t('save_failed'));
      sheet.overlay.remove(); ctx.toast(t('act_speaker_linked'), 'ok'); onDone?.();
    } catch (error) { setBusy(confirm, false, t('act_speaker_link_confirm')); sheet.showErr(errorText(error)); }
  };
}

async function confirmResourceRemove(ctx, kind, item, onDone) {
  const isSpeaker = kind === 'speaker';
  const preview = isSpeaker ? await data.previewRemoveSpeaker(ctx, item.id) : await data.previewRemoveTopic(ctx, item.id);
  const resource = preview[isSpeaker ? 'speaker' : 'topic'];
  const count = preview.impact?.[isSpeaker ? 'participantRows' : 'activityReferences'];
  if (!resource?.updated_at || !Number.isInteger(count)) throw new Error(t('act_resource_preview_failed'));
  const impactLabel = t(isSpeaker ? 'act_speaker_references' : 'act_topic_references');
  const sheet = openSheet({ title: t('act_resource_remove_title'), sub: resource.name || resource.topic_name,
    body: h('div', { class: 'sheet-stack' }, [h('p', { class: 'sheet-note' }, t('act_resource_remove_note')),
      h('div', { class: 'kv-grid' }, [h('div', { class: 'kv-line' }, [h('span', { class: 'kv-k' }, impactLabel), h('span', {}, String(count))])]),
      count ? h('p', { class: 'act-warning' }, t(isSpeaker ? 'act_speaker_remove_blocked' : 'act_topic_remove_blocked')) : null,
      actions(() => sheet.overlay.remove(), remove, t('act_resource_remove_confirm'), true),
    ]) });
  document.body.appendChild(sheet.overlay);
  const button = sheet.overlay.querySelector('.sheet-actions .btn-primary');
  if (count > 0) button.disabled = true;
  async function remove() {
    setBusy(button, true, t('deleting'));
    try {
      const result = isSpeaker
        ? await data.removeSpeaker(ctx, item.id, resource.updated_at, count)
        : await data.removeActivityTopic(ctx, item.id, resource.updated_at, count);
      if (result.ok !== true) throw new Error(result.error || t('delete_failed'));
      sheet.overlay.remove(); ctx.toast(t('act_resource_removed'), 'ok'); onDone?.();
    } catch (error) { setBusy(button, false, t('act_resource_remove_confirm')); sheet.showErr(errorText(error)); }
  }
}

function openTopicEditor(ctx, topic, onDone) {
  const editing = !!topic;
  const name = input('text', topic?.topic_name, { maxlength: '200', required: true });
  const category = input('text', topic?.category, { maxlength: '120' });
  const audience = input('text', topic?.target_audience, { maxlength: '500' });
  const keywords = input('text', Array.isArray(topic?.keywords) ? topic.keywords.join(', ') : '', { maxlength: '1000' });
  const description = textarea(topic?.description, { maxlength: '4000', rows: '3' });
  const summary = textarea(topic?.ai_summary, { maxlength: '4000', rows: '3' });
  const notes = textarea(topic?.notes, { maxlength: '4000', rows: '2' });
  const status = select([['active', t('act_resource_active')], ['inactive', t('act_resource_inactive')]], topic?.status || 'active');
  const sheet = openSheet({ title: t(editing ? 'act_topic_edit_title' : 'act_topic_create_title'), sub: t('act_topic_stats_note'), body: h('div', { class: 'sheet-stack' }, [
    field(t('act_topic_name'), name), field(t('act_topic_category'), category), field(t('act_topic_audience'), audience),
    field(t('act_topic_keywords'), keywords), field(t('act_topic_description'), description),
    field(t('act_topic_summary'), summary), field(t('act_topic_notes'), notes), field(t('act_resource_status'), status),
    h('div', { class: 'sheet-note' }, t('act_topic_stats_note')),
    actions(() => sheet.overlay.remove(), save, t(editing ? 'btn_save' : 'act_topic_confirm_create')),
  ]) });
  document.body.appendChild(sheet.overlay);
  const button = sheet.overlay.querySelector('.sheet-actions .btn-primary');
  async function save() {
    if (!name.value.trim()) { sheet.showErr(t('act_topic_name_required')); return; }
    setBusy(button, true, t('saving'));
    const payload = { topic_name: name.value.trim(), category: category.value.trim() || null,
      target_audience: audience.value.trim() || null, keywords: keywords.value.split(',').map(value => value.trim()).filter(Boolean),
      description: description.value.trim() || null, ai_summary: summary.value.trim() || null,
      notes: notes.value.trim() || null, status: status.value };
    try {
      const result = editing ? await data.updateActivityTopic(ctx, topic.id, payload) : await data.createActivityTopic(ctx, payload);
      if (editing ? result.ok !== true : !result.id) throw new Error(result.error || t('save_failed'));
      sheet.overlay.remove(); ctx.toast(t(editing ? 'act_topic_saved' : 'act_topic_created'), 'ok'); onDone?.();
    } catch (error) { setBusy(button, false, t(editing ? 'btn_save' : 'act_topic_confirm_create')); sheet.showErr(errorText(error)); }
  }
}

function renderTopicAssignment(ctx, activity, topics, onDone) {
  const original = (Array.isArray(activity.topic_ids) ? activity.topic_ids : []).map(String);
  const topicMap = new Map(topics.map(topic => [String(topic.id), topic]));
  const missing = original.filter(id => !topicMap.has(id));
  const chosen = new Set(original.filter(id => topicMap.has(id)));
  const list = h('div', { class: 'act-topic-picks' }, topics.map(topic => {
    const id = String(topic.id), currentlySelected = chosen.has(id);
    const checkbox = h('input', { type: 'checkbox', checked: currentlySelected, disabled: topic.status !== 'active' && !currentlySelected,
      onchange: () => { if (checkbox.checked) chosen.add(id); else chosen.delete(id); } });
    return h('label', { class: 'act-topic-pick' }, [checkbox, h('span', {}, [h('b', {}, topic.topic_name),
      h('small', {}, `${topic.category || t('act_topic_uncategorized')} · ${t('act_topic_usage_count')} ${topic.use_count || 0}`)]),
      topic.status === 'inactive' ? bdg(t('act_resource_inactive'), 'gray') : null]);
  }));
  const acknowledge = h('input', { type: 'checkbox' });
  const save = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, t('act_topics_save'));
  save.onclick = async () => {
    if (missing.length && !acknowledge.checked) return;
    setBusy(save, true, t('saving'));
    try {
      const result = await data.applyActivityTopics(ctx, activity.id, [...chosen], activity.updated_at, original.map(Number));
      if (result.ok !== true) throw new Error(result.error || t('act_topics_conflict'));
      ctx.toast(t('act_topics_saved'), 'ok'); onDone?.();
    } catch (error) { setBusy(save, false, t('act_topics_save')); ctx.toast(errorText(error), 'err'); }
  };
  return h('div', { class: 'act-topic-assignment' }, [
    h('div', { class: 'act-note-row' }, [h('p', { class: 'sheet-note' }, t('act_topic_assignment_note')),
      h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => openTopicEditor(ctx, null, onDone) }, t('act_topic_add'))]),
    missing.length ? h('div', { class: 'act-warning' }, [h('p', {}, `${t('act_topics_missing')}: ${missing.join(', ')}`),
      h('label', { class: 'act-missing-confirm' }, [acknowledge, t('act_topics_remove_missing_confirm')])]) : null,
    topics.length ? list : emptyNote(t('act_topics_empty'), t('act_topics_empty_note')),
    h('div', { class: 'sheet-actions act-topics-save' }, [save]),
  ]);
}

export function renderResourceDirectory(ctx) {
  const state = { kind: 'speaker', keyword: '', status: '', page: 1, pageSize: 20 };
  const host = h('div', { class: 'resource-directory-results' });
  const kind = select([['speaker', t('act_speakers_title')], ['topic', t('act_topics_title')]], state.kind);
  kind.setAttribute('aria-label', t('resource_directory_kind'));
  const keyword = input('search', '', { placeholder: t('resource_directory_search'), 'aria-label': t('resource_directory_search'), maxlength: '120' });
  const status = select([['', t('resource_directory_all')], ['active', t('act_resource_active')], ['inactive', t('act_resource_inactive')]], '');
  status.setAttribute('aria-label', t('resource_directory_status'));
  let request = 0;
  async function load() {
    const version = ++request;
    host.replaceChildren(h('p', { class: 'muted' }, t('loading')));
    const node = await renderActivityResources(ctx, null, load, { ...state });
    if (version === request && host.isConnected) host.replaceChildren(node);
  }
  const form = h('form', { class: 'more-actions', onsubmit: event => {
    event.preventDefault(); state.kind = kind.value; state.keyword = keyword.value.trim();
    state.status = status.value; state.page = 1; load();
  } }, [kind, keyword, status, h('button', { class: 'btn btn-primary', type: 'submit' }, t('pc21_query'))]);
  ctx.main.replaceChildren(
    pageHead({ title: t('resource_directory_title'), sub: t('resource_directory_note'),
      actions: [h('a', { class: 'btn btn-ghost', href: '#/activities' }, t('title_activities'))] }),
    form, host,
    h('details', { class: 'card card-body' }, [h('summary', {}, t('resource_directory_legacy')),
      h('p', { class: 'foot-note' }, t('resource_directory_legacy_note')),
      h('div', { class: 'more-actions' }, [
        h('a', { class: 'btn btn-ghost', href: '/crm/admin.html#/speakers' }, t('act_speakers_title')),
        h('a', { class: 'btn btn-ghost', href: '/crm/admin.html#/topics' }, t('act_topics_title')),
      ]),
    ]),
  );
  load();
}

export async function renderActivityResources(ctx, activityId, onDone, directory = null) {
  const root = h('div', { class: 'tab-stack act-resources' }, [h('p', { class: 'muted' }, t(directory ? 'resource_directory_note' : 'act_resources_note'))]);
  try {
    const showSpeakers = !directory || directory.kind === 'speaker';
    const showTopics = !directory || directory.kind === 'topic';
    const [detail, speakerResult, topicResult] = directory ? [null,
      showSpeakers ? await data.resourceDirectory(ctx, 'speaker', directory) : { rows: [] },
      showTopics ? await data.resourceDirectory(ctx, 'topic', directory) : { rows: [] },
    ] : await Promise.all([
      data.activityDetail(ctx, activityId), data.activitySpeakers(ctx), data.activityTopics(ctx),
    ]);
    if (!directory && !detail.activity) throw new Error(t('act_activity_not_found'));
    const refresh = () => renderActivityResources(ctx, activityId, onDone, directory).then(node => root.replaceWith(node)).catch(() => {});
    const speakers = speakerResult.rows || [], topics = topicResult.rows || [];
    if (showSpeakers) {
    root.append(sectionTitle(t('act_speakers_title'), h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => openSpeakerEditor(ctx, null, refresh) }, t('act_speaker_add'))));
    root.append(speakers.length ? h('div', {}, speakers.map(speaker => h('article', { class: 'list-row act-resource-row' }, [
      h('div', { class: 'act-resource-main' }, [h('div', { class: 'row-title' }, [speaker.linked_person
        ? h('a', { href: `#/person/${speaker.linked_person.id}`, class: 'act-person-link' }, speaker.linked_person.name)
        : h('span', {}, speaker.name), bdg(translateEnum('speaker_stage', speaker.relationship_stage || 'new'), 'ink'),
        bdg(t(speaker.status === 'active' ? 'act_resource_active' : 'act_resource_inactive'), speaker.status === 'active' ? 'jade' : 'gray')]),
        h('div', { class: 'row-sub' }, [speaker.position, speaker.organization, speaker.expertise].filter(Boolean).join(' · ') || t('act_speaker_profile_empty')),
        speaker.topic_summary ? h('div', { class: 'row-sub' }, speaker.topic_summary) : null,
        !speaker.person_id ? h('div', { class: 'row-sub' }, t('act_speaker_unlinked_note')) : null]),
      h('div', { class: 'act-resource-actions' }, [
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => openSpeakerEditor(ctx, speaker, refresh) }, t('btn_edit')),
        !speaker.person_id ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => openSpeakerLink(ctx, speaker, refresh) }, t('act_speaker_link')) : null,
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => {
          try { const result = await data.updateActivitySpeaker(ctx, speaker.id, { status: speaker.status === 'active' ? 'inactive' : 'active' });
            if (result.ok !== true) throw new Error(t('save_failed')); ctx.toast(t('act_resource_status_saved'), 'ok'); refresh();
          } catch (error) { ctx.toast(errorText(error), 'err'); }
        } }, t(speaker.status === 'active' ? 'act_resource_deactivate' : 'act_resource_activate')),
        h('button', { class: 'btn btn-ghost btn-sm act-resource-delete', type: 'button', onclick: async () => {
          try { await confirmResourceRemove(ctx, 'speaker', speaker, refresh); } catch (error) { ctx.toast(errorText(error), 'err'); }
        } }, t('act_resource_remove')),
      ]),
    ]))) : emptyNote(t('act_speakers_empty'), t('act_speakers_empty_note')));

    }
    if (showTopics) {
    root.append(sectionTitle(t('act_topics_title'), h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => openTopicEditor(ctx, null, refresh) }, t('act_topic_add'))));
    if (!directory) root.append(renderTopicAssignment(ctx, detail.activity, topics, refresh));
    root.append(h('div', { class: 'act-topic-catalog' }, topics.map(topic => h('article', { class: 'list-row act-resource-row' }, [
      h('div', { class: 'act-resource-main' }, [h('div', { class: 'row-title' }, [h('span', {}, topic.topic_name),
        bdg(t(topic.status === 'active' ? 'act_resource_active' : 'act_resource_inactive'), topic.status === 'active' ? 'jade' : 'gray')]),
        h('div', { class: 'row-sub' }, `${topic.category || t('act_topic_uncategorized')} · ${t('act_topic_usage_count')} ${topic.use_count || 0}${topic.last_used_date ? ` · ${topic.last_used_date}` : ''}`),
        topic.description ? h('div', { class: 'row-sub' }, topic.description) : null]),
      h('div', { class: 'act-resource-actions' }, [
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => openTopicEditor(ctx, topic, refresh) }, t('btn_edit')),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => {
          try { const result = await data.updateActivityTopic(ctx, topic.id, { status: topic.status === 'active' ? 'inactive' : 'active' });
            if (result.ok !== true) throw new Error(t('save_failed')); ctx.toast(t('act_resource_status_saved'), 'ok'); refresh();
          } catch (error) { ctx.toast(errorText(error), 'err'); }
        } }, t(topic.status === 'active' ? 'act_resource_deactivate' : 'act_resource_activate')),
        h('button', { class: 'btn btn-ghost btn-sm act-resource-delete', type: 'button', onclick: async () => {
          try { await confirmResourceRemove(ctx, 'topic', topic, refresh); } catch (error) { ctx.toast(errorText(error), 'err'); }
        } }, t('act_resource_remove')),
      ]),
    ]))));
    if (directory && !topics.length) root.append(emptyNote(t('act_topics_empty'), t('act_topics_empty_note')));
    }
    if (directory) {
      const result = showSpeakers ? speakerResult : topicResult;
      if (!Array.isArray(result.rows) || typeof result.hasMore !== 'boolean') throw new Error(t('resource_directory_invalid'));
      const move = delta => {
        root.querySelectorAll('.pager button').forEach(button => { button.disabled = true; });
        renderActivityResources(ctx, activityId, onDone, { ...directory, page: directory.page + delta })
          .then(node => root.replaceWith(node));
      };
      root.append(h('div', { class: 'pager' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', disabled: directory.page <= 1, onclick: () => move(-1) }, t('btn_prev')),
        h('span', { class: 'pager-info' }, t('resource_directory_page').replace('{page}', String(directory.page))),
        h('button', { class: 'btn btn-ghost', type: 'button', disabled: !result.hasMore, onclick: () => move(1) }, t('btn_next')),
      ]));
    }
  } catch (error) {
    const message = String(error?.message || '').includes('RESOURCE_SEARCH_LIMIT') ? t('resource_directory_limit') : errorText(error);
    if (directory) root.replaceChildren(emptyNote(t('act_load_failed'), message),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => {
        renderActivityResources(ctx, activityId, onDone, directory).then(node => root.replaceWith(node));
      } }, t('resource_directory_retry')));
    else root.append(emptyNote(t('act_load_failed'), message));
  }
  return root;
}
