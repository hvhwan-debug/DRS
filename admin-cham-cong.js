/*
 * Chấm Công & Tính Lương — /admin/cham-cong
 * Một trang cho cả NHÂN VIÊN (chấm công, bảng công, xin nghỉ, phiếu lương, hồ sơ)
 * và QUẢN LÝ có quyền "payroll" (hôm nay, chờ duyệt, bảng công nhân viên, bảng lương, hồ sơ lương).
 * API: /api/staff-me (của tôi) và /api/portal-payroll (quản lý). Giờ hiển thị luôn theo giờ Việt Nam.
 */
(function () {
  'use strict';
  const TZ = 'Asia/Ho_Chi_Minh';
  const token = localStorage.getItem('wvn_admin_token');
  const $ = id => document.getElementById(id);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => Math.round(Number(n) || 0).toLocaleString('vi-VN') + 'đ';
  const mv = n => `<span class="mv num">${money(n)}</span>`;
  const hm = min => { min = Math.max(0, Math.round(min || 0)); const h = Math.floor(min / 60), m = min % 60; return h ? `${h}g${m ? ' ' + String(m).padStart(2, '0') + 'p' : ''}` : `${m}p`; };
  const hoursDec = min => (Math.round((min || 0) / 60 * 100) / 100).toLocaleString('vi-VN');
  const timeOf = iso => iso ? new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : '—';
  const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const WDL = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
  const dow = d => new Date(d + 'T00:00:00Z').getUTCDay();
  const dmy = d => d ? d.split('-').reverse().join('/') : '—';
  const dm = d => d ? d.slice(8, 10) + '/' + d.slice(5, 7) : '';
  const periodLabel = p => p ? `tháng ${Number(p.slice(5, 7))}/${p.slice(0, 4)}` : '';
  const initials = n => { const p = String(n || '?').trim().split(/\s+/); return ((p.length > 1 ? p[p.length - 2][0] : '') + p[p.length - 1][0]).toUpperCase(); };
  const STATUS = { ok: ['ok', 'Hợp lệ'], pending: ['pending', 'Chờ duyệt'], rejected: ['rejected', 'Từ chối'], open: ['open', 'Đang trong ca'], replaced: ['muted', 'Đã thay'] };
  const chip = s => { const x = STATUS[s] || ['muted', s]; return `<span class="chip ${x[0]}">${x[1]}</span>`; };
  const FLAG = { add: 'Bổ sung công', edit: 'Xin sửa công', forgot: 'Quên chấm ra', long: 'Ca dài bất thường', 'closed-by-manager': 'Quản lý kết thúc ca' };
  const LEAVE_KINDS = { phep: 'Nghỉ phép (có lương)', 'khong-luong': 'Nghỉ không lương', om: 'Nghỉ ốm', khac: 'Việc riêng khác' };
  const ADJ = { bonus: 'Thưởng', deduction: 'Khấu trừ', advance: 'Tạm ứng' };

  const S = { me: null, d: null, period: null, m: null, mPeriod: null, view: null, offset: 0, tick: null };

  // ---------- Hạ tầng ----------
  async function api(path, opts) {
    opts = opts || {};
    const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token, ...(opts.headers || {}) } });
    const r = await res.json().catch(() => ({}));
    if (res.status === 401) { localStorage.removeItem('wvn_admin_token'); location.replace('/admin-dang-nhap.html'); throw new Error('Phiên đăng nhập đã hết hạn.'); }
    if (!res.ok || !r.success) { const e = new Error(r.message || 'Có lỗi xảy ra, vui lòng thử lại.'); e.data = r; e.status = res.status; throw e; }
    return r;
  }
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
  function toast(msg, err) { const t = $('toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' error' : ''); clearTimeout(toast._t); toast._t = setTimeout(() => t.className = 'toast', err ? 6000 : 2800); }
  function busy(btn, on, label) { if (!btn) return; if (on) { btn.dataset.l = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ' + (label || 'Đang lưu…'); } else { btn.disabled = false; if (btn.dataset.l) btn.innerHTML = btn.dataset.l; } }

  let modalOnClose = null;
  function modal(title, body, buttons, opts) {
    opts = opts || {};
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = body;
    $('modalBox').className = 'modal' + (opts.wide ? ' wide' : '');
    const f = $('modalFoot'); f.innerHTML = '';
    (buttons || []).forEach(b => {
      const el = document.createElement('button'); el.type = 'button'; el.className = 'btn ' + (b.cls || ''); el.innerHTML = b.label;
      el.addEventListener('click', async () => {
        if (!b.run) return closeModal();
        busy(el, true); try { const keep = await b.run(el); if (!keep) closeModal(); } catch (e) { toast(e.message, true); } finally { busy(el, false); }
      });
      f.appendChild(el);
    });
    f.hidden = !(buttons || []).length;
    $('modal').classList.add('on');
    modalOnClose = opts.onClose || null;
    setTimeout(() => { const i = $('modalBody').querySelector('input:not([type=hidden]), select, textarea'); if (i && !opts.noFocus) i.focus(); }, 30);
  }
  function closeModal() { $('modal').classList.remove('on'); if (modalOnClose) { const f = modalOnClose; modalOnClose = null; f(); } }
  $('modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('modal').classList.contains('on')) closeModal(); });
  const val = id => ($(id) ? $(id).value.trim() : '');

  // Ẩn / hiện số tiền trên màn hình (khi đứng ở chỗ đông người)
  const hideMoney = () => localStorage.getItem('wvn_cc_hide_money') === '1';
  function applyMoneyPref() { document.body.classList.toggle('money-hide', hideMoney()); }
  const eyeBtn = () => `<button type="button" class="eye" data-eye title="Ẩn/hiện số tiền" aria-label="Ẩn hoặc hiện số tiền"><i class="fa-regular ${hideMoney() ? 'fa-eye-slash' : 'fa-eye'}"></i></button>`;
  document.addEventListener('click', e => {
    if (!e.target.closest('[data-eye]')) return;
    localStorage.setItem('wvn_cc_hide_money', hideMoney() ? '0' : '1'); applyMoneyPref();
    document.querySelectorAll('[data-eye] i').forEach(i => { i.className = 'fa-regular ' + (hideMoney() ? 'fa-eye-slash' : 'fa-eye'); });
  });

  // ---------- Điều hướng ----------
  const EMP_VIEWS = ['cham-cong', 'bang-cong', 'nghi-phep', 'phieu-luong', 'ho-so'];
  const MGR_VIEWS = ['hom-nay', 'duyet', 'cong-nhan-vien', 'bang-luong', 'nhan-su', 'quy-dinh'];
  const MGR_TITLES = { 'hom-nay': 'Hôm nay', duyet: 'Chờ duyệt', 'cong-nhan-vien': 'Bảng công nhân viên', 'bang-luong': 'Bảng lương', 'nhan-su': 'Hồ sơ lương', 'quy-dinh': 'Quy định chấm công' };
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-view]'); if (!b) return;
    if (b.dataset.view === 'mgr') return openMgrMenu();
    go(b.dataset.view);
  });
  function openMgrMenu() {
    modal('Quản lý nhân sự', `<div class="list">${MGR_VIEWS.map(v => `<button class="li" style="width:100%;text-align:left" data-view="${v}" data-close><div class="body"><b>${MGR_TITLES[v]}</b></div>${v === 'duyet' && pendingCount() ? `<span class="chip pending">${pendingCount()}</span>` : ''}<i class="fa-solid fa-chevron-right muted"></i></button>`).join('')}</div>`, [], { noFocus: true });
  }
  function go(view, noPush) {
    if (MGR_VIEWS.includes(view) && !(S.me && S.me.canManage)) view = 'cham-cong';
    if (!EMP_VIEWS.includes(view) && !MGR_VIEWS.includes(view)) view = 'cham-cong';
    S.view = view;
    if (!noPush && location.hash.slice(1) !== view) history.replaceState(null, '', '#' + view);
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'view-' + view));
    document.querySelectorAll('[data-view]').forEach(b => { if (b.dataset.view === view || (b.dataset.view === 'mgr' && MGR_VIEWS.includes(view))) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    render();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', () => go(location.hash.slice(1), true));

  async function render() {
    const v = S.view;
    if (MGR_VIEWS.includes(v)) {
      if (!S.m) { $('view-' + v).innerHTML = '<div class="loading"><i class="fa-solid fa-spinner fa-spin"></i> Đang tải dữ liệu nhân sự…</div>'; try { await loadMgr(S.mPeriod); } catch (e) { $('view-' + v).innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${esc(e.message)}</div>`; return; } if (S.view !== v) return; }
      ({ 'hom-nay': rToday, duyet: rApprovals, 'cong-nhan-vien': rStaffSheet, 'bang-luong': rPayroll, 'nhan-su': rProfiles, 'quy-dinh': rPolicy })[v]();
    } else {
      ({ 'cham-cong': rClock, 'bang-cong': rMySheet, 'nghi-phep': rLeave, 'phieu-luong': rSlips, 'ho-so': rProfile })[v]();
    }
    applyMoneyPref();
  }

  // ---------- Tải dữ liệu ----------
  async function loadMe(period) {
    const d = await api('/api/staff-me' + (period ? '?period=' + period : ''));
    S.d = d; S.me = d.me; S.period = d.period;
    S.offset = new Date(d.now).getTime() - Date.now();
    if (!S.mPeriod) S.mPeriod = d.period;
    $('meName').textContent = d.me.name; $('meAv').textContent = initials(d.me.name);
    $('meRole').textContent = d.me.canManage ? 'Quản lý chấm công' : 'Nhân viên';
    $('mgrNav').hidden = !d.me.canManage; $('mMgr').hidden = !d.me.canManage;
    window.WVN_EXPORT_ALLOWED = !!d.me.canManage;
    return d;
  }
  async function loadMgr(period) {
    const m = await api('/api/portal-payroll' + (period ? '?period=' + period : ''));
    S.m = m; S.mPeriod = m.period;
    const n = pendingCount();
    $('nDuyet').textContent = n || ''; $('mDuyet').textContent = n; $('mDuyet').hidden = !n;
    return m;
  }
  const pendingCount = () => S.m ? S.m.entries.filter(e => e.status === 'pending').length + S.m.leaves.filter(l => l.status === 'pending').length : 0;
  async function refreshMe() { await loadMe(S.period); render(); }
  async function refreshMgr() { await loadMgr(S.mPeriod); render(); }
  const nowServer = () => new Date(Date.now() + S.offset);

  // =====================================================================
  //                              NHÂN VIÊN
  // =====================================================================
  function todaysClasses() {
    const d = S.d; const w = dow(d.today);
    const labels = { 0: ['chủ nhật', 'cn'], 1: ['thứ 2', 'thứ hai', 't2'], 2: ['thứ 3', 'thứ ba', 't3'], 3: ['thứ 4', 'thứ tư', 't4'], 4: ['thứ 5', 'thứ năm', 't5'], 5: ['thứ 6', 'thứ sáu', 't6'], 6: ['thứ 7', 'thứ bảy', 't7'] }[w];
    return (d.schedules || []).filter(s => labels.some(l => String(s.days).toLowerCase().includes(l))).sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  function rClock() {
    const d = S.d, open = d.open, est = d.estimate;
    const forgot = open && open.date < d.today;
    const now = nowServer();
    const dateText = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(now);
    const classes = todaysClasses();
    const recent = d.entries.filter(e => e.status !== 'replaced' && e.status !== 'open').slice(0, 5);
    const notConfigured = !d.profile.configured;
    $('view-cham-cong').innerHTML = `
      <div class="page-head"><div><h1>Chào ${esc(d.me.name.split(' ').slice(-1)[0])}</h1><p>${esc(dateText.charAt(0).toUpperCase() + dateText.slice(1))}</p></div>${eyeBtn()}</div>
      ${forgot ? `<div class="warn"><i class="fa-solid fa-clock-rotate-left"></i><div style="flex:1"><b>Bạn chưa kết thúc ca ${esc(WDL[dow(open.date)].toLowerCase())} ${dmy(open.date)} (vào lúc ${timeOf(open.clockIn)}).</b>
        Nhập giờ ra thực tế để ca được tính lương. Quản lý sẽ xác nhận lại.
        <div class="acts"><label>Giờ ra <input type="time" id="fgEnd" value="17:00"></label><label>Nghỉ giữa ca <input type="number" id="fgBreak" min="0" max="600" step="5" value="0" style="width:70px"> phút</label><button class="btn sm primary" id="fgSave">Lưu giờ ra</button></div></div></div>` : ''}
      <div class="grid g2">
        <div>
          <div class="clock${open ? ' working' : ''}" id="clockCard">
            <div>
              <div class="when">Giờ Việt Nam</div>
              <div class="big num" id="clkNow">${timeOf(now.toISOString())}</div>
              <div class="state"><span class="dot"></span><span id="clkState">${open ? (forgot ? 'Ca cũ chưa kết thúc' : 'Đang trong ca · ' + hm((now - new Date(open.clockIn)) / 60000)) : 'Chưa vào ca'}</span></div>
              <div class="meta">
                <div>Vào ca<b class="num">${open ? timeOf(open.clockIn) : '—'}</b></div>
                <div>Hôm nay đã làm<b class="num" id="clkToday">${hm(d.todayMinutes + (open && !forgot ? (now - new Date(open.clockIn)) / 60000 : 0))}</b></div>
                <div>Tháng này<b class="num">${hoursDec(est.minutes)} giờ</b></div>
              </div>
              ${placeLine(d.clockPolicy)}
            </div>
            <button class="punch" id="punch" ${forgot ? 'disabled title="Nhập giờ ra cho ca cũ trước"' : ''}><span><i class="fa-solid ${open ? 'fa-stop' : 'fa-play'}"></i>${open ? 'Kết thúc ca' : 'Vào ca'}</span></button>
          </div>
          <div class="card" style="margin-top:1rem">
            <div class="card-h"><h3>Ca gần đây</h3><button class="btn sm" data-view="bang-cong">Xem bảng công</button></div>
            ${recent.length ? `<ul class="list">${recent.map(entryLi).join('')}</ul>` : '<div class="empty"><i class="fa-regular fa-calendar"></i>Chưa có ca nào trong tháng.</div>'}
          </div>
        </div>
        <div>
          <div class="card"><div class="card-h"><h3>Lịch dạy hôm nay</h3><small>${esc(WDL[dow(d.today)])}</small></div><div class="card-b">
            ${classes.length ? classes.map(s => `<div class="sched"><span class="t num">${esc(s.startTime)}–${esc(s.endTime)}</span><div><b>${esc(s.program)}</b><div class="muted" style="font-size:.8rem">${esc(s.location || s.days)}</div></div></div>`).join('') : '<p class="muted" style="font-size:.88rem">Không có lớp nào ghi tên bạn hôm nay trong Lịch Học.</p>'}
          </div></div>
          <div class="card"><div class="card-h"><h3>${esc(periodLabel(d.period).replace(/^./, c => c.toUpperCase()))}</h3>${d.periodStatus.status !== 'open' ? '<span class="chip ok">Đã chốt lương</span>' : '<small>Tạm tính</small>'}</div>
            <div class="grid g3" style="gap:0">
              <div class="stat"><b class="num">${hoursDec(est.minutes)}</b><span>giờ làm</span></div>
              <div class="stat"><b class="num">${est.shifts}</b><span>ca · ${est.workDays} ngày</span></div>
              <div class="stat hl"><b>${notConfigured ? '—' : mv(est.net)}</b><span>${notConfigured ? 'chưa có mức lương' : 'thực nhận dự kiến'}</span></div>
            </div>
            ${est.pendingCount ? `<div class="card-b" style="border-top:1px solid var(--line-2);font-size:.84rem"><span class="chip pending">${est.pendingCount} ca chờ duyệt</span> <span class="muted">chưa được tính vào số trên.</span></div>` : ''}
            ${notConfigured ? `<div class="card-b muted" style="border-top:1px solid var(--line-2);font-size:.84rem">Quản lý chưa thiết lập mức lương cho bạn. Giờ làm vẫn được ghi nhận đầy đủ.</div>` : ''}
          </div>
        </div>
      </div>`;
    $('punch').onclick = punch;
    if ($('fgSave')) $('fgSave').onclick = async e => {
      const btn = e.currentTarget; busy(btn, true);
      try { await post('/api/staff-me', { action: 'fixForgotten', id: open.id, end: val('fgEnd'), breakMinutes: Number(val('fgBreak')) || 0 }); toast('Đã lưu giờ ra. Ca đang chờ quản lý xác nhận.'); await refreshMe(); }
      catch (err) { toast(err.message, true); busy(btn, false); }
    };
    startTick();
  }

  function placeLine(cp) {
    if (!cp) return '';
    if (cp.remoteAllowed) return '<div class="place-line ok"><i class="fa-solid fa-house-laptop"></i> Bạn được chấm công ở bất kỳ đâu</div>';
    if (!cp.enabled) return '';
    if (S.d.open && !cp.applyToClockOut) return ''; // đang trong ca, kết thúc ca không bị giới hạn
    if (cp.onNetwork) return `<div class="place-line ok"><i class="fa-solid fa-wifi"></i> Đang dùng mạng ${esc(cp.onNetwork)}</div>`;
    const where = [cp.networkNames.length ? 'mạng ' + cp.networkNames.join(', ') : '', cp.locationNames.length ? 'trong khu vực ' + cp.locationNames.join(', ') : ''].filter(Boolean).join(' hoặc ');
    return `<div class="place-line"><i class="fa-solid fa-location-dot"></i> Chấm công được khi dùng ${esc(where)}${cp.usesLocation ? ' · cần bật định vị' : ''}</div>`;
  }

  function startTick() {
    clearInterval(S.tick);
    S.tick = setInterval(() => {
      if (S.view !== 'cham-cong' || !$('clkNow')) return;
      const now = nowServer(), open = S.d.open;
      $('clkNow').textContent = timeOf(now.toISOString());
      if (open && open.date >= S.d.today) {
        $('clkState').textContent = 'Đang trong ca · ' + hm((now - new Date(open.clockIn)) / 60000);
        $('clkToday').textContent = hm(S.d.todayMinutes + (now - new Date(open.clockIn)) / 60000);
      }
    }, 15000);
  }

  // Lấy định vị khi quy định nơi chấm công cần (không dùng mạng trung tâm, có khai báo địa điểm)
  function needGeo(action) {
    const cp = S.d.clockPolicy || {};
    return cp.enabled && cp.usesLocation && !cp.onNetwork && (action === 'in' || cp.applyToClockOut);
  }
  function getGeo() {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) return reject(new Error('Thiết bị này không hỗ trợ định vị. Hãy kết nối Wi-Fi của trung tâm để chấm công.'));
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
        err => reject(new Error(err.code === 1
          ? 'Bạn chưa cho phép truy cập vị trí. Mở cài đặt trình duyệt → Quyền của trang web → Vị trí → Cho phép, rồi thử lại (hoặc kết nối Wi-Fi của trung tâm).'
          : 'Không xác định được vị trí. Hãy bật định vị (GPS) của điện thoại và thử lại.')),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
    });
  }
  // Gửi chấm công; nếu máy chủ báo cần định vị (vd. vừa rời Wi-Fi trung tâm) thì lấy vị trí và thử lại 1 lần
  async function clockPost(body, action, btn) {
    let geo = null;
    if (needGeo(action)) { if (btn) btn.innerHTML = '<i class="fa-solid fa-location-crosshairs fa-beat-fade"></i> Đang xác định vị trí…'; geo = await getGeo(); }
    try { return await post('/api/staff-me', { ...body, geo }); }
    catch (e) {
      if (e.data && e.data.code === 'place' && e.data.needGeo && !geo) { geo = await getGeo(); return await post('/api/staff-me', { ...body, geo }); }
      throw e;
    }
  }
  function placeBlocked(e, action) {
    modal(action === 'in' ? 'Chưa chấm công được' : 'Chưa kết thúc ca được', `<div class="warn amber" style="margin:0"><i class="fa-solid fa-location-dot"></i><div>${esc(e.message)}</div></div>`,
      action === 'in' ? [{ label: 'Đóng' }, { label: '<i class="fa-solid fa-plus"></i> Gửi bổ sung công', cls: 'primary', run: async () => { setTimeout(() => requestEntryModal(), 50); } }] : [{ label: 'Đã hiểu', cls: 'primary' }], { noFocus: true });
  }

  async function punch() {
    const open = S.d.open, btn = $('punch');
    if (!open) {
      busy(btn, true, 'Đang vào ca…');
      try { const r = await clockPost({ action: 'clockIn' }, 'in', btn); toast('Đã vào ca lúc ' + timeOf(r.clockIn) + '. Chúc bạn làm việc hiệu quả!'); await refreshMe(); }
      catch (e) { busy(btn, false); if (e.data && e.data.code === 'place') placeBlocked(e, 'in'); else toast(e.message, true); }
      return;
    }
    const mins = (nowServer() - new Date(open.clockIn)) / 60000;
    modal('Kết thúc ca', `
      <p style="margin-bottom:1rem">Vào lúc <b>${timeOf(open.clockIn)}</b> · đã ${hm(mins)}.</p>
      <div class="field"><label>Nghỉ giữa ca</label><div class="chips-pick" id="brk">${[0, 15, 30, 45, 60, 90].map(n => `<button type="button" data-b="${n}" aria-pressed="${n === 0}">${n ? n + ' phút' : 'Không nghỉ'}</button>`).join('')}</div></div>
      <div class="field"><label for="coNote">Ghi chú (không bắt buộc)</label><input id="coNote" maxlength="200" placeholder="VD: Dạy bù lớp Luyện chữ"></div>`,
      [{ label: 'Huỷ' }, { label: '<i class="fa-solid fa-stop"></i> Kết thúc ca', cls: 'primary', run: async () => {
        const b = Number(($('brk').querySelector('[aria-pressed="true"]') || {}).dataset?.b || 0);
        let r;
        try { r = await clockPost({ action: 'clockOut', breakMinutes: b, note: val('coNote') }, 'out'); }
        catch (e) { if (e.data && e.data.code === 'place') { setTimeout(() => placeBlocked(e, 'out'), 50); return; } throw e; }
        toast(r.pending ? r.message : 'Đã kết thúc ca: ' + hm(r.minutes) + '. Cảm ơn bạn!'); await refreshMe();
      } }], { noFocus: true });
    $('brk').addEventListener('click', e => { const b = e.target.closest('[data-b]'); if (!b) return; $('brk').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); });
  }

  function entryLi(e, opts) {
    opts = opts || {};
    const range = e.status === 'open' ? `${timeOf(e.clockIn)} – đang làm` : `${timeOf(e.clockIn)} – ${timeOf(e.clockOut)}`;
    const acts = [];
    if (opts.actions) {
      if (['ok', 'rejected'].includes(e.status) && opts.editable) acts.push(`<button class="btn sm" data-edit="${esc(e.id)}"><i class="fa-regular fa-pen-to-square"></i> Xin sửa</button>`);
      if (e.status === 'pending' && e.source === 'manual') acts.push(`<button class="btn sm danger" data-cancel="${esc(e.id)}">Huỷ yêu cầu</button>`);
    }
    return `<li class="li"><div class="day"><b class="num">${e.date.slice(8, 10)}</b><small>${WD[dow(e.date)]}</small></div>
      <div class="body"><b class="num">${range}</b>${e.breakMinutes ? ` <span class="muted" style="font-size:.8rem">· nghỉ ${e.breakMinutes}p</span>` : ''}
        <p>${[e.flag && FLAG[e.flag] ? FLAG[e.flag] : '', e.note].filter(Boolean).map(esc).join(' · ')}${e.status === 'rejected' && e.reviewNote ? `<br><span style="color:var(--red)">Lý do từ chối: ${esc(e.reviewNote)}</span>` : ''}</p></div>
      <div class="right"><span class="hrs num">${e.status === 'open' ? '…' : hm(e.minutes)}</span>${chip(e.status)}${acts.length ? `<div class="acts">${acts.join('')}</div>` : ''}</div></li>`;
  }

  function monthPicker(id, value) { return `<input type="month" id="${id}" value="${esc(value)}" max="${esc(S.d.today.slice(0, 7))}" aria-label="Chọn tháng">`; }

  function rMySheet() {
    const d = S.d, est = d.estimate, locked = d.periodStatus.status !== 'open';
    const list = d.entries.filter(e => e.status !== 'replaced' && (e.date.slice(0, 7) === d.period || e.status === 'open'));
    $('view-bang-cong').innerHTML = `
      <div class="page-head"><div><h1>Bảng công của tôi</h1><p>Ca bấm nút được tính ngay. Ca bổ sung hoặc xin sửa cần quản lý duyệt.</p></div>
        <div class="toolbar">${monthPicker('myMonth', d.period)}<button class="btn primary" id="addReq" ${locked ? 'disabled' : ''}><i class="fa-solid fa-plus"></i> Bổ sung công</button></div></div>
      ${locked ? `<div class="warn amber"><i class="fa-solid fa-lock"></i><div><b>Kỳ lương ${periodLabel(d.period)} đã chốt.</b>Nếu phát hiện sai sót, vui lòng báo trực tiếp quản lý.</div></div>` : ''}
      <div class="grid g4">
        <div class="card stat"><b class="num">${hoursDec(est.minutes)}</b><span>giờ được tính</span></div>
        <div class="card stat"><b class="num">${est.shifts}</b><span>ca làm</span></div>
        <div class="card stat"><b class="num">${est.workDays}</b><span>ngày có công</span></div>
        <div class="card stat"><b class="num">${est.pendingCount}</b><span>ca chờ duyệt</span></div>
      </div>
      <div class="card">${list.length ? `<ul class="list">${list.map(e => entryLi(e, { actions: true, editable: !locked })).join('')}</ul>` : '<div class="empty"><i class="fa-regular fa-calendar"></i>Chưa có ca nào trong ' + periodLabel(d.period) + '.</div>'}</div>`;
    $('myMonth').onchange = async e => { if (!e.target.value) return; await loadMe(e.target.value); rMySheet(); };
    $('addReq').onclick = () => requestEntryModal();
    $('view-bang-cong').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => requestEntryModal(d.entries.find(x => x.id === b.dataset.edit)));
    $('view-bang-cong').querySelectorAll('[data-cancel]').forEach(b => b.onclick = async () => {
      if (!confirm('Huỷ yêu cầu này?')) return;
      try { await post('/api/staff-me', { action: 'cancelRequest', id: b.dataset.cancel }); toast('Đã huỷ yêu cầu.'); await refreshMe(); } catch (e) { toast(e.message, true); }
    });
  }

  function requestEntryModal(orig) {
    const d = S.d;
    modal(orig ? 'Xin sửa ca làm' : 'Bổ sung công', `
      ${orig ? `<p class="muted" style="margin-bottom:.9rem;font-size:.86rem">Bản hiện tại: ${dmy(orig.date)} · ${timeOf(orig.clockIn)} – ${timeOf(orig.clockOut)}${orig.breakMinutes ? ' · nghỉ ' + orig.breakMinutes + 'p' : ''}. Bản cũ vẫn được tính cho tới khi quản lý duyệt bản sửa.</p>` : ''}
      <div class="field"><label for="rqDate">Ngày làm</label><input type="date" id="rqDate" max="${d.today}" value="${esc(orig ? orig.date : d.today)}"></div>
      <div class="row3">
        <div class="field"><label for="rqStart">Giờ vào</label><input type="time" id="rqStart" value="${esc(orig ? timeOf(orig.clockIn) : '08:00')}"></div>
        <div class="field"><label for="rqEnd">Giờ ra</label><input type="time" id="rqEnd" value="${esc(orig && orig.clockOut ? timeOf(orig.clockOut) : '17:00')}"></div>
        <div class="field"><label for="rqBreak">Nghỉ (phút)</label><input type="number" id="rqBreak" min="0" max="600" step="5" value="${orig ? orig.breakMinutes : 0}"></div>
      </div>
      <div class="field"><label for="rqNote">Lý do *</label><textarea id="rqNote" rows="2" maxlength="300" placeholder="${orig ? 'VD: Bấm nhầm giờ ra, thực tế về lúc 18:00' : 'VD: Quên bấm chấm công khi dạy lớp tối'}"></textarea><small>Giờ ra sớm hơn giờ vào được hiểu là ca qua đêm.</small></div>`,
      [{ label: 'Huỷ' }, { label: 'Gửi quản lý duyệt', cls: 'primary', run: async () => {
        await post('/api/staff-me', { action: 'requestEntry', date: val('rqDate'), start: val('rqStart'), end: val('rqEnd'), breakMinutes: Number(val('rqBreak')) || 0, note: val('rqNote'), replacesId: orig ? orig.id : '' });
        toast('Đã gửi yêu cầu. Quản lý sẽ được thông báo ngay.'); await refreshMe();
      } }]);
  }

  function rLeave() {
    const d = S.d;
    $('view-nghi-phep').innerHTML = `
      <div class="page-head"><div><h1>Xin nghỉ</h1><p>Đơn được gửi tới quản lý. Bạn sẽ nhận email khi có kết quả.</p></div></div>
      <div class="grid g2">
        <div class="card"><div class="card-h"><h3>Đơn đã gửi</h3></div>
          ${d.leaves.length ? `<ul class="list">${d.leaves.map(l => `<li class="li"><div class="day"><b class="num">${l.dateFrom.slice(8, 10)}</b><small>${esc('Th' + Number(l.dateFrom.slice(5, 7)))}</small></div>
            <div class="body"><b>${esc(l.kindLabel)}</b><p>${l.dateFrom === l.dateTo ? dmy(l.dateFrom) + (l.halfDay ? ' · nửa ngày' : '') : dmy(l.dateFrom) + ' – ' + dmy(l.dateTo)} · ${String(l.days).replace('.', ',')} ngày${l.reason ? ' · ' + esc(l.reason) : ''}${l.reviewNote ? `<br><span style="color:${l.status === 'rejected' ? 'var(--red)' : 'var(--green)'}">Quản lý: ${esc(l.reviewNote)}</span>` : ''}</p></div>
            <div class="right">${l.status === 'approved' ? '<span class="chip ok">Đã duyệt</span>' : l.status === 'rejected' ? '<span class="chip rejected">Không duyệt</span>' : '<span class="chip pending">Chờ duyệt</span>'}${l.status === 'pending' ? `<button class="btn sm danger" data-lcancel="${esc(l.id)}">Huỷ</button>` : ''}</div></li>`).join('')}</ul>` : '<div class="empty"><i class="fa-solid fa-umbrella-beach"></i>Bạn chưa gửi đơn xin nghỉ nào.</div>'}
        </div>
        <div class="card"><div class="card-h"><h3>Gửi đơn mới</h3></div><div class="card-b">
          <div class="field"><label for="lvKind">Loại nghỉ</label><select id="lvKind">${Object.entries(LEAVE_KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
          <div class="row2"><div class="field"><label for="lvFrom">Từ ngày</label><input type="date" id="lvFrom" value="${d.today}"></div><div class="field"><label for="lvTo">Đến ngày</label><input type="date" id="lvTo" value="${d.today}"></div></div>
          <label style="display:flex;gap:.5rem;align-items:center;font-size:.86rem;margin-bottom:.85rem"><input type="checkbox" id="lvHalf"> Chỉ nghỉ nửa ngày (khi nghỉ 1 ngày)</label>
          <div class="field"><label for="lvReason">Lý do</label><textarea id="lvReason" rows="2" maxlength="300"></textarea></div>
          <button class="btn primary" id="lvSend" style="width:100%"><i class="fa-regular fa-paper-plane"></i> Gửi đơn</button>
          <p class="muted" style="font-size:.76rem;margin-top:.6rem">Chủ nhật không tính vào số ngày nghỉ. Nghỉ không lương sẽ được trừ vào lương tháng (với nhân viên hưởng lương tháng).</p>
        </div></div>
      </div>`;
    $('lvFrom').onchange = () => { if (val('lvTo') < val('lvFrom')) $('lvTo').value = val('lvFrom'); };
    $('lvSend').onclick = async e => {
      const btn = e.currentTarget; busy(btn, true, 'Đang gửi…');
      try { await post('/api/staff-me', { action: 'requestLeave', kind: val('lvKind'), dateFrom: val('lvFrom'), dateTo: val('lvTo'), halfDay: $('lvHalf').checked, reason: val('lvReason') }); toast('Đã gửi đơn xin nghỉ.'); await refreshMe(); }
      catch (err) { toast(err.message, true); busy(btn, false); }
    };
    $('view-nghi-phep').querySelectorAll('[data-lcancel]').forEach(b => b.onclick = async () => {
      if (!confirm('Huỷ đơn xin nghỉ này?')) return;
      try { await post('/api/staff-me', { action: 'cancelLeave', id: b.dataset.lcancel }); toast('Đã huỷ đơn.'); await refreshMe(); } catch (e) { toast(e.message, true); }
    });
  }

  function slipHtml(s, who) {
    const row = (k, v, neg) => `<dt>${k}</dt><dd>${neg ? '−' : ''}${mv(v)}</dd>`;
    const work = s.payType === 'monthly' ? `Lương tháng${s.unpaidLeaveDays ? ` (trừ ${String(s.unpaidLeaveDays).replace('.', ',')} ngày nghỉ không lương)` : ''}` : `${hoursDec(s.minutes)} giờ × ${money(s.hourlyRate)}`;
    return `<div class="slip" id="slipPrint">
      <div class="slip-head"><div><h2>Phiếu lương ${esc(periodLabel(s.period))}</h2><div class="muted">${esc(who || s.name || '')} · ${esc(s.email)}</div></div>
        <div style="text-align:right"><img src="/images/logo-tri-thuc-viet.png?v=20260928a" alt="Tri thức Việt" style="height:26px"><div class="muted" style="font-size:.76rem">${s.status === 'paid' ? 'Đã trả ' + (s.paidAt ? new Date(s.paidAt).toLocaleDateString('vi-VN', { timeZone: TZ }) : '') : s.status === 'draft' ? 'Tạm tính' : 'Chốt ' + (s.finalizedAt ? new Date(s.finalizedAt).toLocaleDateString('vi-VN', { timeZone: TZ }) : '')}</div></div></div>
      <dl>
        <dt>Công</dt><dd>${s.shifts} ca · ${s.workDays} ngày · ${hoursDec(s.minutes)} giờ</dd>
        ${s.paidLeaveDays ? `<dt>Nghỉ có phép</dt><dd>${String(s.paidLeaveDays).replace('.', ',')} ngày</dd>` : ''}
        ${row(esc(work), s.base)}
        ${s.allowance ? row('Phụ cấp', s.allowance) : ''}
        ${(s.adjustments || []).filter(a => a.kind === 'bonus').map(a => row('Thưởng: ' + esc(a.note), a.amount)).join('')}
        <dt style="font-weight:700;color:var(--ink)">Tổng thu nhập</dt><dd>${mv(s.gross)}</dd>
        ${s.tax ? row('Khấu trừ thuế TNCN 10%', s.tax, true) : ''}
        ${(s.adjustments || []).filter(a => a.kind !== 'bonus').map(a => row((ADJ[a.kind] || a.kind) + ': ' + esc(a.note), a.amount, true)).join('')}
      </dl>
      <dl class="net"><dt>Thực nhận</dt><dd>${mv(s.net)}</dd></dl>
    </div>`;
  }

  function rSlips() {
    const d = S.d;
    $('view-phieu-luong').innerHTML = `
      <div class="page-head"><div><h1>Phiếu lương</h1><p>Phiếu lương xuất hiện khi quản lý chốt bảng lương hằng tháng.</p></div>${eyeBtn()}</div>
      <div class="card" style="margin-bottom:1rem"><div class="card-h"><h3>Tạm tính ${esc(periodLabel(d.period))}</h3><button class="btn sm" id="seeEst">Xem chi tiết</button></div>
        <div class="grid g3" style="gap:0"><div class="stat"><b class="num">${hoursDec(d.estimate.minutes)}</b><span>giờ</span></div><div class="stat"><b>${mv(d.estimate.gross)}</b><span>tổng thu nhập</span></div><div class="stat hl"><b>${mv(d.estimate.net)}</b><span>thực nhận dự kiến</span></div></div></div>
      <div class="card"><div class="card-h"><h3>Đã chốt</h3></div>
        ${d.slips.length ? `<ul class="list">${d.slips.map(s => `<li class="li" style="cursor:pointer" data-slip="${esc(s.period)}"><div class="day"><b class="num">${s.period.slice(5, 7)}</b><small>${s.period.slice(0, 4)}</small></div>
          <div class="body"><b>${esc(periodLabel(s.period).replace(/^./, c => c.toUpperCase()))}</b><p>${hoursDec(s.minutes)} giờ · ${s.shifts} ca</p></div>
          <div class="right"><span class="hrs">${mv(s.net)}</span>${s.status === 'paid' ? '<span class="chip ok">Đã trả</span>' : '<span class="chip open">Đã chốt</span>'}</div></li>`).join('')}</ul>` : '<div class="empty"><i class="fa-solid fa-money-check-dollar"></i>Chưa có phiếu lương nào được chốt.</div>'}
      </div>`;
    $('seeEst').onclick = () => { modal('Tạm tính ' + periodLabel(d.period), slipHtml({ ...d.estimate, status: 'draft', name: d.me.name }, d.me.name) + '<p class="muted" style="font-size:.78rem;margin-top:.8rem">Số liệu tạm tính theo các ca đã hợp lệ tới thời điểm này, có thể thay đổi khi quản lý duyệt thêm hoặc chốt lương.</p>', [{ label: 'Đóng' }], { noFocus: true }); applyMoneyPref(); };
    $('view-phieu-luong').querySelectorAll('[data-slip]').forEach(li => li.onclick = () => {
      const s = d.slips.find(x => x.period === li.dataset.slip);
      modal('Phiếu lương', slipHtml(s, d.me.name), [{ label: '<i class="fa-solid fa-print"></i> In / Lưu PDF', run: async () => { document.body.classList.remove('money-hide'); window.print(); applyMoneyPref(); return true; } }, { label: 'Đóng', cls: 'primary' }], { noFocus: true });
      applyMoneyPref();
    });
  }

  function rProfile() {
    const p = S.d.profile;
    $('view-ho-so').innerHTML = `
      <div class="page-head"><div><h1>Hồ sơ &amp; ngân hàng</h1><p>Mức lương do quản lý thiết lập. Bạn cập nhật tài khoản nhận lương tại đây.</p></div>${eyeBtn()}</div>
      <div class="grid g2">
        <div class="card"><div class="card-h"><h3>Thông tin lương</h3></div><div class="card-b slip">
          ${p.configured ? `<dl>
            <dt>Vị trí</dt><dd>${esc(p.position || '—')}</dd>
            <dt>Hình thức</dt><dd>${p.payType === 'monthly' ? 'Lương tháng' : 'Theo giờ'}</dd>
            ${p.payType === 'monthly' ? `<dt>Lương tháng</dt><dd>${mv(p.monthlySalary)}</dd><dt>Ngày công chuẩn</dt><dd>${p.standardDays} ngày</dd>` : `<dt>Lương / giờ</dt><dd>${mv(p.hourlyRate)}</dd>`}
            ${p.allowance ? `<dt>Phụ cấp / tháng</dt><dd>${mv(p.allowance)}</dd>` : ''}
            <dt>Khấu trừ thuế 10%</dt><dd>${p.withholdTax ? 'Có (khi từ 2 triệu/lần)' : 'Không'}</dd>
          </dl>` : '<p class="muted">Quản lý chưa thiết lập mức lương cho bạn. Giờ làm vẫn được ghi nhận đầy đủ để tính sau.</p>'}
        </div></div>
        <div class="card"><div class="card-h"><h3>Tài khoản nhận lương</h3></div><div class="card-b">
          <div class="field"><label for="bkName">Ngân hàng</label><input id="bkName" value="${esc(p.bankName)}" placeholder="VD: Vietcombank"></div>
          <div class="field"><label for="bkAcc">Số tài khoản</label><input id="bkAcc" inputmode="numeric" value="${esc(p.bankAccount)}"></div>
          <div class="field"><label for="bkHolder">Chủ tài khoản</label><input id="bkHolder" value="${esc(p.bankHolder)}" placeholder="NGUYEN VAN A" style="text-transform:uppercase"></div>
          <div class="field"><label for="bkPhone">Số điện thoại</label><input id="bkPhone" type="tel" value="${esc(p.phone)}"></div>
          <button class="btn primary" id="bkSave" style="width:100%">Lưu thông tin</button>
        </div></div>
      </div>`;
    $('bkSave').onclick = async e => {
      const btn = e.currentTarget; busy(btn, true);
      try { await post('/api/staff-me', { action: 'updateBank', bankName: val('bkName'), bankAccount: val('bkAcc'), bankHolder: val('bkHolder'), phone: val('bkPhone') }); toast('Đã lưu thông tin ngân hàng.'); await refreshMe(); }
      catch (err) { toast(err.message, true); busy(btn, false); }
    };
  }

  // =====================================================================
  //                               QUẢN LÝ
  // =====================================================================
  const nameOf = email => { const s = S.m.staff.find(x => x.email === email); return s ? s.name : email; };
  const whoHtml = (email, sub) => `<div class="who"><span class="av">${esc(initials(nameOf(email)))}</span><div><b>${esc(nameOf(email))}</b>${sub ? `<small>${sub}</small>` : ''}</div></div>`;

  function rToday() {
    const m = S.m, today = m.today;
    const open = m.entries.filter(e => e.status === 'open');
    const working = open.filter(e => e.date >= today || (Date.now() - new Date(e.clockIn)) < 16 * 3600e3);
    const forgot = open.filter(e => !working.includes(e));
    const todayDone = m.entries.filter(e => e.date === today && ['ok', 'pending'].includes(e.status));
    const minsBy = {}; todayDone.forEach(e => { minsBy[e.email] = (minsBy[e.email] || 0) + e.minutes; });
    const active = new Set([...open.map(e => e.email), ...todayDone.map(e => e.email)]);
    const absent = m.staff.filter(s => !active.has(s.email) && !s.inactive && s.profile.inPayroll !== false);
    const onLeave = m.leaves.filter(l => l.status === 'approved' && l.dateFrom <= today && l.dateTo >= today);
    $('view-hom-nay').innerHTML = `
      <div class="page-head"><div><h1>Hôm nay</h1><p>${esc(WDL[dow(today)])}, ${dmy(today)} · cập nhật lúc ${timeOf(new Date().toISOString())}</p></div><button class="btn" id="tdRefresh"><i class="fa-solid fa-rotate"></i> Làm mới</button></div>
      <div class="grid g4">
        <div class="card stat hl"><b class="num">${working.length}</b><span>đang trong ca</span></div>
        <div class="card stat"><b class="num">${Object.keys(minsBy).length}</b><span>đã hoàn thành ca</span></div>
        <div class="card stat"><b class="num" style="color:${forgot.length ? 'var(--red)' : 'inherit'}">${forgot.length}</b><span>quên chấm ra</span></div>
        <div class="card stat"><b class="num">${pendingCount()}</b><span>chờ duyệt</span></div>
      </div>
      ${forgot.length ? `<div class="card"><div class="card-h"><h3 style="color:var(--red)"><i class="fa-solid fa-clock-rotate-left"></i> Quên chấm ra</h3><small>Ca từ hôm trước chưa kết thúc</small></div><ul class="list">${forgot.map(e => `<li class="li">${whoHtml(e.email, `${WDL[dow(e.date)]} ${dmy(e.date)} · vào ${timeOf(e.clockIn)}`)}<div class="right" style="margin-left:auto"><button class="btn sm" data-close-open="${esc(e.email)}|${esc(e.id)}">Kết thúc ca hộ</button></div></li>`).join('')}</ul></div>` : ''}
      <div class="grid g2">
        <div class="card"><div class="card-h"><h3>Đang trong ca</h3></div>
          ${working.length ? `<ul class="list">${working.map(e => `<li class="li">${whoHtml(e.email, 'Vào lúc ' + timeOf(e.clockIn))}<div class="right" style="margin-left:auto"><span class="hrs num">${hm((Date.now() - new Date(e.clockIn)) / 60000)}</span><button class="btn sm" data-close-open="${esc(e.email)}|${esc(e.id)}">Kết thúc hộ</button></div></li>`).join('')}</ul>` : '<div class="empty"><i class="fa-solid fa-mug-hot"></i>Chưa ai đang trong ca.</div>'}
        </div>
        <div class="card"><div class="card-h"><h3>Đã làm hôm nay</h3></div>
          ${Object.keys(minsBy).length ? `<ul class="list">${Object.entries(minsBy).map(([em, mi]) => `<li class="li">${whoHtml(em)}<div class="right" style="margin-left:auto"><span class="hrs num">${hm(mi)}</span></div></li>`).join('')}</ul>` : '<div class="empty">Chưa có ca nào hoàn thành.</div>'}
        </div>
      </div>
      <div class="card"><div class="card-h"><h3>Chưa chấm công hôm nay</h3><small>${absent.length} người</small></div><div class="card-b" style="display:flex;flex-wrap:wrap;gap:.5rem">
        ${absent.length ? absent.map(s => { const lv = onLeave.find(l => l.email === s.email); return `<span class="chip ${lv ? 'violet' : 'muted'}" style="font-size:.8rem;padding:.3rem .7rem">${esc(s.name)}${lv ? ' · ' + esc(lv.kindLabel.split(' (')[0].toLowerCase()) : ''}</span>`; }).join('') : '<span class="muted">Mọi người đều đã chấm công.</span>'}
      </div></div>`;
    $('tdRefresh').onclick = () => refreshMgr();
    $('view-hom-nay').querySelectorAll('[data-close-open]').forEach(b => b.onclick = () => closeOpenModal(...b.dataset.closeOpen.split('|')));
  }

  function closeOpenModal(email, id) {
    const e = S.m.entries.find(x => x.id === id && x.email === email);
    modal('Kết thúc ca hộ ' + nameOf(email), `<p style="margin-bottom:1rem">Vào ca ${WDL[dow(e.date)].toLowerCase()} ${dmy(e.date)} lúc <b>${timeOf(e.clockIn)}</b>.</p>
      <div class="row2"><div class="field"><label for="coEnd">Giờ ra</label><input type="time" id="coEnd" value="${e.date === S.m.today ? timeOf(new Date().toISOString()) : '17:00'}"></div><div class="field"><label for="coBrk">Nghỉ giữa ca (phút)</label><input type="number" id="coBrk" min="0" max="600" step="5" value="0"></div></div>`,
      [{ label: 'Huỷ' }, { label: 'Kết thúc ca', cls: 'primary', run: async () => { await post('/api/portal-payroll', { action: 'closeOpen', email, id, end: val('coEnd'), breakMinutes: Number(val('coBrk')) || 0 }); toast('Đã kết thúc ca.'); await refreshMgr(); } }]);
  }

  function rApprovals() {
    const m = S.m;
    const pend = m.entries.filter(e => e.status === 'pending').sort((a, b) => a.date.localeCompare(b.date));
    const leaves = m.leaves.filter(l => l.status === 'pending').sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
    const origOf = e => e.replacesId ? m.entries.find(x => x.id === e.replacesId && x.email === e.email) : null;
    $('view-duyet').innerHTML = `
      <div class="page-head"><div><h1>Chờ duyệt</h1><p>Nhân viên nhận thông báo trên màn hình ngay sau khi bạn duyệt hoặc từ chối.</p></div></div>
      <div class="card"><div class="card-h"><h3>Chấm công</h3><small>${pend.length} yêu cầu</small></div>
        ${pend.length ? `<ul class="list">${pend.map(e => { const o = origOf(e); return `<li class="li" style="align-items:flex-start;flex-wrap:wrap">
          <div style="min-width:200px">${whoHtml(e.email, `${WDL[dow(e.date)]} ${dmy(e.date)}`)}</div>
          <div class="body"><b>${esc(FLAG[e.flag] || 'Chấm công')}</b> · <span class="num">${timeOf(e.clockIn)} – ${timeOf(e.clockOut)}</span>${e.breakMinutes ? ` · nghỉ ${e.breakMinutes}p` : ''} · <b>${hm(e.minutes)}</b>
            ${o ? `<p>Bản cũ: <s>${timeOf(o.clockIn)} – ${timeOf(o.clockOut)} (${hm(o.minutes)})</s></p>` : e.replacesId ? '<p>Sửa một ca ở kỳ khác</p>' : ''}
            ${e.note ? `<p>“${esc(e.note)}”</p>` : ''}</div>
          <div class="acts" style="margin-left:auto"><button class="btn sm good" data-ok="${esc(e.email)}|${esc(e.id)}"><i class="fa-solid fa-check"></i> Duyệt</button><button class="btn sm danger" data-no="${esc(e.email)}|${esc(e.id)}">Từ chối</button></div></li>`; }).join('')}</ul>` : '<div class="empty"><i class="fa-solid fa-circle-check" style="color:var(--green)"></i>Không có yêu cầu chấm công nào.</div>'}
      </div>
      <div class="card"><div class="card-h"><h3>Đơn xin nghỉ</h3><small>${leaves.length} đơn</small></div>
        ${leaves.length ? `<ul class="list">${leaves.map(l => `<li class="li" style="align-items:flex-start;flex-wrap:wrap">
          <div style="min-width:200px">${whoHtml(l.email, esc(l.kindLabel))}</div>
          <div class="body"><b class="num">${l.dateFrom === l.dateTo ? dmy(l.dateFrom) + (l.halfDay ? ' (nửa ngày)' : '') : dmy(l.dateFrom) + ' – ' + dmy(l.dateTo)}</b> · ${String(l.days).replace('.', ',')} ngày${l.reason ? `<p>“${esc(l.reason)}”</p>` : ''}</div>
          <div class="acts" style="margin-left:auto"><button class="btn sm good" data-lok="${esc(l.email)}|${esc(l.id)}"><i class="fa-solid fa-check"></i> Duyệt</button><button class="btn sm danger" data-lno="${esc(l.email)}|${esc(l.id)}">Từ chối</button></div></li>`).join('')}</ul>` : '<div class="empty"><i class="fa-solid fa-circle-check" style="color:var(--green)"></i>Không có đơn xin nghỉ nào.</div>'}
      </div>`;
    const decide = (kind, key, approve) => {
      const [email, id] = key.split('|');
      const action = kind === 'e' ? 'reviewEntry' : 'reviewLeave';
      const run = async note => { await post('/api/portal-payroll', { action, email, id, decision: approve ? 'approve' : 'reject', reviewNote: note || '' }); toast(approve ? 'Đã duyệt.' : 'Đã từ chối.'); await refreshMgr(); };
      if (approve) return run('').catch(e => toast(e.message, true));
      modal('Từ chối yêu cầu', `<div class="field"><label for="rjNote">Lý do (nhân viên sẽ thấy)</label><textarea id="rjNote" rows="3" maxlength="300"></textarea></div>`, [{ label: 'Huỷ' }, { label: 'Từ chối', cls: 'danger', run: () => run(val('rjNote')) }]);
    };
    const v = $('view-duyet');
    v.querySelectorAll('[data-ok]').forEach(b => b.onclick = () => decide('e', b.dataset.ok, true));
    v.querySelectorAll('[data-no]').forEach(b => b.onclick = () => decide('e', b.dataset.no, false));
    v.querySelectorAll('[data-lok]').forEach(b => b.onclick = () => decide('l', b.dataset.lok, true));
    v.querySelectorAll('[data-lno]').forEach(b => b.onclick = () => decide('l', b.dataset.lno, false));
  }

  let sheetFilter = { email: '', status: '' };
  function rStaffSheet() {
    const m = S.m, locked = m.periodStatus.status !== 'open';
    let rows = m.entries.filter(e => e.date.slice(0, 7) === m.period && e.status !== 'replaced');
    if (sheetFilter.email) rows = rows.filter(e => e.email === sheetFilter.email);
    if (sheetFilter.status) rows = rows.filter(e => e.status === sheetFilter.status);
    const total = rows.filter(e => e.status === 'ok').reduce((s, e) => s + e.minutes, 0);
    $('view-cong-nhan-vien').innerHTML = `
      <div class="page-head"><div><h1>Bảng công nhân viên</h1><p>Ca do quản lý nhập hoặc sửa được tính ngay, không cần duyệt.</p></div>
        <div class="toolbar"><input type="month" id="mgMonth" value="${m.period}" max="${m.today.slice(0, 7)}" aria-label="Chọn tháng">
          <select id="mgStaff" aria-label="Lọc nhân viên"><option value="">Tất cả nhân viên</option>${m.staff.map(s => `<option value="${esc(s.email)}" ${sheetFilter.email === s.email ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
          <select id="mgStatus" aria-label="Lọc trạng thái"><option value="">Mọi trạng thái</option>${['ok', 'pending', 'open', 'rejected'].map(k => `<option value="${k}" ${sheetFilter.status === k ? 'selected' : ''}>${STATUS[k][1]}</option>`).join('')}</select>
          <button class="btn" id="mgExport"><i class="fa-solid fa-file-excel"></i> Xuất Excel</button>
          <button class="btn primary" id="mgAdd" ${locked ? 'disabled title="Kỳ đã chốt"' : ''}><i class="fa-solid fa-plus"></i> Thêm ca</button></div></div>
      ${locked ? `<div class="warn amber"><i class="fa-solid fa-lock"></i><div><b>Kỳ lương ${periodLabel(m.period)} đã chốt.</b>Mở lại kỳ ở mục Bảng lương nếu cần sửa công.</div></div>` : ''}
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Ngày</th><th>Nhân viên</th><th>Vào</th><th>Ra</th><th class="r">Nghỉ</th><th class="r">Giờ</th><th>Trạng thái</th><th class="hide-m">Ghi chú</th><th></th></tr></thead>
        <tbody>${rows.map(e => `<tr><td class="num">${WD[dow(e.date)]} ${dm(e.date)}</td><td>${esc(nameOf(e.email))}</td><td class="num">${timeOf(e.clockIn)}</td><td class="num">${e.status === 'open' ? '—' : timeOf(e.clockOut)}</td><td class="r num">${e.breakMinutes ? e.breakMinutes + 'p' : ''}</td><td class="r num"><b>${e.status === 'open' ? '…' : hm(e.minutes)}</b></td><td>${chip(e.status)}</td><td class="hide-m muted" style="max-width:280px">${esc([FLAG[e.flag] || '', e.note].filter(Boolean).join(' · '))}${e.placeIn || e.placeOut ? `<div style="font-size:.74rem"><i class="fa-solid fa-location-dot"></i> ${esc([e.placeIn, e.placeOut && e.placeOut !== e.placeIn ? 'ra: ' + e.placeOut : ''].filter(Boolean).join(' · '))}</div>` : ''}</td>
          <td style="white-space:nowrap">${!locked && e.status !== 'open' ? `<button class="btn sm" data-me="${esc(e.email)}|${esc(e.id)}" aria-label="Sửa"><i class="fa-regular fa-pen-to-square"></i></button> <button class="btn sm danger" data-md="${esc(e.email)}|${esc(e.id)}" aria-label="Xoá"><i class="fa-regular fa-trash-can"></i></button>` : ''}${e.status === 'open' ? `<button class="btn sm" data-close-open="${esc(e.email)}|${esc(e.id)}">Kết thúc</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="9" class="empty">Không có ca nào.</td></tr>`}</tbody>
        ${rows.length ? `<tfoot><tr><td colspan="5">Tổng giờ hợp lệ</td><td class="r num">${hoursDec(total)} giờ</td><td colspan="3"></td></tr></tfoot>` : ''}
      </table></div></div>`;
    $('mgMonth').onchange = async e => { if (!e.target.value) return; await loadMgr(e.target.value); rStaffSheet(); };
    $('mgStaff').onchange = e => { sheetFilter.email = e.target.value; rStaffSheet(); };
    $('mgStatus').onchange = e => { sheetFilter.status = e.target.value; rStaffSheet(); };
    $('mgAdd').onclick = () => mgrEntryModal(null);
    $('mgExport').onclick = async () => {
      try {
        const label = { ok: 'Hợp lệ', pending: 'Chờ duyệt', rejected: 'Từ chối', open: 'Đang trong ca' };
        const name = await window.WVNExcel.download({
          filename: `bang-cong-${m.period}`, sheetName: 'Bảng công', title: `Bảng công nhân viên ${periodLabel(m.period)}`,
          subtitle: sheetFilter.email ? nameOf(sheetFilter.email) : 'Tất cả nhân viên',
          columns: [
            { label: 'Ngày', get: r => r.date, type: 'date' },
            { label: 'Nhân viên', get: r => nameOf(r.email), type: 'text' },
            { label: 'Email', get: r => r.email, type: 'text' },
            { label: 'Giờ vào', get: r => timeOf(r.clockIn), type: 'text' },
            { label: 'Giờ ra', get: r => r.status === 'open' ? '' : timeOf(r.clockOut), type: 'text' },
            { label: 'Nghỉ (phút)', get: r => r.breakMinutes || 0, type: 'number' },
            { label: 'Giờ công', get: r => r.status === 'open' ? '' : (r.minutes / 60).toFixed(2), type: 'number' },
            { label: 'Trạng thái', get: r => label[r.status] || r.status, type: 'text' },
            { label: 'Ghi chú', get: r => [FLAG[r.flag] || '', r.note].filter(Boolean).join(' · '), type: 'text', wrap: true }
          ],
          rows: rows.slice().sort((a, b) => a.date.localeCompare(b.date) || nameOf(a.email).localeCompare(nameOf(b.email), 'vi'))
        });
        toast(`Đã tải ${name}.`);
      } catch (e) { toast(e.message, true); }
    };
    const v = $('view-cong-nhan-vien');
    v.querySelectorAll('[data-me]').forEach(b => b.onclick = () => { const [em, id] = b.dataset.me.split('|'); mgrEntryModal(m.entries.find(x => x.id === id && x.email === em)); });
    v.querySelectorAll('[data-md]').forEach(b => b.onclick = async () => {
      const [email, id] = b.dataset.md.split('|'); if (!confirm('Xoá ca làm này? Không thể hoàn tác.')) return;
      try { await post('/api/portal-payroll', { action: 'deleteEntry', email, id }); toast('Đã xoá ca.'); await refreshMgr(); } catch (e) { toast(e.message, true); }
    });
    v.querySelectorAll('[data-close-open]').forEach(b => b.onclick = () => closeOpenModal(...b.dataset.closeOpen.split('|')));
  }

  function mgrEntryModal(e) {
    const m = S.m;
    const defDate = m.period === m.today.slice(0, 7) ? m.today : m.period + '-01';
    modal(e ? 'Sửa ca làm' : 'Thêm ca làm', `
      <div class="field"><label for="meWho">Nhân viên</label><select id="meWho" ${e ? 'disabled' : ''}>${m.staff.map(s => `<option value="${esc(s.email)}" ${(e ? e.email : sheetFilter.email) === s.email ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="meDate">Ngày</label><input type="date" id="meDate" value="${esc(e ? e.date : defDate)}" max="${m.today}"></div>
      <div class="row3"><div class="field"><label for="meStart">Giờ vào</label><input type="time" id="meStart" value="${esc(e ? timeOf(e.clockIn) : '08:00')}"></div><div class="field"><label for="meEnd">Giờ ra</label><input type="time" id="meEnd" value="${esc(e ? timeOf(e.clockOut) : '17:00')}"></div><div class="field"><label for="meBrk">Nghỉ (phút)</label><input type="number" id="meBrk" min="0" max="600" step="5" value="${e ? e.breakMinutes : 0}"></div></div>
      <div class="field"><label for="meNote">Ghi chú</label><input id="meNote" maxlength="300" value="${esc(e ? e.note : '')}"></div>`,
      [{ label: 'Huỷ' }, { label: 'Lưu', cls: 'primary', run: async () => {
        await post('/api/portal-payroll', { action: 'saveEntry', email: e ? e.email : val('meWho'), id: e ? e.id : '', date: val('meDate'), start: val('meStart'), end: val('meEnd'), breakMinutes: Number(val('meBrk')) || 0, note: val('meNote') });
        toast(e ? 'Đã cập nhật ca.' : 'Đã thêm ca.'); await refreshMgr();
      } }]);
  }

  function rPayroll() {
    const m = S.m, st = m.periodStatus.status, locked = st !== 'open';
    const rows = m.payroll.filter(r => r.inPayroll !== false && (r.profileConfigured || r.minutes > 0 || (r.adjustments || []).length || r.locked));
    const others = m.payroll.filter(r => !rows.includes(r));
    const missingRate = rows.filter(r => !r.profileConfigured && !r.locked && r.minutes > 0);
    const pendIn = m.entries.filter(e => e.status === 'pending' && e.date.slice(0, 7) === m.period).length;
    const sum = k => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
    const badge = { open: ['var(--sapphire-soft)', 'var(--sapphire)', 'Đang mở · tạm tính'], finalized: ['var(--green-soft)', 'var(--green)', 'Đã chốt'], paid: ['var(--gold-soft)', 'var(--gold)', 'Đã trả lương'] }[st];
    $('view-bang-luong').innerHTML = `
      <div class="page-head"><div><h1>Bảng lương ${esc(periodLabel(m.period))}</h1><p>${locked ? `Chốt bởi ${esc(m.periodStatus.finalizedBy || '')}${m.periodStatus.finalizedAt ? ' lúc ' + new Date(m.periodStatus.finalizedAt).toLocaleString('vi-VN', { timeZone: TZ }) : ''}` : 'Số liệu cập nhật trực tiếp theo bảng công đã hợp lệ.'}</p></div>
        <div class="toolbar"><input type="month" id="plMonth" value="${m.period}" max="${m.today.slice(0, 7)}" aria-label="Chọn tháng"><span class="period-badge" style="background:${badge[0]};color:${badge[1]}">${badge[2]}</span>${eyeBtn()}</div></div>
      ${pendIn && !locked ? `<div class="warn amber"><i class="fa-solid fa-inbox"></i><div style="flex:1"><b>Còn ${pendIn} yêu cầu chấm công chờ duyệt trong kỳ.</b>Các ca này chưa được tính vào bảng lương. <a href="#duyet" style="color:inherit;font-weight:700">Duyệt ngay</a></div></div>` : ''}
      ${missingRate.length ? `<div class="warn amber"><i class="fa-solid fa-user-gear"></i><div style="flex:1"><b>${missingRate.length} người có công nhưng chưa có mức lương:</b> ${missingRate.map(r => esc(r.name)).join(', ')}. <a href="#nhan-su" style="color:inherit;font-weight:700">Thiết lập hồ sơ lương</a></div></div>` : ''}
      <div class="grid g4">
        <div class="card stat"><b class="num">${rows.length}</b><span>người trong bảng lương</span></div>
        <div class="card stat"><b class="num">${hoursDec(sum('minutes'))}</b><span>tổng giờ công</span></div>
        <div class="card stat"><b>${mv(sum('gross'))}</b><span>tổng thu nhập</span></div>
        <div class="card stat hl"><b>${mv(sum('net'))}</b><span>tổng thực chi</span></div>
      </div>
      <div class="card"><div class="card-h"><h3>Chi tiết</h3><div class="toolbar">
          <button class="btn" id="plCsv"><i class="fa-solid fa-file-arrow-down"></i> Xuất Excel</button>
          ${st === 'open' ? `<button class="btn primary" id="plFinal"><i class="fa-solid fa-lock"></i> Chốt lương</button>` : ''}
          ${st === 'finalized' ? `<button class="btn good" id="plPaidAll"><i class="fa-solid fa-check-double"></i> Đã trả tất cả</button>` : ''}
          ${locked ? `<button class="btn danger" id="plReopen"><i class="fa-solid fa-lock-open"></i> Mở lại</button>` : ''}
        </div></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Nhân viên</th><th>Hình thức</th><th class="r">Công</th><th class="r">Lương chính</th><th class="r">Phụ cấp + thưởng</th><th class="r">Khấu trừ</th><th class="r">Thực nhận</th><th>Trạng thái</th></tr></thead>
          <tbody>${rows.map(r => `<tr class="click" data-pr="${esc(r.email)}"><td>${whoHtml(r.email, r.profileConfigured || r.locked ? '' : '<span style="color:var(--amber)">Chưa có mức lương</span>')}</td>
            <td>${!r.profileConfigured && !r.locked ? '—' : r.payType === 'monthly' ? 'Tháng' : `Giờ · ${money(r.hourlyRate)}`}</td>
            <td class="r num">${hoursDec(r.minutes)}g<br><small class="muted">${r.shifts} ca${r.unpaidLeaveDays ? ` · KL ${String(r.unpaidLeaveDays).replace('.', ',')}n` : ''}</small></td>
            <td class="r">${mv(r.base)}</td><td class="r">${mv((r.allowance || 0) + (r.bonus || 0))}</td>
            <td class="r">${r.tax + r.deduction + r.advance ? '−' + mv(r.tax + r.deduction + r.advance) : '—'}</td>
            <td class="r"><b>${mv(r.net)}</b></td>
            <td>${r.status === 'paid' ? '<span class="chip ok">Đã trả</span>' : r.status === 'finalized' ? '<span class="chip open">Đã chốt</span>' : r.pendingCount ? `<span class="chip pending">${r.pendingCount} chờ duyệt</span>` : '<span class="chip muted">Tạm tính</span>'}</td></tr>`).join('') || `<tr><td colspan="8" class="empty">Chưa có ai trong bảng lương kỳ này.</td></tr>`}</tbody>
          ${rows.length ? `<tfoot><tr><td colspan="2">Tổng</td><td class="r num">${hoursDec(sum('minutes'))}g</td><td class="r">${mv(sum('base'))}</td><td class="r">${mv(sum('allowance') + sum('bonus'))}</td><td class="r">−${mv(sum('tax') + sum('deduction') + sum('advance'))}</td><td class="r">${mv(sum('net'))}</td><td></td></tr></tfoot>` : ''}
        </table></div>
        ${others.length ? `<div class="card-b muted" style="border-top:1px solid var(--line-2);font-size:.82rem">${others.length} nhân viên không có công và chưa có mức lương trong kỳ này nên không hiện ở đây.</div>` : ''}
      </div>`;
    applyMoneyPref();
    $('plMonth').onchange = async e => { if (!e.target.value) return; await loadMgr(e.target.value); rPayroll(); };
    $('plCsv').onclick = () => exportCsv(rows);
    $('view-bang-luong').querySelectorAll('[data-pr]').forEach(tr => tr.onclick = () => payDetail(tr.dataset.pr));
    if ($('plFinal')) $('plFinal').onclick = () => finalize(false);
    if ($('plReopen')) $('plReopen').onclick = async () => {
      if (!confirm(`Mở lại bảng lương ${periodLabel(m.period)}? Phiếu lương đã gửi sẽ bị thu hồi để tính lại; bạn cần chốt lại sau khi sửa.`)) return;
      try { await post('/api/portal-payroll', { action: 'reopen', period: m.period }); toast('Đã mở lại kỳ lương.'); await refreshMgr(); } catch (e) { toast(e.message, true); }
    };
    if ($('plPaidAll')) $('plPaidAll').onclick = async () => {
      if (!confirm('Đánh dấu đã chuyển lương cho TẤT CẢ nhân viên trong kỳ? Mỗi người sẽ nhận email báo.')) return;
      try { const r = await post('/api/portal-payroll', { action: 'markPaid', period: m.period }); toast(`Đã đánh dấu ${r.count} người đã nhận lương.`); await refreshMgr(); } catch (e) { toast(e.message, true); }
    };
  }

  async function finalize(force) {
    const m = S.m;
    if (!force && !confirm(`Chốt bảng lương ${periodLabel(m.period)}?\n\n• Bảng công của kỳ sẽ bị khoá, không ai sửa được nữa.\n• Mỗi nhân viên nhận email phiếu lương.\n• Có thể mở lại nếu phát hiện sai sót.`)) return;
    try {
      const r = await post('/api/portal-payroll', { action: 'finalize', period: m.period, force });
      toast(`Đã chốt lương cho ${r.count} người, gửi ${r.sent} phiếu lương qua email.`); await refreshMgr();
    } catch (e) {
      if (e.data && e.data.needsForce) { if (confirm(e.message + '\n\nVẫn chốt lương?')) return finalize(true); return; }
      toast(e.message, true);
    }
  }

  function payDetail(email) {
    const m = S.m, r = m.payroll.find(x => x.email === email), locked = m.periodStatus.status !== 'open';
    const adjs = locked ? (r.adjustments || []) : m.adjustments.filter(a => a.email === email);
    const prof = (m.staff.find(s => s.email === email) || {}).profile || {};
    modal(nameOf(email), `
      ${slipHtml({ ...r, name: nameOf(email) }, nameOf(email))}
      <div style="margin-top:1rem;font-size:.84rem" class="muted">Tài khoản nhận lương: ${prof.bankAccount ? `<b style="color:var(--ink)">${esc(prof.bankName)} · ${esc(prof.bankAccount)} · ${esc(prof.bankHolder)}</b>` : '<span style="color:var(--amber)">nhân viên chưa cập nhật</span>'}</div>
      <h4 style="margin:1.2rem 0 .5rem;font-size:.9rem">Thưởng / khấu trừ / tạm ứng</h4>
      ${adjs.length ? `<ul class="list" style="border:1px solid var(--line-2);border-radius:10px">${adjs.map(a => `<li class="li"><div class="body"><b>${esc(ADJ[a.kind] || a.kind)}</b><p>${esc(a.note)}</p></div><div class="right"><span class="hrs">${a.kind === 'bonus' ? '' : '−'}${mv(a.amount)}</span>${!locked ? `<button class="btn sm danger" data-adel="${esc(a.id)}">Xoá</button>` : ''}</div></li>`).join('')}</ul>` : '<p class="muted" style="font-size:.85rem">Chưa có khoản nào.</p>'}
      ${!locked ? `<div class="row3" style="margin-top:.9rem;align-items:end"><div class="field"><label for="adKind">Loại</label><select id="adKind">${Object.entries(ADJ).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div><div class="field"><label for="adAmt">Số tiền</label><input id="adAmt" type="number" min="1000" step="1000" placeholder="500000"></div><div class="field"><button class="btn" id="adAdd" style="width:100%"><i class="fa-solid fa-plus"></i> Thêm</button></div></div>
        <div class="field"><label for="adNote">Nội dung (hiện trên phiếu lương)</label><input id="adNote" maxlength="200" placeholder="VD: Thưởng dạy thay lớp 3A"></div>` : ''}`,
      [...(m.periodStatus.status === 'finalized' && r.status !== 'paid' ? [{ label: '<i class="fa-solid fa-check"></i> Đã trả người này', cls: 'good', run: async () => { await post('/api/portal-payroll', { action: 'markPaid', period: m.period, email }); toast('Đã đánh dấu đã trả lương.'); await refreshMgr(); } }] : []),
        { label: '<i class="fa-solid fa-print"></i> In phiếu', run: async () => { document.body.classList.remove('money-hide'); window.print(); applyMoneyPref(); return true; } }, { label: 'Đóng', cls: 'primary' }], { wide: true, noFocus: true });
    applyMoneyPref();
    if ($('adAdd')) $('adAdd').onclick = async e => {
      const btn = e.currentTarget; busy(btn, true);
      try { await post('/api/portal-payroll', { action: 'addAdjustment', period: m.period, email, kind: val('adKind'), amount: Number(val('adAmt')), note: val('adNote') }); toast('Đã thêm khoản.'); await loadMgr(m.period); rPayroll(); payDetail(email); }
      catch (err) { toast(err.message, true); busy(btn, false); }
    };
    $('modalBody').querySelectorAll('[data-adel]').forEach(b => b.onclick = async () => {
      if (!confirm('Xoá khoản này?')) return;
      try { await post('/api/portal-payroll', { action: 'deleteAdjustment', period: m.period, id: b.dataset.adel }); await loadMgr(m.period); rPayroll(); payDetail(email); } catch (e) { toast(e.message, true); }
    });
  }

  function exportCsv(rows) {
    const m = S.m;
    const H = ['Nhân viên', 'Email', 'Hình thức', 'Lương/giờ', 'Lương tháng', 'Số ca', 'Ngày công', 'Giờ công', 'Nghỉ không lương (ngày)', 'Lương chính', 'Phụ cấp', 'Thưởng', 'Tổng thu nhập', 'Thuế TNCN', 'Khấu trừ', 'Tạm ứng', 'Thực nhận', 'Ngân hàng', 'Số tài khoản', 'Chủ tài khoản', 'Trạng thái'];
    const q = v => { const s = String(v == null ? '' : v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [H.join(',')].concat(rows.map(r => {
      const p = (m.staff.find(s => s.email === r.email) || {}).profile || {};
      return [r.name, r.email, r.payType === 'monthly' ? 'Tháng' : 'Theo giờ', r.hourlyRate || '', r.monthlySalary || '', r.shifts, r.workDays, (r.minutes / 60).toFixed(2), r.unpaidLeaveDays || 0, r.base, r.allowance, r.bonus, r.gross, r.tax, r.deduction, r.advance, r.net, p.bankName || '', p.bankAccount ? '="' + p.bankAccount + '"' : '', p.bankHolder || '', r.status === 'paid' ? 'Đã trả' : r.status === 'finalized' ? 'Đã chốt' : 'Tạm tính'].map(q).join(',');
    }));
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `bang-luong-${m.period}.csv`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function rProfiles() {
    const m = S.m;
    $('view-nhan-su').innerHTML = `
      <div class="page-head"><div><h1>Hồ sơ lương</h1><p>Nhân viên là các tài khoản đăng nhập quản trị. Thêm người mới ở Trang quản trị → Tài khoản quản trị.</p></div>${eyeBtn()}</div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Nhân viên</th><th>Vị trí</th><th>Hình thức</th><th class="r">Mức lương</th><th class="r">Phụ cấp</th><th>Thuế 10%</th><th>Ngân hàng</th><th></th></tr></thead>
        <tbody>${m.staff.map(s => { const p = s.profile; return `<tr class="click" data-pf="${esc(s.email)}"><td>${whoHtml(s.email, esc(s.email) + (s.inactive ? ' · <span style="color:var(--red)">đã nghỉ</span>' : ''))}</td>
          <td>${esc(p.position || '—')}</td>
          <td>${p.configured ? (p.payType === 'monthly' ? 'Lương tháng' : 'Theo giờ') : '<span class="chip pending">Chưa thiết lập</span>'}${p.configured && !p.inPayroll ? ' <span class="chip muted">Không tính lương</span>' : ''}${p.remoteAllowed ? ' <span class="chip violet">Chấm từ xa</span>' : ''}</td>
          <td class="r">${p.configured ? (p.payType === 'monthly' ? mv(p.monthlySalary) : mv(p.hourlyRate) + '<small class="muted">/giờ</small>') : '—'}</td>
          <td class="r">${p.allowance ? mv(p.allowance) : '—'}</td><td>${p.withholdTax ? 'Có' : '—'}</td>
          <td>${p.bankAccount ? '<i class="fa-solid fa-circle-check" style="color:var(--green)"></i> ' + esc(p.bankName || '') : '<span class="muted">Chưa có</span>'}</td>
          <td><button class="btn sm">Sửa</button></td></tr>`; }).join('')}</tbody>
      </table></div></div>`;
    applyMoneyPref();
    $('view-nhan-su').querySelectorAll('[data-pf]').forEach(tr => tr.onclick = () => profileModal(tr.dataset.pf));
  }

  function profileModal(email) {
    const s = S.m.staff.find(x => x.email === email), p = s.profile;
    modal('Hồ sơ lương · ' + s.name, `
      <div class="field"><label>Hình thức trả lương</label><div class="seg" id="pfType"><button type="button" data-t="hourly" aria-pressed="${p.payType !== 'monthly'}">Theo giờ</button><button type="button" data-t="monthly" aria-pressed="${p.payType === 'monthly'}">Lương tháng</button></div></div>
      <div id="pfHourly" class="field" ${p.payType === 'monthly' ? 'hidden' : ''}><label for="pfRate">Lương theo giờ (đ)</label><input id="pfRate" type="number" min="0" step="1000" value="${p.hourlyRate || ''}" placeholder="VD: 60000"><small>Lương = tổng giờ hợp lệ trong tháng × mức này.</small></div>
      <div id="pfMonthly" ${p.payType !== 'monthly' ? 'hidden' : ''}><div class="row2"><div class="field"><label for="pfSalary">Lương tháng (đ)</label><input id="pfSalary" type="number" min="0" step="100000" value="${p.monthlySalary || ''}"></div><div class="field"><label for="pfDays">Ngày công chuẩn</label><input id="pfDays" type="number" min="1" max="31" value="${p.standardDays || 26}"><small>Dùng để trừ lương ngày nghỉ không lương.</small></div></div></div>
      <div class="row2"><div class="field"><label for="pfAllow">Phụ cấp cố định / tháng (đ)</label><input id="pfAllow" type="number" min="0" step="10000" value="${p.allowance || ''}"></div><div class="field"><label for="pfPos">Vị trí</label><input id="pfPos" maxlength="80" value="${esc(p.position)}" placeholder="VD: Giáo viên Luyện chữ"></div></div>
      <label style="display:flex;gap:.55rem;align-items:flex-start;font-size:.86rem;margin-bottom:.6rem"><input type="checkbox" id="pfTax" ${p.withholdTax ? 'checked' : ''} style="margin-top:.2rem"><span>Khấu trừ thuế TNCN 10% khi tổng thu nhập trong kỳ từ 2.000.000đ <small class="muted" style="display:block">Thường áp dụng cho cộng tác viên, lao động thời vụ hoặc hợp đồng dưới 3 tháng. Vui lòng đối chiếu quy định hiện hành hoặc hỏi kế toán.</small></span></label>
      <label style="display:flex;gap:.55rem;align-items:center;font-size:.86rem;margin-bottom:1rem"><input type="checkbox" id="pfIn" ${p.inPayroll !== false ? 'checked' : ''}> Có tính lương (bỏ chọn với tình nguyện viên / người không hưởng lương)</label>
      <label style="display:flex;gap:.55rem;align-items:flex-start;font-size:.86rem;margin-bottom:1rem"><input type="checkbox" id="pfRemote" ${p.remoteAllowed ? 'checked' : ''} style="margin-top:.2rem"><span>Được chấm công ở bất kỳ đâu <small class="muted" style="display:block">Bỏ qua Quy định chấm công (Wi-Fi / vị trí) — dùng cho giáo viên dạy online, người đi công tác.</small></span></label>
      <h4 style="font-size:.88rem;margin-bottom:.6rem">Tài khoản nhận lương <small class="muted" style="font-weight:400">· nhân viên cũng tự cập nhật được</small></h4>
      <div class="row2"><div class="field"><label for="pfBank">Ngân hàng</label><input id="pfBank" value="${esc(p.bankName)}"></div><div class="field"><label for="pfAcc">Số tài khoản</label><input id="pfAcc" value="${esc(p.bankAccount)}"></div></div>
      <div class="row2"><div class="field"><label for="pfHolder">Chủ tài khoản</label><input id="pfHolder" value="${esc(p.bankHolder)}" style="text-transform:uppercase"></div><div class="field"><label for="pfPhone">Điện thoại</label><input id="pfPhone" value="${esc(p.phone)}"></div></div>
      ${p.updatedBy ? `<p class="muted" style="font-size:.75rem">Cập nhật lần cuối bởi ${esc(p.updatedBy)}${p.updatedAt ? ' · ' + new Date(p.updatedAt).toLocaleString('vi-VN', { timeZone: TZ }) : ''}</p>` : ''}`,
      [{ label: 'Huỷ' }, { label: 'Lưu hồ sơ', cls: 'primary', run: async () => {
        const type = $('pfType').querySelector('[aria-pressed="true"]').dataset.t;
        await post('/api/portal-payroll', { action: 'saveProfile', email, payType: type, hourlyRate: Number(val('pfRate')) || 0, monthlySalary: Number(val('pfSalary')) || 0, standardDays: Number(val('pfDays')) || 26, allowance: Number(val('pfAllow')) || 0, position: val('pfPos'), withholdTax: $('pfTax').checked, inPayroll: $('pfIn').checked, remoteAllowed: $('pfRemote').checked, bankName: val('pfBank'), bankAccount: val('pfAcc'), bankHolder: val('pfHolder'), phone: val('pfPhone') });
        toast('Đã lưu hồ sơ lương.'); await refreshMgr();
      } }], { noFocus: true });
    $('pfType').addEventListener('click', e => {
      const b = e.target.closest('[data-t]'); if (!b) return;
      $('pfType').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
      $('pfHourly').hidden = b.dataset.t !== 'hourly'; $('pfMonthly').hidden = b.dataset.t !== 'monthly';
    });
  }

  // =================== Quy định nơi chấm công (quản lý) ===================
  let draft = null;
  function parseCoords(text) {
    const t = String(text || '');
    const m = t.match(/@(-?\d+\.\d+),\s*(-?\d+\.\d+)/) || t.match(/[?&]q=(-?\d+\.\d+),\s*(-?\d+\.\d+)/) || t.match(/(-?\d{1,2}\.\d{3,})\s*[,;\s]\s*(-?\d{1,3}\.\d{3,})/);
    return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
  }
  function distM(a, b) { const R = 6371000, r = x => x * Math.PI / 180; const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2; return Math.round(2 * R * Math.asin(Math.sqrt(h))); }

  function rPolicy() {
    const m = S.m;
    if (!draft) draft = JSON.parse(JSON.stringify(m.clockSettings || { enabled: false, applyToClockOut: false, networks: [], locations: [] }));
    const remote = m.staff.filter(x => x.profile.remoteAllowed);
    const ipKnown = draft.networks.some(n => n.ip === m.myIp);
    $('view-quy-dinh').innerHTML = `
      <div class="page-head"><div><h1>Quy định chấm công</h1><p>Giới hạn nơi nhân viên được bấm Vào ca: dùng Wi-Fi của trung tâm <b>hoặc</b> đang ở gần địa điểm làm việc.</p></div></div>
      <div class="card"><div class="card-b" style="display:flex;flex-wrap:wrap;gap:1rem 2rem;align-items:center;justify-content:space-between">
        <label class="switch"><input type="checkbox" id="pcOn" ${draft.enabled ? 'checked' : ''}> ${draft.enabled ? 'Đang giới hạn nơi chấm công' : 'Đang cho chấm công ở bất kỳ đâu'}</label>
        <label style="display:flex;gap:.5rem;align-items:center;font-size:.86rem"><input type="checkbox" id="pcOut" ${draft.applyToClockOut ? 'checked' : ''}> Áp dụng cả khi bấm Kết thúc ca</label>
      </div>${m.clockSettings && m.clockSettings.updatedBy ? `<div class="card-b muted" style="border-top:1px solid var(--line-2);font-size:.78rem">Cập nhật lần cuối bởi ${esc(m.clockSettings.updatedBy)}${m.clockSettings.updatedAt ? ' · ' + new Date(m.clockSettings.updatedAt).toLocaleString('vi-VN', { timeZone: TZ }) : ''}</div>` : ''}</div>

      <div class="grid g2">
        <div class="card"><div class="card-h"><h3><i class="fa-solid fa-wifi" style="color:var(--sapphire)"></i> Mạng Wi-Fi của trung tâm</h3></div><div class="card-b">
          <p class="muted" style="font-size:.82rem;margin-bottom:.8rem">Trình duyệt không đọc được tên Wi-Fi, nên hệ thống nhận ra mạng trung tâm qua <b>địa chỉ IP internet</b> của nó. Cách dễ nhất: <b>đứng ở trung tâm, kết nối Wi-Fi, bấm nút bên dưới</b>. Mỗi cơ sở / mỗi nhà mạng thêm 1 dòng.</p>
          ${draft.networks.length ? `<div class="rule-head"><span>Tên gợi nhớ</span><span>Địa chỉ IP</span><span></span></div>` : ''}
          <div id="pcNets">${draft.networks.map((n, i) => `<div class="rule-row"><input data-n="${i}" data-f="name" value="${esc(n.name)}" aria-label="Tên mạng"><input data-n="${i}" data-f="ip" value="${esc(n.ip)}" aria-label="Địa chỉ IP" class="num"><button class="btn sm danger" data-ndel="${i}" aria-label="Xoá"><i class="fa-regular fa-trash-can"></i></button></div>`).join('') || '<p class="muted" style="font-size:.85rem">Chưa khai báo mạng nào.</p>'}</div>
          <div class="toolbar" style="margin-top:.8rem">
            <button class="btn primary" id="pcNetMine" ${!m.myIp || ipKnown ? 'disabled' : ''}><i class="fa-solid fa-plus"></i> ${ipKnown ? 'Mạng bạn đang dùng đã có trong danh sách' : 'Thêm mạng tôi đang dùng'}</button>
            <button class="btn" id="pcNetAdd"><i class="fa-solid fa-keyboard"></i> Nhập tay</button>
          </div>
          <p class="muted" style="font-size:.75rem;margin-top:.6rem">IP hiện tại của bạn: <b class="num">${esc(m.myIp || 'không xác định')}</b>. Nếu trung tâm dùng mạng có IP thay đổi, hãy nhờ kỹ thuật đăng ký IP tĩnh, hoặc dùng thêm cách định vị bên cạnh. Nhập được dải (VD <span class="num">113.160.5.0/24</span>).</p>
        </div></div>

        <div class="card"><div class="card-h"><h3><i class="fa-solid fa-location-dot" style="color:var(--red)"></i> Địa điểm làm việc</h3></div><div class="card-b">
          <p class="muted" style="font-size:.82rem;margin-bottom:.8rem">Nhân viên không dùng Wi-Fi trung tâm sẽ được hỏi quyền định vị khi bấm chấm công, và chỉ chấm được khi ở trong bán kính.</p>
          ${draft.locations.length ? `<div class="rule-head loc"><span>Tên địa điểm</span><span>Vĩ độ</span><span>Kinh độ</span><span>Bán kính</span><span></span></div>` : ''}
          <div id="pcLocs">${draft.locations.map((l, i) => `<div class="rule-row loc"><input data-l="${i}" data-f="name" value="${esc(l.name)}" aria-label="Tên địa điểm"><input data-l="${i}" data-f="lat" value="${l.lat}" class="num" aria-label="Vĩ độ" title="Vĩ độ"><input data-l="${i}" data-f="lng" value="${l.lng}" class="num" aria-label="Kinh độ" title="Kinh độ">
            <select data-l="${i}" data-f="radius" aria-label="Bán kính">${[100, 150, 200, 300, 500, 1000].map(r => `<option value="${r}" ${Number(l.radius) === r ? 'selected' : ''}>${r} m</option>`).join('')}${[100, 150, 200, 300, 500, 1000].includes(Number(l.radius)) ? '' : `<option value="${l.radius}" selected>${l.radius} m</option>`}</select>
            <span style="display:flex;gap:.3rem"><a class="btn sm" href="https://www.google.com/maps?q=${l.lat},${l.lng}" target="_blank" rel="noopener" aria-label="Xem trên bản đồ"><i class="fa-solid fa-map-location-dot"></i></a><button class="btn sm danger" data-ldel="${i}" aria-label="Xoá"><i class="fa-regular fa-trash-can"></i></button></span></div>`).join('') || '<p class="muted" style="font-size:.85rem">Chưa khai báo địa điểm nào.</p>'}</div>
          <div class="toolbar" style="margin-top:.8rem">
            <button class="btn primary" id="pcLocMine"><i class="fa-solid fa-location-crosshairs"></i> Thêm vị trí tôi đang đứng</button>
            <button class="btn" id="pcLocPaste"><i class="fa-regular fa-clipboard"></i> Dán link Google Maps / toạ độ</button>
          </div>
          <p class="muted" style="font-size:.75rem;margin-top:.6rem">Nên để bán kính từ 150–300 m: định vị trong nhà thường lệch 30–100 m.</p>
        </div></div>
      </div>

      <div class="card"><div class="card-h"><h3>Ngoại lệ</h3><button class="btn sm" data-view="nhan-su">Mở Hồ sơ lương</button></div><div class="card-b" style="font-size:.86rem">
        ${remote.length ? `Được chấm công ở bất kỳ đâu: ${remote.map(x => `<span class="chip violet" style="font-size:.78rem">${esc(x.name)}</span>`).join(' ')}` : '<span class="muted">Chưa có ai được miễn. Bật "Được chấm công ở bất kỳ đâu" trong Hồ sơ lương cho giáo viên dạy online hoặc người đi công tác.</span>'}
        <p class="muted" style="font-size:.78rem;margin-top:.6rem">Nhân viên bị chặn vẫn gửi được "Bổ sung công" để bạn duyệt. Nơi chấm công của từng ca hiện ở cột Ghi chú trong Bảng công nhân viên.</p>
      </div></div>

      <div class="card"><div class="card-b" style="display:flex;gap:.6rem;flex-wrap:wrap;justify-content:space-between;align-items:center">
        <button class="btn" id="pcTest"><i class="fa-solid fa-vial"></i> Thử kiểm tra trên máy này</button>
        <div class="toolbar"><button class="btn" id="pcReset">Huỷ thay đổi</button><button class="btn primary" id="pcSave"><i class="fa-solid fa-floppy-disk"></i> Lưu quy định</button></div>
      </div><div id="pcTestOut"></div></div>`;

    const v = $('view-quy-dinh');
    const rerender = () => rPolicy();
    $('pcOn').onchange = e => { draft.enabled = e.target.checked; rerender(); };
    $('pcOut').onchange = e => { draft.applyToClockOut = e.target.checked; };
    v.querySelectorAll('[data-n]').forEach(inp => inp.oninput = () => { draft.networks[inp.dataset.n][inp.dataset.f] = inp.value.trim(); });
    v.querySelectorAll('[data-l]').forEach(inp => inp.oninput = inp.onchange = () => { const f = inp.dataset.f; draft.locations[inp.dataset.l][f] = f === 'name' ? inp.value : Number(inp.value); });
    v.querySelectorAll('[data-ndel]').forEach(b => b.onclick = () => { draft.networks.splice(Number(b.dataset.ndel), 1); rerender(); });
    v.querySelectorAll('[data-ldel]').forEach(b => b.onclick = () => { draft.locations.splice(Number(b.dataset.ldel), 1); rerender(); });
    $('pcNetMine').onclick = () => { draft.networks.push({ name: 'Wi-Fi trung tâm ' + (draft.networks.length + 1), ip: m.myIp }); rerender(); };
    $('pcNetAdd').onclick = () => { draft.networks.push({ name: 'Mạng trung tâm ' + (draft.networks.length + 1), ip: '' }); rerender(); const last = v.querySelectorAll('[data-f="ip"]'); if (last.length) last[last.length - 1].focus(); };
    $('pcLocMine').onclick = async e => {
      const btn = e.currentTarget; busy(btn, true, 'Đang lấy vị trí…');
      try { const g = await getGeo(); draft.locations.push({ name: 'Địa điểm ' + (draft.locations.length + 1), lat: Number(g.lat.toFixed(6)), lng: Number(g.lng.toFixed(6)), radius: g.accuracy > 150 ? 300 : 200 }); rerender(); toast(`Đã thêm vị trí (sai số khoảng ${g.accuracy} m). Nhớ đặt tên và bấm Lưu.`); }
      catch (err) { toast(err.message, true); busy(btn, false); }
    };
    $('pcLocPaste').onclick = () => modal('Thêm địa điểm', `
      <div class="field"><label for="plName">Tên địa điểm</label><input id="plName" placeholder="VD: Cơ sở Cầu Giấy"></div>
      <div class="field"><label for="plTxt">Link Google Maps hoặc toạ độ</label><textarea id="plTxt" rows="3" placeholder="https://maps.google.com/...@21.0333,105.7990,17z  hoặc  21.0333, 105.7990"></textarea><small>Trên Google Maps: bấm giữ vào đúng vị trí → sao chép toạ độ hiện ra.</small></div>
      <div class="field"><label for="plR">Bán kính</label><select id="plR">${[100, 150, 200, 300, 500, 1000].map(r => `<option value="${r}" ${r === 200 ? 'selected' : ''}>${r} m</option>`).join('')}</select></div>`,
      [{ label: 'Huỷ' }, { label: 'Thêm', cls: 'primary', run: async () => {
        const c = parseCoords(val('plTxt'));
        if (!c) throw new Error('Không đọc được toạ độ. Dán dạng "21.0333, 105.7990" hoặc link Google Maps có chứa @vĩ-độ,kinh-độ.');
        draft.locations.push({ name: val('plName') || 'Địa điểm ' + (draft.locations.length + 1), lat: c.lat, lng: c.lng, radius: Number(val('plR')) || 200 }); rerender();
      } }]);
    $('pcReset').onclick = () => { draft = null; rerender(); };
    $('pcSave').onclick = async e => {
      const btn = e.currentTarget; busy(btn, true);
      try {
        const r = await post('/api/portal-payroll', { action: 'saveClockSettings', settings: draft });
        S.m.clockSettings = r.clockSettings; draft = null; toast(r.clockSettings.enabled ? 'Đã lưu. Quy định có hiệu lực ngay với lần chấm công tiếp theo.' : 'Đã lưu. Nhân viên chấm công ở bất kỳ đâu.'); rerender();
        loadMe(S.period).catch(() => {});
      } catch (err) { toast(err.message, true); busy(btn, false); }
    };
    $('pcTest').onclick = async e => {
      const btn = e.currentTarget, out = $('pcTestOut'); busy(btn, true, 'Đang kiểm tra…');
      const lines = [];
      const net = draft.networks.find(n => n.ip && n.ip === m.myIp);
      lines.push(net ? `<i class="fa-solid fa-circle-check" style="color:var(--green)"></i> Máy này đang dùng mạng <b>${esc(net.name)}</b> → chấm công được.` : `<i class="fa-solid fa-circle-minus muted"></i> Máy này không dùng mạng trung tâm đã khai báo (IP ${esc(m.myIp || '?')}).`);
      if (draft.locations.length) {
        try {
          const g = await getGeo();
          const best = draft.locations.map(l => ({ l, d: distM(g, l) })).sort((a, b) => (a.d - a.l.radius) - (b.d - b.l.radius))[0];
          const ok = best.d <= best.l.radius + Math.min(g.accuracy, 150);
          lines.push(`<i class="fa-solid ${ok ? 'fa-circle-check' : 'fa-circle-xmark'}" style="color:${ok ? 'var(--green)' : 'var(--red)'}"></i> Cách <b>${esc(best.l.name)}</b> khoảng ${best.d} m (bán kính ${best.l.radius} m, sai số định vị ${g.accuracy} m) → ${ok ? 'trong khu vực' : 'ngoài khu vực'}.`);
        } catch (err) { lines.push(`<i class="fa-solid fa-triangle-exclamation" style="color:var(--amber)"></i> ${esc(err.message)}`); }
      }
      out.innerHTML = `<div class="card-b" style="border-top:1px solid var(--line-2)"><div class="test-box">${lines.join('<br>')}<br><span class="muted" style="font-size:.76rem">Kiểm tra theo bản đang soạn (kể cả khi chưa lưu).</span></div></div>`;
      busy(btn, false);
    };
  }

  // ---------- Khởi động ----------
  (async function boot() {
    try {
      await loadMe();
      $('boot').remove();
      go(location.hash.slice(1) || 'cham-cong', true);
      // Quay lại tab sau một lúc -> làm mới để giờ và trạng thái luôn đúng
      let hiddenAt = 0;
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) { hiddenAt = Date.now(); return; }
        if (Date.now() - hiddenAt > 60e3) { (MGR_VIEWS.includes(S.view) ? loadMgr(S.mPeriod) : loadMe(S.period)).then(render).catch(() => {}); }
      });
    } catch (e) {
      $('boot').innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${esc(e.message)}`;
    }
  })();
})();
