'use strict';

const CATEGORY_KEYS = [
  'ap_ipa', 'ap_ppa', 'ap_ltc', 'ap_ann', 'ap_life', 'ap_term',
  'ap_wl', 'ap_pa', 'ap_ci', 'ap_hi', 'ap_all',
];
const MAX_BIGINT = '9223372036854775807';
const ITEM_FIELDS = ['amount', 'premium', 'pay_years', 'paid_years', 'update_date'];

function normalizeInteger(value, field, max = null) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new Error(`${field} must be sent as an exact decimal string`);
  }
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (!/^\d+$/.test(text)) throw new Error(`${field} must be a non-negative integer`);
  const canonical = text.replace(/^0+(?=\d)/, '');
  if (max && (canonical.length > max.length ||
      (canonical.length === max.length && canonical > max))) {
    throw new Error(`${field} exceeds the supported range`);
  }
  if (canonical.length > 40) throw new Error(`${field} exceeds the supported range`);
  return canonical;
}

function normalizeDecimal(value, field) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new Error(`${field} must be sent as an exact decimal string`);
  }
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
    throw new Error(`${field} must be a non-negative number`);
  }
  const [wholeRaw, fraction] = text.split('.');
  const whole = (wholeRaw || '0').replace(/^0+(?=\d)/, '');
  const normalized = fraction == null ? whole : `${whole}.${fraction}`;
  if (normalized.length > 40) throw new Error(`${field} exceeds the supported range`);
  return normalized;
}

function normalizeDate(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('update_date must be YYYY-MM-DD');
  const date = new Date(`${text}T00:00:00.000Z`);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error('update_date must be a valid date');
  }
  return text;
}

function normalizeInsuranceItems(value) {
  let source = value;
  if (typeof source === 'string') {
    try { source = JSON.parse(source); } catch { throw new Error('items must be valid JSON'); }
  }
  if (!Array.isArray(source)) throw new Error('items must be an array');
  const byKey = new Map();
  for (const item of source) {
    if (!item || typeof item !== 'object' || !CATEGORY_KEYS.includes(item.key) || byKey.has(item.key)) {
      throw new Error('items contain an invalid or duplicate category');
    }
    byKey.set(item.key, item);
  }
  if (byKey.size !== CATEGORY_KEYS.length) throw new Error('all insurance categories are required');

  return CATEGORY_KEYS.map((key) => {
    const item = byKey.get(key);
    const normalized = { key, label: String(item.label || '').slice(0, 120) };
    for (const field of ITEM_FIELDS) {
      normalized[field] = field === 'update_date' ? normalizeDate(item[field]) :
        field === 'amount' ? normalizeInteger(item[field], `${key}.${field}`, MAX_BIGINT) :
          normalizeDecimal(item[field], `${key}.${field}`);
    }
    return normalized;
  });
}

function amountColumns(items) {
  return Object.fromEntries(items.map((item) => [item.key, item.amount === '' ? null : item.amount]));
}

module.exports = { CATEGORY_KEYS, MAX_BIGINT, normalizeInsuranceItems, amountColumns };
