import { h } from './dom.js';
import { ic } from './icons.js';
import { openSheet } from './write.js';
import { data } from './data.js';
import { t, translateEnum } from './i18n.js';
import { emptyNote, fmtDate, sectionTitle } from './ui.js';

const STAGES = ['新增人才', '互动暖客', '初次面谈', '增员活动', '精准面谈', '入职申请', '签约入司', '流失'];
const FILES = [
  { key: 'radar_image_file_id', name: 'radar_image_name', kind: 'radar', label: 'recruit_file_radar', prefix: 'radar', accept: 'image/*' },
  { key: 'winner_report_file_id', name: 'winner_report_name', kind: 'report', label: 'recruit_file_report', prefix: 'winner_report', accept: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.jpg,.png' },
];
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const field = (key, value = '', type = 'text', attrs = {}) => h('input', {
  class: 'sheet-input', type, value: value == null ? '' : String(value), ...attrs,
});
const area = (key, value = '', rows = 3) => h('textarea', {
  class: 'sheet-input', rows, 'aria-label': t(key),
}, String(value || ''));
const fieldRow = (key, control, note) => h('div', { class: 'sheet-field' }, [
  h('label', {}, t(key)), control,
  note ? h('div', { class: 'sheet-note', style: 'margin-top:4px' }, note) : null,
]);
const actions = (cancel, save) => h('div', { class: 'sheet-actions' }, [
  h('button', { class: 'btn btn-ghost', type: 'button', onclick: cancel }, t('btn_cancel')),
  save,
]);
const saveButton = (handler) => h('button', { class: 'btn btn-primary', type: 'button', onclick: handler }, t('btn_save'));

export function openRecruitCandidateCreate(ctx, { initialName = '', onDone } = {}) {
  const name = field('recruit_identity_name', initialName, 'search', { maxlength: 160, autocomplete: 'off' });
  const results = h('div', {});
  const selectedBox = h('div', {});
  const save = saveButton(async (event) => {
    const button = event.currentTarget;
    const person = selectedBox._selected;
    if (!person) { sheet.showErr(t('recruit_identity_select_required')); return; }
    button.disabled = true;
    button.textContent = t('writing');
    try {
      const result = await data.createRecruitCandidate(ctx, {
        personId: String(person.id), selectedDisplayName: person.displayName,
        operator: ctx.operator?.name || '',
      });
      sheet.overlay.remove();
      ctx.toast(t('recruit_candidate_created'), 'ok');
      if (onDone) onDone(result.personId || person.id, result.id);
    } catch (error) {
      sheet.showErr(error.message || t('write_failed'));
      button.disabled = false;
      button.textContent = t('btn_save');
    }
  });
  save.disabled = true;
  const search = h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => {
    const query = name.value.trim();
    selectedBox._selected = null;
    save.disabled = true;
    results.replaceChildren(h('p', { class: 'sheet-note' }, t('loading')));
    if (!query) { results.replaceChildren(); return; }
    try {
      const resolution = await data.resolveRecruitCandidateName(ctx, query);
      if (resolution.deletedIdentity) {
        results.replaceChildren(h('p', { class: 'sheet-note' }, t('recruit_identity_deleted')));
        return;
      }
      const candidates = resolution.candidates || [];
      if (!candidates.length) {
        results.replaceChildren(h('p', { class: 'sheet-note' }, t('recruit_identity_no_match')));
        return;
      }
      results.replaceChildren(...candidates.map(person => h('button', {
        class: 'btn btn-ghost recruit-person-choice', type: 'button',
        onclick: event => {
          selectedBox._selected = person;
          selectedBox.replaceChildren(h('p', { class: 'sheet-note' }, [
            t('recruit_identity_selected'), `: ${person.displayName} · #${person.id}`,
            person.customerId ? ` · ${t('recruit_existing_customer')}` : ` · ${t('recruit_person_only')}`,
          ]));
          results.querySelectorAll('.recruit-person-choice').forEach(button => button.classList.remove('sel'));
          event.currentTarget.classList.add('sel');
          save.disabled = false;
        },
      }, `${person.displayName} · ${person.occupation || t('occupation_empty')} · ${person.organization || ''} · #${person.id}`)));
      if (resolution.hasMore) results.append(h('p', { class: 'sheet-note' }, t('recruit_identity_more')));
    } catch (error) {
      results.replaceChildren(h('p', { class: 'sheet-note' }, `${t('recruit_identity_search_failed')} ${error.message || ''}`));
    }
  } }, t('work_person_find'));
  const body = h('div', {}, [
    h('p', { class: 'sheet-note' }, t('recruit_identity_resolve_note')),
    fieldRow('recruit_identity_name', name),
    h('div', { class: 'sheet-actions' }, [search]),
    results, selectedBox,
    actions(() => sheet.overlay.remove(), save),
  ]);
  const sheet = openSheet({ title: t('recruit_create_title'), sub: t('recruit_create_sub'), body });
  document.body.appendChild(sheet.overlay);
  if (initialName) search.click();
}

function openProfileEditor(ctx, candidate, onDone) {
  const controls = {
    recruitment_priority: h('select', { class: 'sheet-select' }, [
      h('option', { value: '' }, t('recruit_priority_none')),
      ...['A', 'B', 'C', 'D', 'E'].map(value => h('option', {
        value, ...(candidate.recruitment_priority === value ? { selected: true } : {}),
      }, value)),
    ]),
    motivation: area('recruit_motivation', candidate.motivation),
    concerns: area('recruit_concerns', candidate.concerns),
    work_experience: area('recruit_work_experience', candidate.work_experience),
    family_situation: area('recruit_family_situation', candidate.family_situation),
    personality_tags: field('recruit_personality_tags', candidate.personality_tags),
    career_plan: area('recruit_career_plan', candidate.career_plan),
    next_action: area('recruit_next_action', candidate.next_action, 2),
    next_action_date: field('recruit_next_action_date', candidate.next_action_date, 'date'),
  };
  const save = saveButton(async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const payload = Object.fromEntries(Object.entries(controls).map(([key, control]) => [key, control.value.trim()]));
      payload.operator = ctx.operator?.name || '';
      const result = await data.updateRecruitCandidate(ctx, candidate.id, candidate.updated_at, payload);
      if (!result.ok) throw new Error(result.conflict ? t('recruit_conflict') : t('write_failed'));
      sheet.overlay.remove();
      ctx.toast(t('recruit_profile_saved'), 'ok');
      if (onDone) onDone();
    } catch (error) {
      sheet.showErr(error.message || t('write_failed'));
      button.disabled = false;
    }
  });
  const body = h('div', {}, [
    fieldRow('recruit_priority', controls.recruitment_priority),
    ...[
      ['recruit_motivation', 'motivation'], ['recruit_concerns', 'concerns'],
      ['recruit_work_experience', 'work_experience'], ['recruit_family_situation', 'family_situation'],
      ['recruit_personality_tags', 'personality_tags'], ['recruit_career_plan', 'career_plan'],
      ['recruit_next_action', 'next_action'], ['recruit_next_action_date', 'next_action_date'],
    ].map(([key, fieldKey]) => fieldRow(key, controls[fieldKey])),
    actions(() => sheet.overlay.remove(), save),
  ]);
  const sheet = openSheet({ title: t('recruit_profile_edit'), sub: t('recruit_profile_compat'), body });
  document.body.appendChild(sheet.overlay);
}

function openFollowupEditor(ctx, candidate, followup, onDone) {
  const controls = {
    followup_date: field('recruit_followup_date', followup?.followup_date || today(), 'date'),
    contact_method: field('recruit_contact_method', followup?.contact_method),
    interaction_summary: field('recruit_interaction_summary', followup?.interaction_summary),
    followup_notes: area('recruit_followup_notes', followup?.followup_notes),
    interest_level: field('recruit_interest_level', followup?.interest_level),
    concern_feedback: area('recruit_concern_feedback', followup?.concern_feedback, 2),
    next_action: field('recruit_next_action', followup?.next_action),
    next_action_date: field('recruit_next_action_date', followup?.next_action_date, 'date'),
    next_followup_date: field('recruit_next_followup_date', followup?.next_followup_date, 'date'),
    next_followup_goal: field('recruit_next_followup_goal', followup?.next_followup_goal),
  };
  const save = saveButton(async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const payload = Object.fromEntries(Object.entries(controls).map(([key, control]) => [key, control.value.trim()]));
      payload.operator = ctx.operator?.name || '';
      if (followup) await data.updateRecruitFollowup(ctx, followup.id, payload);
      else {
        payload.candidate_id = String(candidate.id);
        await data.createRecruitFollowup(ctx, payload);
      }
      sheet.overlay.remove();
      ctx.toast(t(followup ? 'recruit_followup_saved' : 'recruit_followup_created'), 'ok');
      if (onDone) onDone();
    } catch (error) {
      sheet.showErr(error.message || t('write_failed'));
      button.disabled = false;
    }
  });
  const body = h('div', {}, [
    fieldRow('recruit_followup_date', controls.followup_date),
    fieldRow('recruit_contact_method', controls.contact_method),
    fieldRow('recruit_interaction_summary', controls.interaction_summary),
    fieldRow('recruit_followup_notes', controls.followup_notes),
    fieldRow('recruit_interest_level', controls.interest_level),
    fieldRow('recruit_concern_feedback', controls.concern_feedback),
    fieldRow('recruit_next_action', controls.next_action),
    fieldRow('recruit_next_action_date', controls.next_action_date),
    fieldRow('recruit_next_followup_date', controls.next_followup_date),
    fieldRow('recruit_next_followup_goal', controls.next_followup_goal),
    actions(() => sheet.overlay.remove(), save),
  ]);
  const sheet = openSheet({ title: t(followup ? 'recruit_followup_edit' : 'recruit_followup_new'), body });
  document.body.appendChild(sheet.overlay);
}

function renderAttachments(ctx, candidate, onDone) {
  return h('div', {}, FILES.map(file => {
    const storedPath = candidate[file.key];
    const fileName = candidate[file.name];
    const fileInput = h('input', { type: 'file', accept: file.accept, style: 'display:none' });
    const upload = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => fileInput.click() },
      t(storedPath ? 'recruit_file_replace' : 'recruit_file_upload'));
    fileInput.onchange = async () => {
      const uploaded = fileInput.files?.[0];
      if (!uploaded) return;
      if (file.kind === 'radar' && uploaded.type && !uploaded.type.startsWith('image/')) {
        ctx.toast(t('recruit_file_invalid_image'), 'err'); fileInput.value = ''; return;
      }
      upload.disabled = true;
      try {
        if (!ctx.recruitFiles) throw new Error(t('recruit_file_unavailable'));
        const extension = (uploaded.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'bin';
        const path = `candidate_${candidate.id}/${file.prefix}_${Date.now()}.${extension}`;
        const response = await ctx.recruitFiles.upload(path, uploaded, {
          contentType: uploaded.type || 'application/octet-stream', upsert: true,
        });
        if (response?.error) throw new Error(response.error.message || t('recruit_file_upload_failed'));
        const savedPath = response?.data?.path || response?.data?.id || path;
        try {
          const result = await data.updateRecruitCandidate(ctx, candidate.id, candidate.updated_at, {
            [file.key]: savedPath, [file.name]: uploaded.name, operator: ctx.operator?.name || '',
          });
          if (!result.ok) throw new Error(result.conflict ? t('recruit_conflict') : t('write_failed'));
        } catch (error) {
          await ctx.recruitFiles.remove([savedPath]).catch(() => {});
          throw error;
        }
        if (storedPath) {
          try {
            const removed = await ctx.recruitFiles.remove([storedPath]);
            if (removed?.error) throw new Error(removed.error.message || String(removed.error));
          } catch (cleanupError) {
            ctx.toast(t('recruit_file_cleanup_needed'), 'err');
          }
        }
        ctx.toast(t('recruit_file_saved'), 'ok');
        if (onDone) onDone();
      } catch (error) { ctx.toast(error.message || t('recruit_file_upload_failed'), 'err'); }
      finally { upload.disabled = false; fileInput.value = ''; }
    };
    return h('div', { class: 'list-row', style: 'gap:8px;flex-wrap:wrap' }, [
      h('span', { style: 'flex:1;min-width:140px' }, [t(file.label), ' · ', fileName || t(storedPath ? 'recruit_file_attached' : 'recruit_file_empty')]),
      storedPath ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => {
        try {
          const result = await ctx.recruitFiles.createSignedUrl(storedPath, 3600);
          if (result?.error) throw new Error(result.error.message || t('recruit_file_link_failed'));
          const url = result?.data?.signedUrl || result?.data?.signedURL || result?.data?.url || result?.data;
          if (typeof url !== 'string') throw new Error(t('recruit_file_link_failed'));
          window.open(url, '_blank', 'noopener');
        } catch (error) { ctx.toast(error.message || t('recruit_file_link_failed'), 'err'); }
      } }, t('recruit_file_download')) : null,
      storedPath ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => {
        if (!window.confirm(t('recruit_file_delete_confirm'))) return;
        try {
          const result = await data.updateRecruitCandidate(ctx, candidate.id, candidate.updated_at, {
            [file.key]: '', [file.name]: '', operator: ctx.operator?.name || '',
          });
          if (!result.ok) throw new Error(result.conflict ? t('recruit_conflict') : t('write_failed'));
          ctx.toast(t('recruit_file_deleted'), 'ok');
          try {
            const removed = await ctx.recruitFiles.remove([storedPath]);
            if (removed?.error) throw new Error(removed.error.message || String(removed.error));
          } catch (cleanupError) { ctx.toast(t('recruit_file_cleanup_needed'), 'err'); }
          if (onDone) onDone();
        } catch (error) { ctx.toast(error.message || t('recruit_file_delete_failed'), 'err'); }
      } }, t('recruit_file_delete')) : null,
      upload, fileInput,
    ]);
  }));
}

export async function renderRecruitSection(ctx, personId, onDone) {
  const result = await data.recruitContext(ctx, personId);
  const person = await data.personHome(ctx, personId);
  const personName = person.person?.display_name || `Person #${personId}`;
  const rows = result.rows || [];
  if (!rows.length) return h('div', { class: 'tab-stack' }, [
    emptyNote(t('empty_no_recruit'), t('empty_recruit_note')),
    h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openRecruitCandidateCreate(ctx, {
      initialName: personName, onDone: () => onDone && onDone(),
    }) }, [ic('plus'), t('recruit_create_title')]),
  ]);

  const nodes = [];
  for (const row of rows) {
    const detail = await data.recruitCandidateDetails(ctx, row.id, personId);
    const candidate = detail.candidate || {};
    const reload = () => onDone && onDone();
    const stage = h('select', { class: 'sheet-select', 'aria-label': t('recruit_stage') }, STAGES.map(value => h('option', {
      value, ...(value === candidate.stage ? { selected: true } : {}),
    }, translateEnum('recruit_stage', value))));
    const note = field('recruit_stage_note', '');
    const stageButton = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async event => {
      const button = event.currentTarget; button.disabled = true;
      try {
        const updated = await data.transitionRecruitStage(ctx, {
          candidateId: String(candidate.id), personId: String(personId),
          expectedUpdatedAt: candidate.updated_at, stage: stage.value, note: note.value,
          operator: ctx.operator?.name || '',
        });
        if (updated.conflict) throw new Error(t('recruit_conflict'));
        if (!updated.ok) throw new Error(t('write_failed'));
        ctx.toast(t('recruit_stage_saved'), 'ok'); reload();
      } catch (error) { ctx.toast(error.message || t('write_failed'), 'err'); button.disabled = false; }
    } }, t('recruit_stage_save'));
    const followups = detail.followups || [];
    nodes.push(h('section', { class: 'card', style: 'overflow:hidden' }, [
      h('div', { class: 'card-head' }, [
        ic('recruit'), h('b', {}, t('recruit_candidate_title')),
        h('span', { style: 'margin-left:auto' }, translateEnum('recruit_stage', candidate.stage)),
      ]),
      h('div', { class: 'card-body tab-stack' }, [
        h('div', { class: 'form-row', style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [stage, note, stageButton]),
        h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => openProfileEditor(ctx, candidate, reload) }, t('recruit_profile_edit')),
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => openFollowupEditor(ctx, candidate, null, reload) }, t('recruit_followup_new')),
        ]),
        h('div', {}, [sectionTitle(t('recruit_files')), renderAttachments(ctx, candidate, reload)]),
        h('div', {}, [sectionTitle(t('recruit_milestones')), (detail.milestones || []).length
          ? h('div', {}, detail.milestones.map(item => h('div', { class: 'row-sub' }, [
            `${fmtDate(item.happened_at)} · `,
            item.from_stage ? `${translateEnum('recruit_stage', item.from_stage)} → ` : '',
            translateEnum('recruit_stage', item.to_stage), item.note ? ` · ${item.note}` : '',
          ]))) : emptyNote(t('recruit_milestones_empty'), '')]),
        h('div', {}, [sectionTitle(`${t('recruit_followups')} (${followups.length})`), followups.length
          ? h('div', {}, followups.map(item => h('div', { class: 'list-row', style: 'align-items:flex-start' }, [
            h('div', { style: 'flex:1;min-width:0' }, [
              h('b', {}, `${fmtDate(item.followup_date)} · ${item.contact_method || t('recruit_contact_unspecified')}`),
              h('div', { class: 'row-sub' }, item.interaction_summary || item.followup_notes || ''),
              item.next_action ? h('div', { class: 'row-sub' }, `${t('recruit_next_action')}: ${item.next_action}`) : null,
            ]),
            h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => openFollowupEditor(ctx, candidate, item, reload) }, t('btn_edit')),
          ]))) : emptyNote(t('recruit_followups_empty'), '')]),
      ]),
    ]));
  }
  return h('div', { class: 'tab-stack' }, nodes);
}
