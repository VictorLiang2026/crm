import { h } from './dom.js';
import { data } from './data.js';
import { t } from './i18n.js';

const BLOCKS = [
  ['summary', 'edited_summary', 'insurance_report_summary'],
  ['gaps_found', 'edited_gaps', 'insurance_report_gaps'],
  ['recommendations', 'edited_recommendations', 'insurance_report_recommendations'],
  ['asset_allocation', 'edited_asset_allocation', 'insurance_report_asset_allocation'],
  ['next_action', 'edited_next_action', 'insurance_report_next_action'],
];

function valueOf(report, key) {
  const value = report?.[key];
  return value == null ? '' : String(value);
}

function editedValue(report, editedKey, originalKey) {
  const edited = valueOf(report, editedKey);
  // Keep the Legacy display rule: a non-empty edited value wins; the AI source stays intact.
  return edited !== '' ? edited : valueOf(report, originalKey);
}

function dateTime(value) {
  const text = String(value || '');
  return text ? text.replace('T', ' ').replace(/\.\d+Z$/, ' UTC').replace(/Z$/, ' UTC') : t('insurance_report_unknown');
}

function reportMeta(report) {
  const inputVersion = report?.input_products_version;
  return h('div', { class: 'policy-report-meta' }, [
    h('span', {}, `${t('insurance_report_id')} #${String(report.id)}`),
    h('span', {}, `${t('insurance_report_generated_at')} ${dateTime(report.created_at)}`),
    h('span', {}, `${t('insurance_report_input_version')} ${inputVersion == null || inputVersion === ''
      ? t('insurance_report_not_recorded') : String(inputVersion)}`),
  ]);
}

function fieldView(report, [key, editedKey, labelKey]) {
  const edited = valueOf(report, editedKey);
  const original = valueOf(report, key);
  const current = edited !== '' ? edited : original;
  return h('section', { class: 'policy-report-field' }, [
    h('h4', {}, t(labelKey)),
    h('div', { class: 'policy-report-current-label' }, edited !== ''
      ? t('insurance_report_human_revision') : t('insurance_report_ai_original')),
    h('p', { class: 'policy-report-text' }, current || t('insurance_report_empty')),
    edited !== '' ? h('details', { class: 'policy-report-original' }, [
      h('summary', {}, t('insurance_report_show_ai_original')),
      h('p', { class: 'policy-report-text' }, original || t('insurance_report_empty')),
    ]) : null,
  ]);
}

function editForm(report, onCancel, onSaved) {
  const inputs = new Map();
  const displayedValues = new Map();
  const body = h('div', { class: 'policy-report-edit' }, [
    h('p', { class: 'row-sub' }, t('insurance_report_edit_note')),
  ]);
  BLOCKS.forEach(([key, editedKey, labelKey]) => {
    const displayed = editedValue(report, editedKey, key);
    const input = h('textarea', {
      class: 'policy-report-input',
      'aria-label': t(labelKey),
      rows: key === 'summary' || key === 'next_action' ? '4' : '6',
    }, displayed);
    inputs.set(editedKey, input);
    displayedValues.set(editedKey, displayed);
    body.appendChild(h('label', { class: 'policy-report-label' }, [
      h('span', {}, t(labelKey)), input,
    ]));
  });
  const status = h('p', { class: 'policy-report-status', role: 'status', 'aria-live': 'polite' });
  const save = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, t('insurance_report_save'));
  save.onclick = async () => {
    save.disabled = true;
    save.textContent = t('saving');
    status.textContent = '';
    const payload = {};
    BLOCKS.forEach(([sourceKey, editedKey]) => {
      const value = inputs.get(editedKey).value;
      if (value === displayedValues.get(editedKey)) return;
      // Returning to the AI original removes the override instead of labeling it a human edit.
      payload[editedKey] = value === valueOf(report, sourceKey) ? '' : value;
    });
    if (!Object.keys(payload).length) {
      status.textContent = t('edit_no_changes');
      save.disabled = false;
      save.textContent = t('insurance_report_save');
      return;
    }
    try {
      await data.updatePolicyReport(report._ctx, report.id, payload);
      const result = await data.policyReport(report._ctx, report.id);
      if (!result.report) throw new Error(t('insurance_report_missing'));
      onSaved(result.report);
    } catch (error) {
      status.textContent = `${t('insurance_report_save_failed')}: ${String(error?.message || error)}`;
      save.disabled = false;
      save.textContent = t('insurance_report_save');
    }
  };
  const cancel = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: onCancel }, t('cancel'));
  body.appendChild(status);
  body.appendChild(h('div', { class: 'policy-report-actions' }, [cancel, save]));
  return body;
}

function reportItem(ctx, summaryRow, onSaved) {
  const details = h('details', { class: 'policy-report-item' });
  const title = [dateTime(summaryRow.report_date), summaryRow.report_type || t('insurance_report_default_type')].join(' · ');
  const summary = h('summary', { class: 'policy-report-summary' }, [
    h('span', {}, title),
    h('span', { class: 'policy-report-summary-hint' }, t('insurance_report_open')),
  ]);
  const body = h('div', { class: 'policy-report-body' }, [h('p', { class: 'row-sub' }, t('loading'))]);
  details.appendChild(summary);
  details.appendChild(body);
  let loaded = false;
  let report = null;
  let editing = false;

  function draw() {
    body.replaceChildren(reportMeta(report));
    if (editing) {
      body.appendChild(editForm(report, () => { editing = false; draw(); }, (updated) => {
        report = { ...updated, _ctx: ctx };
        editing = false;
        draw();
        if (typeof ctx.onWriteDone === 'function') ctx.onWriteDone();
        onSaved();
      }));
      return;
    }
    BLOCKS.forEach((block) => body.appendChild(fieldView(report, block)));
    body.appendChild(h('div', { class: 'policy-report-actions' }, [
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { editing = true; draw(); } },
        t('insurance_report_edit')),
    ]));
    body.appendChild(h('details', { class: 'policy-report-raw' }, [
      h('summary', {}, t('insurance_report_raw')),
      h('pre', {}, valueOf(report, 'raw') || t('insurance_report_empty')),
    ]));
  }

  details.addEventListener('toggle', async () => {
    if (!details.open || loaded) return;
    loaded = true;
    try {
      const result = await data.policyReport(ctx, summaryRow.id);
      if (!result.report) throw new Error(t('insurance_report_missing'));
      report = { ...result.report, _ctx: ctx };
      draw();
    } catch (error) {
      loaded = false;
      body.replaceChildren(h('p', { class: 'policy-report-status', role: 'status' },
        `${t('insurance_report_load_failed')}: ${String(error?.message || error)}`));
    }
  });
  return details;
}

export function renderInsuranceReports(ctx, customerId) {
  const root = h('section', { class: 'policy-reports' });
  const status = h('p', { class: 'policy-report-status', role: 'status', 'aria-live': 'polite' });
  const list = h('div', { class: 'policy-report-list' });
  const generate = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, t('insurance_report_generate'));
  const reload = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, t('insurance_report_reload'));
  let generating = false;

  root.appendChild(h('div', { class: 'stack-head' }, [
    h('h3', { class: 'section-title' }, t('insurance_report_title')),
    h('div', { class: 'policy-report-actions' }, [reload, generate]),
  ]));
  root.appendChild(h('p', { class: 'row-sub' }, t('insurance_report_safety_note')));
  root.appendChild(h('p', { class: 'row-sub' }, t('insurance_report_input_version_note')));
  root.appendChild(status);
  root.appendChild(list);

  if (!customerId) {
    status.textContent = t('insurance_report_customer_required');
    generate.disabled = true;
    reload.disabled = true;
    return root;
  }

  async function loadReports(openId = null) {
    status.textContent = t('loading');
    list.replaceChildren();
    try {
      const result = await data.policyReports(ctx, customerId);
      const rows = Array.isArray(result.rows) ? result.rows : [];
      status.textContent = rows.length
        ? t('insurance_report_count').replace('{count}', String(rows.length))
        : t('insurance_report_none');
      rows.forEach((row) => {
        const item = reportItem(ctx, row, () => { loadReports(String(row.id)); });
        if (openId != null && String(row.id) === String(openId)) item.open = true;
        list.appendChild(item);
      });
    } catch (error) {
      status.textContent = `${t('insurance_report_load_failed')}: ${String(error?.message || error)}`;
    }
  }

  reload.onclick = () => loadReports();
  generate.onclick = async () => {
    if (generating) return;
    generating = true;
    generate.disabled = true;
    generate.textContent = t('insurance_report_generating');
    status.textContent = t('insurance_report_generating_note');
    try {
      const result = await data.generatePolicyReport(ctx, customerId);
      if (!result.id) throw new Error(t('insurance_report_missing'));
      await loadReports(String(result.id));
    } catch (error) {
      status.textContent = `${t('insurance_report_generate_failed')}: ${String(error?.message || error)}`;
    } finally {
      generating = false;
      generate.disabled = false;
      generate.textContent = t('insurance_report_generate');
    }
  };
  loadReports();
  return root;
}
