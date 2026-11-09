const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 1000;
const MAX_COLUMNS = 100;

export function parseCsv(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
      if (rows.length > MAX_ROWS + 1) throw new Error('FILE_ROW_LIMIT');
    } else cell += ch;
  }
  if (quoted) throw new Error('CSV_UNCLOSED_QUOTE');
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  if (rows.length > MAX_ROWS + 1) throw new Error('FILE_ROW_LIMIT');
  if (!rows.length) return [];
  if (rows.some(item => item.length > MAX_COLUMNS)) throw new Error('FILE_COLUMN_LIMIT');
  return rows;
}

export function rowsFromMatrix(matrix) {
  const [headerRow, ...data] = Array.isArray(matrix) ? matrix : [];
  if (!Array.isArray(headerRow) || !headerRow.length) throw new Error('FILE_HEADER_REQUIRED');
  const headers = headerRow.map(value => String(value ?? '').trim());
  if (headers.length > MAX_COLUMNS) throw new Error('FILE_COLUMN_LIMIT');
  if (headers.some((value, index) => !value && data.some(row => String(row?.[index] ?? '').trim()))) {
    throw new Error('FILE_BLANK_HEADER');
  }
  const seen = new Set();
  for (const header of headers) {
    const key = header.toLocaleLowerCase();
    if (key && seen.has(key)) throw new Error('FILE_DUPLICATE_HEADER');
    if (key) seen.add(key);
  }
  const nonblank = data.map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter(item => Array.isArray(item.row) && item.row.some(value => String(value ?? '').trim() !== ''));
  if (nonblank.length > MAX_ROWS) throw new Error('FILE_ROW_LIMIT');
  return { headers, rows: nonblank.map(({ row, rowNumber }) => ({
    rowNumber,
    values: Object.fromEntries(headers.map((header, column) => [header, String(row?.[column] ?? '').trim()])),
  })) };
}

function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (window.__crmXlsxLoading) return window.__crmXlsxLoading;
  window.__crmXlsxLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('../../vendor/sheetjs-0.20.3.full.min.js', import.meta.url).href;
    script.onload = () => window.XLSX ? resolve(window.XLSX) : reject(new Error('XLSX_UNAVAILABLE'));
    script.onerror = () => reject(new Error('XLSX_UNAVAILABLE'));
    document.head.appendChild(script);
  });
  window.__crmXlsxLoading = window.__crmXlsxLoading.catch(error => { window.__crmXlsxLoading = null; throw error; });
  return window.__crmXlsxLoading;
}

export async function readRosterFile(file) {
  if (!file || !Number.isFinite(file.size) || file.size < 1 || file.size > MAX_FILE_BYTES) {
    throw new Error('FILE_SIZE_LIMIT');
  }
  const extension = String(file.name || '').split('.').pop().toLowerCase();
  let matrix;
  if (extension === 'csv') matrix = parseCsv(await file.text());
  else if (extension === 'xlsx') {
    const XLSX = await loadXlsx();
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', sheetRows: MAX_ROWS + 1, WTF: true });
    const first = workbook.SheetNames?.[0];
    if (!first) throw new Error('FILE_EMPTY_WORKBOOK');
    matrix = XLSX.utils.sheet_to_json(workbook.Sheets[first], { header: 1, raw: false, defval: '' });
  } else throw new Error('FILE_TYPE_UNSUPPORTED');
  return rowsFromMatrix(matrix);
}

function escapeCsv(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(columns, rows) {
  const body = [columns.map(escapeCsv).join(','), ...rows.map(row => columns.map(key => escapeCsv(row[key])).join(','))].join('\r\n');
  return `\uFEFF${body}\r\n`;
}

export async function toXlsx(columns, rows) {
  const XLSX = await loadXlsx();
  const sheet = XLSX.utils.aoa_to_sheet([columns, ...rows.map(row => columns.map(key => row[key] ?? ''))]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'People');
  return XLSX.write(book, { bookType: 'xlsx', type: 'array' });
}

export const PERSON_EXPORT_COLUMNS = Object.freeze([
  { key: 'PersonID', labelKey: 'plt_export_person_id', fixed: true },
  { key: 'display_name', labelKey: 'plt_field_display_name', fixed: true },
  { key: 'phone', labelKey: 'plt_field_phone' },
  { key: 'wechat', labelKey: 'plt_field_wechat' },
  { key: 'gender', labelKey: 'plt_field_gender' },
  { key: 'birthday', labelKey: 'plt_field_birthday' },
  { key: 'occupation', labelKey: 'plt_field_occupation' },
  { key: 'organization', labelKey: 'plt_field_organization' },
  { key: 'education', labelKey: 'plt_field_education' },
  { key: 'source', labelKey: 'plt_field_source' },
  { key: 'hobbies', labelKey: 'plt_field_hobbies' },
  { key: 'customer_stage', labelKey: 'plt_field_customer_stage' },
  { key: 'sales_priority', labelKey: 'plt_field_sales_priority' },
  { key: 'referral_priority', labelKey: 'plt_field_referral_priority' },
  { key: 'marital_status', labelKey: 'plt_field_marital_status' },
  { key: 'first_contact_date', labelKey: 'plt_field_first_contact_date' },
  { key: 'notes', labelKey: 'plt_field_notes' },
]);
