'use strict';

function validAt(row, now) {
  const from = row?.valid_from ? Date.parse(row.valid_from) : null;
  const to = row?.valid_to ? Date.parse(row.valid_to) : null;
  const at = now instanceof Date ? now.getTime() : Date.parse(now);
  return Number.isFinite(at) && (from == null || Number.isFinite(from) && from <= at) &&
    (to == null || Number.isFinite(to) && to >= at);
}

function normalizeContent(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLocaleLowerCase() : '';
}

function classifyContextItems(rows, now = new Date(), { truncated = false } = {}) {
  const current = (Array.isArray(rows) ? rows : []).filter(row => validAt(row, now));
  const facts = current.filter(row => row.item_type === 'fact');
  const confirmedFacts = facts.filter(row => row.confirmed === true);
  const byCategory = new Map();
  for (const row of confirmedFacts) {
    const category = String(row.category || 'general').trim().toLocaleLowerCase();
    const values = byCategory.get(category) || new Set();
    values.add(normalizeContent(row.content));
    byCategory.set(category, values);
  }
  const conflictCategories = new Set([...byCategory]
    .filter(([, values]) => values.size > 1).map(([category]) => category));
  if (truncated) for (const category of byCategory.keys()) conflictCategories.add(category);
  const isConflict = row => conflictCategories.has(String(row.category || 'general').trim().toLocaleLowerCase());
  return {
    current,
    trustedFacts: confirmedFacts.filter(row => !isConflict(row)),
    factsToVerify: facts.filter(row => row.confirmed !== true || isConflict(row)),
    signals: current.filter(row => row.item_type === 'signal'),
    inferences: current.filter(row => row.item_type === 'inference'),
    conflictCategories: [...conflictCategories],
    truncated: Boolean(truncated),
    isConflict,
  };
}

module.exports = { classifyContextItems, validAt };
