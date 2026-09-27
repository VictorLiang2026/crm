'use strict';

const MAX_TEXT = 10000;
const LIMITS = Object.freeze({ facts: 20, signals: 12, opportunityCandidates: 10,
  actionCandidates: 10, commitmentCandidates: 10, evidence: 12 });

function clean(value, max, label, allowEmpty = false) {
  if (typeof value !== 'string') throw new Error(`Invalid ${label}`);
  const result = value.trim();
  if (result.length > max || (!allowEmpty && !result)) throw new Error(`Invalid ${label}`);
  return result;
}

function list(value, name) {
  if (!Array.isArray(value) || value.length > LIMITS[name]) throw new Error(`Invalid ${name}`);
  return value.map((item, index) => clean(item, 500, `${name}[${index}]`));
}

function validDate(value) {
  if (value === null || value === '') return null;
  const date = clean(value, 10, 'interaction date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      new Date(`${date}T12:00:00+08:00`).toISOString().slice(0, 10) !== date) {
    throw new Error('Invalid interaction date');
  }
  return date;
}

function normalizeDraft(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid V2 draft');
  const interaction = value.interaction;
  if (!interaction || typeof interaction !== 'object' || Array.isArray(interaction)) {
    throw new Error('Invalid interaction candidate');
  }
  return {
    personName: clean(value.person_name ?? '', 160, 'person name', true),
    interaction: {
      type: clean(interaction.type, 64, 'interaction type'),
      date: validDate(interaction.date ?? null),
      channel: clean(interaction.channel ?? '', 100, 'interaction channel', true),
      summary: clean(interaction.summary, 2000, 'interaction summary'),
    },
    facts: list(value.facts, 'facts'),
    signals: list(value.signals, 'signals'),
    opportunityCandidates: list(value.opportunity_candidates, 'opportunityCandidates'),
    actionCandidates: list(value.action_candidates, 'actionCandidates'),
    commitmentCandidates: list(value.commitment_candidates, 'commitmentCandidates'),
    evidence: list(value.evidence, 'evidence'),
  };
}

function prompt(today) {
  return [
    '你是 CRM 快速记录草稿助手。仅提取候选内容，不写数据库，不选定人物身份。',
    `今天是 ${today}（北京时间）。只返回 JSON，不要 Markdown。`,
    '返回结构：{"person_name":"", "interaction":{"type":"", "date":"YYYY-MM-DD或空串", "channel":"", "summary":""},',
    '"facts":[], "signals":[], "opportunity_candidates":[], "action_candidates":[], "commitment_candidates":[], "evidence":[]}。',
    'facts 仅为原话明确陈述的事实候选；signals 是观察到的线索；机会是推断，行动是建议，承诺是原话中明确约定的事项。',
    '不得把推测写成事实。信息不足时返回空数组或空姓名；不得猜测具体人物。每项简短，数组最多 10-20 项。',
  ].join('\n');
}

async function quickCaptureV2(event, { generateText, extractJson, today }) {
  const text = clean(event?.text ?? '', MAX_TEXT, 'raw input');
  const messages = [{ role: 'system', content: prompt(today) }, { role: 'user', content: text }];
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await generateText(messages, { timeout: 55000 });
    try { return { preview: normalizeDraft(extractJson(response.text)), today }; }
    catch (error) { lastError = error; }
  }
  throw new Error(`AI 未返回有效的 V2 草稿：${lastError.message}`);
}

module.exports = { quickCaptureV2, normalizeDraft, MAX_TEXT, LIMITS };
