import { h } from './dom.js';
import { ic } from './icons.js';
import { pageHead, card } from './ui.js';
import { data } from './data.js';
import { t } from './i18n.js';

const text = key => t(`df_${key}`);

function field(label, value) {
  return h('section', { class: 'df-field' }, [h('b', {}, text(label)), h('p', {}, value || '—')]);
}

function candidateCard(ctx, taskId, candidate, onSelected) {
  const isStrategy = candidate.candidateType === 'strategy_based';
  const heading = text(isStrategy ? 'strategy_title' : 'library_title');
  const sources = (candidate.sourceRefs || []).map(ref => h('li', {}, [
    h('a', { href: `#/knowledge-library`, title: `public.knowledge_items #${ref.id}` },
      `${ref.title || text('source')} · ${text('source_id')} ${ref.id}${ref.sourceDate ? ` · ${ref.sourceDate}` : ''}`),
    ref.excerpt ? h('p', {}, ref.excerpt) : null,
  ]));
  const selected = candidate.userSelected === true;
  return card({ cls: 'df-candidate', body: [
    h('div', { class: 'kg-row-head' }, [h('h2', {}, heading),
      h('span', { class: `kg-status ${candidate.matchStatus === 'matched' ? 'kg-verified' : 'kg-draft'}` },
        text(candidate.matchStatus === 'matched' ? 'matched' : 'no_match'))]),
    field('summary', candidate.summary),
    field('reasoning', candidate.reasoning),
    h('section', { class: 'df-field' }, [h('b', {}, text('questions')), h('ul', {}, (candidate.clarifyingQuestions || []).map(value => h('li', {}, value)))]),
    field('next_action', candidate.nextAction),
    field('message', candidate.messageDraft),
    h('section', { class: 'df-field' }, [h('b', {}, text('boundaries')), h('ul', {}, (candidate.boundaryNotes || []).map(value => h('li', {}, value)))]),
    h('section', { class: 'df-field' }, [h('b', {}, text('sources')),
      sources.length ? h('ul', { class: 'df-sources' }, sources) : h('p', {}, text('no_sources'))]),
    h('button', { class: selected ? 'btn btn-soft' : 'btn btn-primary', type: 'button', disabled: selected,
      onclick: async event => {
        event.currentTarget.disabled = true;
        try {
          const response = await data.selectDualFollowup(ctx, { taskId, resultId: candidate.id });
          onSelected(response, candidate);
        } catch (_) { event.currentTarget.disabled = false; window.alert(text('select_failed')); }
      } }, [ic(selected ? 'check' : 'target'), text(selected ? 'selected' : 'choose')]),
  ] });
}

export function renderDualFollowup(ctx, personId) {
  const main = ctx.main;
  let result = null;
  let history = [];
  let loading = false;
  const status = h('p', { class: 'foot-note', role: 'status' });
  const generateButton = h('button', { class: 'btn btn-primary', type: 'button', onclick: generate });
  async function generate() {
    if (loading) return;
    loading = true;
    generateButton.disabled = true;
    status.textContent = text('generating');
    try {
      result = await data.dualFollowup(ctx, { personId: String(personId) });
      status.textContent = result.execution?.modelCalled ? text('generated') : text('reused');
      draw();
    } catch (error) {
      const code = String(error?.code || error?.message || '').split(':')[0];
      status.textContent = text(code === 'TIMEOUT' ? 'timeout' : code === 'AI_RETRY_LATER' ? 'retry_later' : 'generate_failed');
      result = null;
      draw();
    } finally {
      loading = false;
      generateButton.disabled = false;
      generateButton.replaceChildren(ic(result ? 'refresh' : 'sparkle'), text(result ? 'regenerate' : 'retry'));
    }
  }
  const controls = card({ body: [h('div', { class: 'df-actions' }, [status, generateButton])] });
  function draw() {
    const historyNode = history.length ? h('details', { class: 'df-history' }, [
      h('summary', {}, text('history')),
      ...history.slice(0, 10).map(row => {
        const priorCandidates = (row.candidates || []).map(item => {
          const candidate=item.candidate||{}, isStrategy=candidate.candidateType==='strategy_based';
          const sourceIds=(candidate.sourceRefs||[]).map(ref=>String(typeof ref==='object'?ref.id:ref)).filter(id=>/^[1-9]\d*$/.test(id));
          return h('section', { class: 'df-field' }, [
            h('b', {}, `${text(isStrategy?'strategy_title':'library_title')}${item.userSelected?' · '+text('selected'):''}`),
            candidate.summary?h('p',{},candidate.summary):null,
            candidate.nextAction?h('p',{},candidate.nextAction):null,
            sourceIds.length?h('small',{},[text('sources'),': ',sourceIds.map(id=>h('a',{href:`#/knowledge-governance?item=${encodeURIComponent(id)}`},` ${text('source_id')} ${id}`))]):null,
          ]);
        });
        return h('article', { class: 'kg-row' }, [
          h('b', {}, `${new Date(row.createdAt).toLocaleString()} · ${text('task')} #${row.taskId}`),
          h('div', { class: 'df-history-candidates' }, priorCandidates),
        ]);
      }),
    ]) : null;
    main.replaceChildren(pageHead({ kicker: text('kicker'), title: text('title'), sub: text('description') }),
      h('p', { class: 'foot-note' }, text('human_review')),
      controls,
      result?.candidates?.length === 2 ? h('div', { class: 'df-grid' }, result.candidates.map(candidate => candidateCard(ctx, result.taskId, candidate, (response, chosen) => {
        result.candidates = result.candidates.map(item => ({ ...item, userSelected:item.id===chosen.id,
          userEdited:response.userEdited===true&&item.id===chosen.id }));
        status.textContent = response.userEdited ? text('selected_edited') : text('selected_done');
        draw();
      }))) : null,
      historyNode);
  }
  generateButton.replaceChildren(ic('sparkle'), text('generate'));
  draw();
  void generate();
  data.dualFollowupHistory(ctx, personId).then(value => { history = value.rows || []; draw(); })
    .catch(() => {});
}
