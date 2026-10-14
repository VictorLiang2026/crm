'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { matches } = require('./static.cjs');

test('static asset comparison treats CRLF and LF JavaScript as equivalent', () => {
  assert.equal(matches('crm/js/app.js', Buffer.from('const value = 1;\nnext();\n'), Buffer.from('const value = 1;\r\nnext();\r\n')), true);
});

test('static asset comparison still rejects changed JavaScript content', () => {
  assert.equal(matches('crm/js/app.js', Buffer.from('const value = 1;\n'), Buffer.from('const value = 2;\r\n')), false);
});

test('static asset comparison keeps HTML byte exact', () => {
  assert.equal(matches('console.html', Buffer.from('<main>\n</main>'), Buffer.from('<main>\r\n</main>')), false);
});
