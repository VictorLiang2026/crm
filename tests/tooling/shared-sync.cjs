'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { syncShared } = require('../../tools/sync-shared.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-shared-test-'));
const functions = path.join(root, 'cloudfunctions');
const shared = path.join(functions, '_shared');
const target = path.join(functions, 'customers');
try {
  fs.mkdirSync(shared, { recursive: true });
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(root, 'cloudbaserc.json'), JSON.stringify({
    functionRoot: 'cloudfunctions', functions: [{ name: 'customers' }]
  }));
  fs.writeFileSync(path.join(shared, 'db.js'), 'source db\n');
  fs.writeFileSync(path.join(shared, 'ai.js'), 'source ai\n');
  fs.writeFileSync(path.join(target, 'db.js'), 'old db\n');
  fs.writeFileSync(path.join(target, 'index.js'), 'unchanged handler\n');

  assert.throws(() => syncShared(root, 'check'), /customers\/db\.js.*customers\/ai\.js/);
  assert.equal(fs.readFileSync(path.join(target, 'db.js'), 'utf8'), 'old db\n');
  const result = syncShared(root, 'sync');
  assert.deepEqual(result.updated, ['customers/db.js', 'customers/ai.js']);
  assert.equal(syncShared(root, 'check').files, 2);
  assert.equal(fs.readFileSync(path.join(target, 'index.js'), 'utf8'), 'unchanged handler\n');

  fs.writeFileSync(path.join(target, 'ai.js'), 'drift\n');
  assert.throws(() => syncShared(root, 'check'), /customers\/ai\.js/);
  fs.rmSync(path.join(shared, 'db.js'));
  assert.throws(() => syncShared(root, 'sync'), /Missing or unsafe shared source/);

  fs.writeFileSync(path.join(root, 'cloudbaserc.json'), JSON.stringify({
    functionRoot: 'cloudfunctions', functions: [{ name: '../outside' }]
  }));
  assert.throws(() => syncShared(root, 'sync'), /Unsafe or duplicate function name/);
  console.log('[PASS] shared sync detects drift, repairs only scoped files, and rejects unsafe input');
} finally {
  const temp = path.resolve(os.tmpdir()) + path.sep;
  if (!path.resolve(root).startsWith(temp)) throw new Error('Refusing to remove unexpected test directory');
  fs.rmSync(root, { recursive: true, force: true });
}
