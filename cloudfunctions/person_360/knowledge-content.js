'use strict';
const { createHash } = require('node:crypto');
const CONTENT_COLUMNS = 'gpt_original_text,gpt_summary,selected_content_source,content_state';
const nonempty = value => typeof value === 'string' && !!value.trim();
function contentVersions(row, table = 'knowledge_items', source = null) {
  const st = row.content_state || {};
  const base = { text: table === 'playbooks' ? row.response_logic : row.content,
    summary: row.metadata?.summary ?? null, reviewed: true };
  const sig = createHash('md5').update(`${base.text || ''}\x1f${base.summary || ''}`).digest('hex');
  const managed = !!st.original;
  const original = { ...(managed && st.baseSignature === sig ? st.original : base) };
  const gpt = { text: row.gpt_original_text, summary: row.gpt_summary, reviewed: st.gpt?.reviewed === true };
  const fingerprint = source ? `${source.sha256 || ''}:${source.version_no || ''}` : null;
  if (managed && ((source && st.sourceFingerprint !== fingerprint) || (!source && st.baseSignature !== sig))) {
    gpt.reviewed = false;
    if (source) original.reviewed = false;
  }
  return { original, gpt, selected: row.selected_content_source || 'original', managed, version: st.version || 0 };
}
function effectiveContent(row, table = 'knowledge_items', source = null, today = new Date().toISOString().slice(0,10)) {
  const v = contentVersions(row, table, source), pair = v[v.selected];
  if (row.deleted_at || ['invalidated','superseded'].includes(row.lifecycle_status)) return null;
  // Current library validity is manual. Do not revive retired date-based expiration rules.
  if (row.source_id && (!source || source.deleted_at || source.lifecycle_status !== 'verified' ||
      source.review_at && source.review_at < today || source.valid_from && source.valid_from > today || source.valid_to && source.valid_to < today)) return null;
  if (!pair || !nonempty(pair.text)) return null;
  // Untouched legacy text-only rows retain their original eligibility. Managed pairs never mix/fallback.
  if ((v.managed || v.selected === 'gpt') && (!nonempty(pair.summary) || !pair.reviewed || row.content_state?.paused)) return null;
  return { text: pair.text, summary: pair.summary || '', source: v.selected, version: v.version };
}
function projectContent(row, table, source, today) {
  const content = effectiveContent(row, table, source, today);
  if (!content) return null;
  // Do not carry unselected text or metadata summaries into AI prompts/ranking.
  const { gpt_original_text, gpt_summary, content_state, ...safe } = row;
  return { ...safe, [table === 'playbooks' ? 'response_logic' : 'content']: content.text,
    metadata: { categories: row.metadata?.categories, domain: row.metadata?.domain,
      published_at: row.metadata?.published_at, locator: row.metadata?.locator, summary: content.summary },
    contentReference: { contentSource: content.source, contentVersion: content.version } };
}
function managementRow(row, table, source) {
  const versions = contentVersions(row, table, source);
  const { content_state, gpt_original_text, gpt_summary, ...safe } = row;
  return { ...safe, [table === 'playbooks' ? 'response_logic' : 'content']: versions.original.text,
    metadata: { ...row.metadata, summary: versions.original.summary }, contentManaged: versions.managed,
    contentVersion: versions.version, selected_content_source: versions.selected,
    contentPaused: !effectiveContent(row, table, source),
    gpt_original_preview: (gpt_original_text || '').slice(0,180), gpt_summary_preview: (gpt_summary || '').slice(0,180) };
}
module.exports = { CONTENT_COLUMNS, contentVersions, effectiveContent, projectContent, managementRow };
