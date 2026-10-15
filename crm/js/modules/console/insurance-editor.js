import { h } from './dom.js';
import { data } from './data.js';
import { t } from './i18n.js';
import { bdg } from './ui.js';

const CATEGORIES = [
  ['ap_ipa', 'insurance_cat_ipa', '重疾(IPA)'], ['ap_ppa', 'insurance_cat_ppa', '个人养老金(PPA)'],
  ['ap_ltc', 'insurance_cat_ltc', '长期护理(LTC)'], ['ap_ann', 'insurance_cat_ann', '年金(ANN)'],
  ['ap_life', 'insurance_cat_life', '终身寿险(LIFE)'], ['ap_term', 'insurance_cat_term', '定期寿险(TERM)'],
  ['ap_wl', 'insurance_cat_wl', '万能险(WL)'], ['ap_pa', 'insurance_cat_pa', '意外(PA)'],
  ['ap_ci', 'insurance_cat_ci', '医疗(CI)'], ['ap_hi', 'insurance_cat_hi', '健康(HI)'],
  ['ap_all', 'insurance_cat_all', '总保额(ALL)'],
];
const FIELDS = [
  ['amount', 'insurance_amount', 'bigint'], ['premium', 'insurance_premium', 'decimal'],
  ['pay_years', 'insurance_pay_years', 'decimal'], ['paid_years', 'insurance_paid_years', 'decimal'],
  ['update_date', 'insurance_update_date', 'date'],
];
const MAX_BIGINT = '9223372036854775807';
const MAX_MONEY_TEXT = 40;

function parseItems(text) {
  if (!text) return new Map();
  try {
    const rows = typeof text === 'string' ? JSON.parse(text) : text;
    if (!Array.isArray(rows)) return new Map();
    return new Map(rows.filter((row) => row && CATEGORIES.some(([key]) => row.key === key)).map((row) => [row.key, row]));
  } catch { return new Map(); }
}

function exactText(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new Error(t('insurance_unsafe_number'));
  }
  return String(value);
}

function canonicalValue(value, key, kind) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (kind === 'bigint' && !/^\d+$/.test(text)) {
    throw new Error(t('insurance_nonnegative_value').replace('{field}', t(key)));
  }
  if (kind !== 'bigint' && !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
    throw new Error(t('insurance_nonnegative_value').replace('{field}', t(key)));
  }
  const [wholeRaw, fraction] = text.split('.');
  const whole = (wholeRaw || '0').replace(/^0+(?=\d)/, '');
  const canonical = fraction == null ? whole : `${whole}.${fraction}`;
  const overBigint = kind === 'bigint' && (canonical.length > MAX_BIGINT.length ||
    (canonical.length === MAX_BIGINT.length && canonical > MAX_BIGINT));
  if (canonical.length > MAX_MONEY_TEXT || overBigint) {
    throw new Error(t('insurance_amount_range').replace('{field}', t(key)));
  }
  return canonical;
}

function categoryValues(row, oldItem) {
  const values = {};
  for (const [field] of FIELDS) {
    // PostgreSQL bigint is the exact source for amount; items is a compatible detail mirror.
    const source = field === 'amount' && row?.[oldItem?.key] != null ? row[oldItem.key] : oldItem?.[field];
    values[field] = exactText(source);
  }
  return values;
}

export function renderInsuranceEditor(ctx, personId) {
  const root = h('section', { class: 'insurance-editor' });
  root.appendChild(h('h3', { class: 'section-title' }, t('insurance_editor_title')));
  root.appendChild(h('p', { class: 'row-sub' }, t('insurance_manual_provenance')));
  root.appendChild(h('p', { class: 'row-sub' }, t('insurance_unit_note')));
  root.appendChild(h('div', { class: 'muted' }, t('loading')));

  data.personProducts(ctx, personId).then((result) => {
    const customerId = result.customerId || null;
    let row = (result.rows || [])[0] || null;
    let version = String(result.version ?? row?.version ?? 0);
    if (!customerId) {
      root.replaceChildren(
        h('h3', { class: 'section-title' }, t('insurance_editor_title')),
        h('p', { class: 'row-sub' }, t('insurance_manual_provenance')),
        h('div', { class: 'empty' }, t('insurance_customer_link_required')),
      );
      return;
    }
    draw(false);

    function draw(editing, message = '', messageCode = '') {
      const oldItems = parseItems(row?.items);
      root.replaceChildren(
        h('div', { class: 'stack-head' }, [
          h('h3', { class: 'section-title' }, t('insurance_editor_title')),
        bdg(t('insurance_manual_badge'), 'jade'),
        ]),
        h('p', { class: 'row-sub' }, t('insurance_manual_provenance')),
        h('p', { class: 'row-sub' }, t('insurance_unit_note')),
      );
      if (message) {
        root.appendChild(h('div', { class: 'row-sub', role: 'status' }, message));
        if (/VERSION_CONFLICT/.test(messageCode)) {
          root.appendChild(h('button', { class: 'btn btn-ghost btn-sm', type: 'button',
            onclick: () => { if (typeof ctx.onWriteDone === 'function') ctx.onWriteDone(); } }, t('insurance_reload')));
        }
      }
      const fieldInputs = new Map();
      CATEGORIES.forEach(([category, labelKey, legacyLabel]) => {
        const oldItem = oldItems.get(category) || { key: category };
        const values = categoryValues(row, { ...oldItem, key: category });
        const amountLabel = values.amount === '' ? t('insurance_unknown') : `${values.amount} ${t('insurance_currency_unit')}`;
        const summary = `${t(labelKey)} · ${editing ? t('insurance_editing') : amountLabel}`;
        const details = h('details', { class: 'insurance-category' });
        details.appendChild(h('summary', {}, summary));
        if (editing) {
          const grid = h('div', { style: 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px;margin-top:12px' });
          FIELDS.forEach(([field, labelKey2, kind]) => {
            const label = h('label', { style: 'display:flex;flex-direction:column;gap:5px;min-width:0' }, t(labelKey2));
            const input = h('input', {
              class: 'sheet-input', type: kind === 'date' ? 'date' : 'text', value: values[field],
              autocomplete: 'off', inputmode: kind === 'date' ? undefined : kind === 'bigint' ? 'numeric' : 'decimal',
              'aria-label': `${t(labelKey)} ${t(labelKey2)}`,
            });
            if (kind !== 'date') input.maxLength = MAX_MONEY_TEXT;
            if (kind === 'bigint' || kind === 'decimal') input.placeholder = t('insurance_unknown');
            label.appendChild(input);
            grid.appendChild(label);
            fieldInputs.set(`${category}.${field}`, input);
          });
          details.appendChild(grid);
        } else {
          const detailsText = FIELDS.map(([field, labelKey2]) => {
            const value = values[field];
            return `${t(labelKey2)}: ${value === '' ? t('insurance_unknown') : value}`;
          }).join(' · ');
          details.appendChild(h('div', { class: 'row-sub', style: 'margin-top:8px;white-space:normal' }, detailsText));
        }
        root.appendChild(details);
      });
      const actions = h('div', { class: 'toolbar', style: 'margin-top:12px' });
      if (!editing) {
        actions.appendChild(h('button', { class: 'btn btn-primary btn-sm', type: 'button',
          onclick: () => draw(true) }, row ? t('insurance_edit') : t('insurance_add')));
      } else {
        const saveButton = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, t('insurance_save'));
        saveButton.onclick = async () => {
          saveButton.disabled = true;
          saveButton.textContent = t('saving');
          try {
            const items = CATEGORIES.map(([category, labelKey, legacyLabel]) => {
              const item = { key: category, label: legacyLabel };
              FIELDS.forEach(([field, labelKey2, kind]) => {
                const input = fieldInputs.get(`${category}.${field}`);
                item[field] = kind === 'date' ? input.value : canonicalValue(input.value, labelKey2,
                  field === 'amount' ? 'bigint' : 'decimal');
              });
              return item;
            });
            const payload = { items: JSON.stringify(items) };
            items.forEach((item) => { payload[item.key] = item.amount === '' ? null : item.amount; });
            const saved = await data.savePersonProducts(ctx, personId, version, payload);
            version = String(saved.version);
            if (!row) row = { id: saved.id, customer_id: customerId };
            row.items = payload.items;
            Object.assign(row, payload);
            row.version = version;
            if (typeof ctx.onWriteDone === 'function') ctx.onWriteDone();
          } catch (error) {
            const message = String(error?.message || error);
            draw(true, /VERSION_CONFLICT/.test(message) ? t('insurance_conflict') : message, message);
          } finally {
            saveButton.disabled = false;
            saveButton.textContent = t('insurance_save');
          }
        };
        actions.appendChild(saveButton);
        actions.appendChild(h('button', { class: 'btn btn-ghost btn-sm', type: 'button',
          onclick: () => draw(false) }, t('cancel')));
      }
      root.appendChild(actions);
    }
  }).catch((error) => {
    root.replaceChildren(
      h('h3', { class: 'section-title' }, t('insurance_editor_title')),
      h('div', { class: 'empty' }, String(error?.message || error)),
    );
  });
  return root;
}
