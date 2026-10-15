import { h } from './dom.js';
import { data } from './data.js';
import { t, translateEnum } from './i18n.js';
import { bdg, emptyNote } from './ui.js';

const MAX_NODES = 50;
const MAX_EDGES = 100;
const ID = value => String(value || '');
const dateText = value => value ? String(value).replace('T', ' ').slice(0, 16) : t('network_unknown_date');
const typeText = value => t(`relationship_type_${value}`) || value || t('network_unknown');
const personHref = id => `#/person/${encodeURIComponent(ID(id))}`;

function personLink(id, name) {
  return h('a', { class: 'relationship-network-person', href: personHref(id), title: `${name || t('relationship_person_unavailable')} · #${id}` },
    `${name || t('relationship_person_unavailable')} · #${id}`);
}

function evidenceLine(edge) {
  return h('div', { class: 'relationship-network-evidence' }, [
    h('span', {}, `${t('relationship_type')}: ${typeText(edge.relationshipType || edge.relationship_type)}`),
    h('span', {}, `${t('relationship_source')}: ${t(`relationship_source_${edge.source}`) || edge.source || t('network_unknown')}`),
    h('span', {}, `${t('relationship_confirmed')}: ${dateText(edge.confirmedAt || edge.confirmed_at)}`),
    h('span', {}, `${t('relationship_updated_at')}: ${dateText(edge.updatedAt || edge.updated_at)}`),
    h('span', {}, `${t('relationship_strength')}: ${edge.strength || t('relationship_no_strength')}`),
    h('span', {}, `${t('relationship_importance')}: ${edge.importance == null ? t('relationship_unrated') : `${edge.importance}/5`}`),
    h('span', {}, `${t('network_edge_record')}: #${edge.edgeId || edge.id}`),
  ]);
}

function linkRow(edge, relativePersonId, expanded, canExpand = true) {
  const outgoing = String(edge.fromPersonId) === String(relativePersonId);
  const otherId = outgoing ? edge.toPersonId : edge.fromPersonId;
  const otherName = outgoing ? edge.toName : edge.fromName;
  const row = h('article', { class: 'relationship-network-edge' }, [
    h('div', { class: 'relationship-network-edge-title' }, [
      h('span', { class: outgoing ? 'relationship-network-arrow outgoing' : 'relationship-network-arrow incoming', 'aria-label': outgoing ? t('relationship_direction_outgoing') : t('relationship_direction_incoming') }, outgoing ? '→' : '←'),
      personLink(otherId, otherName),
      bdg(typeText(edge.relationshipType), edge.relationshipType === 'business' || edge.relationshipType === 'referral' ? 'red' : 'ink'),
    ]),
    evidenceLine(edge),
  ]);
  if (canExpand && outgoing && !expanded.has(String(otherId))) {
    const button = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => expanded.onExpand(String(otherId)) }, t('network_expand_neighbor'));
    row.append(button);
  }
  return row;
}

export async function relationshipNetworkNode(ctx, personId) {
  const root = h('section', { class: 'card person360-card relationship-network' });
  const header = h('div', { class: 'card-head' }, [h('b', {}, t('network_title')), bdg(t('network_confirmed_only'), 'jade')]);
  const body = h('div', { class: 'card-body' });
  root.append(header, body);
  body.append(h('p', { class: 'sheet-note' }, t('network_scope_note')));

  const columns = h('div', { class: 'relationship-network-columns' });
  const adjacencyPane = h('section', { class: 'relationship-network-pane' }, [
    h('h4', {}, t('network_adjacency_title')),
  ]);
  const adjacencyList = h('div', { class: 'relationship-network-list' });
  const adjacencyMore = h('div', { class: 'relationship-network-controls' });
  adjacencyPane.append(h('p', { class: 'row-sub' }, t('network_adjacency_note')), adjacencyList, adjacencyMore);

  const pathsPane = h('section', { class: 'relationship-network-pane' }, [
    h('h4', {}, t('network_paths_title')),
    h('p', { class: 'row-sub' }, t('network_paths_note')),
  ]);
  const pathList = h('div', { class: 'relationship-network-list' });
  const adviceHost = h('div', { class: 'relationship-network-advice' });
  pathsPane.append(pathList, adviceHost);
  columns.append(adjacencyPane, pathsPane);
  body.append(columns);

  const familyPane = h('section', { class: 'relationship-network-family' }, [
    h('h4', {}, [bdg(t('network_family_legend'), 'gold'), ` ${t('network_family_title')}`]),
    h('p', { class: 'row-sub' }, t('network_family_note')),
  ]);
  const familyList = h('div', { class: 'relationship-network-list' });
  familyPane.append(familyList);
  body.append(familyPane);

  const edgeIds = new Set();
  const nodeIds = new Set([String(personId)]);
  const expanded = new Set();
  const neighborNames = new Map();
  let page = 1;
  let hasMore = false;
  let paths = [];
  let truncated = false;

  function acceptEdge(edge) {
    if (edgeIds.has(String(edge.id))) return true;
    const extraNodes = [edge.fromPersonId, edge.toPersonId].map(String).filter(value => !nodeIds.has(value));
    if (edgeIds.size >= MAX_EDGES || nodeIds.size + new Set(extraNodes).size > MAX_NODES) return false;
    edgeIds.add(String(edge.id));
    nodeIds.add(String(edge.fromPersonId)); nodeIds.add(String(edge.toPersonId));
    return true;
  }

  function renderAdjacency(rows, append = false) {
    const cards = [];
    const expandConfig = { has: value => expanded.has(value), onExpand: async neighborId => {
      expanded.add(neighborId);
      const loading = h('p', { class: 'row-sub' }, t('loading'));
      adjacencyMore.append(loading);
      try {
        const result = await data.expandRelationshipNetwork(ctx, String(personId), neighborId, 1);
        const accepted = (result.rows || []).filter(edge => !edgeIds.has(String(edge.id)) && acceptEdge(edge));
        const block = h('div', { class: 'relationship-network-expanded' }, [
          h('h5', {}, `${t('network_expanded_title')}: ${personLink(neighborId, neighborNames.get(neighborId) || neighborId)}`),
        ]);
        accepted.forEach(edge => block.append(linkRow(edge, neighborId, expandConfig, false)));
        if (result.hasMore || result.truncated) block.append(h('p', { class: 'relationship-network-limit' }, t('network_limit_reached')));
        loading.replaceWith(block);
      } catch (error) {
        loading.replaceWith(h('p', { class: 'relationship-network-error' }, `${t('network_expand_failed')}: ${error.message}`));
      }
    } };
    for (const edge of rows) {
      if (!acceptEdge(edge)) { truncated = true; continue; }
      neighborNames.set(String(edge.fromPersonId), edge.fromName);
      neighborNames.set(String(edge.toPersonId), edge.toName);
      cards.push(linkRow(edge, String(personId), expandConfig));
    }
    if (append) adjacencyList.append(...cards); else adjacencyList.replaceChildren(...cards);
  }

  async function loadNextPage() {
    adjacencyMore.replaceChildren(h('p', { class: 'row-sub' }, t('loading')));
    try {
      const result = await data.relationshipNetwork(ctx, String(personId), page);
      const adjacency = result.adjacency || {};
      renderAdjacency(adjacency.rows || [], page > 1);
      hasMore = adjacency.hasMore === true;
      truncated ||= adjacency.truncated === true;
      const controls = [];
      if (hasMore && nodeIds.size < MAX_NODES && edgeIds.size < MAX_EDGES) {
        controls.push(h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { page++; void loadNextPage(); } }, t('network_load_more')));
      }
      if (truncated || adjacency.truncated) controls.push(h('span', { class: 'relationship-network-limit' }, t('network_limit_reached')));
      adjacencyMore.replaceChildren(...controls);
      if (page === 1) renderFamily(result.family || {});
    } catch (error) {
      adjacencyList.replaceChildren(emptyNote(t('data_load_failed'), error.message || t('try_later')));
    }
  }

  function renderFamily(family) {
    const rows = family.rows || [];
    if (!rows.length) {
      familyList.replaceChildren(emptyNote(t('network_family_empty'), ''));
      return;
    }
    familyList.replaceChildren(...rows.map(row => h('article', { class: 'relationship-network-edge family' }, [
      h('div', { class: 'relationship-network-edge-title' }, [
        bdg(t('network_family_legend'), 'gold'), personLink(row.personId, row.personName),
        h('span', { class: 'row-sub' }, translateEnum('family_relationship', row.relationshipToAnchor) || row.relationshipToAnchor),
      ]),
      h('div', { class: 'relationship-network-evidence' }, [
        h('span', {}, `${t('network_membership_confirmed')}: ${dateText(row.confirmedAt)}`),
        h('span', {}, `${t('relationship_updated_at')}: ${dateText(row.updatedAt)}`),
      ]),
    ])));
    if (family.truncated) familyList.append(h('p', { class: 'relationship-network-limit' }, t('network_family_truncated')));
  }

  function renderPaths(result) {
    paths = result.paths || [];
    truncated ||= result.truncated === true;
    if (!paths.length) {
      pathList.replaceChildren(emptyNote(t('network_no_paths'), t('network_no_paths_note')));
    } else {
      pathList.replaceChildren(...paths.map(path => {
        const article = h('article', { class: 'relationship-network-path' }, [
          h('div', { class: 'relationship-network-path-title' }, [
            bdg(path.hops.length === 1 ? t('network_path_one_hop') : t('network_path_two_hops'), path.hops.length === 1 ? 'jade' : 'gold'),
            h('strong', {}, t('network_path_to')),
            personLink(path.targetPersonId, path.targetName),
          ]),
        ]);
        path.hops.forEach((hop, index) => {
          article.append(h('div', { class: 'relationship-network-hop' }, [
            h('div', { class: 'relationship-network-hop-title' }, [
              personLink(hop.fromPersonId, hop.fromName), h('span', { class: 'relationship-network-arrow outgoing' }, '→'),
              personLink(hop.toPersonId, hop.toName), bdg(typeText(hop.relationshipType), hop.relationshipType === 'business' || hop.relationshipType === 'referral' ? 'red' : 'ink'),
            ]), evidenceLine(hop),
            index < path.hops.length - 1 ? h('div', { class: 'relationship-network-via' }, t('network_path_via')) : null,
          ]));
        });
        const button = h('button', { class: 'btn btn-soft btn-sm', type: 'button' }, t('network_generate_advice'));
        button.onclick = () => void requestAdvice(path, button);
        article.append(button);
        return article;
      }));
    }
    if (result.truncated) pathList.append(h('p', { class: 'relationship-network-limit' }, t('network_paths_truncated')));
  }

  async function requestAdvice(path, button) {
    button.disabled = true;
    adviceHost.replaceChildren(h('p', { class: 'row-sub' }, t('network_ai_loading')));
    try {
      const result = await data.suggestRelationshipIntroduction(ctx, String(personId), String(path.targetPersonId), path.hops.map(hop => hop.edgeId));
      const suggestion = result.suggestion || {};
      adviceHost.replaceChildren(h('article', { class: 'relationship-network-advice-card' }, [
        h('div', { class: 'relationship-network-advice-title' }, [h('strong', {}, t('network_ai_suggestion')), bdg(suggestion.confidence || t('confidence_low'), suggestion.suitable ? 'jade' : 'gold')]),
        h('p', {}, suggestion.reason || t('network_ai_no_reason')),
        suggestion.timing ? h('p', {}, `${t('network_ai_timing')}: ${suggestion.timing}`) : null,
        suggestion.approach ? h('p', {}, `${t('network_ai_approach')}: ${suggestion.approach}`) : null,
        suggestion.message ? h('blockquote', {}, suggestion.message) : null,
        h('p', { class: 'relationship-network-limit' }, t('network_ai_no_write')),
      ]));
    } catch (error) {
      adviceHost.replaceChildren(h('p', { class: 'relationship-network-error' }, `${t('network_ai_failed')}: ${error.message}`));
    } finally { button.disabled = false; }
  }

  const initial = await Promise.all([
    loadNextPage(),
    data.relationshipIntroductionPaths(ctx, String(personId)).then(renderPaths).catch(error =>
      pathList.replaceChildren(emptyNote(t('network_paths_failed'), error.message || t('try_later')))),
  ]);
  void initial;
  return root;
}
