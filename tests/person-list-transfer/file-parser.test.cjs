'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseCsv, rowsFromMatrix, toCsv, toXlsx, readRosterFile } = require('../../crm/js/modules/console/person-list-transfer-file.js');

test('CSV parser handles BOM, escaped quotes, commas and embedded newlines', () => {
  const parsed = parseCsv('\uFEFF姓名,备注\r\n张三,"他说""你好"",来自上海"\r\n李四,"多行\n备注"');
  assert.deepEqual(parsed, [['姓名','备注'],['张三','他说"你好",来自上海'],['李四','多行\n备注']]);
});

test('matrix validation retains source row numbers when blank rows are skipped', () => {
  const data = rowsFromMatrix([['姓名','备注'],['张三','a'],['',''],['李四','b']]);
  assert.deepEqual(data.rows.map(row => row.rowNumber), [2,4]);
});

test('matrix validation rejects repeated headers and CSV round trips quotes', () => {
  assert.throws(() => rowsFromMatrix([['姓名','姓名'],['张三','李四']]), /FILE_DUPLICATE_HEADER/);
  const csv = toCsv(['姓名','备注'], [{姓名:'张三',备注:'含有,逗号和"引号"'}]);
  assert.deepEqual(parseCsv(csv), [['姓名','备注'],['张三','含有,逗号和"引号"']]);
});

test('XLSX export can be read back from the bundled local SheetJS copy', async () => {
  const sandbox = { window:{} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../../crm/js/vendor/sheetjs-0.20.3.full.min.js'),'utf8'), sandbox);
  global.window = sandbox.window;
  const bytes = Buffer.from(await toXlsx(['PersonID','display_name','notes'], [
    { PersonID:'42', display_name:'张三（老师）', notes:'第一行\n第二行' },
  ]));
  const data = await readRosterFile({ name:'people.xlsx', size:bytes.length,
    arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) });
  assert.equal(data.rows[0].values.PersonID, '42');
  assert.equal(data.rows[0].values.display_name, '张三（老师）');
  assert.equal(data.rows[0].values.notes, '第一行\n第二行');
  delete global.window;
});

