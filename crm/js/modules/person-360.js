// Isolated Person 360 view. All data requests use the existing authenticated callFn bridge.
const ROLE_LABELS = { spouse: '配偶', child: '子女', parent: '父母', sibling: '兄弟姐妹', other: '其他' };

function node(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value != null) element.textContent = String(value);
  return element;
}

function button(label, onClick, className = '') {
  const element = node('button', `btn ${className}`, label);
  element.type = 'button';
  element.addEventListener('click', onClick);
  return element;
}

export async function renderPerson360({ root, personId, callFn }) {
  const hash = `#/person/${personId}`;
  root.replaceChildren(node('div', 'loading', '正在加载 Person 360…'));
  const request = async (action, data = {}) => {
    const result = await callFn('person_360', { action, ...data });
    if (!result || result.error) throw new Error(result?.error || '请求失败');
    return result;
  };
  let model;
  try { model = await request('get', { personId }); }
  catch (error) {
    if (location.hash === hash) root.replaceChildren(node('div', 'empty', `Person 360 加载失败：${error.message}`));
    return;
  }
  if (location.hash !== hash) return;

  const wrap = node('div', 'person360');
  const top = node('div', 'person360-toolbar');
  const back = node('a', '', '← 返回客户详情');
  back.href = model.person.legacy_customer_id ? `#/customer/${model.person.legacy_customer_id}` : '#/customers';
  top.append(back);
  wrap.append(top, node('h2', '', `${model.person.display_name} · Person 360`));

  const family = node('section', 'card person360-card');
  family.append(node('h3', '', '家庭成员'));
  if (!model.members.length) family.append(node('p', 'person360-muted', '尚未关联家庭成员。只可选择已有 Person，且需人工确认。'));
  for (const member of model.members) {
    const row = node('div', 'person360-member');
    const name = member.person?.display_name || '已删除的 Person';
    row.append(node('span', '', `${ROLE_LABELS[member.relationship_to_anchor] || '其他'} · ${name}`));
    row.append(button('移除', async () => {
      if (!window.confirm(`确认移除 ${name} 的家庭关联？Person 记录不会删除。`)) return;
      try {
        await request('removeMember', { personId, membershipId: member.id, confirmed: true });
        await renderPerson360({ root, personId, callFn });
      } catch (error) { window.alert(`移除失败：${error.message}`); }
    }, 'person360-remove'));
    family.append(row);
  }

  const add = node('div', 'person360-add');
  add.append(node('h4', '', '关联已有 Person'));
  const searchInput = node('input');
  searchInput.type = 'search';
  searchInput.placeholder = '输入完整姓名，例如 张玮（电信）';
  searchInput.maxLength = 160;
  const searchLine = node('div', 'person360-row');
  const candidateList = node('div', 'person360-candidates');
  let chosen = null;
  const searchButton = button('查找', async () => {
    chosen = null;
    candidateList.replaceChildren();
    try {
      const result = await request('search', { name: searchInput.value.trim() });
      if (!result.candidates.length) {
        candidateList.append(node('p', 'person360-muted', '没有匹配的现有 Person；此处不会自动新建。'));
        return;
      }
      for (const candidate of result.candidates) {
        const label = node('label', 'person360-candidate');
        const radio = node('input');
        radio.type = 'radio'; radio.name = 'person360-candidate';
        radio.addEventListener('change', () => { chosen = candidate; });
        label.append(radio, node('span', '', `${candidate.display_name} · #${candidate.id}${candidate.occupation ? ` · ${candidate.occupation}` : ''}`));
        candidateList.append(label);
      }
      if (result.hasMore) candidateList.append(node('p', 'person360-muted', '匹配人数较多，请补充括号限定后重新查找。'));
    } catch (error) { candidateList.append(node('p', 'person360-error', `查找失败：${error.message}`)); }
  });
  searchLine.append(searchInput, searchButton);
  add.append(searchLine, candidateList);
  const role = node('select');
  for (const [value, label] of Object.entries(ROLE_LABELS)) {
    const option = node('option', '', label);
    option.value = value;
    role.append(option);
  }
  const attachLine = node('div', 'person360-row');
  attachLine.append(role, button('确认关联', async () => {
    if (!chosen) { window.alert('请先查找并选择一位已有 Person。'); return; }
    if (!window.confirm(`确认把 ${chosen.display_name} 作为 ${ROLE_LABELS[role.value]} 关联到 ${model.person.display_name} 的家庭？`)) return;
    try {
      await request('addMember', {
        personId, memberId: chosen.id, relationship: role.value,
        selectedDisplayName: chosen.display_name, confirmed: true,
      });
      await renderPerson360({ root, personId, callFn });
    } catch (error) { window.alert(`关联失败：${error.message}`); }
  }, 'btn-primary'));
  add.append(attachLine);
  family.append(add);
  wrap.append(family);

  const facts = node('section', 'card person360-card');
  facts.append(node('h3', '', '重要家庭事实'));
  const textarea = node('textarea', 'person360-facts');
  textarea.value = model.household?.important_facts || '';
  textarea.maxLength = 2000;
  textarea.placeholder = '只记录有助于了解家庭关系的事实；不记录资产、收入或理财建议。';
  facts.append(textarea, node('p', 'person360-muted', '人工记录，最多 2000 字。'));
  facts.append(button('保存事实', async () => {
    try {
      await request('saveFacts', { personId, facts: textarea.value });
      await renderPerson360({ root, personId, callFn });
    } catch (error) { window.alert(`保存失败：${error.message}`); }
  }, 'btn-primary'));
  wrap.append(facts);
  root.replaceChildren(wrap);
}
