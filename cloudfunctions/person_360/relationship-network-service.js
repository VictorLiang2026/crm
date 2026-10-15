'use strict';

const NETWORK_FIELDS = 'id,from_person_id,to_person_id,relationship_type,relationship_stage,strength,trust_level,trend,source,status,confirmed_at,importance,last_meaningful_interaction_at,created_at,updated_at';
const EDGE_PAGE_SIZE = 20;
const MAX_EDGE_PAGES = 3;
const MAX_NODES = 50;
const MAX_EDGES = 100;
const MAX_PATHS = 50;
const ID = /^[1-9]\d*$/;

function idOf(value) {
  const valueText = String(value ?? '');
  if (!ID.test(valueText) || !Number.isSafeInteger(Number(valueText))) throw new Error('Invalid Person ID');
  return valueText;
}

function one(rows) { return Array.isArray(rows) ? rows[0] || null : null; }

function pageOf(value) {
  const page = Number(value ?? 1);
  if (!Number.isInteger(page) || page < 1 || page > MAX_EDGE_PAGES) throw new Error('Invalid relationship network page');
  return page;
}

function relationshipFilters(personId, limit, offset = 0) {
  return {
    select: NETWORK_FIELDS,
    or: `(from_person_id.eq.${personId},to_person_id.eq.${personId})`,
    status: 'eq.confirmed', deleted_at: 'is.null',
    order: 'updated_at.desc,id.desc', limit, offset,
  };
}

class RelationshipNetworkService {
  constructor({ request, generateText, extractJson, guardrails }) {
    if (typeof request !== 'function') throw new Error('Authorized relationship network access is required');
    this.request = request;
    this.generateText = generateText;
    this.extractJson = extractJson;
    this.guardrails = guardrails || '';
  }

  async activePerson(personId) {
    const pid = idOf(personId);
    const person = one(await this.request('persons', 'GET', {
      select: 'id,display_name,customer_stage,referral_priority', id: `eq.${pid}`, deleted_at: 'is.null', limit: 1,
    }));
    if (!person) throw new Error('Person not found');
    return person;
  }

  async hydratePersonNames(rows) {
    const ids = [...new Set((rows || []).flatMap(row => [String(row.from_person_id), String(row.to_person_id)]))];
    if (!ids.length) return new Map();
    const people = await this.request('persons', 'GET', {
      select: 'id,display_name', id: `in.(${ids.join(',')})`, deleted_at: 'is.null', limit: MAX_NODES,
    });
    return new Map((people || []).map(person => [String(person.id), person]));
  }

  async listAdjacency(personId, pageValue = 1) {
    const person = await this.activePerson(personId);
    const page = pageOf(pageValue);
    const offset = (page - 1) * EDGE_PAGE_SIZE;
    const remaining = MAX_NODES - offset;
    if (remaining <= 0) return { personId: String(person.id), rows: [], page, hasMore: false, truncated: true };
    const limit = Math.min(EDGE_PAGE_SIZE, remaining) + 1;
    const rows = await this.request('relationships', 'GET', relationshipFilters(person.id, limit, offset));
    const pageRows = (rows || []).slice(0, limit - 1);
    const names = await this.hydratePersonNames(pageRows);
    const active = pageRows.filter(row => names.has(String(row.from_person_id)) && names.has(String(row.to_person_id)) &&
      String(row.from_person_id) !== String(row.to_person_id));
    return {
      personId: String(person.id),
      rows: active.map(row => this.presentEdge(row, names, String(person.id))),
      page, hasMore: rows.length >= limit && page < MAX_EDGE_PAGES,
      truncated: rows.length >= limit && page >= MAX_EDGE_PAGES,
      maxNodes: MAX_NODES, maxEdges: MAX_EDGES,
    };
  }

  presentEdge(row, names, relativePersonId) {
    const fromId = String(row.from_person_id);
    const toId = String(row.to_person_id);
    return {
      id: String(row.id), fromPersonId: fromId, toPersonId: toId,
      fromName: names.get(fromId)?.display_name || null, toName: names.get(toId)?.display_name || null,
      direction: fromId === relativePersonId ? 'outgoing' : 'incoming',
      relationshipType: row.relationship_type, relationshipStage: row.relationship_stage || null,
      strength: row.strength || null, importance: row.importance == null ? null : Number(row.importance),
      source: row.source, status: row.status, confirmedAt: row.confirmed_at || null,
      updatedAt: row.updated_at || null, lastMeaningfulInteractionAt: row.last_meaningful_interaction_at || null,
    };
  }

  async isConfirmedNeighbor(personId, neighborId) {
    const pid = idOf(personId);
    const nid = idOf(neighborId);
    if (pid === nid) return false;
    const [forward, reverse] = await Promise.all([
      this.request('relationships', 'GET', {
        select: 'id', from_person_id: `eq.${pid}`, to_person_id: `eq.${nid}`,
        status: 'eq.confirmed', deleted_at: 'is.null', limit: 1,
      }),
      this.request('relationships', 'GET', {
        select: 'id', from_person_id: `eq.${nid}`, to_person_id: `eq.${pid}`,
        status: 'eq.confirmed', deleted_at: 'is.null', limit: 1,
      }),
    ]);
    return Boolean(one(forward) || one(reverse));
  }

  async expandNeighbor(personId, neighborId, page = 1) {
    const root = await this.activePerson(personId);
    const neighbor = await this.activePerson(neighborId);
    if (!(await this.isConfirmedNeighbor(root.id, neighbor.id))) throw new Error('Person is not a confirmed direct neighbor');
    const result = await this.listAdjacency(neighbor.id, page);
    return { ...result, rootPersonId: String(root.id), expandedPersonId: String(neighbor.id) };
  }

  async listFamilyMemberships(personId) {
    const person = await this.activePerson(personId);
    const pid = String(person.id);
    const [owned, current] = await Promise.all([
      this.request('households', 'GET', {
        select: 'id,anchor_person_id,updated_at', anchor_person_id: `eq.${pid}`,
        deleted_at: 'is.null', order: 'id.asc', limit: 21,
      }),
      this.request('household_members', 'GET', {
        select: 'id,household_id,person_id,relationship_to_anchor,confirmed_at,confirmed_by_uid,updated_at',
        person_id: `eq.${pid}`, confirmed_at: 'not.is.null', confirmed_by_uid: 'not.is.null',
        deleted_at: 'is.null', order: 'updated_at.desc,id.desc', limit: 21,
      }),
    ]);
    const householdIds = [...new Set([
      ...(owned || []).slice(0, 20).map(row => String(row.id)),
      ...(current || []).slice(0, 20).map(row => String(row.household_id)),
    ])].slice(0, 20);
    if (!householdIds.length) return { personId: pid, rows: [], hasMore: false, truncated: false };
    const households = await this.request('households', 'GET', {
      select: 'id,anchor_person_id,updated_at', id: `in.(${householdIds.join(',')})`, deleted_at: 'is.null', limit: 20,
    });
    const rawLinks = [];
    let truncated = (owned || []).length > 20 || (current || []).length > 20;
    for (const household of households || []) {
      const members = await this.request('household_members', 'GET', {
        select: 'id,household_id,person_id,relationship_to_anchor,confirmed_at,confirmed_by_uid,updated_at',
        household_id: `eq.${household.id}`, confirmed_at: 'not.is.null', confirmed_by_uid: 'not.is.null',
        deleted_at: 'is.null', order: 'updated_at.desc,id.desc', limit: 51,
      });
      if (members.length > 50) truncated = true;
      const anchorId = String(household.anchor_person_id);
      if (anchorId === pid) {
        members.slice(0, 50).forEach(member => {
          if (String(member.person_id) !== pid) rawLinks.push({
            householdId: String(household.id), personId: String(member.person_id),
            membershipId: String(member.id), relationshipToAnchor: member.relationship_to_anchor,
            confirmedAt: member.confirmed_at, updatedAt: member.updated_at,
          });
        });
      } else {
        const ownMembership = (members || []).find(member => String(member.person_id) === pid);
        if (ownMembership) rawLinks.push({
          householdId: String(household.id), personId: anchorId,
          membershipId: String(ownMembership.id), relationshipToAnchor: ownMembership.relationship_to_anchor,
          confirmedAt: ownMembership.confirmed_at, updatedAt: ownMembership.updated_at,
        });
      }
    }
    const endpointIds = [...new Set([pid, ...rawLinks.map(row => row.personId)])];
    const people = endpointIds.length ? await this.request('persons', 'GET', {
      select: 'id,display_name', id: `in.(${endpointIds.join(',')})`, deleted_at: 'is.null', limit: MAX_NODES,
    }) : [];
    const names = new Map((people || []).map(row => [String(row.id), row.display_name]));
    const rows = rawLinks.filter(row => names.has(row.personId)).slice(0, MAX_NODES).map(row => ({
      ...row, personName: names.get(row.personId), direction: 'household-membership',
    }));
    if (rawLinks.length > MAX_NODES) truncated = true;
    return { personId: pid, rows, hasMore: truncated, truncated };
  }

  async listIntroductionPaths(personId) {
    const root = await this.activePerson(personId);
    const rootId = String(root.id);
    const directRows = await this.request('relationships', 'GET', {
      select: NETWORK_FIELDS, from_person_id: `eq.${rootId}`, status: 'eq.confirmed', deleted_at: 'is.null',
      order: 'importance.desc.nullslast,updated_at.desc,id.desc', limit: MAX_NODES + 1,
    });
    const direct = (directRows || []).slice(0, MAX_NODES - 1).filter(row => String(row.to_person_id) !== rootId);
    const middleIds = [...new Set(direct.map(row => String(row.to_person_id)))].slice(0, MAX_NODES - 1);
    let secondRows = [];
    if (middleIds.length) secondRows = await this.request('relationships', 'GET', {
      select: NETWORK_FIELDS, from_person_id: `in.(${middleIds.join(',')})`, status: 'eq.confirmed',
      deleted_at: 'is.null', order: 'importance.desc.nullslast,updated_at.desc,id.desc', limit: MAX_EDGES + 1,
    });
    const routeEdges = [...direct, ...(secondRows || []).slice(0, MAX_EDGES)];
    const names = await this.hydratePersonNames(routeEdges);
    if (!names.has(rootId)) names.set(rootId, root);
    const paths = [];
    const usedNodes = new Set([rootId]);
    const usedEdges = new Set();
    let truncated = (directRows || []).length > MAX_NODES - 1 || (secondRows || []).length > MAX_EDGES;
    const makeHop = row => {
      const fromId = String(row.from_person_id), toId = String(row.to_person_id);
      return {
        edgeId: String(row.id), fromPersonId: fromId, fromName: names.get(fromId)?.display_name || null,
        toPersonId: toId, toName: names.get(toId)?.display_name || null,
        relationshipType: row.relationship_type, source: row.source, confirmedAt: row.confirmed_at || null,
        updatedAt: row.updated_at || null, strength: row.strength || null,
        importance: row.importance == null ? null : Number(row.importance),
      };
    };
    const addPath = rows => {
      const hops = rows.map(makeHop);
      if (!hops.length || hops.length > 2 || hops[0].fromPersonId !== rootId) return;
      let expected = rootId;
      const seen = new Set([rootId]);
      for (const hop of hops) {
        if (hop.fromPersonId !== expected || !hop.toName || hop.fromPersonId === hop.toPersonId || seen.has(hop.toPersonId)) return;
        expected = hop.toPersonId; seen.add(expected);
      }
      if (paths.length >= MAX_PATHS || usedEdges.size + hops.filter(h => !usedEdges.has(h.edgeId)).length > MAX_EDGES ||
          [...seen].filter(nodeId => !usedNodes.has(nodeId)).length + usedNodes.size > MAX_NODES) {
        truncated = true; return;
      }
      hops.forEach(hop => { usedEdges.add(hop.edgeId); usedNodes.add(hop.fromPersonId); usedNodes.add(hop.toPersonId); });
      paths.push({ pathId: hops.map(hop => hop.edgeId).join(':'), targetPersonId: expected,
        targetName: names.get(expected)?.display_name || null, hops });
    };
    direct.forEach(row => addPath([row]));
    const directIds = new Set(direct.map(row => String(row.id)));
    for (const second of (secondRows || []).slice(0, MAX_EDGES)) {
      const first = direct.find(row => String(row.to_person_id) === String(second.from_person_id));
      if (!first || directIds.has(String(second.id))) continue;
      addPath([first, second]);
    }
    return { personId: rootId, paths, truncated, maxNodes: MAX_NODES, maxEdges: MAX_EDGES, maxPaths: MAX_PATHS };
  }

  async suggestIntroduction(personId, targetPersonId, edgeIds) {
    if (typeof this.generateText !== 'function' || typeof this.extractJson !== 'function') throw new Error('AI Gateway is unavailable');
    const root = await this.activePerson(personId);
    const targetId = idOf(targetPersonId);
    if (!Array.isArray(edgeIds) || edgeIds.length < 1 || edgeIds.length > 2 ||
        edgeIds.some(edgeId => !ID.test(String(edgeId)))) throw new Error('Invalid selected path');
    const routeSet = await this.listIntroductionPaths(root.id);
    const path = routeSet.paths.find(candidate => candidate.targetPersonId === targetId &&
      candidate.hops.length === edgeIds.length && candidate.hops.every((hop, index) => hop.edgeId === String(edgeIds[index])));
    if (!path) throw new Error('Selected introduction path is no longer active and confirmed');
    const context = {
      focalPerson: { displayName: root.display_name, customerStage: root.customer_stage || null,
        referralPriority: root.referral_priority || null },
      path: path.hops.map((hop, index) => ({
        step: index + 1, from: hop.fromName, to: hop.toName, relationshipType: hop.relationshipType,
        source: hop.source, confirmedAt: hop.confirmedAt, updatedAt: hop.updatedAt,
        strength: hop.strength, importance: hop.importance,
      })),
    };
    const system = [
      '你是关系经营顾问。只根据服务端提供的、已确认且有效的有向关系路径，给用户提供一条可供人工审阅的介绍建议。',
      '路径中的人物和每一段关系都是真实数据；不得补充、反转、跳过或推测任何边，也不得把家庭成员关系当作转介绍路径。',
      '不得虚构熟悉程度、沟通意愿、对方需求、联系方式、联系记录、保险情况或成功率。来源与更新时间只表示记录元数据，不代表外部证明。',
      '只输出 JSON：suitable(boolean), confidence(高/中/低), reason(≤120字), timing(≤40字), approach(≤120字), message(≤200字)。证据不足时 suitable=false、confidence=低，并明确说明需要人工核实。',
      this.guardrails,
    ].filter(Boolean).join('\n');
    const result = await this.generateText([
      { role: 'system', content: system },
      { role: 'user', content: `请基于以下已核实路径提供谨慎建议，不要选择或改写路径：\n${JSON.stringify(context)}` },
    ], { timeout: 60000 });
    const parsed = this.extractJson(result?.text || '') || {};
    const clip = (value, length) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, length) : '';
    const confidence = ['高', '中', '低'].includes(parsed.confidence) ? parsed.confidence : '低';
    return {
      path,
      suggestion: {
        suitable: parsed.suitable === true, confidence,
        reason: clip(parsed.reason, 120) || '模型未提供可核验的判断依据，请人工检查路径。',
        timing: clip(parsed.timing, 40), approach: clip(parsed.approach, 120),
        message: parsed.suitable === true ? clip(parsed.message, 200) : '',
      },
    };
  }
}

module.exports = { RelationshipNetworkService, EDGE_PAGE_SIZE, MAX_EDGE_PAGES, MAX_NODES, MAX_EDGES, MAX_PATHS };
