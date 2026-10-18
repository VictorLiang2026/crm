/**
 * pmc18_observer — Person 中心化运行观察采集器
 * 入参 event: { action }
 *   collect:     采集全部观察指标并写入 pmc18_observations 表（供定时触发器调用）
 *   listRecent:  返回最近 N 条观测记录（默认 50，供 Console/Legacy 查看）
 * 只读采集 + 写入观测表；不修改业务数据；无 PII
 */
'use strict';

const { rdb, assertOk } = require('./db');

exports.main = async (event, context) => {
  try {
    const action = (event && event.action) || 'collect'; // 定时触发器无参时默认 collect
    switch (action) {
      case 'collect': return await collect();
      case 'listRecent': return await listRecent(event);
      default: return { error: 'unknown action: ' + action };
    }
  } catch (e) {
    return { error: e.message };
  }
};

async function collect() {
  // The fixed public RPC owns the lock, the snapshot and the write transaction.
  const response = assertOk(await rdb.rpc('pmc18_collect_once_v1'));
  const result = response && response.data;
  if (!result || typeof result !== 'object' || Array.isArray(result) ||
      result.ok !== true || !Number.isInteger(result.metrics) || result.metrics !== 20 ||
      typeof result.collectedAt !== 'string' || !Number.isFinite(Date.parse(result.collectedAt)) ||
      (result.reused !== true && result.reused !== false) ||
      (result.reused === false && (!result.summary || typeof result.summary !== 'object'))) {
    throw new Error('Invalid PMC18 collection receipt');
  }
  return result;
}

async function listRecent(event) {
  const limit = Math.min(200, Math.max(1, parseInt(event.limit, 10) || 50));
  const res = assertOk(await rdb.from('pmc18_observations')
    .select('id, observed_at, metric, value, level, detail, created_at')
    .order('observed_at', { ascending: false })
    .limit(limit));
  return { rows: res.data || [], total: res.data?.length || 0 };
}
