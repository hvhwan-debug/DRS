/*
 * Xuất file Excel (.xlsx) có định dạng đẹp, dùng chung cho Admin, CRM, Công Việc.
 * Thay cho CSV (CSV không có định dạng và thường dồn hết vào 1 cột trên Excel cài tiếng Việt,
 * vì Excel đó dùng dấu ";" làm dấu ngăn cột thay cho ",").
 *
 *   WVNExcel.download({
 *     filename: 'hoc-sinh.xlsx', sheetName: 'Học sinh', title: 'Danh sách học sinh', subtitle: '...',
 *     columns: [{ label, get: row => value, type: 'text'|'date'|'money'|'number'|'phone', width, style: (value,row) => ({fill,color,bold}) }],
 *     rows: [...]
 *   })
 * Thư viện ExcelJS (lưu ngay trong website, /vendor) chỉ được tải khi bấm xuất lần đầu.
 */
(function () {
  'use strict';
  const LIB = '/vendor/exceljs-4.4.0.min.js';
  let loading = null;
  function loadLib() {
    if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LIB; s.async = true;
      s.onload = () => window.ExcelJS ? resolve(window.ExcelJS) : reject(new Error('Không tải được bộ tạo Excel.'));
      s.onerror = () => { loading = null; reject(new Error('Không tải được bộ tạo Excel. Kiểm tra mạng rồi thử lại.')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  const NAVY = 'FF111A33', ZEBRA = 'FFF5F7FB', LINE = 'FFE2E6EE', MUTED = 'FF6B7386';
  const argb = hex => 'FF' + String(hex || '').replace('#', '').toUpperCase().padStart(6, '0').slice(-6);

  function toDate(v) {
    if (v instanceof Date) return isNaN(v) ? null : v;
    const s = String(v || '').trim(); if (!s) return null;
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    return null;
  }
  function toNumber(v) {
    if (typeof v === 'number') return v;
    const s = String(v == null ? '' : v).replace(/[^\d-]/g, '');
    return s && s !== '-' ? Number(s) : null;
  }
  function display(v, type) {
    if (v == null) return '';
    if (type === 'date') { const d = toDate(v); return d ? '00/00/0000' : String(v); }
    if (type === 'money') { const n = toNumber(v); return n == null ? '' : n.toLocaleString('vi-VN') + ' đ'; }
    return String(v);
  }

  async function build(opts) {
    const ExcelJS = await loadLib();
    const cols = opts.columns;
    const rows = opts.rows || [];
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Mạng Lưới Tri Thức Việt Nam'; wb.created = new Date();
    const ws = wb.addWorksheet((opts.sheetName || 'Dữ liệu').slice(0, 31), {
      views: [{ state: 'frozen', xSplit: opts.freezeFirstColumn === false ? 0 : 1, ySplit: 4, showGridLines: false }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
      headerFooter: { oddFooter: '&L&8' + (opts.title || '') + '&R&8Trang &P / &N' }
    });

    // Tiêu đề + dòng mô tả
    const n = cols.length;
    ws.mergeCells(1, 1, 1, Math.max(1, n));
    const t = ws.getCell(1, 1);
    t.value = opts.title || opts.sheetName || 'Dữ liệu';
    t.font = { name: 'Arial', size: 15, bold: true, color: { argb: NAVY } };
    ws.getRow(1).height = 26;
    ws.mergeCells(2, 1, 2, Math.max(1, n));
    const now = new Date();
    const sub = ws.getCell(2, 1);
    sub.value = (opts.subtitle ? opts.subtitle + ' · ' : '') + `${rows.length} dòng · xuất lúc ${now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} ngày ${now.toLocaleDateString('vi-VN')}`;
    sub.font = { name: 'Arial', size: 10, color: { argb: MUTED } };
    ws.getRow(3).height = 6;

    // Hàng tiêu đề cột
    const head = ws.getRow(4);
    cols.forEach((c, i) => {
      const cell = head.getCell(i + 1);
      cell.value = c.label;
      cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
      cell.alignment = { vertical: 'middle', horizontal: c.type === 'money' || c.type === 'number' ? 'right' : 'left', wrapText: true, indent: 1 };
      cell.border = { bottom: { style: 'thin', color: { argb: NAVY } } };
    });
    head.height = 24;

    // Dữ liệu
    const widths = cols.map(c => Math.max(10, String(c.label).length + 4));
    rows.forEach((row, r) => {
      const xr = ws.getRow(5 + r);
      cols.forEach((c, i) => {
        const raw = c.get ? c.get(row) : row[c.key];
        const cell = xr.getCell(i + 1);
        let v = raw == null ? '' : raw;
        if (c.type === 'date') { const d = toDate(v); if (d) { cell.value = d; cell.numFmt = 'dd/mm/yyyy'; } else cell.value = String(v); }
        else if (c.type === 'money') { const num = toNumber(v); cell.value = num == null ? '' : num; cell.numFmt = '#,##0" đ"'; }
        else if (c.type === 'number') { const num = typeof v === 'number' ? v : (v === '' ? '' : Number(v)); cell.value = (num === '' || isNaN(num)) ? String(v) : num; }
        else { cell.value = String(v); if (c.type === 'phone') cell.numFmt = '@'; }
        cell.font = { name: 'Arial', size: 10, color: { argb: 'FF121829' }, bold: i === 0 && opts.boldFirstColumn !== false };
        cell.alignment = { vertical: 'middle', horizontal: c.type === 'money' || c.type === 'number' ? 'right' : 'left', wrapText: !!c.wrap, indent: 1 };
        cell.border = { bottom: { style: 'hair', color: { argb: LINE } } };
        if (r % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
        if (c.style) {
          const st = c.style(raw, row) || {};
          if (st.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(st.fill) } };
          if (st.color || st.bold) cell.font = { ...cell.font, color: st.color ? { argb: argb(st.color) } : cell.font.color, bold: !!st.bold || cell.font.bold };
        }
        const len = display(raw, c.type).split('\n').reduce((m, l) => Math.max(m, l.length), 0);
        widths[i] = Math.max(widths[i], Math.min(c.wrap ? 50 : 45, len + 3));
      });
      xr.height = 20;
    });
    cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.width || widths[i]; });

    // Bộ lọc trên hàng tiêu đề
    if (rows.length) ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + rows.length, column: n } };

    // Dòng tổng cho cột tiền (nếu có)
    const moneyCols = cols.map((c, i) => c.type === 'money' && c.total !== false ? i : -1).filter(i => i >= 0);
    if (moneyCols.length && rows.length) {
      const tr = ws.getRow(5 + rows.length);
      tr.getCell(1).value = 'Tổng cộng';
      tr.getCell(1).font = { name: 'Arial', size: 10, bold: true, color: { argb: NAVY } };
      moneyCols.forEach(i => {
        const colL = ws.getColumn(i + 1).letter;
        const cell = tr.getCell(i + 1);
        cell.value = { formula: `SUBTOTAL(9,${colL}5:${colL}${4 + rows.length})` };
        cell.numFmt = '#,##0" đ"';
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: NAVY } };
        cell.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
      });
      tr.eachCell({ includeEmpty: true }, cell => { cell.border = { top: { style: 'medium', color: { argb: NAVY } } }; });
      for (let i = 1; i <= n; i++) tr.getCell(i).border = { top: { style: 'medium', color: { argb: NAVY } } };
      tr.height = 22;
    }
    return wb;
  }

  async function download(opts) {
    const wb = await build(opts);
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const name = String(opts.filename || 'du-lieu').replace(/\.(csv|xlsx)$/i, '') + '.xlsx';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return name;
  }

  // Đoán kiểu cột cho các bảng cũ chỉ khai báo {key, label}
  function guessType(col, rows) {
    const k = (col.key + ' ' + col.label).toLowerCase();
    if (/email|mã|id\b|số hđ|invoicenumber/.test(k)) return 'text';
    if (/sđt|phone|điện thoại|sdt/.test(k)) return 'phone';
    if (/tiền|amount|học phí|giá trị|tổng|chênh|total/.test(k) && rows.some(r => typeof r[col.key] === 'number' || /^\d[\d.,]*$/.test(String(r[col.key] || '')))) return 'money';
    if (/ngày|date|at$|lúc|dob|sinh/.test(k) || rows.slice(0, 20).every(r => !r[col.key] || /^\d{4}-\d{2}-\d{2}/.test(String(r[col.key])))) return rows.some(r => r[col.key]) ? 'date' : 'text';
    if (/điểm|score|số lượng|count/.test(k)) return 'number';
    return 'text';
  }

  window.WVNExcel = { download, build, guessType, loadLib };
})();
