import { h } from './dom.js';
import { data } from './data.js';
import { openPersonNew, openSheet } from './write.js';
import { t, translateEnum } from './i18n.js';
import { bdg, emptyNote, sectionTitle } from './ui.js';

const RELATIONSHIPS = ['spouse', 'child', 'parent', 'sibling', 'other'];
const uuid = () => window.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,
  char => { const n = Math.random() * 16 | 0; return (char === 'x' ? n : (n & 3 | 8)).toString(16); });
const relationLabel = value => value === 'anchor' ? t('family_anchor') : translateEnum('family_relationship', value) || t('label_no_relation');

async function call(ctx, action, params) {
  const result = await ctx.api.call('person_360', { action, ...params });
  if (!result || result.error) throw new Error(result?.message || result?.error || t('family_action_failed'));
  return result;
}

function openReview(ctx, personId, operation, payload, onDone) {
  const sheet = openSheet({ title: t('family_review_title'), sub: t('family_review_note'),
    body: h('div', { class: 'sheet-stack' }, [h('div', { class: 'sheet-note' }, t('loading'))]) });
  document.body.appendChild(sheet.overlay);
  (async () => {
    try {
      const result = await data.previewHousehold(ctx, personId, operation, { ...payload, idempotencyKey: uuid() });
      const preview = result.preview || {};
      const before = preview.before || {};
      const after = preview.after || {};
      const changed = operation === 'add_member'
        ? `${after.memberName || ''} · ${relationLabel(after.relationship)}`
        : operation === 'save_facts' ? (after.facts || t('family_facts_cleared'))
          : operation === 'remove_member' ? t('family_remove_member')
          : `${before.personName || ''} · ${relationLabel(before.relationship)} → ${relationLabel(after.relationship || before.relationship)}`;
      sheet.swap(h('div', { class: 'sheet-stack' }, [
        h('div', { class: 'sheet-preview' }, [
          h('div', { class: 'kv-line' }, [h('span', { class: 'kv-k' }, t('family_before')), h('span', {}, operation === 'save_facts'
            ? (before.facts || t('family_none')) : (before.personName ? `${before.personName} · ${relationLabel(before.relationship)}` : t('family_none')))]),
          h('div', { class: 'kv-line' }, [h('span', { class: 'kv-k' }, t('family_after')), h('span', {}, changed)]),
          preview.personName ? h('div', { class: 'sheet-note' }, `${t('person')}: ${preview.personName} · #${preview.personId}`) : null,
          result.expiresAt ? h('div', { class: 'sheet-note' }, `${t('family_preview_expiry')} ${String(result.expiresAt).replace('T', ' ').slice(0, 16)}`) : null,
        ]),
        h('div', { class: 'sheet-actions' }, [
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('btn_cancel')),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: async event => {
            const button = event.currentTarget;
            button.disabled = true;
            button.textContent = t('writing');
            try {
              await data.executeHousehold(ctx, result.previewId);
              sheet.overlay.remove();
              ctx.toast(t('family_saved'), 'ok');
              onDone?.();
            } catch (error) { button.disabled = false; button.textContent = t('confirm_write'); sheet.showErr(error.message); }
          } }, t('confirm_write')),
        ]),
      ]));
    } catch (error) { sheet.showErr(error.message); }
  })();
}

function relationshipSelect(value) {
  return h('select', { class: 'sheet-select', 'aria-label': t('family_relationship') }, RELATIONSHIPS.map(key =>
    h('option', { value: key, ...(key === value ? { selected: true } : {}) }, translateEnum('family_relationship', key))));
}

function openMemberPicker(ctx, personId, householdId, onDone) {
  const name = h('input', { class: 'sheet-input', type: 'search', maxlength: '160', placeholder: t('family_member_search') });
  const relation = relationshipSelect('spouse');
  const results = h('div', { class: 'sheet-stack' });
  const sheet = openSheet({ title: t('family_add_member'), sub: t('family_identity_note'), body: h('div', { class: 'sheet-stack' }, [
    h('div', { class: 'sheet-field' }, [h('label', {}, t('family_member_name')), name]),
    h('div', { class: 'sheet-field' }, [h('label', {}, t('family_relationship')), relation]),
    h('div', { class: 'sheet-actions' }, [h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => {
      results.replaceChildren(h('div', { class: 'sheet-note' }, t('loading')));
      try {
        const resolution = await data.resolveHouseholdMember(ctx, name.value.trim());
        const candidates = resolution.candidates || [];
        results.replaceChildren(...(candidates.length ? candidates.map(candidate => h('button', {
          class: 'btn btn-ghost', type: 'button', onclick: () => {
            sheet.overlay.remove();
            openReview(ctx, personId, 'add_member', { householdId: householdId || null,
              memberId: String(candidate.id), memberName: candidate.displayName, relationship: relation.value }, onDone);
          },
        }, `${candidate.displayName} · ${candidate.occupation || t('occupation_empty')} · #${candidate.id}`)) : [h('div', { class: 'sheet-note' }, t('family_no_match'))]));
      } catch (error) { sheet.showErr(error.message); }
    } }, t('family_resolve'))]), results,
    h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => {
      sheet.overlay.remove();
      openPersonNew(ctx, { onDone: () => { ctx.toast(t('family_person_created_reopen'), 'ok'); onDone?.(); } });
    } }, t('family_create_person_first')),
  ]) });
  document.body.appendChild(sheet.overlay);
}

function openMemberEdit(ctx, personId, household, member, onDone) {
  const relation = relationshipSelect(member.relationship_to_anchor || 'other');
  const sheet = openSheet({ title: t('family_edit_relation'), sub: `${member.person?.display_name || t('label_member')} · ${relationLabel(member.relationship_to_anchor)}`,
    body: h('div', { class: 'sheet-stack' }, [
      h('div', { class: 'sheet-field' }, [h('label', {}, t('family_relationship')), relation]),
      h('div', { class: 'sheet-actions' }, [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('btn_cancel')),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => {
          sheet.overlay.remove();
          openReview(ctx, personId, 'update_member', { householdId: String(household.id),
            membershipId: String(member.id), relationship: relation.value }, onDone);
        } }, t(member.confirmed_at ? 'btn_save' : 'family_confirm_member')),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => {
          sheet.overlay.remove();
          openReview(ctx, personId, 'remove_member', { householdId: String(household.id),
            membershipId: String(member.id) }, onDone);
        } }, t('family_remove_member')),
      ]),
    ]) });
  document.body.appendChild(sheet.overlay);
}

function openFacts(ctx, personId, household, onDone) {
  const input = h('textarea', { class: 'sheet-input', rows: '4', maxlength: '2000', placeholder: t('family_facts_placeholder') });
  input.value = household.important_facts || '';
  const sheet = openSheet({ title: t('family_facts_title'), sub: t('family_facts_confirm_note'), body: h('div', { class: 'sheet-stack' }, [
    h('div', { class: 'sheet-field' }, [h('label', {}, t('sec_family_facts')), input]),
    h('div', { class: 'sheet-actions' }, [
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('btn_cancel')),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => {
        sheet.overlay.remove();
        openReview(ctx, personId, 'save_facts', { householdId: String(household.id), facts: input.value }, onDone);
      } }, t('family_review_and_save')),
    ]),
  ]) });
  document.body.appendChild(sheet.overlay);
}

export function renderFamily(ctx, personId, onDone) {
  return data.personHome(ctx, personId).then(home => {
    const groups = home.households || (home.household ? [{ household: home.household, anchor: null,
      members: home.members || [], isAnchor: String(home.household.anchor_person_id) === String(personId) }] : []);
    if (!groups.length) return h('div', { class: 'tab-stack' }, [
      sectionTitle(t('sec_family_members')), emptyNote(t('family_unknown'), t('family_unknown_note')),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openMemberPicker(ctx, personId, null, onDone) }, t('family_start')),
    ]);
    return h('div', { class: 'tab-stack' }, groups.map(group => {
      const household = group.household;
      const members = group.members || [];
      return h('section', { class: 'card family-household', style: 'padding:14px;margin:0 0 12px' }, [
        h('div', { class: 'stack-head' }, [h('div', {}, [h('div', { class: 'row-title' }, group.isAnchor ? t('family_anchor_household') : t('family_other_household')),
          h('div', { class: 'row-sub' }, `${t('family_anchor_label')}: ${group.anchor?.display_name || `Person #${household.anchor_person_id}`}`)]),
          group.isAnchor ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => openMemberPicker(ctx, personId, household.id, onDone) }, t('family_add_member')) : null]),
        sectionTitle(t('sec_family_facts')),
        household.important_facts ? h('p', { class: 'fact-text' }, household.important_facts) : emptyNote(t('empty_no_family_facts'), ''),
        household.important_facts && !household.important_facts_confirmed_at
          ? h('div', { class: 'sheet-stack' }, [bdg(t('family_fact_pending'), 'gold'), h('p', { class: 'sheet-note' }, t('family_legacy_fact_note'))])
          : household.important_facts_confirmed_at ? bdg(t('badge_confirmed'), 'jade') : null,
        group.isAnchor ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => openFacts(ctx, personId, household, onDone) },
          household.important_facts ? t('family_review_facts') : t('family_add_facts')) : null,
        sectionTitle(t('sec_family_members')),
        !group.isAnchor ? h('a', { class: 'list-row data-row', href: group.anchor ? `#/person/${group.anchor.id}` : '#',
          onclick: group.anchor ? null : event => event.preventDefault() }, [h('div', {}, [
          h('div', { class: 'row-title' }, group.anchor?.display_name || t('family_anchor')),
          h('div', { class: 'row-sub' }, `${t('family_relative_to_anchor')}: ${t('family_anchor')}`),
        ]), bdg(t('badge_confirmed'), 'jade')]) : null,
        members.length ? h('div', {}, members.map(member => h('div', { class: 'list-row data-row' }, [
          h('a', { class: 'family-person-link', href: member.person ? `#/person/${member.person.id}` : '#',
            onclick: member.person ? null : event => event.preventDefault() }, [h('div', { class: 'row-title' }, member.person?.display_name || t('label_member')),
            h('div', { class: 'row-sub' }, `${t('family_relative_to_anchor')}: ${relationLabel(member.relationship_to_anchor)}`)]),
          member.confirmed_at ? bdg(t('badge_confirmed'), 'jade') : bdg(t('badge_to_confirm'), 'gold'),
          (group.isAnchor || String(member.person_id) === String(personId)) && String(member.person_id) !== String(household.anchor_person_id)
            ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => openMemberEdit(ctx, personId, household, member, onDone) },
              member.confirmed_at ? t('btn_edit') : t('family_confirm_member')) : null,
        ]))) : emptyNote(t('empty_no_family'), t('family_no_members_note')),
      ]);
    }));
  });
}
