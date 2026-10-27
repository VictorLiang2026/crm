'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeBase64, extractDocx, likelySensitive, MAX_FILE_BYTES } = require('../../cloudfunctions/assistant/knowledge-library-service');

test('knowledge source accepts only canonical base64 within the private file limit', () => {
  const bytes = Buffer.from('trusted source text', 'utf8');
  assert.deepEqual(decodeBase64(bytes.toString('base64')), bytes);
  assert.throws(() => decodeBase64('***'), error => error.code === 'INVALID_FILE');
  assert.equal(MAX_FILE_BYTES, 6 * 1024 * 1024);
  assert.throws(() => decodeBase64(Buffer.alloc(MAX_FILE_BYTES + 1).toString('base64')),
    error => ['INVALID_FILE','FILE_TOO_LARGE'].includes(error.code));
});

test('DOCX extraction rejects non-ZIP and malformed documents', () => {
  assert.throws(() => extractDocx(Buffer.from('not a document')), error => error.code === 'INVALID_CONTENT');
  const brokenZip = Buffer.from([0x50,0x4b,0x03,0x04]);
  assert.throws(() => extractDocx(brokenZip), error => error.code === 'INVALID_CONTENT');
});

test('top performer privacy scan catches personal identifiers and permits anonymized general notes', () => {
  assert.equal(likelySensitive('客户电话 13812345678'), true);
  assert.equal(likelySensitive('身份证 11010519491231002X'), true);
  assert.equal(likelySensitive('匿名分享：先确认家庭责任，再讨论保障优先级。'), false);
});
