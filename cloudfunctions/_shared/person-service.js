/** Read-only identity resolution for future server-side CRM callers. */
'use strict';

const MAX_DISPLAY_LENGTH = 160;
const MAX_CANDIDATES = 10;
const COLUMNS = 'id,display_name,name_key,organization,occupation,legacy_customer_id';

class PersonResolutionError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'PersonResolutionError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

function normalizeWhitespace(value) {
  return value.replace(/[ \t\r\n\f\v\u3000]+/gu, ' ').trim();
}

function validateParentheses(value) {
  const stack = [];
  for (const char of value) {
    if (char === '（' || char === '(') stack.push(char);
    else if (char === '）' || char === ')') {
      if (stack.pop() !== (char === '）' ? '（' : '(')) {
        throw new PersonResolutionError('INVALID_NAME', 'Unbalanced name qualifier');
      }
    }
  }
  if (stack.length) throw new PersonResolutionError('INVALID_NAME', 'Unbalanced name qualifier');
}

function parsePersonName(value) {
  if (typeof value !== 'string') throw new PersonResolutionError('INVALID_NAME', 'displayName must be text');
  const displayName = normalizeWhitespace(value);
  if (!displayName || displayName.length > MAX_DISPLAY_LENGTH) {
    throw new PersonResolutionError('INVALID_NAME', 'displayName must have 1-160 characters');
  }
  validateParentheses(displayName);
  const qualifiers = [];
  let baseName = displayName;
  for (;;) {
    const match = baseName.match(/(?:（([^（）]*)）|\(([^()]*)\))$/u);
    if (!match) break;
    const qualifier = normalizeWhitespace(match[1] ?? match[2]);
    if (!qualifier) throw new PersonResolutionError('INVALID_NAME', 'Name qualifier cannot be empty');
    qualifiers.unshift(qualifier);
    baseName = baseName.slice(0, match.index).trimEnd();
  }
  if (!baseName) throw new PersonResolutionError('INVALID_NAME', 'Name is required before qualifier');
  return {
    displayName,
    nameKey: normalizeWhitespace(baseName).toLowerCase(),
    qualifierKey: qualifiers.map(item => item.toLowerCase()).join('|'),
    hasQualifier: qualifiers.length > 0,
  };
}

function personId(value) {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^[1-9]\d*$/.test(String(value)) ||
      (typeof value === 'number' && !Number.isSafeInteger(value))) {
    throw new PersonResolutionError('READ_FAILED', 'Person search returned an invalid id');
  }
  return String(value);
}

class PersonService {
  constructor({ rdb } = {}) {
    if (!rdb || typeof rdb.from !== 'function') {
      throw new PersonResolutionError('INVALID_CONFIG', 'Authorized server-side CloudBase RDB is required');
    }
    this.rdb = rdb;
  }

  async resolveName(displayName) {
    const parsed = parsePersonName(displayName);
    let response;
    try {
      response = await this.rdb.from('public.persons')
        .select(COLUMNS)
        .eq('name_key', parsed.nameKey)
        .is('deleted_at', null)
        .order('id', { ascending: true })
        .limit(MAX_CANDIDATES + 1);
    } catch (error) {
      throw new PersonResolutionError('READ_FAILED', 'Person search failed', error);
    }
    if (!response || response.error || !Array.isArray(response.data) ||
        response.data.length > MAX_CANDIDATES + 1) {
      throw new PersonResolutionError('READ_FAILED', 'Person search returned an invalid result', response?.error);
    }
    const hasMore = response.data.length > MAX_CANDIDATES;
    const candidates = response.data.slice(0, MAX_CANDIDATES).map(row => {
      if (!row || typeof row.display_name !== 'string' || row.name_key !== parsed.nameKey) {
        throw new PersonResolutionError('READ_FAILED', 'Person search returned an inconsistent row');
      }
      let candidateName;
      try { candidateName = parsePersonName(row.display_name); }
      catch (error) { throw new PersonResolutionError('READ_FAILED', 'Person search returned an invalid name', error); }
      if (candidateName.nameKey !== parsed.nameKey) {
        throw new PersonResolutionError('READ_FAILED', 'Person search returned a mismatched name key');
      }
      return {
        id: personId(row.id),
        displayName: row.display_name,
        organization: row.organization ?? null,
        occupation: row.occupation ?? null,
        legacyCustomerId: row.legacy_customer_id == null ? null : String(row.legacy_customer_id),
      };
    });
    let status;
    let qualifierMatches = [];
    if (parsed.hasQualifier && !hasMore) {
      qualifierMatches = candidates.filter(candidate =>
        parsePersonName(candidate.displayName).qualifierKey === parsed.qualifierKey &&
        parsed.qualifierKey !== '').map(candidate => candidate.id);
    }
    if (response.data.length === 0) status = 'available';
    else if (response.data.length === 1) status = 'confirm_existing';
    else if (parsed.hasQualifier && !hasMore) {
      status = qualifierMatches.length === 1 ? 'confirm_qualified_match' :
        qualifierMatches.length === 0 ? 'confirm_new_qualified' : 'choose_or_qualify';
    } else status = 'choose_or_qualify';

    return {
      displayName: parsed.displayName,
      nameKey: parsed.nameKey,
      status,
      candidates,
      hasMore,
      qualifierMatches,
      selectedPersonId: null,
      requiresHumanDecision: status !== 'available',
      canCreate: status === 'available',
      canCreateAfterConfirmation: status === 'confirm_new_qualified' ||
        (status === 'confirm_existing' && parsed.hasQualifier && qualifierMatches.length === 0),
    };
  }
}

module.exports = { PersonService, PersonResolutionError, parsePersonName };
