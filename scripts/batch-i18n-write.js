// Batch i18n replacement for write.js
const fs = require('fs');
const path = 'd:\\CRM\\crm\\crm\\js\\modules\\console\\write.js';
let c = fs.readFileSync(path, 'utf8');

const pairs = [
  // Core popup titles
  ["\"完成行动\"", "t(\"complete_action\")"],
  ["\"完成承诺\"", "t(\"complete_commitment\")"],
  ["\"推进 / 关闭机会\"", "t(\"advance_close_opp\")"],
  ["\"新建机会\"", "t(\"new_opp\")"],
  ["\"审核机会候选\"", "t(\"review_candidate\")"],
  ["\"快速记录\"", "t(\"quick_record\")"],
  // Buttons
  ["\"取消\"", "t(\"cancel\")"],
  ["\"确认完成\"", "t(\"confirm_complete\")"],
  ["\"确认执行\"", "t(\"confirm_execute\")"],
  ["\"确认创建\"", "t(\"confirm_create\")"],
  ["\"确认并保存\"", "t(\"confirm_save\")"],
  ["\"确认建档并保存\"", "t(\"confirm_create_save\")"],
  ["\"保存编辑\"", "t(\"save_edit\")"],
  ["\"拒绝\"", "t(\"reject\")"],
  ["\"接受并建机会\"", "t(\"accept_create\")"],
  ["\"搜索 Person\"", "t(\"search_person\")"],
  ["\"生成预览\"", "t(\"generate_preview\")"],
  ["\"AI 理解 →\"", "t(\"ai_parse\")"],
  // Status labels
  ["\"待完成\"", "t(\"pending\")"],
  ["\"已完成\"", "t(\"completed\")"],
  // Common labels
  ["\"对象\"", "t(\"target\")"],
  ["\"内容\"", "t(\"content\")"],
  ["\"到期\"", "t(\"due\")"],
  ["\"操作\"", "t(\"operation\")"],
  ["\"推进到\"", "t(\"advance_to\")"],
  ["\"结果\"", "t(\"result\")"],
  ["\"结果说明\"", "t(\"result_note\")"],
  ["\"变更\"", "t(\"change\")"],
  ["\"关联 Person\"", "t(\"link_person\")"],
  ["\"机会类型\"", "t(\"opp_type\")"],
  ["\"当前进展\"", "t(\"current_progress\")"],
  ["\"下一步\"", "t(\"next_step\")"],
  ["\"下一步日期\"", "t(\"next_date\")"],
  ["\"方式\"", "t(\"method\")"],
  ["\"日期\"", "t(\"date\")"],
  ["\"互动摘要\"", "t(\"interaction_summary\")"],
  // Notes / hints
  ["\"先由服务端核对当前状态并生成预览，你确认后才写入完成状态。\"", "t(\"preview_note\")"],
  ["\"先预览变更，确认后才写入。\"", "t(\"preview_before_write\")"],
  ["\"预览不写业务数据；执行后立即生效。\"", "t(\"preview_no_write\")"],
  ["\"新机会将进入「发现」阶段。\"", "t(\"new_opp_stage\")"],
  ["\"AI 候选仅供参考；接受后才创建真实机会（进入「发现」阶段）。\"", "t(\"ai_candidate_note\")"],
  ["\"AI 只拆解和匹配人物；保存前由你逐项确认，AI 不会自动改阶段或建机会。\"", "t(\"ai_parse_note\")"],
  ["\"请先输入要记录的内容\"", "t(\"enter_content\")"],
  ["\"请输入姓名\"", "t(\"enter_name\")"],
  ["\"请填写结果说明（Outcome）\"", "t(\"fill_outcome\")"],
  ["\"请填写当前进展\"", "t(\"fill_progress\")"],
  ["\"请填写下一步\"", "t(\"fill_next_step\")"],
  ["\"请填写互动摘要或至少一条事实\"", "t(\"fill_summary_or_fact\")"],
  ["\"请先点选明确的 Person 身份（已有候选或新建）\"", "t(\"select_person_first\")"],
  ["\"每条事实 / 信号不能超过 500 字\"", "t(\"max_500_chars\")"],
  ["\"可留空 = 暂不排期\"", "t(\"date_optional\")"],
  ["\"保存到互动时间线；≤2000 字。原话已留存为 rawNote。\"", "t(\"summary_note\")"],
  ["\"一次确认产生两项写入：服务端先建档 Person，再落本次互动与事实/信号。\"", "t(\"two_writes_note\")"],
  // Process states
  ["\"写入中…\"", "t(\"writing\")"],
  ["\"预览中…\"", "t(\"previewing\")"],
  ["\"AI 理解中…（约十几秒）\"", "t(\"ai_parsing\")"],
  ["\"搜索中…\"", "t(\"searching\")"],
  ["\"保存中…\"", "t(\"saving\")"],
  ["\"建档并保存中…\"", "t(\"creating_saving\")"],
  // Toast messages
  ["\"行动已完成\"", "t(\"action_completed\")"],
  ["\"承诺已履行\"", "t(\"commitment_fulfilled\")"],
  ["\"恭喜，机会已成交\"", "t(\"opp_won\")"],
  ["\"机会已更新\"", "t(\"opp_updated\")"],
  ["\"机会已创建\"", "t(\"opp_created\")"],
  ["\"已拒绝该候选\"", "t(\"candidate_rejected\")"],
  ["\"草稿已更新，请再次确认\"", "t(\"draft_updated\")"],
  ["\"已记录并保存互动\"", "t(\"interaction_saved\")"],
  // Error messages
  ["\"操作未完成\"", "t(\"operation_incomplete\")"],
  ["\"该条目状态已变化（可能已完成或取消），请刷新列表后重试。\"", "t(\"state_changed\")"],
  ["\"预览失败\"", "t(\"preview_failed\")"],
  ["\"AI 解析失败：\"", "t(\"ai_parse_failed\") + "],
  ["\"未找到同名 Person\"", "t(\"no_person_found\")"],
  ["\"已自动选定唯一候选\"", "t(\"auto_selected\")"],
  ["\"请点选明确的 Person\"", "t(\"select_person\")"],
  ["\"该姓名存在同名候选，请改用已有候选或补充括号限定后重试\"", "t(\"same_name_exists\")"],
  ["\"建档未返回 Person\"", "t(\"create_failed\")"],
  ["\"所选 Person 身份已变化，请重新打开并选择\"", "t(\"person_changed\")"],
  ["\"草稿已修改，已重新预览；请核对后再次点击「接受并建机会」\"", "t(\"draft_modified\")"],
  // Misc
  ["\"已锁定为当前 Person（服务端将再次核对身份）\"", "t(\"person_locked\")"],
  ["\"AI 未识别出人名：可点「新建 Person」建档，或从 Person 页锁定对象后进入\"", "t(\"ai_no_name\")"],
  ["\"未找到同名 Person：可人工确认后新建（建档时服务端再次核对同名）\"", "t(\"no_same_name\")"],
  ["\"请点选明确的 Person（服务端已核对同名候选）\"", "t(\"select_confirmed\")"],
  ["\"同名结果较多或需补充限定，请先在完整档案核对身份后再记录\"", "t(\"many_names\")"],
  ["\"＋ 新建 Person（人工确认建档）\"", "t(\"new_person_manual\")"],
  ["\"事实（发生了什么 / 需求 / 兴趣）\"", "t(\"facts_label\")"],
  ["\"信号（AI 判断，仅供记录）\"", "t(\"signals_label\")"],
  ["\"理由（进展依据）\"", "t(\"reason_basis\")"],
  ["\"建议下一步\"", "t(\"suggested_next\")"],
  ["\"依据（原文引用）\"", "t(\"evidence_quote\")"],
  ["\"最多 20 条，每条 ≤500 字\"", "t(\"max_20_items\")"],
  ["\"最多 12 条；不会自动建机会或改阶段\"", "t(\"max_12_signals\")"],
  ["\"加一条\"", "t(\"add_one\")"],
  ["\"必填：记录本次结果（Outcome），≤4000 字\"", "t(\"outcome_required\")"],
  ["\"当前阶段：\"", "t(\"current_stage_prefix\")"],
  ["\"阶段不由 AI 自动推进\"", "t(\"no_auto_advance\")"],
  ["\"① 新建 Person\"", "t(\"step1_new_person\")"],
  ["\"② 交流记录\"", "t(\"step2_interaction\")"],
  ["\"预览有效期至\"", "t(\"preview_valid_until\")"],
  ["\"超时后需重新预览。\"", "t(\"preview_expires_note\")"],
  ["\"修改草稿后需重新预览。\"", "t(\"draft_changed_preview\")"],
  ["\"已新建 Person 并保存互动 #\"", "t(\"new_person_saved\")"],
  ["\"职业未填\"", "t(\"occupation_empty\")"],
  ["\"机构未填\"", "t(\"organization_empty\")"],
  ["\"像说话一样记下这次交流，例如：今天和王总吃饭，他说孩子明年去美国读大学，对教育金感兴趣，让我十月后再联系。\"", "t(\"quick_capture_placeholder\")"],
];

let count = 0;
pairs.forEach(([o, n]) => {
  if (c.includes(o)) {
    c = c.split(o).join(n);
    count++;
  }
});

fs.writeFileSync(path, c);
console.log('write.js: ' + count + ' replacements done');
