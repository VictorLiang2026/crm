'use strict';
// Keep old AI prompt contracts, while reading the same Person ledger as the new UI.
async function customerHistory(app, rdb, customer, limit = 20) {
  if (!/^[1-9]\d*$/.test(String(customer?.person_id || ''))) throw Error('Person history requires a linked Person');
  const response = await app.callFunction({ name: 'person_360', data: {
    action: 'listInteractions', personId: String(customer.person_id), limit,
  } });
  const result = response?.result;
  if (!result || result.error || !Array.isArray(result.rows)) throw Error('Person history unavailable');
  const ids = result.rows.filter(row => row.source_type === 'followups').map(row => row.source_id);
  let extensions = [];
  if (ids.length) {
    const res = await rdb.from('followups').select('Id,next_followup_date,next_followup_goal,next_action,next_action_date')
      .eq('customer_id', customer.Id).is('deleted_at', null).in('Id', ids);
    if (res.error) throw Error('Follow-up details unavailable');
    extensions = res.data || [];
  }
  return { data: result.rows.map(row => ({
    ...(extensions.find(item => String(item.Id) === String(row.source_id) && row.source_type === 'followups') || {}),
    followup_date: row.interaction_at, followup_notes: [row.summary,row.raw_note].filter(Boolean).join('\n'),
    interaction_summary: row.summary, interaction_type: row.interaction_type, channel: row.channel,
    source: `public.${row.source_id == null ? 'interactions' : row.source_type}#${row.source_id ?? row.id}`,
  })), error: null };
}
module.exports = { customerHistory };
