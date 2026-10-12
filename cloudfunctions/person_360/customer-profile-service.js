'use strict';
const testData = require('./test-data');
// PMC-20：customers 人物基础列已退出（CL-02：customer_name/phone/gender/birthday/occupation/
// wx_account/education）；当前基础信息只来自 persons。mbti 仍为 customers 域列。
const CUSTOMER_FIELDS = 'Id,person_id,additional_info,tags,annual_income,household_income,properties_info,mbti,updated_at';
const PERSON_FIELDS = 'id,display_name,phone,wechat,gender,birthday,occupation,organization,education,source,notes,hobbies,customer_stage,sales_priority,referral_priority,marital_status,first_contact_date,updated_at';

// Read the explicitly linked customer afresh; never reconcile identities by name.
async function getCustomerProfile(personId, { request, disclose = testData.disclose }) {
  const id = String(personId ?? '');
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw Error('Invalid Person ID');
  const [person] = await request('persons', 'GET', {
    select: PERSON_FIELDS, id: `eq.${id}`, deleted_at: 'is.null', limit: 1,
  });
  if (!person) throw Error('Person not found');
  // PMC-19 CL-03: legacy_customer_id removed; resolve customer via customers.person_id
  const [customers, roles, recruits] = await Promise.all([
    request('customers', 'GET', {
      select: CUSTOMER_FIELDS, person_id: `eq.${id}`, deleted_at: 'is.null', limit: 1,
    }),
    request('person_roles', 'GET', { select: 'id,role,origin', person_id: `eq.${id}`, order: 'id.asc', limit: 50 }),
    request('recruit_candidates', 'GET', {
      select: 'id,recruitment_priority', person_id: `eq.${id}`, deleted_at: 'is.null', order: 'id.desc', limit: 1,
    }),
  ]);
  const customer = customers[0] || null;
  const linked = customer != null;
  const summary = await disclose([
    ...testData.refsForRows('persons', [person]), ...testData.refsForRows('customers', customers),
    ...testData.refsForRows('person_roles', roles),
  ]);
  // A missing/deleted linked customer must not expose a stale Person contact snapshot.
  const personFields = {
    customer_name: person.display_name, phone: person.phone, wx_account: person.wechat,
    gender: person.gender, birthday: person.birthday, occupation: person.occupation,
    organization: person.organization, education: person.education, source: person.source,
    hobbies: person.hobbies, customer_stage: person.customer_stage,
    sales_priority: person.sales_priority, referral_priority: person.referral_priority,
    marital_status: person.marital_status, first_contact_date: person.first_contact_date,
    person_notes: person.notes, updated_at: person.updated_at,
  };
  // PMC-20：人物当前基础信息只来自 persons；客户行仅提供销售/增员域字段。
  // person_updated_at：persons 行版本号，供 updatePerson 乐观锁使用（linked 时
  // fields.updated_at 是 customers.updated_at，不能用于 persons 的乐观锁比对）。
  const personIdentity = {
    customer_name: person.display_name, phone: person.phone, wx_account: person.wechat,
    gender: person.gender, birthday: person.birthday, occupation: person.occupation,
    organization: person.organization, education: person.education,
    source: person.source, hobbies: person.hobbies, customer_stage: person.customer_stage,
    sales_priority: person.sales_priority, referral_priority: person.referral_priority,
    marital_status: person.marital_status, first_contact_date: person.first_contact_date,
    person_notes: person.notes,
    person_updated_at: person.updated_at,
  };
  const fields = Object.assign(customer
    ? Object.assign({}, customer, personIdentity)
    : (linked ? {} : Object.assign({}, personFields, personIdentity)), {
    recruitment_priority: recruits[0]?.recruitment_priority ?? null,
    recruit_id: recruits[0]?.id == null ? null : String(recruits[0].id),
  });
  const marked = [person.display_name, fields.customer_name, fields.source, fields.additional_info,
    fields.person_notes, customer?.additional_info]
    .some(value => typeof value === 'string' && (value.includes(testData.MARKER) || value.startsWith('crm_test_')));
  return { personId: id, customerId: customer ? String(customer.Id) : null,
    status: customer ? 'linked' : linked ? 'customer_unavailable' : 'person_only',
    source: linked && !customer ? null : 'public.persons',
    fields, roles, testData: summary,
    contactAllowed: !!(!linked || customer) && summary?.status === 'verified' && summary.containsTestData === false && !marked,
  };
}
module.exports = { getCustomerProfile, CUSTOMER_FIELDS };
