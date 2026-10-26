import { h } from './dom.js';
import { data } from './data.js';
import { t, translateEnum } from './i18n.js';
import { card, emptyNote, errorBox, pageHead, wpTag } from './ui.js';

import { GOAL_STAGES as STAGES, MAX_GOAL, previousGoalMonth, validGoals, reverseGoalDraft, goalDraftFromRows } from './recruit-goal-draft.js';
const monthKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const stageTitle = stage => t('l06_stage_full_' + STAGES.indexOf(stage));
const monthInput = (value, onChange) => h('input', { class: 'sheet-input', type: 'month', value, onchange: onChange });

function targetEditor(ctx, month, rows, afterSaved) {
  const values = Object.fromEntries(STAGES.map(stage => [stage, '']));
  for (const row of rows || []) if (Object.hasOwn(values, row.stage)) values[row.stage] = row.target_count;
  const status = h('p', { class: 'row-sub', role: 'status', 'aria-live': 'polite' });
  let draftBackup = null;
  const fields = STAGES.map(stage => h('label', { class: 'sheet-field' }, [
    h('span', { title: stageTitle(stage) }, translateEnum('recruit_stage', stage)),
    h('input', { class: 'sheet-input', type: 'number', min: '0', max: String(MAX_GOAL), step: '1', inputMode: 'numeric',
      value: values[stage] == null ? '' : String(values[stage]),
      'aria-label': t('pc21_goal_stage').replace('{stage}', translateEnum('recruit_stage', stage)) }),
  ]));
  const inputs = fields.map(field => field.querySelector('input'));
  const undo = h('button', { class: 'btn btn-ghost', type: 'button', style: 'display:none', onclick: () => {
    if (!draftBackup) return;
    inputs.forEach((input, index) => { input.value = draftBackup[index]; });
    draftBackup = null; undo.style.display = 'none'; status.textContent = t('l06_draft_undone');
  } }, t('l06_undo_draft'));
  const applyDraft = (values, source) => {
    const goals = validGoals(values);
    if (!inputs[0].isConnected) return;
    if (!draftBackup) draftBackup = inputs.map(input => input.value);
    STAGES.forEach((stage, i) => { inputs[i].value = String(goals[stage]); });
    undo.style.display = ''; status.textContent = source + ' · ' + t('l06_draft_only');
  };
  const save = h('button', { class: 'btn btn-primary', type: 'button', onclick: async event => {
    const button = event.currentTarget; button.disabled = true; status.textContent = t('pc21_saving');
    try {
      let goals;
      try { goals = validGoals(Object.fromEntries(STAGES.map((stage, i) => [stage, inputs[i].value.trim()]))); }
      catch (_) { throw new Error(t('l06_invalid_goal')); }
      await data.saveRecruitGoals(ctx, month, goals);
      status.textContent = t('pc21_saved');
      if (afterSaved) afterSaved();
    } catch (error) { status.textContent = t('pc21_save_failed') + ': ' + (error.message || ''); }
    finally { button.disabled = false; }
  } }, t('pc21_save_goals'));
  return card({ title: t('pc21_monthly_goals'), icon: 'recruit', body: [
    h('p', { class: 'row-sub' }, t('pc21_goal_help').replace('{month}', month)),
    h('div', { class: 'form-grid l06-goal-fields', style: 'grid-template-columns:repeat(auto-fit,minmax(180px,1fr))' }, fields),
    h('div', { class: 'sheet-actions' }, [save, undo]), status,
    goalTools(ctx, month, () => inputs[6].value, applyDraft),
  ] });
}

function goalTools(ctx, month, readSign, applyDraft) {
  const content = h('div', { class: 'tab-stack l06-tools' });
  const panel = h('details', { class: 'card card-body recruit-goals-advanced' }, [
    h('summary', {}, t('recruit_analysis_reference')), content,
  ]);
  let started = false;
  panel.addEventListener('toggle', () => {
    if (!panel.open || started) return;
    started = true; mount();
  });
  function mount() {
    const status = h('p', { class: 'row-sub', role: 'status', 'aria-live': 'polite' });
    const tableHost = h('div', { class: 'l06-assumption-host' });
    const sign = h('input', { class: 'sheet-input', type: 'number', min: '0', max: String(MAX_GOAL),
      step: '1', value: String(readSign() || 0), 'aria-label': t('l06_signed_target') });
    let rows = [], controls = [], sequence = 0, dirty = false, saving = false;
    const previous = h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => {
      previous.disabled = true;
      try {
        const priorMonth = previousGoalMonth(month);
        const result = await data.recruitGoals(ctx, priorMonth, priorMonth);
        const draft = goalDraftFromRows(result.rows);
        if (panel.isConnected) {
          applyDraft(draft, t('l06_previous_source').replace('{month}', priorMonth));
          status.textContent = t('l06_draft_only');
        }
      } catch (error) {
        status.textContent = t(error.message === 'No previous goals' ? 'l06_no_previous' : 'l06_read_failed');
      } finally { previous.disabled = false; }
    } }, t('l06_use_previous'));
    const calculate = h('button', { class: 'btn btn-soft', type: 'button', disabled: true, onclick: () => {
      try {
        if (sign.value.trim() === '') throw Error('Invalid goal');
        const draft = reverseGoalDraft(Number(sign.value), editedRows());
        applyDraft(draft, t('l06_calculated_source'));
        status.textContent = t('l06_draft_only');
      } catch (error) {
        status.textContent = t(error.message === 'Goal overflow' ? 'l06_overflow' : error.message === 'Invalid goal' ? 'l06_invalid_goal' : 'l06_invalid_assumptions');
      }
    } }, t('l06_calculate'));
    const reload = h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => {
      if (dirty && !window.confirm(t('l06_reload_confirm'))) return;
      load();
    } }, t('l06_reload'));
    const save = h('button', { class: 'btn btn-primary', type: 'button', disabled: true, onclick: async () => {
      let payload;
      try { payload = editedRows(); } catch (_) { status.textContent = t('l06_invalid_assumptions'); return; }
      saving = true; busy(true); status.textContent = t('pc21_saving');
      try {
        const result = await data.saveRecruitBenchmarks(ctx, payload);
        if (result?.ok !== true) throw Error('UNCONFIRMED');
        dirty = false;
        if (panel.isConnected) {
          const loaded = await load();
          status.textContent = t(loaded ? 'l06_assumptions_saved' : 'l06_saved_reload_failed');
        }
      } catch (error) {
        status.textContent = t(/changed|40001/i.test(String(error.message)) ? 'l06_changed' : 'l06_save_unconfirmed');
      } finally { saving = false; busy(false); }
    } }, t('l06_save_assumptions'));
    function busy(value) {
      save.disabled = value || !rows.length; reload.disabled = value;
      calculate.disabled = value || !rows.length;
      for (const row of controls) for (const input of Object.values(row)) input.disabled = value;
    }
    function editedRows() {
      if (!rows.length || rows.length > 7) throw Error('Invalid assumption');
      return rows.map((row, index) => {
        const input = controls[index];
        const low = Number(input.min.value), average = Number(input.avg.value), high = Number(input.good.value);
        if ([low, average, high].some(value => !Number.isFinite(value)) ||
            low <= 0 || average < low || high < average || high > 100 || input.source.value.length > 500) {
          throw Error('Invalid assumption');
        }
        return { stage_from: row.stage_from, stage_to: row.stage_to, conversion_min: low,
          conversion_avg: average, conversion_good: high, source: input.source.value,
          updated_at: row.updated_at };
      });
    }
    async function load() {
      const request = ++sequence;
      rows = []; controls = []; busy(true);
      tableHost.replaceChildren(h('p', { class: 'muted' }, t('loading')));
      try {
        const result = await data.recruitBenchmarks(ctx);
        if (request !== sequence || !panel.isConnected) return false;
        if (!Array.isArray(result.rows) || result.rows.length > 7) throw Error('Invalid assumptions');
        const pairs = new Set(STAGES.slice(0, -1).map((stage, i) => stage + '→' + STAGES[i + 1]));
        pairs.add(STAGES[0] + '→' + STAGES[6]);
        const seen = new Set();
        for (const row of result.rows) {
          const pair = row.stage_from + '→' + row.stage_to;
          if (!pairs.has(pair) || seen.has(pair) || typeof row.updated_at !== 'string') throw Error('Invalid assumptions');
          seen.add(pair);
        }
        rows = result.rows; dirty = false;
        const body = rows.map(row => {
          const numeric = (value, key) => h('input', { class: 'sheet-input', type: 'number',
            min: '0', max: '100', step: 'any', value: String(value ?? ''),
            'aria-label': `${translateEnum('recruit_stage', row.stage_from)} → ${translateEnum('recruit_stage', row.stage_to)} ${t(key)}`,
            oninput: () => { dirty = true; } });
          const item = {
            min: numeric(row.conversion_min, 'l06_low'),
            avg: numeric(row.conversion_avg, 'l06_average'),
            good: numeric(row.conversion_good, 'l06_high'),
            source: h('input', { class: 'sheet-input', value: row.source || '', maxlength: '500',
              'aria-label': t('l06_source'), oninput: () => { dirty = true; } }),
          };
          controls.push(item);
          return h('tr', {}, [
            h('th', { scope: 'row', title: `${stageTitle(row.stage_from)} → ${stageTitle(row.stage_to)}` }, `${translateEnum('recruit_stage', row.stage_from)} → ${translateEnum('recruit_stage', row.stage_to)}`),
            ...['min', 'avg', 'good', 'source'].map(key => h('td', {}, item[key])),
          ]);
        });
        tableHost.replaceChildren(rows.length ? h('div', { style: 'overflow-x:auto' }, h('table', { class: 'data-table l06-assumptions' }, [
          h('thead', {}, h('tr', {}, ['pc21_stage', 'l06_low', 'l06_average', 'l06_high', 'l06_source'].map(key =>
            h('th', { title: t(key === 'l06_average' ? 'l06_average_full' : key) }, t(key))))),
          h('tbody', {}, body),
        ])) : emptyNote(t('l06_no_assumptions'), t('l06_manual_targets')));
        busy(saving); return true;
      } catch (_) {
        if (request === sequence && panel.isConnected) {
          tableHost.replaceChildren(h('p', { class: 'status-error' }, t('l06_read_failed')));
          busy(saving);
        }
        return false;
      }
    }
    content.append(
      h('p', { class: 'foot-note' }, t('l06_tool_note').replace('{month}', month)),
      previous,
      h('div', { class: 'form-grid' }, [
        h('label', { class: 'sheet-field' }, [h('span', {}, t('l06_signed_target')), sign]), calculate,
      ]),
      h('p', { class: 'foot-note' }, t('l06_assumptions_note')),
      tableHost,
      h('div', { class: 'sheet-actions' }, [reload, save]),
      status,
    );
    load();
  }
  return panel;
}

function analysisMetric(label, actual, target) {
  return h('div', { class: 'recruit-analysis-metric' }, [
    h('span', { class: 'recruit-analysis-metric-label' }, label),
    h('strong', {}, String(actual ?? 0)),
    h('span', { class: 'recruit-analysis-metric-detail' }, t('recruit_analysis_actual_target')
      .replace('{actual}', String(actual ?? 0)).replace('{target}', String(target ?? 0))),
  ]);
}

function stageComparison(rows) {
  const max = Math.max(1, ...(rows || []).flatMap(row => [Number(row.target) || 0, Number(row.actual) || 0]));
  return h('section', { class: 'card card-body recruit-analysis-panel' }, [
    h('h3', { class: 'section-title' }, t('recruit_analysis_stage_title')),
    h('p', { class: 'row-sub' }, t('recruit_analysis_stage_note')),
    h('div', { class: 'recruit-analysis-stage-list' }, (rows || []).map(row => {
      const actual = Math.max(0, Number(row.actual) || 0);
      const target = Math.max(0, Number(row.target) || 0);
      return h('div', { class: 'recruit-analysis-stage' }, [
        h('span', { class: 'recruit-analysis-stage-label', title: translateEnum('recruit_stage', row.stage) }, translateEnum('recruit_stage', row.stage)),
        h('div', { class: 'recruit-analysis-bars' }, [
          h('span', { class: 'recruit-analysis-bar target', style: `width:${Math.min(100, target / max * 100)}%` }),
          h('span', { class: 'recruit-analysis-bar actual', style: `width:${Math.min(100, actual / max * 100)}%` }),
        ]),
        h('span', { class: 'recruit-analysis-stage-count' }, `${actual} / ${target}`),
      ]);
    })),
  ]);
}

function currentFunnelPanel(funnel) {
  if (funnel?._error || funnel?.error) return h('section', { class: 'card card-body recruit-analysis-panel' }, [
    h('h3', { class: 'section-title' }, t('recruit_analysis_current_title')),
    emptyNote(t('data_load_failed'), String(funnel?._error?.message || funnel?.error || '')),
  ]);
  const counts = funnel?.funnel || {};
  const stages = [...STAGES, '流失'];
  const max = Math.max(1, ...stages.map(stage => Number(counts[stage]) || 0));
  const total = funnel?.total ?? stages.reduce((sum, stage) => sum + (Number(counts[stage]) || 0), 0);
  return h('section', { class: 'card card-body recruit-analysis-panel' }, [
    h('h3', { class: 'section-title' }, t('recruit_analysis_current_title')),
    h('p', { class: 'row-sub' }, t('recruit_analysis_current_note')),
    h('div', { class: 'recruit-analysis-current-list' }, stages.map(stage => {
      const count = Number(counts[stage]) || 0;
      return h('div', { class: 'recruit-analysis-current-row' }, [
        h('span', { title: translateEnum('recruit_stage', stage) }, translateEnum('recruit_stage', stage)),
        h('span', { class: 'recruit-analysis-current-track' }, h('span', { class: stage === '流失' ? 'lost' : '', style: `width:${Math.min(100, count / max * 100)}%` })),
        h('strong', {}, String(count)),
      ]);
    })),
    h('p', { class: 'foot-note' }, t('recruit_analysis_current_total').replace('{count}', String(total))),
    funnel?.testData?.status === 'unverified' ? h('p', { class: 'status-error' }, t('pc21_test_unverified'))
      : funnel?.testData?.containsTestData ? h('p', { class: 'status-error' }, t('pc21_test_notice').replace('{count}', String(funnel.testData.recordCount))) : null,
  ]);
}

function progressPanel(progress, funnel) {
  if (!progress || progress.error) return emptyNote(t('data_load_failed'), progress?.error || t('pc21_no_progress'));
  const heads = [t('pc21_stage'), t('pc21_target'), t('pc21_actual'), t('goal_gap'), t('pc21_achievement'), t('l06_ratio'), t('l06_benchmark')];
  const rows = (progress.rows || []).map(row => h('tr', {}, [
    h('th', { scope: 'row' }, translateEnum('recruit_stage', row.stage)),
    h('td', {}, String(row.target ?? 0)), h('td', {}, String(row.actual ?? 0)),
    h('td', { class: 'goal-gap', title: t('goal_gap_note') }, String(Number(row.target ?? 0) - Number(row.actual ?? 0))),
    h('td', {}, Number(row.target) > 0 ? `${row.achieve_rate ?? 0}%` : '—'),
    h('td', {}, row.conv_rate == null ? '—' : `${row.conv_rate}%`),
    h('td', {}, row.conv_bench ? `${row.conv_bench.min}% / ${row.conv_bench.avg}% / ${row.conv_bench.good}%` : '—'),
  ]));
  const trends = (progress.trends || []).map(month => h('tr', {}, [
    h('th', { scope: 'row' }, month.month),
    ...STAGES.map(stage => h('td', {}, `${month.stages?.[stage]?.actual ?? 0} / ${month.stages?.[stage]?.target ?? 0}`)),
  ]));
  const table = (labels, body) => h('div', { style: 'overflow-x:auto' }, h('table', { class: 'data-table' }, [
    h('thead', {}, h('tr', {}, labels.map(label => h('th', {}, label)))),
    h('tbody', {}, body.length ? body : [h('tr', {}, h('td', { colspan: String(labels.length) }, t('pc21_no_history')))]),
  ]));
  return h('div', { class: 'tab-stack' }, [
    h('div', { class: 'recruit-analysis-metrics' }, [
      analysisMetric(t('recruit_analysis_new'), progress.rows?.[0]?.actual, progress.rows?.[0]?.target),
      analysisMetric(t('recruit_analysis_signed'), progress.rows?.find(row => row.stage === STAGES[STAGES.length - 1])?.actual,
        progress.rows?.find(row => row.stage === STAGES[STAGES.length - 1])?.target),
      h('div', { class: 'recruit-analysis-metric' }, [
        h('span', { class: 'recruit-analysis-metric-label' }, t('recruit_analysis_rate')),
        h('strong', {}, Number(progress.overall?.new_count) > 0 ? `${progress.overall?.rate ?? 0}%` : '—'),
        h('span', { class: 'recruit-analysis-metric-detail' }, t('l06_metric_note')),
      ]),
    ]),
    h('div', { class: 'recruit-analysis-grid' }, [stageComparison(progress.rows), currentFunnelPanel(funnel)]),
    h('p', { class: 'row-sub' }, `${t('l06_overall')}: ${progress.overall?.new_count ?? 0} → ${progress.overall?.sign_count ?? 0} · ${Number(progress.overall?.new_count) > 0 ? `${progress.overall?.rate ?? 0}%` : '—'}`),
    progress.testData?.status === 'unverified' ? h('p', { class: 'status-error' }, t('pc21_test_unverified'))
      : progress.testData?.containsTestData ? h('p', { class: 'status-error' }, t('pc21_test_notice').replace('{count}', String(progress.testData.recordCount))) : null,
    h('h3', { class: 'section-title' }, t('pc21_period_summary')),
    h('p', { class: 'foot-note' }, t('goal_gap_note')),
    h('p', { class: 'foot-note' }, t('l06_metric_note')),
    table(heads, rows),
    h('h3', { class: 'section-title' }, t('pc21_monthly_history')),
    table([t('pc21_month'), ...STAGES.map(stage => translateEnum('recruit_stage', stage))], trends),
  ]);
}

export function renderRecruitGoals(ctx) {
  const now = new Date();
  const current = monthKey(now);
  const start = monthInput(current);
  const end = monthInput(current);
  const targetMonth = monthInput(current);
  const targetHost = h('div', { class: 'tab-stack' }, h('p', { class: 'row-sub' }, t('loading')));
  const historyHost = h('div', { class: 'tab-stack' }, h('p', { class: 'row-sub' }, t('loading')));
  let targetRequest = 0;
  let historyRequest = 0;
  async function loadTarget() {
    const request = ++targetRequest, month = targetMonth.value || current;
    targetHost.replaceChildren(h('p', { class: 'row-sub' }, t('loading')));
    try {
      const result = await data.recruitGoals(ctx, month, month);
      if (request !== targetRequest) return;
      targetHost.replaceChildren(targetEditor(ctx, month, result.rows || [], () => { loadTarget(); loadHistory(); }));
    } catch (error) { if (request === targetRequest) targetHost.replaceChildren(errorBox(error, loadTarget)); }
  }
  async function loadHistory() {
    const request = ++historyRequest, from = start.value || current, to = end.value || from;
    historyHost.replaceChildren(h('p', { class: 'row-sub' }, t('loading')));
    if (to < from) { historyHost.replaceChildren(errorBox(new Error(t('pc21_invalid_range')), loadHistory)); return; }
    try {
      const [progress, funnel] = await Promise.all([
        data.recruitProgress(ctx, from, to), data.recruitFunnel(ctx).catch(error => ({ _error: error })),
      ]);
      if (request === historyRequest) historyHost.replaceChildren(progressPanel(progress, funnel));
    } catch (error) { if (request === historyRequest) historyHost.replaceChildren(errorBox(error, loadHistory)); }
  }
  const query = h('button', { class: 'btn btn-primary', type: 'button', onclick: loadHistory }, t('pc21_query'));
  targetMonth.addEventListener('change', loadTarget);
  loadTarget(); loadHistory();
  ctx.main.replaceChildren(
    pageHead({ kicker: t('pc21_kicker'), title: t('recruit_analysis_entry'), tag: wpTag(t('fact')),
      sub: t('recruit_analysis_sub'),
      actions: [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { location.hash = '#/recruit'; } }, t('pc21_back_recruit'))] }),
    h('div', { class: 'tab-stack' }, [
      h('section', { class: 'card card-body tab-stack recruit-analysis-filter' }, [
        h('b', {}, t('recruit_analysis_period')),
        h('div', { class: 'form-row', style: 'display:flex;gap:12px;align-items:end;flex-wrap:wrap' }, [
          h('label', { class: 'sheet-field' }, [h('span', {}, t('pc21_start_month')), start]),
          h('label', { class: 'sheet-field' }, [h('span', {}, t('pc21_end_month')), end]), query,
        ]),
      ]),
      historyHost,
      h('section', { class: 'card card-body recruit-analysis-targets' }, [
        h('h2', { class: 'section-title' }, t('recruit_analysis_target_section')),
        h('p', { class: 'row-sub' }, t('recruit_analysis_target_note')),
        h('div', { class: 'form-row', style: 'display:flex;gap:12px;align-items:end;flex-wrap:wrap' }, [
          h('label', { class: 'sheet-field' }, [h('span', {}, t('pc21_goal_month')), targetMonth]),
        ]), targetHost,
      ]),
    ]),
  );
}
