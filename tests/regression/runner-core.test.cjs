'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, counts, shouldRetryBrowser, mergeRetry } = require('./runner-core.cjs');

test('runner accepts full, service, browser, and isolated browser-group modes', () => {
  assert.deepEqual(parseArgs([]), { mode: 'full', browserGroup: null });
  assert.deepEqual(parseArgs(['--backend-only']), { mode: 'backend', browserGroup: null });
  assert.deepEqual(parseArgs(['--browser-only']), { mode: 'browser', browserGroup: null });
  assert.deepEqual(parseArgs(['--browser-only', '--browser-group=short']), { mode: 'browser-short', browserGroup: 'short' });
  assert.deepEqual(parseArgs(['--browser-only', '--browser-group=long']), { mode: 'browser-long', browserGroup: 'long' });
});

test('runner rejects ambiguous, unsupported, and conflicting modes', () => {
  for (const args of [
    ['--browser-only', '--backend-only'], ['--backend-only', '--browser-group=short'],
    ['--browser-group=long'], ['--browser-only', '--browser-group=long', '--browser-group=short'],
    ['--browser-only', '--mobile'], ['--backend-only', '--backend-only'],
  ]) assert.ok(parseArgs(args).error, `expected invalid arguments: ${args.join(' ')}`);
});

test('only all-infrastructure browser failures qualify for a single retry', () => {
  assert.equal(shouldRetryBrowser([]), false);
  assert.equal(shouldRetryBrowser([{ status: 'FAIL', errorCode: 'BROWSER_INFRASTRUCTURE' }]), true);
  assert.equal(shouldRetryBrowser([
    { status: 'FAIL', errorCode: 'BROWSER_INFRASTRUCTURE' },
    { status: 'FAIL', errorCode: 'BROWSER_INFRASTRUCTURE' },
  ]), true);
  assert.equal(shouldRetryBrowser([{ status: 'FAIL', errorCode: null }]), false);
  assert.equal(shouldRetryBrowser([
    { status: 'FAIL', errorCode: 'BROWSER_INFRASTRUCTURE' }, { status: 'FAIL', errorCode: null },
  ]), false);
});

test('retry merge labels recovered infrastructure failures as flaky and preserves attempts', () => {
  const initial = [
    { id: 'browser.start', status: 'FAIL', errorCode: 'BROWSER_INFRASTRUCTURE', failureStage: 'browser.spawn', error: 'startup timeout' },
    { id: 'assertion', status: 'PASS' },
  ];
  const retry = [
    { id: 'browser.start', status: 'PASS', attempt: 'isolated-retry' },
    { id: 'assertion', status: 'PASS', attempt: 'isolated-retry' },
    { id: 'new-case', status: 'PASS', attempt: 'isolated-retry' },
  ];
  const merged = mergeRetry(initial, retry);
  assert.equal(merged.find(item => item.id === 'browser.start').status, 'FLAKY');
  assert.equal(merged.find(item => item.id === 'browser.start').firstFailure.failureStage, 'browser.spawn');
  assert.equal(merged.find(item => item.id === 'assertion').status, 'PASS');
  assert.equal(merged.find(item => item.id === 'new-case').status, 'PASS');
  assert.deepEqual(counts(merged), { PASS: 2, FAIL: 0, FLAKY: 1, TODO: 0, SKIP: 0 });
});

test('a second infrastructure failure remains a failure after retry', () => {
  const result = mergeRetry(
    [{ id: 'browser.start', status: 'FAIL', errorCode: 'BROWSER_INFRASTRUCTURE', failureStage: 'browser.spawn' }],
    [{ id: 'browser.start', status: 'FAIL', errorCode: 'BROWSER_INFRASTRUCTURE', failureStage: 'browser.cdp-connect' }],
  )[0];
  assert.equal(result.status, 'FAIL');
  assert.equal(result.attempts, 2);
  assert.equal(result.failureStage, 'browser.cdp-connect');
});
