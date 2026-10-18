'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const moduleRoot = path.join(root, 'crm/js/modules/console');
const i18nFile = path.join(moduleRoot, 'i18n.js');

function readDictionary() {
  const source = fs.readFileSync(i18nFile, 'utf8').replace(/\bexport\s+/g, '');
  const context = vm.createContext({});
  vm.runInContext(`${source}\n;globalThis.__pc34 = { DICT, ENUM_I18N };`, context, { filename: i18nFile });
  return context.__pc34;
}
function modules(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? modules(file) : entry.isFile() && file.endsWith('.js') && file !== i18nFile ? [file] : [];
  });
}

test('PC34 Console literal keys have both languages and centralized enum labels', () => {
  const { DICT, ENUM_I18N } = readDictionary();
  const missing = [];
  const englishEmptyGrammarParts = new Set(['act_weekday_prefix', 'day_suffix', 'weekday_prefix']);
  let references = 0;
  for (const file of modules(moduleRoot)) {
    const source = fs.readFileSync(file, 'utf8');
    const pattern = /\b(?:t|tFull)\(\s*(['"`])([^'"`]+)\1/g;
    for (const match of source.matchAll(pattern)) {
      if (match[1] === '`' && match[2].includes('${')) continue;
      if (/^\s*\+/.test(source.slice(match.index + match[0].length))) continue;
      references++;
      const value = DICT[match[2]];
      if (!value || !String(value['zh-CN'] || '').trim() ||
          typeof value.en !== 'string' ||
          (!value.en.trim() && !englishEmptyGrammarParts.has(match[2]))) {
        missing.push(`${path.relative(root, file)}: ${match[2]}`);
      }
    }
  }
  assert.ok(references > 250, `unexpectedly few Console dictionary references: ${references}`);
  const missingEnums = [];
  for (const [type, values] of Object.entries(ENUM_I18N)) {
    for (const [raw, key] of Object.entries(values)) {
      if (!raw || !DICT[key]?.['zh-CN'] || !DICT[key]?.en) missingEnums.push(`${type}.${raw}: ${key}`);
    }
  }
  assert.equal(missing.length + missingEnums.length, 0,
    `missing literal Console dictionary keys/languages:\n${missing.join('\n')}\nmissing enum labels:\n${missingEnums.join('\n')}`);
});
