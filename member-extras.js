/*
 * Khu thành viên: các tính năng bổ sung
 *   - Chuyên cần: xem điểm danh của từng con + gửi đơn xin nghỉ (ghi thẳng vào CRM)
 *   - Hộp thư: email hệ thống đã gửi cho gia đình + tuỳ chọn nhận email
 *   - Lịch học: thêm vào lịch điện thoại (tệp .ics, lặp hằng tuần)
 *   - Hoá đơn: mã VietQR chuyển khoản điền sẵn số tiền & nội dung (khi đã cấu hình tài khoản nhận)
 *   - Giới thiệu bạn bè: đường dẫn riêng + số người đã giới thiệu
 * Được gọi sau khi trang thành viên vẽ xong: WVNMemberExtras.mount(payload)
 */
(function () {
  'use strict';
  var D = null, childFilter = '';
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var $ = function (id) { return document.getElementById(id); };
  var fmtDate = function (s) { if (!s) return ''; var p = String(s).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : s; };
  var todayStr = function () { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  var token = function () { return localStorage.getItem('wvn_member_token') || ''; };
  function post(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Member-Token': token() }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || !j.success) throw new Error(j.message || 'Đã có lỗi xảy ra.'); return j; }); });
  }
  var ST = { present: ['Có mặt', 'ok'], late: ['Đi muộn', 'warn'], absent: ['Vắng', 'bad'], excused: ['Có phép', 'info'] };

  // ---------- Thêm mục vào thanh bên + khung nội dung ----------
  function addTab(key, icon, label, afterKey) {
    if (document.querySelector('.member-tab-btn[data-tab="' + key + '"]')) return;
    var after = document.querySelector('.member-tab-btn[data-tab="' + afterKey + '"]');
    var b = document.createElement('button');
    b.className = 'member-tab-btn'; b.dataset.tab = key; b.setAttribute('onclick', "switchMemberTab('" + key + "')");
    b.innerHTML = '<i class="fa-solid ' + icon + '"></i> ' + label;
    if (after && after.parentNode) after.parentNode.insertBefore(b, after.nextSibling); else ($('sidebarNav') || document.body).appendChild(b);
    var anchor = document.getElementById('memberPanel-' + afterKey);
    var p = document.createElement('div'); p.className = 'member-panel'; p.id = 'memberPanel-' + key;
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(p, anchor.nextSibling);
  }

  // ---------- Chuyên cần & xin nghỉ ----------
  function renderAttendance() {
    var el = $('memberPanel-attendance'); if (!el) return;
    var kids = D.students || [];
    var rows = (D.attendance || []).filter(function (a) { return !childFilter || a.studentId === childFilter; }).sort(function (x, y) { return String(y.date).localeCompare(String(x.date)); });
    var leaves = (D.leaveRequests || []).filter(function (l) { return !childFilter || l.studentId === childFilter; });
    var since = Date.now() - 30 * 864e5;
    var r30 = rows.filter(function (a) { return new Date(a.date).getTime() >= since; });
    var cnt = function (st) { return r30.filter(function (a) { return a.status === st; }).length; };
    var total = r30.length, rate = total ? Math.round((cnt('present') + cnt('late')) / total * 100) : null;
    var chips = kids.length > 1 ? '<div class="mx-kids" role="group" aria-label="Chọn con"><button type="button" data-kid="" aria-pressed="' + (!childFilter) + '">Tất cả các con</button>' +
      kids.map(function (k) { return '<button type="button" data-kid="' + esc(k.id) + '" aria-pressed="' + (childFilter === k.id) + '">' + esc(k.studentName) + '</button>'; }).join('') + '</div>' : '';
    el.innerHTML =
      '<div class="card"><h2><i class="fa-solid fa-user-check"></i> Chuyên Cần</h2>' + chips +
      '<div class="mx-stats"><div><b>' + (rate == null ? '—' : rate + '%') + '</b><span>Đi học đủ (30 ngày)</span></div><div><b>' + cnt('present') + '</b><span>Có mặt</span></div><div><b>' + cnt('late') + '</b><span>Đi muộn</span></div><div class="' + (cnt('absent') >= 3 ? 'bad' : '') + '"><b>' + cnt('absent') + '</b><span>Vắng</span></div></div>' +
      (rows.length ? '<div class="mx-table-wrap"><table class="mx-table"><thead><tr><th>Ngày</th><th>Học sinh</th><th>Chương trình</th><th>Ghi chú</th><th>Trạng thái</th></tr></thead><tbody>' + rows.slice(0, 40).map(function (a) {
        var s = ST[a.status] || ST.present;
        return '<tr><td data-label="Ngày">' + esc(fmtDate(a.date)) + '</td><td data-label="Học sinh">' + esc(a.studentName) + '</td><td data-label="Chương trình">' + (a.program ? esc(a.program) : '—') + '</td><td data-label="Ghi chú">' + (a.note ? esc(a.note) : '—') + '</td><td data-label="Trạng thái"><span class="mx-pill ' + s[1] + '">' + s[0] + '</span></td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="mx-empty">Chưa có buổi điểm danh nào được ghi nhận.</p>') + '</div>' +
      '<div class="card"><h2><i class="fa-solid fa-envelope-open-text"></i> Xin Nghỉ Học</h2>' +
      (kids.length ? '<form id="mxLeaveForm" class="mx-form"><div class="mx-grid">' +
        '<div><label for="mxLeaveKid">Con</label><select id="mxLeaveKid">' + kids.map(function (k) { return '<option value="' + esc(k.id) + '"' + (childFilter === k.id ? ' selected' : '') + '>' + esc(k.studentName) + '</option>'; }).join('') + '</select></div>' +
        '<div><label for="mxLeaveDate">Ngày nghỉ</label><input type="date" id="mxLeaveDate" min="' + todayStr() + '" value="' + todayStr() + '" required></div></div>' +
        '<label for="mxLeaveReason">Lý do</label><div class="mx-opts">' + ['Con bị ốm', 'Gia đình có việc', 'Đi xa', 'Lịch trùng việc khác'].map(function (r) { return '<button type="button" data-leave-reason="' + esc(r) + '">' + esc(r) + '</button>'; }).join('') + '</div>' +
        '<input type="text" id="mxLeaveReason" maxlength="200" placeholder="Hoặc ghi lý do khác…" required>' +
        '<div id="mxLeaveAlert" class="mx-alert" hidden></div><button type="submit" class="btn" id="mxLeaveBtn"><i class="fa-solid fa-paper-plane"></i> Gửi đơn xin nghỉ</button>' +
        '<p class="mx-note">Giáo viên và bộ phận chăm sóc sẽ nhận được thông báo ngay.</p></form>'
        : '<p class="mx-empty">Tài khoản chưa có học sinh nào. Liên hệ trung tâm để được thêm thông tin con.</p>') +
      (leaves.length ? '<h3 class="mx-sub">Đơn đã gửi</h3><div class="mx-list">' + leaves.slice(0, 20).map(function (l) {
        return '<div class="mx-row"><div><strong>' + esc(fmtDate(l.date)) + ' · ' + esc(l.studentName) + '</strong><small>' + esc(l.reason) + '</small></div><span class="mx-pill info">Đã gửi</span></div>';
      }).join('') + '</div>' : '') + '</div>';
  }

  // ---------- Hộp thư & tuỳ chọn ----------
  var TYPE = { crm: 'Chăm sóc học tập', invoice: 'Hoá đơn', tuition: 'Học phí', bulk: 'Tin tức & sự kiện', registration: 'Đăng ký', otp: 'Mã xác nhận', tier: 'Hạng thành viên', gift: 'Đổi quà', other: 'Thông báo' };
  // Nhóm loại email thành vài mục dễ lọc
  var GROUPS = [
    { key: 'money', label: 'Học phí & hoá đơn', icon: 'fa-file-invoice-dollar', types: ['invoice', 'tuition'] },
    { key: 'gift', label: 'Đổi quà & hạng', icon: 'fa-gift', types: ['gift', 'tier'] },
    { key: 'study', label: 'Học tập', icon: 'fa-graduation-cap', types: ['crm', 'registration', 'grade', 'schedule'] },
    { key: 'news', label: 'Tin tức', icon: 'fa-bullhorn', types: ['bulk', 'news'] }
  ];
  function groupOf(m) {
    for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i].types.indexOf(m.type) > -1) return GROUPS[i];
    if (/hạng|kim cương|vàng|bạc/i.test(m.subject)) return GROUPS[1];
    return { key: 'other', label: 'Khác', icon: 'fa-envelope' };
  }
  // Gộp các email cùng một việc thành 1 chuỗi: cùng quà ("1 buổi học miễn phí") hoặc cùng số hoá đơn
  function threadKey(m) {
    var s = String(m.subject || '');
    var inv = s.match(/HD\d{4,}-[A-Z0-9]+/i); if (inv) return 'inv:' + inv[0].toUpperCase();
    var q = s.match(/[“"]([^"”]+)[”"]/); if (q && /quà/i.test(s)) return 'gift:' + q[1].toLowerCase();
    var g = s.match(/yêu cầu đổi quà:\s*(.+)$/i); if (g) return 'gift:' + g[1].trim().toLowerCase();
    return 'one:' + (m.sentAt || '') + s;
  }
  var inboxState = { group: '', open: {}, limit: 8 };
  function dayLabel(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    var t = new Date(); t.setHours(0, 0, 0, 0); var x = new Date(d); x.setHours(0, 0, 0, 0);
    var diff = Math.round((t - x) / 864e5);
    return diff === 0 ? 'Hôm nay' : diff === 1 ? 'Hôm qua' : diff > 1 && diff < 7 ? diff + ' ngày trước' : fmtDate(iso);
  }
  var hhmm = function (iso) { var d = new Date(iso); return isNaN(d) ? '' : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  function renderInbox() {
    var el = $('memberPanel-inbox'); if (!el) return;
    var all = (D.emailInbox || []).slice().sort(function (a, b) { return String(b.sentAt).localeCompare(String(a.sentAt)); });
    var prefs = (D.profile && D.profile.prefs) || {};
    // chuỗi email
    var threads = [], byKey = {};
    all.forEach(function (m) {
      var k = threadKey(m), th = byKey[k];
      if (!th) { th = byKey[k] = { key: k, items: [], group: groupOf(m) }; threads.push(th); }
      th.items.push(m);
    });
    var counts = {}; threads.forEach(function (t) { counts[t.group.key] = (counts[t.group.key] || 0) + 1; });
    var shown = threads.filter(function (t) { return !inboxState.group || t.group.key === inboxState.group; });
    var failed = all.filter(function (m) { return !m.success; }).length;
    var chips = '<div class="mx-kids mx-ibx-filter" role="group" aria-label="Lọc email"><button type="button" data-ibx-group="" aria-pressed="' + (!inboxState.group) + '">Tất cả <span>' + threads.length + '</span></button>' +
      GROUPS.filter(function (g) { return counts[g.key]; }).map(function (g) { return '<button type="button" data-ibx-group="' + g.key + '" aria-pressed="' + (inboxState.group === g.key) + '"><i class="fa-solid ' + g.icon + '"></i> ' + g.label + ' <span>' + counts[g.key] + '</span></button>'; }).join('') + '</div>';
    var lastDay = '', html = '';
    shown.slice(0, inboxState.limit).forEach(function (th) {
      var m = th.items[0], day = dayLabel(m.sentAt);
      if (day !== lastDay) { html += '<div class="mx-ibx-day">' + esc(day) + '</div>'; lastDay = day; }
      var more = th.items.length - 1, isOpen = inboxState.open[th.key];
      html += '<div class="mx-ibx' + (isOpen ? ' open' : '') + '"><div class="mx-ibx-row"' + (more ? ' data-ibx-toggle="' + esc(th.key) + '" role="button" tabindex="0" aria-expanded="' + !!isOpen + '"' : '') + '>' +
        '<span class="mx-ibx-ic g-' + th.group.key + '"><i class="fa-solid ' + th.group.icon + '"></i></span>' +
        '<div class="mx-ibx-main"><strong>' + esc(m.subject) + '</strong><small>' + esc(th.group.label) + (more ? ' · ' + (more + 1) + ' email' : '') + '</small></div>' +
        '<span class="mx-ibx-time">' + esc(hhmm(m.sentAt)) + '</span>' + (m.success ? '' : '<span class="mx-pill bad">Gửi lỗi</span>') +
        (more ? '<i class="fa-solid fa-chevron-down mx-ibx-chev" aria-hidden="true"></i>' : '') + '</div>' +
        (more && isOpen ? '<ol class="mx-ibx-thread">' + th.items.slice(1).map(function (x) { return '<li><span>' + esc(x.subject) + '</span><small>' + esc(fmtDate(x.sentAt)) + ' ' + esc(hhmm(x.sentAt)) + (x.success ? '' : ' · gửi lỗi') + '</small></li>'; }).join('') + '</ol>' : '') + '</div>';
    });
    var rest = shown.length - Math.min(shown.length, inboxState.limit);
    el.innerHTML = '<div class="card"><h2><i class="fa-solid fa-inbox"></i> Hộp Thư</h2><p class="mx-note" style="margin-top:-0.4rem">' + all.length + ' email đã gửi tới ' + esc(D.email) + (failed ? ', <b style="color:#b91c1c">' + failed + ' email gửi lỗi</b>' : '') + '. Không thấy trong hộp thư? Hãy xem mục Thư rác / Quảng cáo.</p>' +
      (all.length ? chips + '<div class="mx-ibx-list">' + html + '</div>' + (rest > 0 ? '<button type="button" class="btn btn-outline mx-ibx-more" data-ibx-more>Xem thêm ' + rest + ' mục</button>' : '') : '<p class="mx-empty">Chưa có email nào.</p>') + '</div>' +
      '<div class="card"><h2><i class="fa-solid fa-bell"></i> Tuỳ Chọn Nhận Email</h2>' +
      '<label class="mx-switch"><input type="checkbox" data-pref="news"' + (prefs.news !== false ? ' checked' : '') + '><span><strong>Bản tin, khuyến mãi & chương trình mới</strong><small>Tin tức, ưu đãi và sự kiện gửi chung tới thành viên. Tắt đi thì trung tâm không gửi các email này nữa.</small></span></label>' +
      '<div class="mx-always"><i class="fa-solid fa-shield-heart"></i><div><strong>Luôn được gửi</strong><small>Học phí & hoá đơn, xác nhận đổi quà, lịch học & điểm danh, tình hình học tập của con, bảo mật tài khoản và thông báo quan trọng (vd. nghỉ học). Những email này không phải quảng cáo nên vẫn gửi để gia đình không bỏ lỡ.</small></div></div>' +
      '<div id="mxPrefAlert" class="mx-alert" hidden></div></div>';
  }

  // ---------- Lịch học: tải .ics ----------
  var DAYMAP = [['chủ nhật', 'SU'], ['cn', 'SU'], ['thứ 2', 'MO'], ['thứ hai', 'MO'], ['t2', 'MO'], ['thứ 3', 'TU'], ['thứ ba', 'TU'], ['t3', 'TU'], ['thứ 4', 'WE'], ['thứ tư', 'WE'], ['t4', 'WE'], ['thứ 5', 'TH'], ['thứ năm', 'TH'], ['t5', 'TH'], ['thứ 6', 'FR'], ['thứ sáu', 'FR'], ['t6', 'FR'], ['thứ 7', 'SA'], ['thứ bảy', 'SA'], ['t7', 'SA']];
  function byDays(text) {
    var t = ' ' + String(text || '').toLowerCase().replace(/[,;/+&-]/g, ' ').replace(/\s+/g, ' ') + ' ', out = [];
    DAYMAP.forEach(function (d) { if (t.indexOf(' ' + d[0] + ' ') > -1 && out.indexOf(d[1]) < 0) out.push(d[1]); });
    // "Thứ 3, 5" -> các số lẻ sau chữ Thứ
    (t.match(/thứ\s+([2-7](\s+[2-7])*)/g) || []).forEach(function (m) { m.replace(/[2-7]/g, function (n) { var c = ['', '', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][n]; if (out.indexOf(c) < 0) out.push(c); }); });
    return out;
  }
  function icsFor(list) {
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    var idx = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tri thuc Viet//Lich hoc//VI', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Lịch học Tri thức Việt', 'X-WR-TIMEZONE:Asia/Ho_Chi_Minh'];
    var n = 0;
    list.forEach(function (s, i) {
      var days = byDays(s.days); var st = String(s.startTime || '').match(/(\d{1,2}):(\d{2})/), en = String(s.endTime || '').match(/(\d{1,2}):(\d{2})/);
      if (!days.length || !st) return;
      var d = new Date(); d.setHours(0, 0, 0, 0);
      while (days.indexOf(Object.keys(idx)[d.getDay()]) < 0) d.setDate(d.getDate() + 1);
      var ds = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
      var endT = en ? pad(en[1]) + en[2] : pad(Number(st[1]) + 1) + st[2];
      lines.push('BEGIN:VEVENT', 'UID:wvn-' + i + '-' + ds + '@wvn.vn', 'DTSTAMP:' + stamp, 'DTSTART;TZID=Asia/Ho_Chi_Minh:' + ds + 'T' + pad(st[1]) + st[2] + '00', 'DTEND;TZID=Asia/Ho_Chi_Minh:' + ds + 'T' + endT + '00',
        'RRULE:FREQ=WEEKLY;BYDAY=' + days.join(','), 'SUMMARY:' + String(s.program || 'Buổi học').replace(/[,;\n]/g, ' '), 'LOCATION:' + String(s.location || '').replace(/[,;\n]/g, ' '),
        'DESCRIPTION:' + ('Giáo viên: ' + (s.teacherName || '') + (s.note ? ' - ' + s.note : '')).replace(/[,;\n]/g, ' '),
        'BEGIN:VALARM', 'TRIGGER:-PT60M', 'ACTION:DISPLAY', 'DESCRIPTION:Sắp đến giờ học', 'END:VALARM', 'END:VEVENT');
      n++;
    });
    lines.push('END:VCALENDAR');
    return n ? lines.join('\r\n') : '';
  }
  function mountIcs() {
    var panel = $('memberPanel-schedule'); if (!panel || !(D.schedules || []).length || panel.querySelector('.mx-ics')) return;
    var card = panel.querySelector('.card'); if (!card) return;
    var h2 = card.querySelector('h2');
    var key = D.profile && D.profile.calendarKey;
    var feed = key ? location.host + '/api/member-calendar?k=' + key : '';
    var isApple = /iPhone|iPad|Macintosh/.test(navigator.userAgent);
    var box = document.createElement('div'); box.className = 'mx-ics';
    box.innerHTML = '<div class="mx-ics-head"><i class="fa-regular fa-calendar-plus"></i><div><strong>Đưa lịch học vào điện thoại</strong><small>Mỗi buổi học tự hiện trong lịch, nhắc trước 1 tiếng.' + (feed ? ' Khi trung tâm đổi lịch, lịch trên máy bạn tự cập nhật.' : '') + '</small></div></div>' +
      '<div class="mx-ics-acts">' +
      (feed ? '<a class="btn' + (isApple ? '' : ' btn-outline') + '" href="webcal://' + esc(feed) + '"><i class="fa-brands fa-apple"></i> Lịch iPhone / Mac</a>' +
              '<a class="btn' + (isApple ? ' btn-outline' : '') + '" target="_blank" rel="noopener" href="https://calendar.google.com/calendar/r?cid=' + encodeURIComponent('webcal://' + feed) + '"><i class="fa-brands fa-google"></i> Google Calendar</a>' : '') +
      '<button type="button" class="btn btn-outline" id="mxIcsBtn"><i class="fa-solid fa-download"></i> Tải tệp lịch</button></div>' +
      '<details class="mx-ics-help"><summary>Hướng dẫn từng bước</summary><ol>' +
      (feed ? '<li><b>iPhone:</b> bấm “Lịch iPhone / Mac”, chọn <i>Đăng ký</i> rồi <i>Thêm</i>. Lịch học hiện trong ứng dụng Lịch.</li>' +
              '<li><b>Android / Google:</b> bấm “Google Calendar”, đăng nhập Gmail, chọn <i>Thêm</i>. Mở ứng dụng Google Calendar trên điện thoại là thấy (nếu chưa hiện, vào Cài đặt của ứng dụng, bật đồng bộ lịch “Lịch học Tri thức Việt”).</li>' : '') +
      '<li><b>Máy khác / Outlook:</b> bấm “Tải tệp lịch” rồi mở tệp vừa tải để nhập vào lịch.' + (feed ? ' Cách này không tự cập nhật khi lịch đổi.' : '') + '</li></ol></details>';
    if (h2) h2.insertAdjacentElement('afterend', box); else card.prepend(box);
  }

  // ---------- Tự nhận diện thiết bị & hỏi thêm lịch học (popup Đồng ý / Để sau) ----------
  // Trình duyệt KHÔNG cho trang web tự thêm lịch vào điện thoại khi chưa được phép, nên ta hỏi 1 lần:
  // bấm Đồng ý -> mở đúng cách thêm theo thiết bị (iPhone/Mac: Lịch; Android/khác: Google Calendar),
  // điện thoại sẽ hiện thêm 1 bước xác nhận của chính hệ điều hành. Lựa chọn được nhớ trên từng thiết bị.
  var CAL_KEY = 'wvn_cal_offer';
  function deviceKind() {
    var ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document)) return 'ios';
    if (/Android/.test(ua)) return 'android';
    if (/Macintosh/.test(ua)) return 'mac';
    return 'desktop';
  }
  function calLinks() {
    var key = D.profile && D.profile.calendarKey; if (!key) return null;
    var feed = location.host + '/api/member-calendar?k=' + key;
    return { apple: 'webcal://' + feed, google: 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent('webcal://' + feed) };
  }
  function calState() { try { return JSON.parse(localStorage.getItem(CAL_KEY) || '{}'); } catch (e) { return {}; } }
  function saveCalState(v) { try { localStorage.setItem(CAL_KEY, JSON.stringify(v)); } catch (e) {} }
  function scheduleSig() {
    return (D.schedules || []).map(function (s) { return [s.program, s.days, s.startTime].join('|'); }).sort().join(';;');
  }
  function markAdded(where) { saveCalState({ status: 'added', where: where, at: Date.now(), sig: scheduleSig() }); refreshIcsBox(); }
  function refreshIcsBox() {
    var st = calState(), box = document.querySelector('.mx-ics'); if (!box) return;
    var old = box.querySelector('.mx-ics-done'); if (old) old.remove();
    if (st.status === 'added') box.querySelector('.mx-ics-head').insertAdjacentHTML('afterend', '<p class="mx-ics-done"><i class="fa-solid fa-circle-check"></i> Đã thêm vào ' + (st.where === 'google' ? 'Google Calendar' : 'Lịch trên máy') + ' trên thiết bị này. Nếu chưa thấy lịch, bấm lại nút bên dưới.</p>');
  }
  function maybeOfferCalendar() {
    var links = calLinks(); if (!links || !(D.schedules || []).length || document.getElementById('mxCalOffer')) return;
    var st = calState();
    var sig = scheduleSig();
    // Chỉ hỏi khi: chưa từng hỏi trên thiết bị này (thiết bị mới), hoặc chương trình học
    // đã thay đổi so với lần hỏi/trả lời gần nhất (chương trình mới). Không hỏi lặp lại
    // định kỳ chỉ vì thời gian trôi qua.
    if (st.status === 'never' && st.sig === sig) return;
    if (st.status === 'added' && st.sig === sig) return;
    if (st.status === 'later' && st.sig === sig) return;
    var kind = deviceKind();
    var apple = kind === 'ios' || kind === 'mac';
    var devName = { ios: 'iPhone', android: 'điện thoại Android', mac: 'máy Mac', desktop: 'máy tính' }[kind];
    var n = (D.schedules || []).length;
    var el = document.createElement('div'); el.id = 'mxCalOffer'; el.className = 'mx-offer'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'mxCalTitle');
    el.innerHTML = '<div class="mx-offer-box"><div class="mx-offer-ic"><i class="fa-regular fa-calendar-check"></i></div>' +
      '<h3 id="mxCalTitle">Thêm lịch học của con vào ' + devName + '?</h3>' +
      '<p>' + n + ' lớp học sẽ tự hiện trong lịch, <b>nhắc trước giờ học 1 tiếng</b> và tự cập nhật khi trung tâm đổi lịch.</p>' +
      '<div class="mx-offer-acts">' +
      (apple ? '<a class="btn" data-cal-go="apple" href="' + esc(links.apple) + '"><i class="fa-brands fa-apple"></i> Đồng ý, thêm vào Lịch</a>'
             : '<a class="btn" data-cal-go="google" target="_blank" rel="noopener" href="' + esc(links.google) + '"><i class="fa-brands fa-google"></i> Đồng ý, thêm vào Google Calendar</a>') +
      (kind === 'desktop' || kind === 'mac' ? '<a class="btn btn-outline" data-cal-go="' + (apple ? 'google' : 'apple') + '"' + (apple ? ' target="_blank" rel="noopener"' : '') + ' href="' + esc(apple ? links.google : links.apple) + '">' + (apple ? '<i class="fa-brands fa-google"></i> Dùng Google Calendar' : '<i class="fa-brands fa-apple"></i> Dùng Lịch Apple / Outlook') + '</a>' : '') +
      '<button type="button" class="btn btn-outline" data-cal-later>Để sau</button></div>' +
      '<button type="button" class="mx-offer-never" data-cal-never>Không, cảm ơn — đừng hỏi lại</button>' +
      '<small>' + (apple ? 'Máy sẽ hỏi thêm 1 lần “Đăng ký lịch này?”, chọn <b>Đăng ký</b> là xong.' : 'Google sẽ hỏi “Thêm lịch này?”, chọn <b>Thêm</b> là xong. Lịch hiện trong ứng dụng Google Calendar trên điện thoại.') + '</small></div>';
    document.body.appendChild(el);
    var close = function () { el.remove(); document.removeEventListener('keydown', onKey); };
    var onKey = function (e) { if (e.key === 'Escape') { saveCalState({ status: 'later', at: Date.now(), sig: sig }); close(); } };
    document.addEventListener('keydown', onKey);
    el.addEventListener('click', function (e) {
      var go = e.target.closest('[data-cal-go]'); if (go) { markAdded(go.dataset.calGo); setTimeout(close, 50); return; }
      if (e.target.closest('[data-cal-later]') || e.target === el) { saveCalState({ status: 'later', at: Date.now(), sig: sig }); close(); return; }
      if (e.target.closest('[data-cal-never]')) { saveCalState({ status: 'never', at: Date.now(), sig: sig }); close(); }
    });
    setTimeout(function () { var f = el.querySelector('[data-cal-go]'); if (f) f.focus(); }, 60);
  }

  // ---------- Hoá đơn: VietQR ----------
  function qrBlock(inv) {
    var b = D.bank; var amount = Math.round(Number(inv.totalAmount || 0));
    if (inv.status === 'paid' || !amount) return '';
    var memo = String(inv.invoiceNumber || inv.id || '').replace(/[^A-Za-z0-9 ]/g, '').slice(0, 25);
    if (!b) return '<div class="mx-qr mx-qr-off no-print"><i class="fa-solid fa-qrcode"></i><div><strong>Chuyển khoản bằng mã QR</strong><small>Trung tâm đang cập nhật tài khoản nhận học phí. Vui lòng liên hệ trung tâm để được hướng dẫn chuyển khoản.</small></div></div>';
    var src = 'https://img.vietqr.io/image/' + encodeURIComponent(b.bin) + '-' + encodeURIComponent(b.account) + '-compact2.png?amount=' + amount + '&addInfo=' + encodeURIComponent(memo) + '&accountName=' + encodeURIComponent(b.name || '');
    return '<div class="mx-qr no-print"><img src="' + esc(src) + '" alt="Mã QR chuyển khoản ' + esc(amount.toLocaleString('vi-VN')) + ' đồng" width="180" height="180" loading="lazy"><div><strong>Quét mã để chuyển khoản</strong>' +
      '<dl><dt>Số tiền</dt><dd>' + esc(amount.toLocaleString('vi-VN')) + 'đ</dd><dt>Nội dung</dt><dd>' + esc(memo) + '</dd>' + (b.bankName ? '<dt>Ngân hàng</dt><dd>' + esc(b.bankName) + '</dd>' : '') + '<dt>Số tài khoản</dt><dd>' + esc(b.account) + '</dd>' + (b.name ? '<dt>Chủ tài khoản</dt><dd>' + esc(b.name) + '</dd>' : '') + '</dl>' +
      '<small>Mở ứng dụng ngân hàng, chọn Quét QR. Số tiền và nội dung đã điền sẵn, vui lòng giữ nguyên nội dung để trung tâm đối soát nhanh. Chuyển xong, bấm "Tôi đã chuyển khoản" bên dưới.</small></div></div>';
  }
  function hookInvoiceView() {
    if (window.__mxInvoiceHooked || typeof window.viewMemberInvoice !== 'function') return;
    var orig = window.viewMemberInvoice;
    window.viewMemberInvoice = function (id) {
      orig(id);
      var inv = (window.__memberInvoices || []).find(function (i) { return i.id === id; });
      var box = $('memberInvoiceViewContent'); if (inv && box) box.insertAdjacentHTML('afterbegin', qrBlock(inv));
    };
    window.__mxInvoiceHooked = true;
  }

  // ---------- Giới thiệu bạn bè ----------
  function mountReferral() {
    var panel = $('memberPanel-perks'); if (!panel || !D.referral || panel.querySelector('.mx-ref')) return;
    var link = location.origin + '/dang-ky.html?ref=' + D.referral.code;
    var card = document.createElement('div'); card.className = 'card mx-ref';
    card.innerHTML = '<h2><i class="fa-solid fa-user-plus"></i> Giới Thiệu Bạn Bè</h2><p class="mx-note" style="margin-top:-0.4rem">Gửi đường dẫn này cho người quen. Khi họ tạo tài khoản qua đường dẫn, trung tâm biết đó là gia đình do bạn giới thiệu.</p>' +
      '<div class="mx-reflink"><input type="text" readonly value="' + esc(link) + '" id="mxRefLink" aria-label="Đường dẫn giới thiệu"><button type="button" class="btn" id="mxRefCopy"><i class="fa-regular fa-copy"></i> Sao chép</button>' +
      (navigator.share ? '<button type="button" class="btn btn-outline" id="mxRefShare"><i class="fa-solid fa-share-nodes"></i> Chia sẻ</button>' : '') + '</div>' +
      '<p class="mx-refcount"><b>' + D.referral.count + '</b> gia đình đã tham gia nhờ bạn giới thiệu</p>';
    panel.appendChild(card);
  }

  // ---------- Sự kiện ----------
  function bind() {
    if (window.__mxBound) return; window.__mxBound = true;
    document.addEventListener('click', function (e) {
      var k = e.target.closest('[data-kid]'); if (k) { childFilter = k.dataset.kid; renderAttendance(); return; }
      var ig = e.target.closest('[data-ibx-group]'); if (ig) { inboxState.group = ig.dataset.ibxGroup; inboxState.limit = 8; renderInbox(); return; }
      var it = e.target.closest('[data-ibx-toggle]'); if (it) { inboxState.open[it.dataset.ibxToggle] = !inboxState.open[it.dataset.ibxToggle]; renderInbox(); return; }
      if (e.target.closest('[data-ibx-more]')) { inboxState.limit += 12; renderInbox(); return; }
      var r = e.target.closest('[data-leave-reason]'); if (r) { $('mxLeaveReason').value = r.dataset.leaveReason; document.querySelectorAll('[data-leave-reason]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === r)); }); return; }
      var cg = e.target.closest('.mx-ics-acts a[href^="webcal"], .mx-ics-acts a[href*="calendar.google"]'); if (cg) { markAdded(/google/.test(cg.href) ? 'google' : 'apple'); }
      if (e.target.closest('#mxIcsBtn')) {
        var ics = icsFor(D.schedules || []);
        if (!ics) { alert('Chưa đọc được ngày học trong lịch. Vui lòng liên hệ trung tâm.'); return; }
        var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' })); a.download = 'lich-hoc-tri-thuc-viet.ics';
        document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000); return;
      }
      if (e.target.closest('#mxRefCopy')) { var inp = $('mxRefLink'); inp.select(); (navigator.clipboard ? navigator.clipboard.writeText(inp.value) : Promise.resolve(document.execCommand('copy'))).then(function () { e.target.closest('#mxRefCopy').innerHTML = '<i class="fa-solid fa-check"></i> Đã sao chép'; }); return; }
      if (e.target.closest('#mxRefShare')) { navigator.share({ title: 'Tri thức Việt', text: 'Mời bạn tham gia cùng gia đình mình tại Tri thức Việt', url: $('mxRefLink').value }).catch(function () {}); }
    });
    document.addEventListener('keydown', function (e) { var it = e.target.closest && e.target.closest('[data-ibx-toggle]'); if (it && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); it.click(); } });
    document.addEventListener('submit', function (e) {
      if (e.target.id !== 'mxLeaveForm') return;
      e.preventDefault();
      var btn = $('mxLeaveBtn'), al = $('mxLeaveAlert'); btn.disabled = true;
      post('/api/member-request-leave', { studentId: $('mxLeaveKid').value, date: $('mxLeaveDate').value, reason: $('mxLeaveReason').value.trim() })
        .then(function (r) { D.leaveRequests = [r.leave].concat(D.leaveRequests || []); renderAttendance(); var a2 = $('mxLeaveAlert'); a2.hidden = false; a2.className = 'mx-alert ok'; a2.textContent = 'Đã gửi đơn xin nghỉ. Trung tâm đã nhận được thông tin.'; })
        .catch(function (err) { al.hidden = false; al.className = 'mx-alert bad'; al.textContent = err.message; btn.disabled = false; });
    });
    document.addEventListener('change', function (e) {
      if (!e.target.matches('[data-pref]')) return;
      var prefs = { reminders: true }; document.querySelectorAll('[data-pref]').forEach(function (c) { prefs[c.dataset.pref] = c.checked; });
      var al = $('mxPrefAlert');
      post('/api/member-update-prefs', { prefs: prefs }).then(function (r) { D.profile = D.profile || {}; D.profile.prefs = r.prefs; al.hidden = false; al.className = 'mx-alert ok'; al.textContent = r.prefs.news ? 'Đã bật nhận bản tin & khuyến mãi.' : 'Đã tắt. Bạn sẽ không nhận email quảng cáo nữa, các thông báo quan trọng vẫn được gửi.'; })
        .catch(function (err) { al.hidden = false; al.className = 'mx-alert bad'; al.textContent = err.message; e.target.checked = !e.target.checked; });
    });
  }

  window.WVNMemberExtras = {
    mount: function (payload) {
      D = payload || {};
      addTab('attendance', 'fa-user-check', 'Chuyên Cần', 'schedule');
      addTab('inbox', 'fa-inbox', 'Hộp Thư', 'gifts');
      renderAttendance(); renderInbox(); mountIcs(); refreshIcsBox(); mountReferral(); hookInvoiceView(); bind();
      setTimeout(maybeOfferCalendar, 1800);
    },
    _icsFor: icsFor, _byDays: byDays
  };
})();
