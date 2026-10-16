import { h } from './dom.js';
import { data } from './data.js';
import { t, translateEnum } from './i18n.js';
import { card, emptyNote, errorBox, pageHead, wpTag } from './ui.js';

const STAGES = ['新增人才', '互动暖客', '初次面谈', '增员活动', '精准面谈', '入职申请', '签约入司'];
const monthKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const monthInput = (value, onChange) => h('input', { class: 'sheet-input', type: 'month', value, onchange: onChange });

function targetEditor(ctx, month, rows, afterSaved) {
  const values = Object.fromEntries(STAGES.map(stage => [stage, '']));
  for (const row of rows || []) if (Object.hasOwn(values, row.stage)) values[row.stage] = row.target_count;
  const status = h('p', { class: 'row-sub', role: 'status', 'aria-live': 'polite' });
  const fields = STAGES.map(stage => {
    const input = h('input', {
      class: 'sheet-input', type: 'number', min: '0', step: '1', inputMode: 'numeric',
      value: values[stage] == null ? '' : String(values[stage]), 'aria-label': t('pc21_goal_stage').replace('{stage}', translateEnum('recruit_stage', stage)),
    });
    return h('label', { class: 'sheet-field' }, [
      h('span', {}, translateEnum('recruit_stage', stage)), input,
    ]);
  });
  const save = h('button', { class: 'btn btn-primary', type: 'button', onclick: async event => {
    const button = event.currentTarget; button.disabled = true; status.textContent = t('pc21_saving');
    try {
      const goals = Object.fromEntries(STAGES.map((stage, i) => {
        const raw = fields[i].querySelector('input').value.trim();
        return [stage, raw === '' ? 0 : Number(raw)];
      }));
      if (Object.values(goals).some(value => !Number.isSafeInteger(value) || value < 0)) {
        throw new Error(t('pc21_goal_invalid'));
      }
      await data.saveRecruitGoals(ctx, month, goals);
      status.textContent = t('pc21_saved');
      if (afterSaved) afterSaved();
    } catch (error) { status.textContent = `${t('pc21_save_failed')}: ${error.message || ''}`; }
    finally { button.disabled = false; }
  } }, t('pc21_save_goals'));
  return card({ title: t('pc21_monthly_goals'), icon: 'recruit', body: [
    h('p', { class: 'row-sub' }, t('pc21_goal_help').replace('{month}', month)),
    h('div', { class: 'form-grid', style: 'grid-template-columns:repeat(auto-fit,minmax(180px,1fr))' }, fields),
    h('div', { class: 'sheet-actions' }, [save]), status,
  ] });
}

function progressPanel(progress) {
  if (!progress || progress.error) return emptyNote(t('data_load_failed'), progress?.error || t('pc21_no_progress'));
  const heads = [t('pc21_stage'), t('pc21_target'), t('pc21_actual'), t('pc21_achievement'), t('pc21_conversion'), t('pc21_benchmark')];
  const rows = (progress.rows || []).map(row => h('tr', {}, [
    h('th', { scope: 'row' }, translateEnum('recruit_stage', row.stage)),
    h('td', {}, String(row.target ?? 0)), h('td', {}, String(row.actual ?? 0)),
    h('td', {}, `${row.achieve_rate ?? 0}%`),
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
    h('p', { class: 'row-sub' }, `${t('pc21_overall')}: ${progress.overall?.new_count ?? 0} → ${progress.overall?.sign_count ?? 0} · ${progress.overall?.rate ?? 0}%`),
    progress.testData?.status === 'unverified' ? h('p', { class: 'status-error' }, t('pc21_test_unverified'))
      : progress.testData?.containsTestData ? h('p', { class: 'status-error' }, t('pc21_test_notice').replace('{count}', String(progress.testData.recordCount))) : null,
    h('h3', { class: 'section-title' }, t('pc21_period_summary')),
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
  async function loadTarget() {
    targetHost.replaceChildren(h('p', { class: 'row-sub' }, t('loading')));
    try {
      const result = await data.recruitGoals(ctx, targetMonth.value, targetMonth.value);
      targetHost.replaceChildren(targetEditor(ctx, targetMonth.value, result.rows || [], loadTarget));
    } catch (error) { targetHost.replaceChildren(errorBox(error, loadTarget)); }
  }
  async function loadHistory() {
    const from = start.value || current, to = end.value || from;
    historyHost.replaceChildren(h('p', { class: 'row-sub' }, t('loading')));
    if (to < from) { historyHost.replaceChildren(errorBox(new Error(t('pc21_invalid_range')), loadHistory)); return; }
    try { historyHost.replaceChildren(progressPanel(await data.recruitProgress(ctx, from, to))); }
    catch (error) { historyHost.replaceChildren(errorBox(error, loadHistory)); }
  }
  const query = h('button', { class: 'btn btn-primary', type: 'button', onclick: loadHistory }, t('pc21_query'));
  targetMonth.addEventListener('change', loadTarget);
  loadTarget(); loadHistory();
  ctx.main.replaceChildren(
    pageHead({ kicker: t('pc21_kicker'), title: t('pc21_goals_title'), tag: wpTag(t('fact')),
      actions: [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { location.hash = '#/recruit'; } }, t('pc21_back_recruit'))] }),
    h('div', { class: 'tab-stack' }, [
      h('section', { class: 'card card-body tab-stack' }, [
        h('b', {}, t('pc21_history_filter')),
        h('div', { class: 'form-row', style: 'display:flex;gap:12px;align-items:end;flex-wrap:wrap' }, [
          h('label', { class: 'sheet-field' }, [h('span', {}, t('pc21_start_month')), start]),
          h('label', { class: 'sheet-field' }, [h('span', {}, t('pc21_end_month')), end]), query,
        ]),
      ]),
      historyHost,
      h('section', { class: 'card card-body' }, [
        h('div', { class: 'form-row', style: 'display:flex;gap:12px;align-items:end;flex-wrap:wrap' }, [
          h('label', { class: 'sheet-field' }, [h('span', {}, t('pc21_goal_month')), targetMonth]),
        ]), targetHost,
      ]),
    ]),
  );
}
