import { h } from './dom.js';
import { data } from './data.js';
import { t, translateEnum, getLang } from './i18n.js';
import { card, errorBox, pageHead, wpTag } from './ui.js';

const KINDS = ['customer', 'opportunity', 'recruit'];
const ENUMS = { customer: 'customer_stage', opportunity: 'opportunity_stage', recruit: 'recruit_stage' };
const count = value => Number.isInteger(value) && value >= 0 ? String(value) : '—';
const timeNote = value => value && Number.isFinite(Date.parse(value))
  ? h('p', { class: 'foot-note' }, `${t('m16_generated')}: ${value}`) : null;
const provenance = summary => !summary || summary.status !== 'verified'
  ? h('p', { class: 'foot-note status-error' }, t('pc21_test_unverified'))
  : summary.containsTestData ? h('p', { class: 'foot-note status-error' }, t('pc21_test_notice').replace('{count}', String(summary.recordCount))) : null;

function stageDetails(key, row) {
  const metrics = ['count', 'overdue', 'dwell_median_days', 'stuck', 'entered_30d', 'moved_30d'];
  const value = (stage, field) => {
    if (['dwell_median_days', 'stuck'].includes(field) && stage.kind === 'terminal') return t('l02_na');
    if (key === 'customer' && ['dwell_median_days', 'stuck', 'moved_30d'].includes(field)) return t('l02_unknown');
    if (key === 'opportunity' && field === 'moved_30d') return t('l02_unknown');
    return count(stage[field]) === '—' ? t('l02_unknown') : count(stage[field]);
  };
  return h('details', { 'data-stage-details': key }, [
    h('summary', {}, t('l02_details')),
    h('p', { class: 'foot-note' }, t('l02_basis_' + key)),
    h('p', { class: 'foot-note' }, t('l02_distribution')),
    row.total === 0 ? h('p', { class: 'foot-note' }, t('l02_empty'))
      : !Number.isInteger(row.total) || row.total < 10 ? h('p', { class: 'foot-note' }, t('l02_small')) : null,
    h('div', { class: 'table-scroll' }, h('table', { class: 'people-table analytics-stage-table' }, [
      h('thead', {}, h('tr', {}, [h('th', {}, t('pc21_stage')),
        ...metrics.map(field => h('th', { title: t('l02_' + field + '_full') }, t('l02_' + field)))])),
      h('tbody', {}, (row.stages || []).map(stage => h('tr', { 'data-stage-kind': stage.kind, style: 'cursor:default' }, [
        h('th', { scope: 'row' }, stage.kind === 'unclassified' ? t('m16_unclassified') : translateEnum(ENUMS[key], stage.stage)),
        ...metrics.map(field => h('td', { 'data-stage-metric': field }, value(stage, field))),
      ]))),
    ])),
  ]);
}

function funnelCard(key, row) {
  return card({ title: t('m16_' + key), icon: 'chart', body: [
    provenance(row?.testData),
    h('p', { class: 'foot-note', 'data-analytics-scope': key }, t('m16_scope_' + key)),
    row ? h('div', { class: 'stat', 'data-analytics-total': key }, [h('b', {}, count(row.total)), h('span', {}, t('m16_total'))]) : null,
    row ? h('div', { class: 'tab-stack' }, (row.stages || []).map(stage => h('div', { class: 'list-row' }, [
      h('span', { style: 'flex:1;min-width:0;overflow-wrap:anywhere' }, stage.kind === 'unclassified' ? t('m16_unclassified') : translateEnum(ENUMS[key], stage.stage)),
      h('b', {}, count(stage.count)),
    ]))) : h('p', { class: 'foot-note' }, t('m16_missing')),
    row ? stageDetails(key, row) : null,
    row ? h('details', {}, [
      h('summary', {}, t('m16_source_notes')),
      h('p', { class: 'foot-note' }, t('m16_original_language')),
      ...(row.warnings || []).map(text => h('p', { class: 'foot-note' }, text)),
      ...(row.metrics || []).map(metric => h('p', { class: 'foot-note' }, `${metric.label}: ${metric.value}`)),
    ]) : null,
  ] });
}

export function renderAnalytics(ctx) {
  const facts = h('div', { class: 'tab-stack', 'data-analytics-facts': '' });
  const status = h('div', { role: 'status' });
  const explanation = h('div', { 'data-analytics-explanation': '' });
  const refresh = h('button', { class: 'btn btn-ghost', type: 'button', onclick: load }, t('btn_refresh'));
  const explain = h('button', { class: 'btn btn-soft', type: 'button', disabled: true, onclick: explainFacts }, t('m16_explain'));
  let ready = false, reading = false, explaining = false;
  function buttons() { refresh.disabled = reading || explaining; explain.disabled = !ready || reading || explaining; }
  async function load() {
    if (reading || explaining) return;
    reading = true; buttons();
    status.replaceChildren(h('p', { class: 'foot-note' }, t('loading')));
    explanation.replaceChildren();
    try {
      const result = await data.funnelStats(ctx);
      if (!ctx.main.contains(facts)) return;
      if (result.ok !== true || !Array.isArray(result.funnels)) throw new Error(t('m16_invalid'));
      facts.replaceChildren(timeNote(result.generated_at) || h('span', {}),
        ...KINDS.map(key => funnelCard(key, result.funnels.find(row => row.key === key))));
      ready = true; status.replaceChildren();
    } catch (error) {
      if (ctx.main.contains(facts)) status.replaceChildren(errorBox(error, load));
    } finally { reading = false; buttons(); }
  }
  async function explainFacts() {
    if (!ready || reading || explaining) return;
    explaining = true; buttons();
    explanation.replaceChildren(h('p', { class: 'foot-note' }, t('loading')));
    try {
      const result = await data.explainFunnels(ctx, getLang());
      if (!ctx.main.contains(facts)) return;
      if (result.ok !== true || typeof result.text !== 'string' || !result.text.trim() || !['ai', 'rule'].includes(result.source)) throw new Error(t('m16_invalid'));
      explanation.replaceChildren(
        h('b', {}, t(result.source === 'rule' ? 'm16_rule_result' : 'm16_ai_result')),
        provenance(result.testData) || h('span', {}),
        timeNote(result.generated_at) || h('span', {}),
        h('p', { class: 'foot-note' }, t('m16_explain_scope')),
        h('p', { style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, result.text),
      );
    } catch (error) {
      if (ctx.main.contains(facts)) explanation.replaceChildren(h('p', { class: 'foot-note' }, t('m16_explain_failed')), errorBox(error, explainFacts));
    } finally { explaining = false; buttons(); }
  }
  ctx.main.replaceChildren(
    pageHead({ title: t('m16_title'), sub: t('m16_desc'), tag: wpTag(t('fact')), actions: [refresh] }),
    card({ title: t('m16_workspaces'), icon: 'grid', body: [
      h('div', { class: 'more-actions', style: 'display:flex;gap:10px;flex-wrap:wrap' }, [
        h('a', { class: 'btn btn-ghost', href: '#/activity-report' }, t('pc21_open_report')),
        h('a', { class: 'btn btn-ghost', href: '#/recruit/goals' }, t('pc21_open_goals')),
        h('a', { class: 'btn btn-ghost', href: '#/opportunities' }, t('m16_open_opportunities')),
      ]), h('p', { class: 'foot-note' }, t('m16_workspace_scope')),
    ] }),
    h('p', { class: 'foot-note' }, t('m16_counts_scope')),
    status, facts,
    card({ title: t('m16_interpretation'), icon: 'sparkle', body: [h('p', { class: 'foot-note' }, t('m16_explain_scope')), explain, explanation] }),
  );
  load();
}
