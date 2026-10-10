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
  // 调用 DB 函数采集指标（只读，返回 JSON 快照）
  const metricsRes = assertOk(await rdb.from('pmc18_collect_metrics()').select('*').single());
  const m = metricsRes.pmc18_collect_metrics || metricsRes;

  const rows = [];
  const now = new Date().toISOString();

  // 身份映射
  pushMetric(rows, now, 'customers_without_person', m.mappings?.customers_without_person, m.mappings?.customers_without_person > 0 ? 'critical' : 'info');
  pushMetric(rows, now, 'recruits_without_person', m.mappings?.recruits_without_person, m.mappings?.recruits_without_person > 0 ? 'critical' : 'info');

  // 字段漂移
  pushMetric(rows, now, 'field_drift_rows', m.field_drift?.drift_rows, m.field_drift?.drift_rows > 0 ? 'warning' : 'info');

  // 重复人物
  pushMetric(rows, now, 'duplicate_person_groups', m.duplicate_persons?.dup_groups, m.duplicate_persons?.dup_groups > 0 ? 'warning' : 'info');

  // 孤儿引用
  for (const [k, v] of Object.entries(m.orphans || {})) {
    pushMetric(rows, now, 'orphan_' + k, v, v > 0 ? 'critical' : 'info');
  }

  // 软删跨表不一致
  pushMetric(rows, now, 'person_alive_customer_deleted', m.softdelete_cross?.person_alive_customer_deleted, m.softdelete_cross?.person_alive_customer_deleted > 0 ? 'warning' : 'info');
  pushMetric(rows, now, 'person_deleted_customer_alive', m.softdelete_cross?.person_deleted_customer_alive, m.softdelete_cross?.person_deleted_customer_alive > 0 ? 'warning' : 'info');

  // 角色重复
  pushMetric(rows, now, 'duplicate_role_rows', m.roles?.duplicate_role_rows, m.roles?.duplicate_role_rows > 0 ? 'critical' : 'info');

  // 无角色 Person（排除测试数据）
  pushMetric(rows, now, 'persons_without_role', m.no_role?.no_role, m.no_role?.no_role > 0 ? 'warning' : 'info');

  // 计数
  for (const [t, c] of Object.entries(m.counts || {})) {
    pushMetric(rows, now, 'count_' + t, c.total, 'info', c);
  }

  // 写入观测表
  await assertOk(rdb.from('pmc18_observations').insert(rows));

  return {
    ok: true,
    collectedAt: now,
    metrics: rows.length,
    summary: {
      customers_without_person: m.mappings?.customers_without_person,
      recruits_without_person: m.mappings?.recruits_without_person,
      field_drift: m.field_drift?.drift_rows,
      duplicate_persons: m.duplicate_persons?.dup_groups,
      orphans: m.orphans,
      persons_without_role: m.no_role?.no_role,
    },
  };
}

async function listRecent(event) {
  const limit = Math.min(200, Math.max(1, parseInt(event.limit, 10) || 50));
  const res = assertOk(await rdb.from('pmc18_observations')
    .select('id, observed_at, metric, value, level, detail, created_at')
    .order('observed_at', { ascending: false })
    .limit(limit));
  return { rows: res.data || [], total: res.data?.length || 0 };
}

function pushMetric(rows, observedAt, metric, value, level, detail) {
  rows.push({
    observed_at: observedAt,
    metric,
    value: value != null ? String(value) : null,
    level: level || 'info',
    detail: detail != null ? JSON.stringify(detail) : null,
  });
}
