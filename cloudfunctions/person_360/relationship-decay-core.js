/** Deterministic relationship-decay candidate. It never reads or writes CRM data. */
'use strict';

const DAY = 86400000;
const CHINA_OFFSET = 8 * 60 * 60 * 1000;
const MAX_HISTORY_DAYS = 730;
const MAX_EVENTS = 24;

function level(value) {
  const key = String(value ?? '').trim().toLowerCase();
  if (['high', 'strong', '高', '强', '紧密', '重要'].includes(key)) return 'high';
  if (['medium', 'moderate', '中', '一般'].includes(key)) return 'medium';
  if (['low', 'weak', '低', '弱', '疏远'].includes(key)) return 'low';
  return null;
}

function importanceLevel(value) {
  if (Number.isInteger(value) && value >= 1 && value <= 5) {
    return value >= 4 ? 'high' : value >= 3 ? 'medium' : 'low';
  }
  return level(value);
}

function validTime(value, nowMs) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms <= nowMs && ms >= nowMs - MAX_HISTORY_DAYS * DAY ? ms : null;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function insufficient(missing) {
  return { signal_type: 'relationship_decay', status: 'insufficient_evidence',
    why: `缺少${missing.join('、')}，暂不能判断关系是否衰减。`, confidence: 0,
    recommended_action: '先核实并补录真实的关系和互动信息，不要仅因经过的天数打扰对方。',
    evidence: { missing } };
}

function evaluateRelationshipDecay(input = {}) {
  const nowMs = input.now instanceof Date ? input.now.getTime() : Date.parse(input.now);
  if (!Number.isFinite(nowMs)) throw new TypeError('Valid evaluation time is required');
  const strength = level(input.strength);
  const importance = importanceLevel(input.importance);
  const lastMeaningfulMs = validTime(input.lastMeaningfulAt, nowMs);
  const rawTimes = Array.isArray(input.interactionTimes) ? input.interactionTimes : [];
  // Multiple rows from one day are a single contact for cadence purposes.
  const uniqueDays = [...new Set(rawTimes.map(value => validTime(value, nowMs))
    .filter(ms => ms !== null).map(ms => Math.floor((ms + CHINA_OFFSET) / DAY)))].sort((a, b) => a - b).slice(-MAX_EVENTS);
  const missing = [];
  if (!strength) missing.push('明确的关系强度');
  if (!importance) missing.push('关系重要性');
  if (lastMeaningfulMs === null) missing.push('最近一次重要互动');
  if (uniqueDays.length < 3) missing.push('可建立个人节奏的至少三次真实互动');
  if (missing.length) return insufficient(missing);

  const gaps = uniqueDays.slice(1).map((day, index) => day - uniqueDays[index]);
  const cadenceDays = median(gaps);
  if (!Number.isFinite(cadenceDays) || cadenceDays <= 0) {
    return insufficient(['可计算的历史互动间隔']);
  }
  const strengthFactor = { high: 0.85, medium: 1, low: 1.15 }[strength];
  const importanceFactor = { high: 0.85, medium: 1, low: 1.15 }[importance];
  const irregularity = Math.max(...gaps) / Math.max(1, Math.min(...gaps));
  const variabilityFactor = irregularity >= 4 ? 1.3 : 1;
  const expectedDays = Math.min(365, Math.max(14,
    Math.round(cadenceDays * 2 * strengthFactor * importanceFactor * variabilityFactor)));
  const elapsedDays = Math.floor((nowMs - lastMeaningfulMs) / DAY);
  const decaying = elapsedDays > expectedDays;
  let confidence = 0.55 + (uniqueDays.length >= 5 ? 0.1 : 0) +
    (uniqueDays.length >= 8 ? 0.05 : 0) +
    (input.meaningfulSource === 'explicit' ? 0.1 : 0) +
    (input.importanceSource === 'explicit' ? 0.1 : 0) -
    (irregularity >= 4 ? 0.15 : 0) -
    (input.importanceSource === 'sales_priority_proxy' ? 0.1 : 0);
  confidence = Math.max(0.3, Math.min(0.9, Math.round(confidence * 100) / 100));
  const why = `最近一次重要互动距今 ${elapsedDays} 天；最近 ${uniqueDays.length} 次真实互动的典型间隔约 ${Math.round(cadenceDays)} 天。按${strength === 'high' ? '强' : strength === 'medium' ? '中' : '弱'}关系、${importance === 'high' ? '高' : importance === 'medium' ? '中' : '低'}重要性及节奏波动，个性化观察界限为 ${expectedDays} 天。`;
  return { signal_type: 'relationship_decay', status: decaying ? 'signal' : 'stable',
    why, confidence,
    recommended_action: decaying
      ? '先核实是否有未录入的重要互动，再参考上次有价值的话题安排一次轻量联系；由人决定是否创建 Action。'
      : '维持现有互动节奏；不要只因日历天数增加就催促联系。',
    evidence: { strength, importance, cadence_days: Math.round(cadenceDays),
      elapsed_days: elapsedDays, observation_days: expectedDays,
      interaction_count: uniqueDays.length, irregular: irregularity >= 4,
      meaningful_source: input.meaningfulSource || 'unknown',
      importance_source: input.importanceSource || 'unknown' } };
}

module.exports = { evaluateRelationshipDecay };
