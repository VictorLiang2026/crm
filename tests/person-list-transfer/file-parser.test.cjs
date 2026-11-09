'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseCsv, rowsFromMatrix, mapMappedValues, mergeContinuationRows, toCsv, toXlsx, readRosterFile } = require('../../crm/js/modules/console/person-list-transfer-file.js');

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

test('multiple descriptive columns combine into labeled notes while duplicate structured targets are rejected', () => {
  const mapped = mapMappedValues({ values: { '姓名或称呼':'张三', '基本信息':'讲师', '故事经历':'从业多年', '学生案例':'' } },
    ['姓名或称呼','基本信息','故事经历','学生案例'], ['display_name','notes','notes','notes']);
  assert.deepEqual(mapped, { display_name:'张三', notes:'基本信息：讲师\n故事经历：从业多年' });
  assert.throws(() => mapMappedValues({ values:{ A:'1', B:'2' } }, ['A','B'], ['phone','phone']), /DUPLICATE_FIELD_MAPPING/);
});

test('unnamed continuation rows combine into the previous named row and expose source rows', () => {
  const grouped = mergeContinuationRows([
    { rowNumber:2, values:{ 姓名:'张三', 备注:'简介' } },
    { rowNumber:3, values:{ 姓名:'', 备注:'补充经历' } },
    { rowNumber:4, values:{ 姓名:'李四', 备注:'另一个人' } },
    { rowNumber:5, values:{ 姓名:'', 备注:'补充观点' } },
  ], '姓名');
  assert.deepEqual(grouped.rows.map(row => [row.rowNumber, row.values.备注, row.sourceRowNumbers]), [
    [2, '简介\n补充经历', [2,3]], [4, '另一个人\n补充观点', [4,5]],
  ]);
  assert.deepEqual(grouped.mergedInto, [{ rowNumber:3, mergedIntoRowNumber:2 }, { rowNumber:5, mergedIntoRowNumber:4 }]);
  assert.deepEqual(grouped.unresolvedRowNumbers, []);
  assert.deepEqual(mergeContinuationRows([{ rowNumber:2, values:{ 姓名:'', 备注:'前置内容' } },
    { rowNumber:3, values:{ 姓名:'张三', 备注:'简介' } }], '姓名').unresolvedRowNumbers, [2]);
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

