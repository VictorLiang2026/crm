'use strict';
const assert = require('node:assert/strict');
const { SpeakerProfileService, profileData } = require('../../cloudfunctions/person_360/speaker-profile-service');

module.exports = async function (_root, test) {
  const person = {
    id: 880001, display_name: '联调讲者（测试）', name_key: '联调讲者',
    phone: '000', wechat: 'test', organization: '测试机构', occupation: '讲师',
    legacy_customer_id: 101,
  };
  function fixture({ customerId = 101, existing = [], legacy = [], speaker = null } = {}) {
    const calls = [];
    const request = async (table, method, filters, body) => {
      calls.push({ table, method, filters, body });
      if (table === 'persons') return [person];
      if (table === 'customers') return customerId == null ? [] : [{ Id: customerId }];
      if (table === 'activity_speakers' && method === 'GET') {
        return filters.id ? (speaker ? [speaker] : []) : (filters.customer_id ? legacy : existing);
      }
      if (table === 'activity_speakers' && method === 'POST') return [{ id: 801 }];
      if (table === 'activity_speakers' && method === 'PATCH') return [{ id: speaker.id }];
      throw new Error('Unexpected request');
    };
    return { service: new SpeakerProfileService({ request }), calls };
  }
  await test('speaker.person.create', '已确认 Person 可建立独立专业档案', 'backend', async () => {
    const f = fixture();
    const result = await f.service.create({ personId: 880001,
      selectedDisplayName: person.display_name, confirmed: true,
      profile: { expertise: '保障规划', topic_summary: '家庭保障', cooperation_count: '2',
        preferred_format: '线下', notes: '测试备注', name: '伪造姓名', person_id: 999 },
    }, 'test-uid');
    assert.equal(result.personId, '880001');
    const write = f.calls.find(call => call.method === 'POST');
    assert.equal(write.body.person_id, 880001);
    assert.equal(write.body.customer_id, 101);
    assert.equal(write.body.name, person.display_name);
    assert.equal(write.body.expertise, '保障规划');
    assert.equal(write.body.cooperation_count, 2);
    assert.equal(write.body.preferred_format, '线下');
  });
  await test('speaker.person.no_auto_identity', '未确认、伪选和重复关联均拒绝', 'backend', async () => {
    const f = fixture({ existing: [{ id: 9 }] });
    const data = { personId: 880001, selectedDisplayName: person.display_name,
      profile: { expertise: '测试' } };
    await assert.rejects(f.service.create(data, 'test-uid'), /Human confirmation/);
    await assert.rejects(f.service.create({ ...data, confirmed: true, personId: 880002 }, 'test-uid'), /Selected Person/);
    await assert.rejects(f.service.create({ ...data, confirmed: true }, 'test-uid'), /already exists/);
    assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
    const oldProfile = fixture({ legacy: [{ id: 8 }] });
    await assert.rejects(oldProfile.service.create({ ...data, confirmed: true }, 'test-uid'),
      /link the existing profile/);
    assert.equal(oldProfile.calls.filter(call => call.method === 'POST').length, 0);
  });
  await test('speaker.person.link', '旧嘉宾只可关联同一客户的 Person', 'backend', async () => {
    const f = fixture({ speaker: { id: 8, name: person.display_name, person_id: null, customer_id: 101 } });
    const result = await f.service.link({ speakerId: 8, personId: 880001,
      selectedDisplayName: person.display_name, confirmed: true }, 'test-uid');
    assert.equal(result.ok, true);
    const write = f.calls.find(call => call.method === 'PATCH');
    assert.equal(write.body.person_id, 880001);
    assert.equal(write.body.customer_id, 101);
    const mismatch = fixture({ speaker: { id: 8, name: person.display_name, person_id: null, customer_id: 999 } });
    await assert.rejects(mismatch.service.link({ speakerId: 8, personId: 880001,
      selectedDisplayName: person.display_name, confirmed: true }, 'test-uid'), /another Person/);
    assert.equal(mismatch.calls.filter(call => call.method === 'PATCH').length, 0);
  });
  await test('speaker.person.profile_validation', '专业字段白名单及校验', 'backend', () => {
    assert.deepEqual(profileData({ expertise: '主题', name: '伪造', customer_id: 42 }), { expertise: '主题' });
    assert.throws(() => profileData({ cooperation_count: '-1' }), /cooperation count/);
    assert.throws(() => profileData({ relationship_stage: 'invalid' }), /relationship stage/);
  });
};
