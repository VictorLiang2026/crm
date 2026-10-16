'use strict';

function positiveId(value, label) {
  const text = String(value ?? '');
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new Error(`Invalid ${label}`);
  }
  return text;
}

class RecruitCandidateService {
  constructor({ request, rpc, resolveName }) {
    this.request = request;
    this.rpc = rpc;
    this.resolveName = resolveName;
  }

  async resolveRecruitName(name) {
    const resolution = await this.resolveName(name);
    const deleted = await this.request('persons', 'GET', {
      select: 'id', display_name: `eq.${resolution.displayName}`, deleted_at: 'not.is.null', limit: 1,
    });
    const candidates = (resolution.candidates || []).map(person => ({
      ...person, customerId: person.legacyCustomerId == null ? null : String(person.legacyCustomerId),
    }));
    return { ...resolution, candidates, deletedIdentity: deleted.length > 0 };
  }

  async create(data, uid) {
    if (typeof uid !== 'string' || !uid.trim()) throw new Error('Unauthorized recruit candidate create');
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid recruit candidate data');
    const personId = positiveId(data.personId, 'Person ID');
    const selectedDisplayName = String(data.selectedDisplayName || '').trim();
    if (!selectedDisplayName || selectedDisplayName.length > 160) throw new Error('Invalid selected Person name');

    // Re-resolve on the server after the user selected a candidate in the UI.
    const resolution = await this.resolveName(selectedDisplayName);
    const deleted = await this.request('persons', 'GET', {
      select: 'id', display_name: `eq.${selectedDisplayName}`, deleted_at: 'not.is.null', limit: 1,
    });
    const selected = (resolution.candidates || []).some(person =>
      String(person.id) === personId && person.displayName === selectedDisplayName);
    if (!selected || deleted.length) {
      throw new Error('Selected Person changed; resolve identity again');
    }

    const result = await this.rpc('crm_recruit_candidate_create_v1', {
      p_actor_uid: uid,
      p_person_id: Number(personId),
      p_selected_display_name: selectedDisplayName,
      p_operator: String(data.operator || '').trim() || null,
    });
    if (result?.error) throw new Error(String(result.error));
    return result;
  }

  async details(candidateIdValue, personIdValue) {
    const candidateId = positiveId(candidateIdValue, 'candidate ID');
    const personId = positiveId(personIdValue, 'Person ID');
    const candidate = (await this.request('recruit_candidates', 'GET', {
      select: '*', id: `eq.${candidateId}`, person_id: `eq.${personId}`,
      deleted_at: 'is.null', limit: 1,
    }))[0] || null;
    if (!candidate) return { error: 'not found' };
    const [milestones, followups] = await Promise.all([
      this.request('recruit_milestones', 'GET', {
        select: '*', candidate_id: `eq.${candidateId}`,
        order: 'happened_at.desc,id.desc', limit: 100,
      }),
      this.request('recruit_followups', 'GET', {
        select: '*', candidate_id: `eq.${candidateId}`, deleted_at: 'is.null',
        order: 'followup_date.desc,id.desc', limit: 100,
      }),
    ]);
    return { candidate, milestones, followups };
  }

  async transition(data, uid) {
    if (typeof uid !== 'string' || !uid.trim()) throw new Error('Unauthorized recruit stage transition');
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid recruit stage transition');
    const candidateId = positiveId(data.candidateId, 'candidate ID');
    const personId = positiveId(data.personId, 'Person ID');
    const expected = String(data.expectedUpdatedAt || '');
    if (!expected || !Number.isFinite(Date.parse(expected))) throw new Error('Invalid recruit candidate version');
    const result = await this.rpc('crm_recruit_candidate_transition_v1', {
      p_actor_uid: uid,
      p_candidate_id: Number(candidateId),
      p_person_id: Number(personId),
      p_expected_updated_at: expected,
      p_to_stage: String(data.stage || ''),
      p_note: String(data.note || '').trim() || null,
      p_operator: String(data.operator || '').trim() || null,
    });
    return result;
  }
}

module.exports = { RecruitCandidateService };
