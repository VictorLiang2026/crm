/** Read-only Person-aware conversation guidance. AI audit is handled by the injected Gateway. */
'use strict';

const { defaultRegistry } = require('./skill-registry');

const SKILL = 'conversation_playbook';
const SOURCE = table => ({ schema: 'public', table });
const clip = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const idOf = value => {
  const id = String(value ?? '');
  if (!/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error('Invalid ID');
  return id;
};
const normalized = value => clip(value, 1000).toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');

function playbookScore(row, objection, scenario) {
  const asked = normalized(objection);
  const known = normalized(row.objection);
  const context = normalized(scenario);
  const category = normalized(row.scenario);
  let score = 0;
  if (known && asked === known) score += 6;
  else if (known && asked.length >= 3 && known.length >= 3 &&
      (asked.includes(known) || known.includes(asked))) score += 3;
  else if (known) return 0;
  else if (known) return 0;
  else if (known) return 0;
  if (context && category && context === category) score += 2;
  return score;
}

function reliableEvidence(row, today) {
  if (row.item_type !== 'evidence' || row.verified !== true ||
      !clip(row.source, 1024) || !clip(row.content, 2000) ||
      row.confidence == null || Number(row.confidence) < 0.7) return false;
  if (row.source_date && row.source_date > today) return false;
  if (row.valid_from && row.valid_from > today) return false;
  if (row.valid_to && row.valid_to < today) return false;
  return true;
}

class ConversationPlaybookContextBuilder {
  constructor({ request, now = () => new Date() } = {}) {
    if (typeof request !== 'function') throw new Error('Authorized public database request is required');
    this.request = request;
    this.now = now;
  }

  async build(input) {
    defaultRegistry.validateInput(SKILL, input);
    const personId = idOf(input.person_id);
    const read = (table, filters) => this.request(table, 'GET', filters);
    const person = (await read('persons', { select: 'id,display_name,occupation,organization',
      id: `eq.${personId}`, deleted_at: 'is.null', limit: 1 }))[0];
    if (!person) throw new Error('Person not found');

    const [interactionRows, itemRows, opportunityRows, playbookRows] = await Promise.all([
      read('interactions', { select: 'id,interaction_type,interaction_at,summary,importance',
        person_id: `eq.${personId}`, order: 'interaction_at.desc,id.desc', limit: 6 }),
      read('context_items', { select: 'id,item_type,category,content,confirmed,confidence,valid_from,valid_to',
        person_id: `eq.${personId}`, order: 'created_at.desc,id.desc', limit: 30 }),
      read('opportunities', { select: 'id,opportunity_type,status,last_progress,next_action',
        person_id: `eq.${personId}`, deleted_at: 'is.null', order: 'updated_at.desc,id.desc', limit: 15 }),
      read('playbooks', { select: 'id,scenario,objection,possible_underlying_reasons,clarifying_questions,response_logic,evidence_refs,do_not_say,next_objective',
        order: 'created_at.desc,id.desc', limit: 60 }),
    ]);

    const today = this.now().toISOString().slice(0, 10);
    const playbooks = playbookRows.map(row => ({ row, score: playbookScore(row, input.objection, input.scenario) }))
      .filter(item => item.score > 0).sort((a, b) => b.score - a.score)
      .slice(0, 3).map(item => item.row);
    const evidenceIds = [...new Set(playbooks.flatMap(row => Array.isArray(row.evidence_refs) ? row.evidence_refs : [])
      .map(value => { try { return idOf(value); } catch (_) { return null; } }).filter(Boolean))].slice(0, 20);
    const evidenceRows = evidenceIds.length ? await read('knowledge_items', {
      select: 'id,item_type,source,source_date,valid_from,valid_to,verified,confidence,content',
      id: `in.(${evidenceIds.join(',')})`, limit: 20,
    }) : [];
    const validIds = new Set(evidenceIds);
    const evidence = evidenceRows.filter(row => validIds.has(String(row.id)) && reliableEvidence(row, today))
      .slice(0, 12).map(row => ({ id: row.id, source_name: clip(row.source, 300),
        source_date: row.source_date || null, content: clip(row.content, 600),
        confidence: Number(row.confidence), source: { ...SOURCE('knowledge_items'), id: row.id } }));
    const current = itemRows.filter(row => (!row.valid_from || row.valid_from <= today) &&
      (!row.valid_to || row.valid_to >= today));
    const contextItem = row => ({ category: clip(row.category, 80), content: clip(row.content, 400),
      confirmed: row.confirmed === true, confidence: row.confidence,
      source: { ...SOURCE('context_items'), id: row.id } });
    const context = {
      guidance: { principle: '先理解异议，不生成通用或逐字照读的话术。潜在原因只能作为待确认假设；先提出澄清问题，再给响应逻辑与下一步目标。只引用 reliable_evidence 中的 ID。没有可信证据时 evidenceRefs 为空，明确需要人工核实；不将推断写为事实。' },
      person: { display_name: clip(person.display_name, 120), occupation: clip(person.occupation, 120),
        organization: clip(person.organization, 120), source: { ...SOURCE('persons'), id: person.id } },
      recent_interactions: interactionRows.slice(0, 6).map(row => ({ type: clip(row.interaction_type, 80),
        at: row.interaction_at, summary: clip(row.summary, 400), importance: row.importance,
        source: { ...SOURCE('interactions'), id: row.id } })),
      facts: current.filter(row => row.item_type === 'fact' && row.confirmed === true)
        .slice(0, 8).map(contextItem),
      signals: current.filter(row => row.item_type === 'signal').slice(0, 8).map(contextItem),
      open_opportunities: opportunityRows.filter(row => !['成交', '关闭'].includes(row.status))
        .slice(0, 5).map(row => ({ type: row.opportunity_type, status: row.status,
          last_progress: clip(row.last_progress, 250), next_action: clip(row.next_action, 250),
          source: { ...SOURCE('opportunities'), id: row.id } })),
      relevant_playbooks: playbooks.map(row => ({ scenario: clip(row.scenario, 256),
        objection: clip(row.objection, 500),
        possible_underlying_reasons: (row.possible_underlying_reasons || []).slice(0, 6).map(v => clip(v, 300)),
        clarifying_questions: (row.clarifying_questions || []).slice(0, 8).map(v => clip(v, 300)),
        response_logic: clip(row.response_logic, 1200), do_not_say: (row.do_not_say || []).slice(0, 6).map(v => clip(v, 300)),
        next_objective: clip(row.next_objective, 400), source: { ...SOURCE('playbooks'), id: row.id } })),
      reliable_evidence: evidence,
    };
    defaultRegistry.validateContext(SKILL, context);
    return { context, context_snapshot: { ...context, _context: { recipe: SKILL,
      subject_type: 'person', subject_id: personId, built_at: this.now().toISOString(),
      limits: { recent_interactions: 6, facts: 8, signals: 8, open_opportunities: 5,
        relevant_playbooks: 3, reliable_evidence: 12 } } } };
  }
}

function forReview(result, context) {
  defaultRegistry.validateOutput(SKILL, result);
  const known = new Map(context.reliable_evidence.map(row => [String(row.id), row]));
  const evidence = [...new Set(result.evidenceRefs.map(String))].map(id => known.get(id)).filter(Boolean);
  const needsEvidenceConfirmation = evidence.length === 0;
  return {
    possible_underlying_reasons: result.possibleUnderlyingReasons.map(reason => ({
      hypothesis: reason, needs_confirmation: true,
    })),
    clarifying_questions: result.clarifyingQuestions,
    response_logic: result.responseLogic,
    evidence,
    evidence_notice: needsEvidenceConfirmation ? '没有可引用的已核验有效证据；涉及事实或产品承诺前必须人工确认。' : null,
    needs_evidence_confirmation: needsEvidenceConfirmation,
    next_objective: result.nextObjective,
    do_not_say: result.doNotSay,
    requires_human_review: true,
    business_data_written: false,
  };
}

async function runConversationPlaybook({ input, request, gateway, now } = {}) {
  if (!gateway || typeof gateway.runAITask !== 'function') throw new Error('AI Gateway is required');
  const built = await new ConversationPlaybookContextBuilder({ request, now }).build(input);
  const task = await gateway.runAITask({ taskType: SKILL, skill: SKILL, capability: 'coaching',
    subjectType: 'person', subjectId: idOf(input.person_id), input,
    context: built.context, contextSnapshot: built.context_snapshot });
  return { task_id: task.taskId, result_id: task.resultId,
    review: forReview(task.result, built.context) };
}

module.exports = { ConversationPlaybookContextBuilder, runConversationPlaybook,
  forReview, playbookScore, reliableEvidence };
