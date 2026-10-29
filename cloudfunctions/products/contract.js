'use strict';

const CATEGORY_KEYS = [
  'ap_ipa', 'ap_ppa', 'ap_ltc', 'ap_ann', 'ap_life', 'ap_term',
  'ap_wl', 'ap_pa', 'ap_ci', 'ap_hi', 'ap_all',
];
const MAX_MONEY_INTEGER_DIGITS = 19;
const ITEM_FIELDS = ['coverage_amount', 'total_premium', 'paid_premium', 'annual_premium', 'update_date'];

function normalizeMoney(value, field) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new Error(`${field} must be sent as an exact decimal string`);
  }
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(text)) {
    throw new Error(`${field} must be a non-negative amount with up to 2 decimal places`);
  }
  const [wholeRaw, fraction] = text.split('.');
  const whole = (wholeRaw || '0').replace(/^0+(?=\d)/, '');
  const normalized = fraction == null ? whole : `${whole}.${fraction}`;
  if (whole.length > MAX_MONEY_INTEGER_DIGITS) throw new Error(`${field} exceeds the supported range`);
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
    // Accept old cached callers for fields that retain their meaning; persist only the new schema.
    const legacyValue = {
      coverage_amount: item.amount,
      annual_premium: item.premium,
    };
    for (const field of ITEM_FIELDS) {
      const value = (item[field] == null || item[field] === '') && legacyValue[field] != null
        ? legacyValue[field] : item[field];
      normalized[field] = field === 'update_date' ? normalizeDate(item[field]) :
        normalizeMoney(value, `${key}.${field}`);
    }
    return normalized;
  });
}

function amountColumns(items) {
  return Object.fromEntries(items.map((item) => [item.key,
    item.coverage_amount === '' ? null : item.coverage_amount]));
}

module.exports = { CATEGORY_KEYS, MAX_MONEY_INTEGER_DIGITS, normalizeInsuranceItems, amountColumns };
