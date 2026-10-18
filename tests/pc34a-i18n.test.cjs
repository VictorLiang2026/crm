'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'crm/js/modules/console/i18n.js'), 'utf8').replace(/\bexport\s+/g, '');
const expected = {
  person: ['人物', 'Person'],
  opportunities: ['机会', 'Opportunities'],
  work_item: ['工作项', 'Work item'],
  act_legacy_status: ['原状态', 'Legacy status'],
  btn_refresh: ['刷新', 'Refresh'],
  confidence_low: ['低置信度', 'Low confidence']
};

test('PC34-A six existing Console keys render through the shared Chinese/English dictionary', () => {
  const context = vm.createContext({
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { querySelectorAll: () => [] }
  });
  vm.runInContext(`${source}\n;globalThis.pc34a = { t, setLang };`, context);
  for (const [key, [zh, en]] of Object.entries(expected)) {
    context.pc34a.setLang('zh-CN');
    assert.equal(context.pc34a.t(key), zh, key);
    context.pc34a.setLang('en');
    assert.equal(context.pc34a.t(key), en, key);
  }
});
