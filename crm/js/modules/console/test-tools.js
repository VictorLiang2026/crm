import { h } from './dom.js';
import { t } from './i18n.js';
import { pageHead, card } from './ui.js';

const SCENE = '#/test-scenario';
const ACTION = '#/test-scenario/action';
const labels = { persons:'persons', customers:'customers', person_roles:'person_roles', followups:'followups', interactions:'interactions', opportunities:'opportunities', actions:'actions', activities:'activities', activity_participants:'activity_participants' };
const text = (key, values = {}) => t(key).replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
const validId = value => /^[1-9][0-9]*$/.test(String(value)) && Number.isSafeInteger(Number(value));
const notice = () => h('p', { class:'form-msg', role:'status', 'aria-live':'polite' });
const setNotice = (node, key, error = false, values) => { node.className = error ? 'form-msg error' : 'form-msg'; node.textContent = text(key, values); };
const button = (key, primary = false) => h('button', { type:'button', class:`btn ${primary ? 'btn-primary' : 'btn-ghost'}` }, t(key));
const link = (key, href) => h('a', { class:'btn btn-ghost', href }, t(key));

function errorKey(code, prefix) {
  const allowed = ['SEED_FORBIDDEN','UNAUTHORIZED','SEED_NOT_CONFIGURED','PREVIEW_STALE','CONFIRMATION_REQUIRED','SEED_IDENTITY_CONFLICT','SEED_CONFLICT','INVALID_COMMAND','DUPLICATE_ACTION'];
  return allowed.includes(code) ? `${prefix}_${code}` : `${prefix}_failed`;
}

export function renderTestScenario(ctx) {
  const root = ctx.main;
  const stateLine = h('p');
  const message = notice();
  const preview = h('div');
  const destinations = h('div', { class:'more-actions test-tools-actions' });
  const dry = button('test_preview', true), confirm = button('test_confirm'), execute = button('test_execute', true);
  root.replaceChildren(pageHead({ kicker:t('test_kicker'), title:t('test_title'), sub:t('test_warning') }),
    card({ title:t('test_title'), body:[link('test_back','#/settings'), message, stateLine,
      h('div', { class:'more-actions test-tools-actions' }, [dry, confirm, execute]), preview, destinations] }));
  let busy = false, authorized = false, receipt = null, confirmed = false;
  const active = () => location.hash === SCENE;
  const buttons = () => { dry.disabled = busy || !authorized; confirm.disabled = busy || !receipt || confirmed; execute.disabled = busy || !confirmed; };
  async function request(stage, extra = {}) {
    const result = await ctx.api.call('assistant', { action:'testSamples', stage, ...extra });
    if (!result?.ok) throw Error(result?.error?.code || 'SEED_DATABASE_ERROR');
    return result;
  }
  function showState(result) {
    stateLine.textContent = text('test_counts', { initial:result.initialCount, derived:result.derivedCount, audit:result.auditCount });
    destinations.replaceChildren();
    if (!result.ready) return;
    const { personId, customerId, activityId } = result.targets || {};
    if (![personId, customerId, activityId].every(validId)) throw Error('SEED_DATABASE_ERROR');
    const agenda = link('test_agenda','#/today');
    destinations.append(link('test_person',`#/person/${personId}`),
      h('a', { class:'btn btn-ghost', href:`#/person/${personId}` }, text('test_customer', { id:customerId })),
      agenda, link('test_funnel','#/analytics'), link('test_search','#/ai'), link('test_action',ACTION));
    destinations.append(h('p', { class:'foot-note' }, t('test_destinations_note')));
  }
  async function run(work) {
    if (busy || !active()) return;
    busy = true; buttons();
    try { await work(); }
    catch (error) { if (active()) { setNotice(message, errorKey(error?.message,'test'), true); receipt = null; confirmed = false; } }
    finally { busy = false; if (active()) buttons(); }
  }
  dry.addEventListener('click', () => run(async () => {
    receipt = null; confirmed = false; preview.replaceChildren(); destinations.replaceChildren();
    const result = await request('dryRun'); if (!active()) return;
    receipt = result; showState(result);
    const rows = result.preview?.rows || [];
    const table = h('table', {}, [h('thead', {}, h('tr', {}, [h('th', {}, t('test_table')), h('th', {}, t('test_existing_new'))])),
      h('tbody', {}, rows.map(row => h('tr', {}, [h('td', {}, t(`test_row_${labels[row.table]}`) === `test_row_${labels[row.table]}` ? row.table : t(`test_row_${labels[row.table]}`)), h('td', {}, `${result.ready ? row.count : 0} / ${result.ready ? 0 : row.count}`)])))]);
    preview.replaceChildren(h('h3', {}, t('test_preview_title')), h('p', {}, result.identity?.name || ''),
      h('p', {}, t(result.identity?.decision === 'confirm_registered' ? 'test_reuse_identity' : 'test_new_identity')),
      table, h('p', {}, text('test_preview_totals', { trigger:result.preview?.triggerBusinessRows, added:result.preview?.initialNew, total:result.preview?.initialTotal, maximum:result.preview?.maximum })),
      h('p', { class:'foot-note' }, t('test_preview_note')));
    setNotice(message,'test_review');
  }));
  confirm.addEventListener('click', () => run(async () => {
    if (!receipt) return;
    await request('confirm', { previewId:receipt.previewId, previewHash:receipt.previewHash });
    if (!active()) return;
    confirmed = true; setNotice(message,'test_confirmed');
  }));
  execute.addEventListener('click', () => run(async () => {
    if (!receipt || !confirmed) return;
    const result = await request('execute', { previewId:receipt.previewId });
    if (!active()) return;
    showState(result); receipt = null; confirmed = false;
    setNotice(message, result.replayed ? 'test_replayed' : 'test_created');
  }));
  buttons();
  void run(async () => {
    const result = await request('status'); if (!active()) return;
    authorized = true; showState(result);
    setNotice(message, result.ready ? 'test_ready' : 'test_not_ready');
  });
}

export function renderTestAction(ctx) {
  const root = ctx.main;
  const message = notice(), choices = h('div', { class:'more-actions test-tools-actions' });
  const selected = h('p', {}, t('test_action_unselected'));
  const name = h('input', { class:'input', required:true, maxlength:100, placeholder:t('test_action_name_placeholder'), 'aria-label':t('test_action_name_label') });
  const search = button('test_action_search');
  const type = h('select', { class:'input' }, ['followup','call','meeting','other'].map(value => h('option', { value }, t(`test_action_type_${value}`))));
  const title = h('input', { class:'input', required:true, maxlength:200 });
  const description = h('textarea', { class:'input', maxlength:4000 });
  const due = h('input', { class:'input', type:'datetime-local' });
  const priority = h('select', { class:'input' }, ['medium','low','high','urgent'].map(value => h('option', { value }, t(`test_action_priority_${value}`))));
  const plan = button('test_action_plan', true), previewBtn = button('test_action_preview'), confirm = button('test_action_confirm'), execute = button('test_action_execute', true);
  plan.type = 'submit';
  const preview = h('div');
  const field = (key, input) => h('label', { class:'settings-password-field' }, [h('span', {}, t(key)), input]);
  const form = h('form', {}, [field('test_action_type',type), field('test_action_title',title), field('test_action_description',description), field('test_action_due',due), field('test_action_priority',priority), plan]);
  root.replaceChildren(pageHead({ kicker:t('test_kicker'), title:t('test_action_heading'), sub:t('test_action_help') }),
    card({ title:t('test_action_heading'), body:[link('test_back_scene',SCENE), message,
      h('div', { class:'more-actions test-tools-actions' }, [name,search]), choices, selected, form,
      h('div', { class:'more-actions test-tools-actions' }, [previewBtn,confirm,execute]), preview] }));
  let busy = false, person = null, commandId = null, previewHash = null, executed = false, authorized = false;
  const active = () => location.hash === ACTION;
  const buttons = () => { search.disabled = busy || !authorized || executed; plan.disabled = busy || !authorized || executed; previewBtn.disabled = busy || !commandId || executed; confirm.disabled = busy || !previewHash || executed; execute.disabled = busy || !previewHash || !confirmed || executed; };
  let confirmed = false;
  const reset = () => { commandId = null; previewHash = null; confirmed = false; preview.replaceChildren(); buttons(); };
  async function request(stage, extra = {}) {
    const result = await ctx.api.call('assistant', { action:'command', stage, ...extra });
    if (!result?.ok) throw Error(result?.error?.code || 'ACTION_COMMAND_FAILED');
    return result;
  }
  async function run(work) {
    if (busy || !active()) return;
    busy = true; buttons();
    try { await work(); }
    catch (error) { if (active()) setNotice(message,errorKey(error?.message,'test_action'),true); }
    finally { busy = false; if (active()) buttons(); }
  }
  for (const input of [type,title,description,due,priority]) input.addEventListener('input', () => { if (commandId) { reset(); setNotice(message,'test_action_changed'); } });
  search.addEventListener('click', () => run(async () => {
    person = null; reset(); choices.replaceChildren(); selected.textContent = t('test_action_unselected');
    const result = await ctx.api.call('person_360', { action:'search', name:name.value.trim() });
    if (!active()) return;
    if (!Array.isArray(result?.candidates)) throw Error('SEARCH_FAILED');
    for (const candidate of result.candidates) {
      if (!validId(candidate.id)) continue;
      const choice = h('button', { type:'button', class:'btn btn-ghost' }, `${candidate.display_name} · #${candidate.id}`);
      choice.addEventListener('click', () => { person = candidate; reset(); selected.textContent = text('test_action_selected',{ name:candidate.display_name,id:candidate.id }); setNotice(message,'test_action_selected_note'); });
      choices.append(choice);
    }
    setNotice(message, result.hasMore ? 'test_action_many' : result.candidates.length ? 'test_action_choose' : 'test_action_no_person', !!result.hasMore);
  }));
  form.addEventListener('submit', event => { event.preventDefault(); void run(async () => {
    if (!person) { setNotice(message,'test_action_select_required',true); return; }
    reset();
    const changes = { action_type:type.value, title:title.value.trim(), description:description.value.trim(), priority:priority.value };
    if (due.value) changes.due_at = new Date(due.value).toISOString();
    const result = await request('plan', { command:{ operation:'create', resource:'actions', personId:person.id, changes } });
    if (!active()) return;
    commandId = result.commandId; setNotice(message,'test_action_planned');
  }); });
  previewBtn.addEventListener('click', () => run(async () => {
    const result = await request('preview',{ resource:'actions',commandId }); if (!active()) return;
    previewHash = result.previewHash; confirmed = false;
    preview.replaceChildren(h('h3',{},t('test_action_preview_title')),
      h('p',{},text('test_action_preview_person',{ name:result.preview.person.displayName,id:result.preview.person.id })),
      h('p',{},text('test_action_preview_title_field',{ title:result.preview.after.title })),
      h('p',{},text('test_action_preview_type_field',{ type:result.preview.after.action_type,priority:result.preview.after.priority })),
      h('p',{},text('test_action_preview_due',{ due:result.preview.after.due_at ? new Date(result.preview.after.due_at).toLocaleString() : t('test_action_no_due') })),
      h('p',{},text('test_action_preview_description',{ description:result.preview.after.description || t('test_action_no_description') })));
    setNotice(message,'test_action_review');
  }));
  confirm.addEventListener('click', () => run(async () => {
    await request('confirm',{ resource:'actions',commandId,previewHash }); if (!active()) return;
    confirmed = true; setNotice(message,'test_action_confirmed');
  }));
  execute.addEventListener('click', () => run(async () => {
    if (!confirmed) return;
    const result = await request('execute',{ resource:'actions',commandId }); if (!active()) return;
    executed = true; setNotice(message,'test_action_created',false,{ id:result.actionId });
  }));
  buttons();
  void run(async () => {
    const result = await ctx.api.call('assistant',{action:'testSamples',stage:'status'});
    if (!active()) return;
    if (!result?.ok || !result.ready) throw Error(result?.error?.code || 'SEED_FORBIDDEN');
    authorized = true;
    name.value = t('test_action_sample_name'); title.value = t('test_action_sample_title');
    description.value = t('test_action_sample_description'); type.value = 'other';
    setNotice(message,'test_action_prefilled');
  });
}
