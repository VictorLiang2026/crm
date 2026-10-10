'use strict';
const testData = require('./test-data');
const CUSTOMER_FIELDS = 'Id,customer_name,phone,source,gender,birthday,occupation,hobbies,customer_stage,sales_priority,recruitment_priority,referral_priority,additional_info,marital_status,tags,annual_income,household_income,properties_info,first_contact_date,wx_account,education,mbti,updated_at';
const PERSON_FIELDS = 'id,display_name,phone,wechat,gender,birthday,occupation,organization,education,source,notes,updated_at';

// Read the explicitly linked customer afresh; never reconcile identities by name.
async function getCustomerProfile(personId, { request, disclose = testData.disclose }) {
  const id = String(personId ?? '');
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw Error('Invalid Person ID');
  const [person] = await request('persons', 'GET', {
    select: PERSON_FIELDS, id: `eq.${id}`, deleted_at: 'is.null', limit: 1,
  });
  if (!person) throw Error('Person not found');
  // PMC-19 CL-03: legacy_customer_id removed; resolve customer via customers.person_id
  const [customers, roles] = await Promise.all([
    request('customers', 'GET', {
      select: CUSTOMER_FIELDS, person_id: `eq.${id}`, deleted_at: 'is.null', limit: 1,
    }),
    request('person_roles', 'GET', { select: 'id,role,origin', person_id: `eq.${id}`, order: 'id.asc', limit: 50 }),
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
    additional_info: person.notes, updated_at: person.updated_at,
  };
  const fields = customer ? { ...customer, customer_name: personFields.customer_name,
    phone: personFields.phone, wx_account: personFields.wx_account,
    gender: personFields.gender, birthday: personFields.birthday,
    occupation: personFields.occupation, organization: personFields.organization,
    education: personFields.education } : (!linked ? personFields : {});
  const marked = [person.display_name, fields.customer_name, fields.source, fields.additional_info,
    customer?.customer_name, customer?.source, customer?.additional_info]
    .some(value => typeof value === 'string' && (value.includes(testData.MARKER) || value.startsWith('crm_test_')));
  return { personId: id, customerId: customer ? String(customer.Id) : null,
    status: customer ? 'linked' : linked ? 'customer_unavailable' : 'person_only',
    source: linked && !customer ? null : 'public.persons',
    fields, roles, testData: summary,
    contactAllowed: !!(!linked || customer) && summary?.status === 'verified' && summary.containsTestData === false && !marked,
  };
}
module.exports = { getCustomerProfile, CUSTOMER_FIELDS };
