'use strict';

const usage = 'Usage: node tests/regression/run.cjs [--backend-only|--browser-only [--browser-group=short|--browser-group=long]]';

function parseArgs(values) {
  const allowed = new Set(['--backend-only', '--browser-only', '--browser-group=short', '--browser-group=long']);
  const groups = values.filter(value => value.startsWith('--browser-group='));
  if (values.some(value => !allowed.has(value)) || new Set(values).size !== values.length || groups.length > 1) return { error: usage };
  if (values.includes('--backend-only')) return values.length === 1 ? { mode: 'backend', browserGroup: null } : { error: usage };
  if (values.includes('--browser-only')) {
    if (values.length !== 1 + groups.length) return { error: usage };
    const browserGroup = groups[0]?.split('=')[1] || null;
    return { mode: browserGroup ? `browser-${browserGroup}` : 'browser', browserGroup };
  }
  return values.length ? { error: usage } : { mode: 'full', browserGroup: null };
}

function counts(results) {
  return Object.fromEntries(['PASS', 'FAIL', 'FLAKY', 'TODO', 'SKIP'].map(status => [status, results.filter(item => item.status === status).length]));
}

function shouldRetryBrowser(results) {
  const failures = results.filter(item => item.status === 'FAIL');
  return failures.length > 0 && failures.every(item => item.errorCode === 'BROWSER_INFRASTRUCTURE');
}

function mergeRetry(first, retry) {
  const retryById = new Map(retry.map(item => [item.id, item]));
  const firstById = new Map(first.map(item => [item.id, item]));
  const merged = [];
  for (const initial of first) {
    const second = retryById.get(initial.id);
    if (initial.status === 'FAIL' && initial.errorCode === 'BROWSER_INFRASTRUCTURE') {
      if (second?.status === 'PASS') merged.push({ ...second, status: 'FLAKY',
        firstFailure: { errorCode: initial.errorCode, failureStage: initial.failureStage, error: initial.error, diagnostics: initial.diagnostics }, attempts: 2 });
      else if (second) merged.push({ ...second, status: 'FAIL',
        firstFailure: { errorCode: initial.errorCode, failureStage: initial.failureStage, error: initial.error }, attempts: 2 });
      else merged.push({ ...initial, attempts: 1 });
    } else merged.push(initial);
  }
  for (const item of retry) if (!firstById.has(item.id)) merged.push(item);
  return merged;
}

module.exports = { parseArgs, counts, shouldRetryBrowser, mergeRetry };
