/** Plain text provenance notice shared by legacy cards and AI-native modules. */
export function testDataText(summary) {
  if (!summary || summary.status !== 'verified') return '测试数据标记暂未核验，请勿将结果直接作为真实经营结论。';
  if (!summary.containsTestData) return '';
  const sources = (summary.sources || []).map(s =>
    String(s.batchKey) + ' / public.' + String(s.table) + ' (' + String(s.count) + ')').join('；');
  return '含测试数据 · 本次计算引用 ' + String(summary.recordCount) + ' 条测试来源记录。' +
    '【系统测试·勿联系】' + sources + '。样本参与普通计算；来源条数不等于业务指标，不得真实外发。';
}
export function renderTestDataNotice(root, summary) {
  root.querySelectorAll(':scope > [data-crm-test-notice]').forEach(node => node.remove());
  const text = testDataText(summary);
  if (!text) return;
  const notice = document.createElement('p');
  notice.className = 'coach-stale';
  notice.dataset.crmTestNotice = '';
  notice.setAttribute('role', 'status');
  notice.textContent = text;
  root.prepend(notice);
}

