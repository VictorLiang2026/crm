/**
 * recruit_score — AI 高潜评分（事件云函数，超时 60s，rdb() 版）
 * 入参 event: { candidate_id }
 * 流程：拉取候选人 → 构建评分 prompt → hy3 生成 → 解析 JSON
 *        → 回写 recruit_candidates.potential_score / potential_reason
 * 出参: { score, reason, risks }
 *
 * 评估维度：行业资源/学习能力/抗压能力/沟通力/创业动机/文化适配
 * AI 仅用 hy3（app.ai().createModel('cloudbase')）。
 */
'use strict';

const { rdb, generateText, extractJson, assertOk, nowIso } = require('./db');
const aiStd = require('./ai');

// PMC-11：候选人人物基础资料统一取 Person（经 v_recruit_candidates.person_id）；
// 增员领域字段（annual_income/mbti/motivation 等）仍取候选人视图。
// 无 person_id / Person 已软删 → 回退视图旧值并标 unmapped；双源同字段不一致 → 记 conflicts（以 Person 为准，不猜测）。
async function loadPersonIdentity(rdb, row) {
  const fallback = {
    name: row.customer_name || null, gender: row.gender || null,
    birthday: row.birthday || null, phone: row.phone || null,
    occupation: row.occupation || null, organization: null,
    education: row.education || null, wechat: row.wx_account || null,
  };
  const identity = { source: 'customers_legacy', person_id: null, unmapped: true, conflicts: [] };
  if (row.person_id == null) return Object.assign({}, fallback, { identity: identity });
  const r = await rdb.from('persons')
    .select('id, display_name, phone, wechat, gender, birthday, occupation, organization, education')
    .eq('id', row.person_id).is('deleted_at', null).maybeSingle();
  if (r.error) throw new Error(r.error);
  const p = r.data;
  if (!p) return Object.assign({}, fallback, { identity: identity });
  identity.source = 'persons';
  identity.person_id = String(p.id);
  identity.unmapped = false;
  const merged = {};
  const pairs = [['display_name', 'name', row.customer_name], ['gender', 'gender', row.gender],
    ['birthday', 'birthday', row.birthday], ['phone', 'phone', row.phone],
    ['occupation', 'occupation', row.occupation], ['wechat', 'wechat', row.wx_account]];
  pairs.forEach(function (pair) {
    const pv = p[pair[0]] == null ? '' : String(p[pair[0]]).trim();
    const lv = pair[2] == null ? '' : String(pair[2]).trim();
    if (pv) {
      merged[pair[1]] = p[pair[0]];
      if (lv && pv !== lv) identity.conflicts.push({ field: pair[1], person: pv, legacy: lv });
    } else merged[pair[1]] = pair[2] || null;
  });
  merged.organization = p.organization || null;
  merged.education = p.education || null;
  return Object.assign({}, fallback, merged, { identity: identity });
}

// 冲突/缺失给模型的显式标注（禁止模型自行猜测补齐）
function identityNotice(identity) {
  if (identity.unmapped) {
    return '【人物身份】该候选人尚未关联 Person 档案，基础资料暂取自候选人档案；未提供的字段一律视为未知，禁止猜测补齐。';
  }
  if (identity.conflicts.length) {
    return '【人物身份·资料冲突，一律以 Person 档案为准】' +
      identity.conflicts.map(c => c.field + '：Person=' + c.person + ' / 候选人档案=' + c.legacy).join('；');
  }
  return null;
}

function buildScoringPrompt(c, ident, notice) {
  return [
    '你是保险增员人才评估专家。根据候选人资料评估其成为优秀代理人的潜力。',
    '【评估维度（每项 0-100，加权得出总分）】',
    '1. 行业资源(25%): 现有客户/人脉网络的质量与数量',
    '2. 学习能力(15%): 学历背景、跨界适应力',
    '3. 抗压能力(20%): 收入波动承受力、职业转型经验',
    '4. 沟通力(15%): MBTI 倾向、现职沟通场景',
    '5. 创业动机(15%): 求职动机与保险创业的契合度',
    '6. 文化适配(10%): 价值观、团队协作倾向',
    '【输出 JSON】',
    '{ "score": 0-100整数, "reason": "三大理由（60字内，每条只引用上面给出的事实）", "risks": "三大风险点（60字内）" }',
    '【统一护栏】',
    '1. 只能依据上面给出的资料打分，严禁虚构候选人的经历/资源/动机；',
    '2. 资料严重不足（大部分字段为未知/无）时 score 不得高于 60，且 reason 首句必须注明“资料不足，分数为初步判断”；',
    '3. 严禁虚构成功率、ROI 或收益承诺；只输出 JSON，不要解释。',
    // PMC-11：缺失/冲突显式标注，禁止模型猜测补齐
    notice || '',
    '【候选人资料】',
    '姓名：' + (ident.name || '未知'),
    '性别：' + (ident.gender || '未知'),
    '出生：' + (ident.birthday || '未知'),
    '现职/行业：' + (ident.occupation || '未知'),
    '年收入：' + (c.annual_income || '未知'),
    '学历：' + (ident.education || '未知'),
    'MBTI：' + (c.mbti || '未知'),
    '求职动机：' + (c.motivation || '未知'),
    '顾虑点：' + (c.concerns || '未知'),
    '来源：' + (c.source || '未知'),
    '工作经历：' + (c.work_experience || '无'),
    '家庭情况：' + (c.family_situation || '无'),
    '性格标签：' + (c.personality_tags || '无'),
    '职业规划：' + (c.career_plan || '无'),
  ].join('\n');
}

exports.main = async (event, context) => {
  try {
    // PMC-12：bigint ID 字符串精确处理（R-ID2）；缺失时保留原错误信息
    if (!event || event.candidate_id == null || event.candidate_id === '') return { error: 'candidate_id required' };
    const s = String(event.candidate_id);
    if (!/^[1-9]\d*$/.test(s) || !Number.isSafeInteger(Number(s))) return { error: 'Invalid candidate ID' };
    const candidateId = s;

    const c = assertOk(await rdb.from('v_recruit_candidates')
      .select('*').eq('candidate_id', candidateId).maybeSingle());
    if (!c.data) return { error: 'candidate not found' };
    const candidate = c.data;
    // PMC-11：人物基础资料 Person 化（缺失回退、冲突标注）
    const ident = await loadPersonIdentity(rdb, candidate);

    const messages = [
      { role: 'user', content: buildScoringPrompt(candidate, ident, identityNotice(ident.identity)) },
    ];
    const { text: raw } = await generateText(messages, { timeout: 60000 });
    const parsed = extractJson(raw) || {};

    // 分数夹取 0-100 整数，非法值置 null（防 AI 输出越界/非数字污染业务字段）
    var scoreNum = Number.isFinite(parseInt(parsed.score, 10)) ? parseInt(parsed.score, 10) : null;
    if (scoreNum != null) scoreNum = Math.max(0, Math.min(100, scoreNum));
    var reasonText = aiStd.clipText(parsed.reason, 300) + (parsed.risks ? ' | 风险：' + aiStd.clipText(parsed.risks, 300) : '');

    // 回写到候选人表
    assertOk(await rdb.from('recruit_candidates').update({
      potential_score: scoreNum,
      potential_reason: reasonText || null,
      updated_at: nowIso(),
    }).eq('id', candidateId));

    return {
      score: scoreNum,
      reason: aiStd.clipText(parsed.reason, 300) || null,
      risks: aiStd.clipText(parsed.risks, 300) || null,
      raw: raw,
      identity: ident.identity,
    };
  } catch (e) {
    return { error: e.message };
  }
};
