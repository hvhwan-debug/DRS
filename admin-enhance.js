/*
 * Lớp tăng cường thao tác cho trang Quản trị (admin-index.html).
 *
 * Mục tiêu: giảm gõ tay tối đa. Không viết lại các biểu mẫu sẵn có; file này chỉ GẮN THÊM:
 *  1. Ô "Chọn nhanh học sinh" ở đầu các form Học Phí, Hoá Đơn, Bảng Điểm: gõ vài chữ của tên
 *     học sinh / tên phụ huynh / số điện thoại, chạm 1 kết quả là điền sẵn email, tên, chương trình.
 *  2. Form Học Sinh: chọn phụ huynh theo tên/SĐT, và nút "Tạo từ đơn đăng ký" điền sẵn cả form.
 *  3. Các nút chọn 1 chạm: kỳ học phí, hình thức nộp, số tiền hay dùng, buổi học, điểm số, nhận
 *     xét mẫu, ngày học trong tuần, giờ học, địa điểm, giáo viên.
 *  4. Tự điền ngày hôm nay cho các ô ngày còn trống.
 * Dùng lại biến & hàm toàn cục của trang (allStudentsData, setProgramSelectValue, formatMoneyInput...).
 */
(function () {
  'use strict';

  // ---------- Kiểu dáng ----------
  const css = `
  .qx-box { background:#f0f7ff; border:1px solid #cfe3f7; border-radius:12px; padding:0.8rem 0.9rem; margin-bottom:1rem; position:relative; }
  .qx-box > label { display:block; font-size:0.78rem; font-weight:700; color:#0369a1; margin-bottom:0.4rem; }
  .qx-search { width:100%; padding:0.6rem 0.8rem 0.6rem 2.2rem; border:1px solid #bcd6ee; border-radius:10px; font:inherit; font-size:0.92rem; background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.5'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='m20 20-3.5-3.5'/%3E%3C/svg%3E") no-repeat 0.75rem center; }
  .qx-search:focus { outline:none; border-color:#0284c7; box-shadow:0 0 0 3px rgba(2,132,199,0.15); }
  .qx-results { position:absolute; left:0.9rem; right:0.9rem; top:calc(100% - 0.4rem); background:#fff; border:1px solid #d5e2f0; border-radius:10px; box-shadow:0 12px 30px rgba(15,23,42,0.14); z-index:60; max-height:320px; overflow-y:auto; display:none; }
  .qx-results.open { display:block; }
  .qx-item { display:flex; gap:0.7rem; align-items:center; width:100%; text-align:left; background:none; border:none; border-bottom:1px solid #eef2f7; padding:0.6rem 0.8rem; cursor:pointer; font:inherit; }
  .qx-item:last-child { border-bottom:none; }
  .qx-item:hover, .qx-item.active { background:#f0f7ff; }
  .qx-item b { display:block; font-size:0.9rem; color:#0f172a; }
  .qx-item small { display:block; font-size:0.78rem; color:#64748b; }
  .qx-av { width:32px; height:32px; border-radius:50%; background:#e0f2fe; color:#0369a1; display:grid; place-items:center; font-weight:700; font-size:0.75rem; flex-shrink:0; }
  .qx-empty { padding:0.8rem; font-size:0.84rem; color:#64748b; }
  .qx-picked { margin-top:0.5rem; font-size:0.82rem; color:#15803d; display:none; }
  .qx-picked.show { display:block; }
  .qx-chips { display:flex; flex-wrap:wrap; gap:0.35rem; margin-top:0.4rem; }
  .qx-chip { border:1px solid #d5e2f0; background:#fff; color:#334155; border-radius:999px; padding:0.28rem 0.7rem; font:inherit; font-size:0.8rem; cursor:pointer; line-height:1.3; }
  .qx-chip:hover { border-color:#0284c7; color:#0369a1; }
  .qx-chip[aria-pressed="true"] { background:#0f172a; color:#fff; border-color:#0f172a; }
  .qx-regs { display:flex; flex-wrap:wrap; gap:0.4rem; margin-top:0.55rem; }
  .qx-regs .qx-chip { background:#fff7ed; border-color:#fed7aa; color:#9a3412; }
  .qx-regs .qx-chip:hover { background:#ffedd5; }
  .qx-hint { font-size:0.75rem; color:#64748b; margin-top:0.35rem; }
  `;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  // ---------- Tiện ích ----------
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
  const initials = n => { const p = String(n || '?').trim().split(/\s+/); return ((p.length > 1 ? p[p.length - 2][0] : '') + p[p.length - 1][0]).toUpperCase(); };
  const todayStr = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  // Đọc các biến `let` toàn cục do trang quản trị khai báo (dùng chung phạm vi toàn cục giữa các thẻ <script>).
  const GLOBALS = {
    allStudentsData: () => allStudentsData, allMembers: () => allMembers, allRegistrationsData: () => allRegistrationsData,
    allTuitionData: () => allTuitionData, allGradesData: () => allGradesData, allScheduleData: () => allScheduleData
  };
  const g = name => { try { return GLOBALS[name](); } catch (e) { return undefined; } };
  const fire = (el, type) => el && el.dispatchEvent(new Event(type, { bubbles: true }));
  const setVal = (id, v) => { const el = $(id); if (el) { el.value = v; fire(el, 'input'); fire(el, 'change'); } };
  const monthLabel = offset => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset); return `Tháng ${d.getMonth() + 1}/${d.getFullYear()}`; };
  const programOfForm = t => /tien_tieu_hoc/.test(t) ? 'Tiền Tiểu Học' : /luyen_chu/.test(t) ? 'Luyện Chữ Đẹp' : '';

  function chips(values, onPick, opts) {
    opts = opts || {};
    const wrap = document.createElement('div'); wrap.className = 'qx-chips';
    wrap.innerHTML = values.map(v => {
      const val = Array.isArray(v) ? v[0] : v, label = Array.isArray(v) ? v[1] : v;
      return `<button type="button" class="qx-chip" data-v="${esc(val)}">${esc(label)}</button>`;
    }).join('');
    wrap.addEventListener('click', e => {
      const b = e.target.closest('.qx-chip'); if (!b) return;
      if (opts.toggle) b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true');
      else wrap.querySelectorAll('.qx-chip').forEach(x => x.setAttribute('aria-pressed', x === b));
      onPick(b.dataset.v, b, wrap);
    });
    return wrap;
  }
  function attachChips(inputId, values, onPick, opts) {
    const input = $(inputId); if (!input || !values.length) return null;
    const holder = input.parentElement;
    const old = holder.querySelector(`.qx-chips[data-for="${inputId}"]`); if (old) old.remove();
    const c = chips(values, onPick || (v => setVal(inputId, v)), opts);
    c.dataset.for = inputId;
    // chèn ngay sau ô nhập (hoặc sau phần xem trước số tiền nếu có)
    const after = $(inputId + 'Preview') || input;
    after.insertAdjacentElement('afterend', c);
    return c;
  }
  function uniqTop(arr, n) {
    const count = {};
    arr.filter(Boolean).forEach(v => { v = String(v).trim(); if (v) count[v] = (count[v] || 0) + 1; });
    return Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, n).map(x => x[0]);
  }

  // ---------- Danh bạ học sinh / phụ huynh ----------
  function studentDirectory() {
    return (g('allStudentsData') || []).filter(s => s && s.studentName).map(s => ({
      studentName: s.studentName, parentEmail: s.parentEmail, parentName: s.parentName || '', parentPhone: s.parentPhone || '',
      programs: s.programs || (s.program ? [s.program] : [])
    }));
  }
  function parentDirectory() {
    const map = {};
    const add = (email, name, phone, child) => {
      email = String(email || '').trim().toLowerCase(); if (!email) return;
      const p = map[email] || (map[email] = { email, name: '', phone: '', children: new Set() });
      if (!p.name && name) p.name = String(name).trim();
      if (!p.phone && phone) p.phone = String(phone).trim();
      if (child) p.children.add(String(child).trim());
    };
    (g('allMembers') || []).forEach(m => add(m.email, m.fullName, m.phone));
    (g('allStudentsData') || []).forEach(s => add(s.parentEmail, s.parentName, s.parentPhone, s.studentName));
    (g('allRegistrationsData') || []).forEach(r => { const d = r.data || {}; add(d.email_phu_huynh || r.email, d.ten_phu_huynh || d.fullname || d.name, d.sdt_phu_huynh || d.phone, d.ten_tre); });
    return Object.values(map);
  }
  function matchScore(hay, q) {
    const words = norm(q).split(/\s+/).filter(Boolean);
    return words.every(w => hay.includes(w));
  }

  // ---------- Ô tìm & chọn nhanh ----------
  function buildPicker(form, opts) {
    if (!form || form.querySelector('.qx-box')) return;
    const box = document.createElement('div'); box.className = 'qx-box';
    box.innerHTML = `<label>${esc(opts.label)}</label>
      <input type="search" class="qx-search" placeholder="${esc(opts.placeholder)}" autocomplete="off">
      <div class="qx-results" role="listbox"></div>
      <div class="qx-picked"></div>
      ${opts.extra ? '<div class="qx-extra"></div>' : ''}`;
    form.insertBefore(box, form.firstChild);
    const input = box.querySelector('.qx-search'), list = box.querySelector('.qx-results'), picked = box.querySelector('.qx-picked');
    let items = [], active = -1;

    function render() {
      const q = input.value.trim();
      if (!q) { list.classList.remove('open'); return; }
      items = opts.source().filter(it => matchScore(it._hay || (it._hay = norm(opts.haystack(it))), q)).slice(0, 12);
      active = items.length ? 0 : -1;
      list.innerHTML = items.length ? items.map((it, i) => `<button type="button" class="qx-item ${i === 0 ? 'active' : ''}" data-i="${i}" role="option">
          <span class="qx-av">${esc(initials(opts.title(it)))}</span><span><b>${esc(opts.title(it))}</b><small>${esc(opts.sub(it))}</small></span></button>`).join('')
        : `<div class="qx-empty">Không tìm thấy "${esc(q)}". ${esc(opts.emptyHint || '')}</div>`;
      list.classList.add('open');
    }
    function choose(i) {
      const it = items[i]; if (!it) return;
      opts.onPick(it);
      picked.innerHTML = `<i class="fa-solid fa-circle-check"></i> Đã điền: <b>${esc(opts.title(it))}</b> · ${esc(opts.sub(it))}`;
      picked.classList.add('show');
      input.value = ''; list.classList.remove('open');
    }
    input.addEventListener('input', render);
    input.addEventListener('focus', render);
    input.addEventListener('keydown', e => {
      if (!list.classList.contains('open')) return;
      const btns = list.querySelectorAll('.qx-item');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); active = Math.max(0, Math.min(btns.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
        btns.forEach((b, i) => b.classList.toggle('active', i === active));
        if (btns[active]) btns[active].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
      else if (e.key === 'Escape') list.classList.remove('open');
    });
    list.addEventListener('mousedown', e => e.preventDefault());
    list.addEventListener('click', e => { const b = e.target.closest('.qx-item'); if (b) choose(+b.dataset.i); });
    input.addEventListener('blur', () => setTimeout(() => list.classList.remove('open'), 120));
    form.addEventListener('reset', () => { picked.classList.remove('show'); });
    return box;
  }

  function fillStudent(prefix, st) {
    setVal(prefix + 'ParentEmail', st.parentEmail);
    // các hàm onXParentEmailChange của trang sẽ dựng danh sách học sinh; ghi đè tên cho chắc chắn
    setTimeout(() => {
      const nameInput = $(prefix + 'StudentName'), sel = $(prefix + 'StudentNameSelect');
      if (sel && sel.style.display !== 'none' && Array.from(sel.options).some(o => o.value === st.studentName)) { sel.value = st.studentName; fire(sel, 'change'); }
      if (nameInput) { nameInput.value = st.studentName; nameInput.style.display = sel && sel.style.display !== 'none' ? 'none' : 'block'; }
      if (st.programs.length && typeof setProgramSelectValue === 'function' && $(prefix + 'Program')) setProgramSelectValue(prefix, st.programs[0]);
      if (prefix === 'tuition') refreshTuitionChips();
      if (prefix === 'grade') refreshGradeChips();
    }, 30);
  }

  function studentPicker(prefix) {
    const form = $(prefix + 'Form');
    buildPicker(form, {
      label: 'Chọn nhanh học sinh',
      placeholder: 'Gõ tên học sinh, tên phụ huynh hoặc số điện thoại…',
      emptyHint: 'Thêm học sinh ở mục Học Sinh trước.',
      source: studentDirectory,
      haystack: s => [s.studentName, s.parentName, s.parentEmail, s.parentPhone, String(s.parentPhone).replace(/\D/g, ''), s.programs.join(' ')].join(' '),
      title: s => s.studentName,
      sub: s => [s.parentName ? 'PH: ' + s.parentName : s.parentEmail, s.parentPhone, s.programs.join(', ')].filter(Boolean).join(' · '),
      onPick: s => fillStudent(prefix, s)
    });
  }

  // ---------- Form Học Sinh: chọn phụ huynh + tạo từ đơn đăng ký ----------
  function studentFormEnhance() {
    const form = $('studentForm'); if (!form) return;
    const box = buildPicker(form, {
      label: 'Chọn phụ huynh',
      placeholder: 'Gõ tên phụ huynh, số điện thoại hoặc email…',
      emptyHint: 'Có thể gõ thẳng email vào ô bên dưới.',
      source: parentDirectory,
      haystack: p => [p.name, p.email, p.phone, String(p.phone).replace(/\D/g, ''), Array.from(p.children).join(' ')].join(' '),
      title: p => p.name || p.email,
      sub: p => [p.name ? p.email : '', p.phone, p.children.size ? 'Con: ' + Array.from(p.children).join(', ') : ''].filter(Boolean).join(' · '),
      onPick: p => { setVal('studentParentEmail', p.email); $('studentName') && $('studentName').focus(); },
      extra: true
    });
    if (box) renderPendingRegistrations(box.querySelector('.qx-extra'));
  }
  // Đơn đăng ký có tên trẻ nhưng trẻ chưa có trong danh sách Học Sinh -> 1 chạm là điền cả form.
  function renderPendingRegistrations(holder) {
    if (!holder) return;
    const existing = new Set((g('allStudentsData') || []).map(s => `${String(s.parentEmail).toLowerCase()}|${norm(s.studentName)}`));
    const seen = new Set();
    const pending = (g('allRegistrationsData') || []).filter(r => {
      const d = r.data || {}; if (!d.ten_tre) return false;
      const email = String(d.email_phu_huynh || r.email || '').toLowerCase();
      const k = `${email}|${norm(d.ten_tre)}`;
      if (existing.has(k) || seen.has(k) || /Từ chối/i.test(r.status || '')) return false;
      seen.add(k); return true;
    }).slice(0, 8);
    if (!pending.length) { holder.innerHTML = ''; return; }
    holder.innerHTML = `<div class="qx-hint"><i class="fa-solid fa-inbox"></i> ${pending.length} trẻ đã đăng ký nhưng chưa thành học sinh. Chạm để điền sẵn:</div><div class="qx-regs"></div>`;
    const regs = holder.querySelector('.qx-regs');
    pending.forEach(r => {
      const d = r.data || {};
      const b = document.createElement('button'); b.type = 'button'; b.className = 'qx-chip';
      b.innerHTML = `<i class="fa-solid fa-plus"></i> ${esc(d.ten_tre)}${d.ten_phu_huynh ? ' · ' + esc(d.ten_phu_huynh) : ''}`;
      b.addEventListener('click', () => {
        setVal('studentParentEmail', String(d.email_phu_huynh || r.email || '').toLowerCase());
        setVal('studentName', d.ten_tre);
        if (d.ngay_sinh_tre) setVal('studentDob', d.ngay_sinh_tre);
        const prog = programOfForm(r.formType);
        if (prog && typeof renderStudentProgramsChecklist === 'function') renderStudentProgramsChecklist([prog]);
        const note = [d.truong_lop ? 'Trường/lớp: ' + d.truong_lop : '', d.sdt_phu_huynh ? 'SĐT PH: ' + d.sdt_phu_huynh : ''].filter(Boolean).join(' · ');
        if (note && $('studentNote') && !$('studentNote').value) $('studentNote').value = note;
        $('studentSubmitBtn') && $('studentSubmitBtn').focus();
      });
      regs.appendChild(b);
    });
  }

  // ---------- Học Phí ----------
  function refreshTuitionChips() {
    const program = typeof getProgramValue === 'function' ? getProgramValue('tuition') : '';
    const all = g('allTuitionData') || [];
    const amounts = uniqTop(all.filter(t => !program || t.program === program).map(t => t.expectedAmount || t.amount), 4)
      .map(Number).filter(n => n > 0).sort((a, b) => a - b);
    const fillAmount = (id) => v => { const el = $(id); el.value = v; formatMoneyInput(el); };
    attachChips('tuitionAmount', amounts.map(a => [a, a.toLocaleString('vi-VN') + 'đ']), fillAmount('tuitionAmount'));
  }
  function tuitionEnhance() {
    if (!$('tuitionForm')) return;
    studentPicker('tuition');
    attachChips('tuitionPeriod', [monthLabel(0), monthLabel(1), monthLabel(-1)]);
    attachChips('tuitionMethod', ['Chuyển khoản', 'Tiền mặt', 'Ví điện tử']);
    const prog = $('tuitionProgram'); if (prog) prog.addEventListener('change', refreshTuitionChips);
    refreshTuitionChips();
  }

  // ---------- Bảng Điểm ----------
  function refreshGradeChips() {
    const email = ($('gradeParentEmail') || {}).value, name = ($('gradeStudentName') || {}).value;
    const program = typeof getProgramValue === 'function' ? getProgramValue('grade') : '';
    const past = (g('allGradesData') || []).filter(x => String(x.parentEmail).toLowerCase() === String(email || '').toLowerCase() && norm(x.studentName) === norm(name) && (!program || x.program === program));
    const nextNo = past.filter(x => (x.assessmentType || 'Buổi học') === 'Buổi học').length + 1;
    attachChips('gradeTerm', [`Buổi ${nextNo} - ${monthLabel(0)}`, monthLabel(0), `Giữa kỳ - ${monthLabel(0)}`, `Cuối kỳ - ${monthLabel(0)}`]);
  }
  function gradeEnhance() {
    if (!$('gradeForm')) return;
    studentPicker('grade');
    refreshGradeChips();
    attachChips('gradeScore', ['6', '7', '7.5', '8', '8.5', '9', '9.5', '10']);
    const comment = $('gradeComment');
    if (comment) {
      const c = chips(['Viết đều nét hơn', 'Tư thế ngồi viết tốt', 'Cần luyện thêm nét khuyết', 'Chữ còn nghiêng, cần chỉnh', 'Tập trung tốt trong giờ', 'Tiến bộ rõ so với buổi trước', 'Cần luyện thêm ở nhà'], v => {
        comment.value = (comment.value.trim() ? comment.value.trim().replace(/[.]?$/, '. ') : '') + v + '.';
        comment.focus();
      }, { toggle: true });
      comment.insertAdjacentElement('afterend', c);
    }
    ['gradeStudentName', 'gradeParentEmail'].forEach(id => $(id) && $(id).addEventListener('change', refreshGradeChips));
  }

  // ---------- Hoá Đơn ----------
  function invoiceEnhance() {
    if (!$('invoiceForm')) return;
    studentPicker('invoice');
  }

  // ---------- Lịch Học ----------
  const DAYS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
  function syncDayChips() {
    const input = $('scheduleDays'), wrap = document.querySelector('.qx-chips[data-for="scheduleDays"]'); if (!input || !wrap) return;
    const txt = norm(input.value);
    wrap.querySelectorAll('.qx-chip').forEach(b => {
      const d = norm(b.dataset.v);
      const on = d === 'chu nhat' ? /chu nhat|cn\b/.test(txt) : new RegExp('\\b' + d.replace(' ', '\\s*') + '\\b').test(txt) || new RegExp('\\bt' + d.slice(-1) + '\\b').test(txt);
      b.setAttribute('aria-pressed', on);
    });
  }
  function addMinutes(t, m) { const [h, mi] = t.split(':').map(Number); const x = h * 60 + mi + m; return `${String(Math.floor(x / 60) % 24).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; }
  function scheduleEnhance() {
    if (!$('scheduleForm')) return;
    attachChips('scheduleDays', DAYS, (v, b, wrap) => {
      const chosen = Array.from(wrap.querySelectorAll('.qx-chip[aria-pressed="true"]')).map(x => x.dataset.v);
      $('scheduleDays').value = chosen.join(', ');
    }, { toggle: true });
    $('scheduleDays').addEventListener('input', syncDayChips);
    attachChips('scheduleStartTime', ['07:30', '08:00', '09:00', '14:00', '15:30', '16:00', '17:30', '19:00'], v => {
      setVal('scheduleStartTime', v);
      const end = $('scheduleEndTime'); if (!end.value || end.value <= v) setVal('scheduleEndTime', addMinutes(v, 60));
    });
    $('scheduleStartTime').addEventListener('change', () => { const s = $('scheduleStartTime').value, e = $('scheduleEndTime'); if (s && (!e.value || e.value <= s)) e.value = addMinutes(s, 60); });
    attachChips('scheduleEndTime', [['60', '+1 giờ'], ['90', '+1,5 giờ'], ['120', '+2 giờ']], v => { const s = $('scheduleStartTime').value; if (s) setVal('scheduleEndTime', addMinutes(s, +v)); });
    refreshScheduleChips();
    // khi bấm "Sửa" một lịch học, đồng bộ lại các nút ngày
    if (typeof window.startEditSchedule === 'function') {
      const orig = window.startEditSchedule;
      window.startEditSchedule = function (s) { orig(s); setTimeout(syncDayChips, 0); };
    }
    $('scheduleForm').addEventListener('reset', () => setTimeout(syncDayChips, 0));
  }
  function refreshScheduleChips() {
    const all = g('allScheduleData') || [];
    attachChips('scheduleLocation', uniqTop(all.map(x => x.location), 6));
    attachChips('scheduleTeacher', uniqTop(all.map(x => x.teacherName), 6));
  }

  // ---------- Thành Viên: tạo tài khoản từ đơn đăng ký ----------
  function renderAccountSuggestions() {
    const form = $('createAccountForm'); if (!form) return;
    let holder = form.querySelector('.qx-acc');
    if (!holder) { holder = document.createElement('div'); holder.className = 'qx-box qx-acc'; form.insertBefore(holder, form.firstChild); }
    const members = new Set((g('allMembers') || []).map(m => String(m.email).toLowerCase()));
    const seen = new Set();
    const pending = (g('allRegistrationsData') || []).filter(r => {
      const d = r.data || {}; const email = String(d.email_phu_huynh || r.email || '').toLowerCase();
      if (!email || members.has(email) || seen.has(email)) return false;
      seen.add(email); return true;
    }).slice(0, 10);
    if (!pending.length) { holder.style.display = 'none'; return; }
    holder.style.display = '';
    holder.innerHTML = `<label>Người đã gửi đơn nhưng chưa có tài khoản (${pending.length})</label><div class="qx-hint" style="margin-top:0;">Chạm để điền sẵn email, họ tên, SĐT, địa chỉ rồi bấm Tạo Tài Khoản.</div><div class="qx-regs"></div>`;
    const regs = holder.querySelector('.qx-regs');
    pending.forEach(r => {
      const d = r.data || {}; const email = String(d.email_phu_huynh || r.email || '').toLowerCase();
      const name = d.ten_phu_huynh || d.fullname || d.fullName || d.name || d.ten_tnv || d.ten_tai_tro || '';
      const phone = d.sdt_phu_huynh || d.phone || d.sdt_tnv || d.sdt_tai_tro || '';
      const b = document.createElement('button'); b.type = 'button'; b.className = 'qx-chip';
      b.innerHTML = `<i class="fa-solid fa-user-plus"></i> ${esc(name || email)}${r.formTitle ? ' · ' + esc(r.formTitle) : ''}`;
      b.addEventListener('click', () => {
        setVal('newAccountEmail', email); setVal('newAccountFullName', name); setVal('newAccountPhone', phone);
        setVal('newAccountAddress', d.dia_chi || d.phuong_xa || '');
        $('createAccountBtn') && $('createAccountBtn').focus();
      });
      regs.appendChild(b);
    });
  }

  // ---------- Ngày mặc định ----------
  function defaultDates() {
    ['tuitionDate', 'invoiceIssueDate', 'attendanceDate'].forEach(id => {
      const el = $(id); if (el && !el.value) { el.value = todayStr(); if (id === 'attendanceDate') fire(el, 'change'); }
    });
  }
  ['tuitionForm', 'invoiceForm'].forEach(fid => { const f = $(fid); if (f) f.addEventListener('reset', () => setTimeout(defaultDates, 0)); });

  // ---------- Khởi động: chờ dữ liệu của trang tải xong rồi mới gắn các lựa chọn dựa trên dữ liệu ----------
  tuitionEnhance(); invoiceEnhance(); gradeEnhance(); scheduleEnhance(); studentFormEnhance(); defaultDates();
  let tries = 0;
  const refresher = setInterval(() => {
    tries++;
    refreshTuitionChips(); refreshScheduleChips();
    const extra = document.querySelector('#studentForm .qx-extra'); if (extra) renderPendingRegistrations(extra);
    renderAccountSuggestions();
    if (tries >= 6) clearInterval(refresher); // ~12 giây đầu, đủ cho các API tải xong
  }, 2000);
  // Mỗi lần mở lại tab, làm mới gợi ý theo dữ liệu mới nhất
  document.addEventListener('click', e => {
    const tab = e.target.closest('.tab-btn[data-tab]'); if (!tab) return;
    setTimeout(() => {
      if (tab.dataset.tab === 'tuition') refreshTuitionChips();
      if (tab.dataset.tab === 'schedule') refreshScheduleChips();
      if (tab.dataset.tab === 'members') renderAccountSuggestions();
      if (tab.dataset.tab === 'students') { const extra = document.querySelector('#studentForm .qx-extra'); if (extra) renderPendingRegistrations(extra); }
    }, 50);
  });
})();
