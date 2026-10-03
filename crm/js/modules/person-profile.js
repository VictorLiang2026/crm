import { renderTestDataNotice } from './test-data-notice.js';

const CORE = [['customer_name','姓名'],['phone','电话'],['wx_account','微信'],['gender','性别'],
  ['birthday','生日'],['occupation','职业'],['organization','单位'],['hobbies','爱好'],
  ['customer_stage','客户经营阶段'],['sales_priority','销售优先级'],
  ['recruitment_priority','招募优先级'],['referral_priority','转介绍优先级'],['source','来源']];
const MORE = [['marital_status','婚况'],['tags','标签'],['annual_income','年收入'],
  ['household_income','家庭收入'],['properties_info','房产信息'],['first_contact_date','首次接触日期'],
  ['education','学历'],['mbti','MBTI'],['additional_info','附加信息']];
const ROLES = { customer:'客户', recruit:'候选人', speaker:'嘉宾', participant:'参与者' };
const ORIGINS = { legacy_backfill:'旧记录映射', manual:'已登记' };
function node(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = String(text);
  return el;
}
export async function renderPersonProfile({ root, personId, callFn, openLegacyTab, isCurrent = () => true }) {
  root.replaceChildren(node('h3', '', '身份与客户资料'), node('p', 'person360-muted', '正在读取最新资料…'));
  try {
    const model = await callFn('person_360', { action:'getCustomerProfile', personId });
    if (!isCurrent()) return;
    if (!model || model.error || !['linked','person_only','customer_unavailable'].includes(model.status) ||
        !model.fields || !Array.isArray(model.roles)) throw Error('资料暂不可用');
    root.replaceChildren(node('h3', '', '身份与客户资料'));
    renderTestDataNotice(root, model.testData);
    root.append(node('p', 'person360-muted', `Person #${model.personId} · ` +
      (model.customerId ? `客户 #${model.customerId} · 最新客户资料` : model.status === 'person_only' ? '独立人物资料' : '关联客户暂不可用')));
    const roles = node('div', 'person360-role-list');
    for (const role of model.roles) roles.append(node('span', 'badge',
      `${ROLES[role.role] || role.role} · ${ORIGINS[role.origin] || role.origin}`));
    if (!model.roles.length) roles.append(node('span', 'person360-muted', '暂无已登记角色'));
    root.append(roles, node('p', 'person360-muted', '角色来自身份登记；不代表当前业务阶段，不在此自动变更。'));
    if (model.status === 'customer_unavailable') {
      root.append(node('p', 'person360-error', '关联客户不存在或已移入回收站；未使用历史人物资料代替。请从原客户入口核对。'));
      return;
    }
    const fields = model.fields;
    function list(defs) {
      const dl = node('dl', 'person360-profile-fields');
      for (const [key,label] of defs) {
        const row = node('div', 'person360-profile-field');
        const v = fields[key];
        row.append(node('dt', '', label), node('dd', '', v == null || v === '' ? '未填写' : v));
        dl.append(row);
      }
      return dl;
    }
    root.append(list(CORE));
    const more = node('details', 'person360-profile-more');
    more.append(node('summary', '', '更多资料'), list(MORE));
    root.append(more);
    const actions = node('div', 'person360-profile-actions');
    if (model.customerId) {
      for (const [tab,label] of [['info','编辑基本信息'],['profile','查看 / 编辑客户画像']]) {
        const link = node('a', 'btn', label);
        link.href = `#/customer/${model.customerId}`;
        link.addEventListener('click', event => {
          if (typeof openLegacyTab !== 'function' || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button) return;
          event.preventDefault(); openLegacyTab(model.customerId, tab);
        });
        actions.append(link);
      }
      root.append(node('p', 'person360-muted', '资料统一在原客户详情编辑；返回此页会重新读取。'));
    } else root.append(node('p', 'person360-muted', '尚未关联客户。这里仅展示人物资料，不按姓名自动关联或创建客户。'));
    const feedback = node('p', 'person360-muted');
    feedback.setAttribute('role', 'status');
    // Fail closed if test provenance is unavailable; never launch an external app.
    const allowed = model.contactAllowed === true && model.testData?.status === 'verified' && model.testData.containsTestData === false;
    for (const [key,label] of [['phone','电话'],['wx_account','微信']]) {
      const copy = node('button', 'btn', `复制${label}`);
      copy.type = 'button'; copy.disabled = !allowed || !String(fields[key] ?? '').trim();
      copy.addEventListener('click', async () => {
        try {
          if (copy.disabled || !allowed) return;
          await navigator.clipboard.writeText(String(fields[key]));
          feedback.textContent = `${label}已复制，请自行核对后联系。`;
        } catch { feedback.textContent = '复制不可用，请从上方资料手动查看。'; }
      });
      actions.append(copy);
    }
    root.append(actions, feedback);
    if (!allowed) root.append(node('p', 'person360-muted', '测试数据或测试标记未核验，联系操作已禁用。'));
    if (fields.updated_at) root.append(node('p', 'person360-muted', `资料更新时间：${fields.updated_at}`));
  } catch {
    if (!isCurrent()) return;
    root.replaceChildren(node('h3', '', '身份与客户资料'), node('p', 'person360-error', '资料加载失败，请稍后重试。其他 Person 360 功能仍可使用。'));
    const retry = node('button', 'btn', '重试资料'); retry.type = 'button';
    retry.addEventListener('click', () => renderPersonProfile({ root, personId, callFn, openLegacyTab, isCurrent }));
    root.append(retry);
  }
}
