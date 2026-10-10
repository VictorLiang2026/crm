const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const nodeVersion = '4.1.0';
const webVersion = '3.10.1';
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

test('browser loads an explicit CloudBase SDK version', () => {
  const page = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
  assert.match(page, new RegExp(`https://static\\.cloudbase\\.net/cloudbase-js-sdk/${webVersion.replaceAll('.', '\\.')}\\/cloudbase\\.full\\.js`));
  assert.doesNotMatch(page, /cloudbase-js-sdk\/latest\//);
});

test('all deployed CRM functions pin the installed CloudBase Node SDK', () => {
  const config = readJson(path.join(root, 'cloudbaserc.json'));
  const functions = config.functions.map(item => item.name);
  assert.equal(functions.length, 29);
  for (const name of functions) {
    assert.match(name, /^(?!pr_)[a-z][a-z0-9_]*$/);
    const dir = path.join(root, 'cloudfunctions', name);
    const manifest = readJson(path.join(dir, 'package.json'));
    assert.equal(manifest.dependencies['@cloudbase/node-sdk'], nodeVersion, name);
    const lockPath = path.join(dir, 'package-lock.json');
    if (!fs.existsSync(lockPath)) continue;
    const lock = readJson(lockPath);
    assert.equal(lock.packages[''].dependencies['@cloudbase/node-sdk'], nodeVersion, `${name} root lock`);
    assert.equal(lock.packages['node_modules/@cloudbase/node-sdk'].version, nodeVersion, `${name} resolved lock`);
    assert.match(lock.packages['node_modules/@cloudbase/node-sdk'].integrity, /^sha512-/, `${name} integrity`);
  }
});
