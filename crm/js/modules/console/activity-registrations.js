// Activity registration stays separate from the legacy attendee/check-in flow.
import { registrationCall } from './registration-call.js';
import { h, toast } from './dom.js';
import { getLang, t } from './i18n.js';
import { ic } from './icons.js';
import { pageHead, emptyNote, sectionTitle, bdg } from './ui.js';

const call = (ctx, action, extra = {}) => registrationCall(payload=>ctx.callFn('activity_registration',payload),action,extra);
const value = (tag, attrs = {}, children = []) => h(tag, attrs, children);
const field = (label, input) => h('label', { class: 'field-stack' }, [h('span', {}, label), input]);
const select = (items, selected = '') => h('select', {}, items.map(item =>
  h('option', { value: item.value, selected: String(item.value) === String(selected) }, item.label)));
const idText = row => String(row?.id || '');
const statusText = status => t(({ draft:'ar_admin_draft', published:'ar_admin_published', closed:'ar_admin_closed', pending:'ar_admin_pending', approved:'ar_admin_approved', rejected:'ar_admin_rejected', waitlisted:'ar_admin_waitlisted' })[status] || 'ar_admin_unknown');
const explain = error => t(({PERSON_ALREADY_LINKED_TO_EVENT:'ar_admin_person_exists',APPROVAL_REQUIRED:'ar_admin_approval_required',
  INVALID_SLUG:'ar_admin_bad_slug',INVALID_IMAGE_URL:'ar_admin_bad_image',ACTIVITY_NOT_FOUND:'ar_admin_activity_missing'})[error?.message] || 'ar_admin_operation_failed');

export function renderActivityRegistrations(ctx) {
  const state = { activities: [], pages: [], pageId: '', page: 1, status: '', historyPerson: '' };
  const shell = h('section', { class: 'activity-registration-admin' });
  const activitySelect = select([{ value:'', label:t('ar_admin_choose_activity') }]);
  const pageSelect = select([{ value:'', label:t('ar_admin_choose_page') }]);
  const statusSelect = select([
    { value:'', label:t('ar_admin_all_statuses') },
    ...['pending','approved','waitlisted','rejected'].map(value => ({ value, label:statusText(value) })),
  ]);
  const form = h('form', { class:'card', onsubmit: event => { event.preventDefault(); save(); } });
  const list = h('div', {});
  const editorResult = h('div', {});
  const registrations = h('div', {});
  const linkedPeople = h('div', {});
  const historyResult = h('div', {});

  const title = h('input', { maxlength:'160', required:'', placeholder:t('ar_admin_title_placeholder') });
  const slug = h('input', { maxlength:'80', required:'', pattern:'[a-z0-9][a-z0-9-]{2,79}', placeholder:t('ar_admin_slug_example') });
  const intro = h('textarea', { maxlength:'1200', rows:'4', placeholder:t('ar_admin_intro_placeholder') });
  const cover = h('input', { type:'url', placeholder:'https://…' });
  const bodyText = h('textarea', { rows:'7', maxlength:'9000', placeholder:t('ar_admin_blocks_placeholder') });
  const imageUrl = h('input', { type:'url', placeholder:'https://…' });
  const customFields = h('textarea', { rows:'3', placeholder:t('ar_admin_fields_placeholder') });
  const status = select([
    { value:'draft', label:statusText('draft') },
    { value:'published', label:statusText('published') },
    { value:'closed', label:statusText('closed') },
  ]);
  let editingPage = null;
  let selectedSubmission = null;

  function parseFields(raw) {
    return raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 12).map((line, index) => {
      const [label, type = 'text', required = ''] = line.split('|').map(part => part.trim());
      const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || `field_${index + 1}`;
      if (type === 'select') throw new Error(t('ar_admin_select_not_supported'));
      if (!['text','textarea'].includes(type)) throw new Error(t('ar_admin_field_format'));
      return { key, label, type, required: required === 'required' };
    });
  }

  function fillEditor(page = null) {
    editingPage = page;
    activitySelect.disabled = Boolean(page?.id);
    const activity = state.activities.find(item => String(item.id) === String(page?.activity_id || activitySelect.value));
    activitySelect.value = activity?.id ? String(activity.id) : '';
    title.value = page?.content?.title || activity?.name || '';
    slug.value = page?.slug || (activity?.id ? `activity-${activity.id}` : '');
    intro.value = page?.content?.intro || activity?.description || '';
    cover.value = page?.content?.coverUrl || '';
    bodyText.value = (page?.content?.blocks || []).filter(block => block.type === 'text').map(block => block.text).join('\n\n');
    imageUrl.value = (page?.content?.blocks || []).find(block => block.type === 'image')?.src || '';
    customFields.value = (page?.form_schema || []).map(item => `${item.label}|${item.type}|${item.required ? 'required' : ''}`).join('\n');
    status.value = page?.status || 'draft';
    pageSelect.value = page?.id || '';
    renderEditor();
  }

  function renderEditor() {
    form.replaceChildren(
      sectionTitle(editingPage ? t('ar_admin_edit_page') : t('ar_admin_new_page')),
      h('div', { class:'grid-2' }, [field(t('ar_admin_activity'), activitySelect), field(t('ar_admin_slug'), slug)]),
      h('div', { class:'grid-2' }, [field(t('ar_admin_title'), title), field(t('ar_admin_status'), status)]),
      field(t('ar_admin_intro'), intro), field(t('ar_admin_cover'), cover),
      field(t('ar_admin_text_blocks'), bodyText), field(t('ar_admin_image_block'), imageUrl),
      field(t('ar_admin_form_fields'), customFields),
      h('p', { class:'foot-note' }, t('ar_admin_fields_help')),
      h('div', { class:'button-row' }, [
        h('button', { class:'btn btn-primary', type:'submit' }, [ic('check'), t('ar_admin_save')]),
        h('button', { class:'btn btn-ghost', type:'button', onclick:() => fillEditor() }, t('ar_admin_reset')),
      ]), editorResult,
    );
  }

  async function save() {
    editorResult.replaceChildren();
    try {
      const blocks = [];
      if (bodyText.value.trim()) blocks.push(...bodyText.value.split(/\n\s*\n/).map(text => ({ type:'text', text:text.trim() })).filter(block => block.text));
      if (imageUrl.value.trim()) blocks.push({ type:'image', src:imageUrl.value.trim(), alt:title.value.trim() });
      const result = await call(ctx, 'savePage', { data: {
        ...(editingPage?.id ? { id:editingPage.id } : {}), activityId:activitySelect.value, slug:slug.value.trim(), status:status.value,
        content:{ title:title.value.trim(), intro:intro.value.trim(), coverUrl:cover.value.trim(), blocks }, formSchema:parseFields(customFields.value),
      } });
      toast(t('ar_admin_saved'));
      const link = h('a', { href:result.publicUrl, target:'_blank', rel:'noopener noreferrer' }, result.publicUrl);
      editorResult.replaceChildren(h('p', { class:'foot-note' }, [t('ar_admin_public_link'), link]));
      await loadPages();
    } catch (error) { editorResult.replaceChildren(emptyNote(t('ar_admin_save_failed'), explain(error))); }
  }

  async function loadPages() {
    const result = await call(ctx, 'listPages');
    state.pages = result.rows || [];
    pageSelect.replaceChildren(h('option', { value:'' }, t('ar_admin_choose_page')),
      ...state.pages.map(page => h('option', { value:page.id }, `${page.content?.title || page.slug} · ${statusText(page.status)}`)));
    const links = state.pages.length ? state.pages.map(page => h('div', { class:'list-row' }, [
      h('div', { class:'row-main' }, [h('strong', {}, page.content?.title || page.slug), h('span', { class:'row-sub' }, `${page.slug} · ${statusText(page.status)}`)]),
      h('button', { class:'btn btn-ghost btn-sm', type:'button', onclick:() => { state.pageId = idText(page); fillEditor(page); loadSubmissions(); } }, t('ar_admin_edit')),
      h('button', { class:'btn btn-ghost btn-sm', type:'button', onclick:() => copyPublicLink(page.slug) }, t('ar_admin_copy_link')),
    ])) : [emptyNote(t('ar_admin_no_pages'), t('ar_admin_no_pages_help'))];
    list.replaceChildren(...links);
  }

  async function copyPublicLink(value) {
    const url = `${location.origin}/crm/activity-registration.html?slug=${encodeURIComponent(value)}`;
    try { await navigator.clipboard.writeText(url); toast(t('ar_admin_copied')); }
    catch { window.prompt(t('ar_admin_copy_prompt'), url); }
  }

  async function loadSubmissions() {
    const pageId = pageSelect.value || state.pageId;
    if (!pageId) { registrations.replaceChildren(emptyNote(t('ar_admin_choose_page'), '')); return; }
    state.pageId = pageId;
    try {
      const result = await call(ctx, 'listSubmissions', { pageId, page:state.page, pageSize:30, status:statusSelect.value });
      registrations.replaceChildren(...(result.rows || []).map(row => renderSubmission(row)));
      if (!result.rows?.length) registrations.append(emptyNote(t('ar_admin_no_registrations'), t('ar_admin_no_registrations_help')));
      const page = state.pages.find(item=>String(item.id)===String(pageId));
      if (page) {
        const people = await call(ctx,'activityPeople',{ activityId:page.activity_id });
        linkedPeople.replaceChildren(sectionTitle(t('ar_admin_linked_people')),
          ...(people.rows||[]).map(person=>h('div',{class:'list-row'},[
            h('strong',{},person.personName),
            h('span',{class:'row-sub'},`${t('ar_admin_attendee')}: ${person.attendeeName} · ${statusText(person.status)}`),
          ])));
        if (!people.rows?.length) linkedPeople.append(h('p',{class:'foot-note'},t('ar_admin_no_linked_people')));
      }
    } catch (error) { registrations.replaceChildren(emptyNote(t('ar_admin_load_failed'), explain(error))); }
  }

  function renderSubmission(row) {
    const answers = Object.entries(row.answers || {}).map(([key, answer]) => `${key}: ${answer}`).join(' · ');
    const actions = [];
    if (row.status === 'pending' || row.status === 'waitlisted') {
      actions.push(h('button', { class:'btn btn-primary btn-sm', type:'button', onclick:() => review(row.id, 'approved') }, t('ar_admin_approve')));
      actions.push(h('button', { class:'btn btn-ghost btn-sm', type:'button', onclick:() => review(row.id, 'rejected') }, t('ar_admin_reject')));
      actions.push(h('button', { class:'btn btn-ghost btn-sm', type:'button', onclick:() => review(row.id, 'waitlisted') }, t('ar_admin_waitlist')));
    }
    if (row.status === 'approved') actions.push(h('button', { class:'btn btn-ghost btn-sm', type:'button', onclick:() => notify(row.id) }, t('ar_admin_mark_notified')));
    actions.push(h('button', { class:'btn btn-ghost btn-sm', type:'button', onclick:() => reissue(row.id) }, t('ar_admin_reissue')));
    const search = h('input', { type:'search', placeholder:t('ar_admin_person_search'), maxlength:'80' });
    const candidates = h('div', {});
    const relation = h('div', { class:'person-link-picker' }, [search, candidates]);
    const searchButton = h('button', { class:'btn btn-ghost btn-sm', type:'button', onclick:async () => {
      candidates.replaceChildren();
      try {
        const found = await call(ctx,'searchPersons',{ keyword:search.value.trim() });
        candidates.replaceChildren(...(found.rows || []).map(person => h('button', { class:'btn btn-ghost btn-sm', type:'button', onclick:async () => {
          try { await call(ctx,'linkPerson',{ submissionId:row.id, personId:person.id }); toast(t('ar_admin_person_linked')); loadSubmissions(); }
          catch(error) { toast(explain(error),'error'); }
        } }, `${person.display_name} · #${person.id}`)));
        if (!found.rows?.length) candidates.append(h('span', { class:'foot-note' }, t('ar_admin_no_person')));
      } catch(error) { candidates.textContent = explain(error); }
        } }, t('ar_admin_search_person'));
    relation.insertBefore(searchButton, candidates);
    return h('article', { class:'card', style:'margin:12px 0;padding:18px' }, [
      h('div', { class:'row-title' }, [h('strong', {}, row.attendee_name), bdg(statusText(row.status), row.status === 'approved' ? 'jade' : 'gold')]),
      h('p', { class:'row-sub' }, [row.phone ? `${t('ar_admin_phone')}: ${row.phone}` : '', row.wechat ? `${t('ar_admin_wechat')}: ${row.wechat}` : ''].filter(Boolean).join(' · ')),
      answers ? h('p', { class:'row-sub' }, answers) : null,
      h('p', { class:'row-sub' }, `${t('ar_admin_submitted_at')}: ${new Date(row.created_at).toLocaleString(getLang()==='zh-CN'?'zh-CN':'en-US')}`),
      h('div', { class:'button-row' }, actions),
      row.status === 'approved' ? relation : null,
    ]);
  }

  async function review(id, nextStatus) {
    try { await call(ctx,'review',{ id,status:nextStatus }); toast(t('ar_admin_reviewed')); await loadSubmissions(); }
    catch(error) { toast(explain(error),'error'); }
  }
  async function notify(id) {
    try { await call(ctx,'markNotified',{ id }); toast(t('ar_admin_notified')); await loadSubmissions(); }
    catch(error) { toast(explain(error),'error'); }
  }
  async function reissue(id) {
    let url = '';
    try {
      const result = await call(ctx,'reissueManagementLink',{ id });
      url = result.url;
      await navigator.clipboard.writeText(url);
      toast(t('ar_admin_link_reissued'));
    } catch(error) {
      if (url) { window.prompt(t('ar_admin_copy_prompt'),url); toast(t('ar_admin_link_reissued')); }
      else toast(explain(error),'error');
    }
  }

  const searchPerson = h('input', { type:'text', placeholder:t('ar_admin_person_id'), inputmode:'numeric' });
  const searchHistory = h('button', { class:'btn btn-ghost', type:'button', onclick:async () => {
    try {
      const result = await call(ctx,'personActivities',{ personId:searchPerson.value.trim() });
      historyResult.replaceChildren(...(result.rows || []).map(row => h('div', { class:'list-row' }, [
        h('strong', {}, row.title), h('span', { class:'row-sub' }, `${row.activity.activity_date || ''} · ${statusText(row.status)}`),
      ])));
      if (!result.rows?.length) historyResult.replaceChildren(emptyNote(t('ar_admin_history_empty'),''));
    } catch(error) { historyResult.replaceChildren(emptyNote(t('ar_admin_history_failed'),explain(error))); }
  } }, t('ar_admin_person_history'));

  pageSelect.addEventListener('change', () => { state.pageId = pageSelect.value; state.page = 1; loadSubmissions(); });
  statusSelect.addEventListener('change', () => { state.page = 1; loadSubmissions(); });
  activitySelect.addEventListener('change', () => { if (!editingPage) fillEditor(); });

  shell.replaceChildren(
    pageHead({ kicker:'ACTIVITIES', title:t('ar_admin_heading'), tag:t('ar_admin_tag'), sub:t('ar_admin_sub'),
      actions:[h('a',{class:'btn btn-ghost',href:'#/activities'},t('ar_admin_back'))] }),
    h('div', { class:'card', style:'padding:18px;margin-bottom:16px' }, [sectionTitle(t('ar_admin_page_directory')), list]),
    form,
    h('section', { class:'card', style:'padding:18px;margin-top:18px' }, [
      sectionTitle(t('ar_admin_review_title')),
      h('div', { class:'grid-2' }, [field(t('ar_admin_page'), pageSelect), field(t('ar_admin_filter'), statusSelect)]),
      registrations, linkedPeople,
    ]),
    h('section', { class:'card', style:'padding:18px;margin-top:18px' }, [
      sectionTitle(t('ar_admin_person_history_title')),
      h('div', { class:'button-row' }, [field(t('ar_admin_person_id'), searchPerson), searchHistory]), historyResult,
    ]),
  );
  ctx.main.replaceChildren(shell);

  (async () => {
    try {
      const [activityResult] = await Promise.all([
        ctx.callFn('activities',{action:'list'}), loadPages(),
      ]);
      state.activities = activityResult?.rows || [];
      activitySelect.replaceChildren(h('option',{value:''},t('ar_admin_choose_activity')),
        ...state.activities.map(activity => h('option',{value:activity.id},`${activity.name} · ${activity.activity_date || t('ar_admin_no_date')}`)));
      fillEditor();
      if (state.pages[0]) { pageSelect.value = state.pages[0].id; state.pageId = state.pages[0].id; await loadSubmissions(); }
    } catch(error) { shell.prepend(emptyNote(t('ar_admin_load_failed'),explain(error))); }
  })();
}
