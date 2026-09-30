/*
 * Chuông thông báo cho nhân viên — dùng chung trên Trang Quản Trị, CRM và Công Việc.
 *
 *  - Hỏi /api/portal-alerts mỗi 60 giây (và ngay khi quay lại tab) để biết các đầu việc cần thao tác
 *    theo đúng quyền của người đang đăng nhập + việc được giao cho chính họ.
 *  - Có việc MỚI (hoặc số lượng tăng lên): hiện thẻ thông báo góc màn hình, rung chuông, phát âm báo nhẹ,
 *    nháy tiêu đề tab khi đang ở tab khác, và gửi thông báo của máy tính nếu nhân viên đã cho phép.
 *  - Việc "khẩn" (đã quá hạn, thiếu điểm, học phí báo sai…) chưa xử lý sẽ được nhắc lại sau 30 phút.
 *  - Thao tác lưu thành công ở bất kỳ màn hình nào -> tự làm mới để con số luôn khớp thực tế.
 *
 * Gắn vào trang: <script src="/admin-alerts.js?v=..." defer data-mobile-bottom="..."></script>
 */
(function () {
  'use strict';
  if (window.WVNAlerts) return;

  var SCRIPT = document.currentScript || {};
  var CFG = (SCRIPT.dataset) || {};
  var POLL_MS = 60 * 1000;
  var REMIND_URGENT_MS = 30 * 60 * 1000;
  var LS_SEEN = 'wvn_alerts_seen_v1';
  var LS_SOUND = 'wvn_alerts_sound';
  var TONES = { blue: '#2563eb', green: '#16a34a', gold: '#d97706', red: '#dc2626', violet: '#7c3aed' };
  var ICONS = {
    members: 'fa-user-clock', registrations: 'fa-file-signature', invoices: 'fa-receipt', gifts: 'fa-gift',
    tuition: 'fa-triangle-exclamation', crm: 'fa-phone', leave: 'fa-calendar-xmark', birthday: 'fa-cake-candles',
    points: 'fa-scale-unbalanced', 'task-overdue': 'fa-clock', 'task-new': 'fa-inbox', 'task-today': 'fa-list-check'
  };

  var state = { items: [], total: 0, timer: null, loading: false, lastAt: null, baseTitle: document.title, flashTimer: null, audio: null };

  // ---------- Tiện ích ----------
  function token() { try { return localStorage.getItem('wvn_admin_token') || ''; } catch (e) { return ''; } }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function readSeen() { try { return JSON.parse(localStorage.getItem(LS_SEEN) || '{}') || {}; } catch (e) { return {}; } }
  function writeSeen(s) { try { localStorage.setItem(LS_SEEN, JSON.stringify(s)); } catch (e) {} }
  function soundOn() { try { return localStorage.getItem(LS_SOUND) !== '0'; } catch (e) { return true; } }
  function reducedMotion() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function isNew(item, seen) {
    var s = seen[item.key];
    if (!s) return true;
    if (item.count > s.count) return true;
    return item.level === 'urgent' && Date.now() - (s.at || 0) > REMIND_URGENT_MS;
  }
  function markSeen(list) {
    var seen = readSeen();
    list.forEach(function (i) { seen[i.key] = { count: i.count, at: Date.now() }; });
    // Dọn các mục đã hết (đã xử lý xong) để lần sau xuất hiện lại sẽ được báo như việc mới
    var alive = {}; state.items.forEach(function (i) { alive[i.key] = 1; });
    Object.keys(seen).forEach(function (k) { if (!alive[k]) delete seen[k]; });
    writeSeen(seen);
    state.lastSig = null; // cho phép nhắc lại (vd. việc khẩn sau 30 phút)
  }

  // ---------- Giao diện ----------
  var css = '' +
    '.wa-bell{position:fixed;right:20px;bottom:calc(20px + env(safe-area-inset-bottom,0px));z-index:9000;width:52px;height:52px;border-radius:50%;border:none;cursor:pointer;display:grid;place-items:center;background:#fff;color:#1e3a8a;font-size:1.2rem;box-shadow:0 10px 28px -8px rgba(15,23,42,.35),0 0 0 1px rgba(15,23,42,.06);transition:transform .15s}' +
    '.wa-bell:hover{transform:translateY(-2px)}.wa-bell:focus-visible{outline:3px solid rgba(37,99,235,.45);outline-offset:3px}' +
    '.wa-bell.has{background:#1e3a8a;color:#fff}.wa-bell.urgent{background:#dc2626;color:#fff}' +
    '.wa-bell .wa-n{position:absolute;top:-3px;right:-3px;min-width:22px;height:22px;padding:0 6px;border-radius:11px;background:#dc2626;color:#fff;font-size:.72rem;font-weight:800;display:grid;place-items:center;border:2px solid #fff;font-family:inherit}' +
    '.wa-bell.urgent .wa-n{background:#111827}.wa-bell .wa-n[hidden]{display:none}' +
    '.wa-bell.ring::after{content:"";position:absolute;inset:-6px;border-radius:50%;border:3px solid currentColor;opacity:0;animation:waPulse 1.6s ease-out infinite}' +
    '.wa-bell.has.ring::after{border-color:#60a5fa}.wa-bell.urgent.ring::after{border-color:#f87171}' +
    '.wa-bell.ring i{animation:waShake 2.4s ease-in-out infinite;transform-origin:50% 10%}' +
    '@keyframes waPulse{0%{transform:scale(.9);opacity:.8}100%{transform:scale(1.45);opacity:0}}' +
    '@keyframes waShake{0%,70%,100%{transform:rotate(0)}74%{transform:rotate(16deg)}78%{transform:rotate(-14deg)}82%{transform:rotate(10deg)}86%{transform:rotate(-6deg)}90%{transform:rotate(0)}}' +
    '.wa-panel{position:fixed;right:20px;bottom:calc(84px + env(safe-area-inset-bottom,0px));z-index:9001;width:min(380px,calc(100vw - 24px));max-height:min(70vh,560px);display:flex;flex-direction:column;background:#fff;border-radius:16px;box-shadow:0 24px 60px -16px rgba(15,23,42,.45),0 0 0 1px rgba(15,23,42,.06);overflow:hidden;opacity:0;transform:translateY(8px);pointer-events:none;transition:opacity .16s,transform .16s}' +
    '.wa-panel.open{opacity:1;transform:none;pointer-events:auto}' +
    '.wa-head{display:flex;align-items:center;justify-content:space-between;gap:.6rem;padding:.9rem 1rem .7rem;border-bottom:1px solid #eef1f6}' +
    '.wa-head b{font-size:.98rem;color:#0f172a}.wa-head small{display:block;font-size:.74rem;color:#64748b;font-weight:500}' +
    '.wa-x{background:none;border:none;width:32px;height:32px;border-radius:8px;cursor:pointer;color:#64748b;font-size:1rem}.wa-x:hover{background:#f1f5f9}' +
    '.wa-list{overflow-y:auto;padding:.35rem 0}' +
    '.wa-item{display:flex;gap:.75rem;align-items:flex-start;padding:.7rem 1rem;text-decoration:none;color:inherit;border-left:3px solid transparent}' +
    '.wa-item:hover,.wa-item:focus-visible{background:#f8fafc;outline:none}.wa-item.new{border-left-color:var(--t)}' +
    '.wa-ic{flex:0 0 34px;height:34px;border-radius:10px;display:grid;place-items:center;background:color-mix(in srgb,var(--t) 12%,#fff);color:var(--t);font-size:.9rem}' +
    '.wa-tx{flex:1;min-width:0}.wa-tx b{display:block;font-size:.88rem;color:#0f172a;line-height:1.35}.wa-tx span{display:block;font-size:.78rem;color:#64748b;line-height:1.4;margin-top:.1rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.wa-go{align-self:center;font-size:.76rem;font-weight:700;color:var(--t);white-space:nowrap}' +
    '.wa-empty{padding:1.6rem 1rem;text-align:center;color:#15803d;font-size:.9rem}.wa-empty i{display:block;font-size:1.5rem;margin-bottom:.4rem}' +
    '.wa-foot{display:flex;flex-wrap:wrap;gap:.4rem;padding:.6rem .8rem;border-top:1px solid #eef1f6;background:#fafbfd}' +
    '.wa-foot button{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:.35rem .6rem;font-size:.74rem;font-weight:600;color:#334155;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:.35rem}' +
    '.wa-foot button:hover{background:#f1f5f9}' +
    '.wa-toasts{position:fixed;top:calc(16px + env(safe-area-inset-top,0px));right:16px;z-index:9002;display:flex;flex-direction:column;gap:.6rem;width:min(380px,calc(100vw - 24px));pointer-events:none}' +
    '.wa-toast{pointer-events:auto;background:#fff;border-radius:14px;box-shadow:0 20px 50px -14px rgba(15,23,42,.5),0 0 0 1px rgba(15,23,42,.06);overflow:hidden;animation:waIn .28s cubic-bezier(.2,.9,.3,1.2)}' +
    '.wa-toast .wa-bar{height:4px;background:var(--t)}' +
    '.wa-toast .wa-body{display:flex;gap:.75rem;padding:.85rem .95rem .6rem}' +
    '.wa-toast .wa-tx b{font-size:.92rem}.wa-toast .wa-tx span{white-space:normal}' +
    '.wa-toast .wa-sub{font-size:.72rem;font-weight:700;color:var(--t);margin-bottom:.15rem}' +
    '.wa-toast ul{margin:.35rem 0 0;padding:0;list-style:none}.wa-toast li{font-size:.82rem;color:#334155;padding:.12rem 0}.wa-toast li::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--t);margin-right:.45rem;vertical-align:middle}' +
    '.wa-toast .wa-acts{display:flex;gap:.45rem;padding:0 .95rem .85rem 3.55rem}' +
    '.wa-toast .wa-acts a,.wa-toast .wa-acts button{font-size:.8rem;font-weight:700;border-radius:8px;padding:.42rem .8rem;cursor:pointer;font-family:inherit;text-decoration:none}' +
    '.wa-toast .wa-acts a{background:var(--t);color:#fff;border:1px solid var(--t)}' +
    '.wa-toast .wa-acts button{background:#fff;color:#475569;border:1px solid #e2e8f0}' +
    '@keyframes waIn{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:none}}' +
    '@media (max-width:640px){.wa-bell{bottom:calc(' + (CFG.mobileBottom || '16px') + ' + env(safe-area-inset-bottom,0px));right:14px;width:48px;height:48px}' +
    '.wa-panel{right:12px;left:12px;width:auto;bottom:calc(' + (CFG.mobileBottom || '16px') + ' + 60px + env(safe-area-inset-bottom,0px))}.wa-toasts{left:12px;right:12px;width:auto}}' +
    '@media (prefers-reduced-motion:reduce){.wa-bell.ring::after,.wa-bell.ring i,.wa-toast{animation:none}}' +
    '@media print{.wa-bell,.wa-panel,.wa-toasts{display:none!important}}';

  var bell, badge, panel, list, toasts, sub;
  function build() {
    var st = document.createElement('style'); st.id = 'wvn-alerts-style'; st.textContent = css; document.head.appendChild(st);
    bell = document.createElement('button');
    bell.type = 'button'; bell.className = 'wa-bell'; bell.setAttribute('aria-haspopup', 'dialog'); bell.setAttribute('aria-expanded', 'false');
    bell.setAttribute('aria-label', 'Thông báo việc cần xử lý');
    bell.innerHTML = '<i class="fa-solid fa-bell" aria-hidden="true"></i><span class="wa-n" hidden></span>';
    badge = bell.querySelector('.wa-n');
    panel = document.createElement('div'); panel.className = 'wa-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Việc cần xử lý');
    panel.innerHTML = '<div class="wa-head"><div><b>Việc cần xử lý</b><small id="waSub">Đang tải…</small></div><button type="button" class="wa-x" aria-label="Đóng"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div><div class="wa-list"></div><div class="wa-foot"></div>';
    list = panel.querySelector('.wa-list'); sub = panel.querySelector('#waSub');
    toasts = document.createElement('div'); toasts.className = 'wa-toasts'; toasts.setAttribute('aria-live', 'polite');
    document.body.appendChild(toasts); document.body.appendChild(panel); document.body.appendChild(bell);

    bell.addEventListener('click', function () { togglePanel(); });
    panel.querySelector('.wa-x').addEventListener('click', function () { togglePanel(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && panel.classList.contains('open')) { togglePanel(false); bell.focus(); } });
    document.addEventListener('click', function (e) { if (panel.classList.contains('open') && !panel.contains(e.target) && !bell.contains(e.target)) togglePanel(false); });
    // Trình duyệt chỉ cho phát âm thanh sau khi người dùng đã chạm/bấm vào trang ít nhất 1 lần
    ['pointerdown', 'keydown'].forEach(function (ev) { document.addEventListener(ev, unlockAudio, { once: true, capture: true }); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { stopFlash(); refresh(); } });
    window.addEventListener('focus', stopFlash);
  }

  function togglePanel(force) {
    var open = typeof force === 'boolean' ? force : !panel.classList.contains('open');
    panel.classList.toggle('open', open);
    bell.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      renderPanel();
      markSeen(state.items); clearToasts(); updateBell();
      var first = panel.querySelector('.wa-item, .wa-foot button'); if (first) first.focus();
    }
  }

  function itemHtml(i, fresh) {
    var t = TONES[i.tone] || TONES.blue;
    return '<a class="wa-item' + (fresh ? ' new' : '') + '" style="--t:' + t + '" href="' + esc(i.href) + '" data-key="' + esc(i.key) + '">' +
      '<span class="wa-ic"><i class="fa-solid ' + (ICONS[i.key] || 'fa-circle-exclamation') + '" aria-hidden="true"></i></span>' +
      '<span class="wa-tx"><b>' + esc(i.title) + '</b>' + (i.hint ? '<span>' + esc(i.hint) + '</span>' : '') + '</span>' +
      '<span class="wa-go">Xử lý</span></a>';
  }

  function renderPanel() {
    var seen = readSeen();
    list.innerHTML = state.items.length
      ? state.items.map(function (i) { return itemHtml(i, isNew(i, seen)); }).join('')
      : '<div class="wa-empty"><i class="fa-solid fa-circle-check" aria-hidden="true"></i>Không còn việc nào cần xử lý. Làm tốt lắm!</div>';
    sub.textContent = state.lastAt ? 'Cập nhật lúc ' + state.lastAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' · tự làm mới mỗi phút' : 'Đang tải…';
    var foot = panel.querySelector('.wa-foot');
    var notifBtn = '';
    if ('Notification' in window) {
      if (Notification.permission === 'default') notifBtn = '<button type="button" data-wa="notif"><i class="fa-regular fa-bell" aria-hidden="true"></i> Báo cả khi đang ở tab khác</button>';
      else if (Notification.permission === 'granted') notifBtn = '<button type="button" disabled style="cursor:default;color:#15803d"><i class="fa-solid fa-check" aria-hidden="true"></i> Đã bật báo trên máy</button>';
    }
    foot.innerHTML = '<button type="button" data-wa="sound"><i class="fa-solid ' + (soundOn() ? 'fa-volume-high' : 'fa-volume-xmark') + '" aria-hidden="true"></i> Âm báo: ' + (soundOn() ? 'Bật' : 'Tắt') + '</button>' +
      notifBtn + '<button type="button" data-wa="refresh"><i class="fa-solid fa-rotate" aria-hidden="true"></i> Làm mới</button>';
    foot.querySelectorAll('button[data-wa]').forEach(function (b) {
      b.addEventListener('click', function () {
        var a = b.dataset.wa;
        if (a === 'sound') { try { localStorage.setItem(LS_SOUND, soundOn() ? '0' : '1'); } catch (e) {} if (soundOn()) chime('action'); renderPanel(); }
        if (a === 'notif') Notification.requestPermission().then(renderPanel);
        if (a === 'refresh') refresh(true);
      });
    });
  }

  function updateBell() {
    var seen = readSeen();
    var actionable = state.items.filter(function (i) { return i.level !== 'info'; });
    var unseen = actionable.filter(function (i) { return isNew(i, seen); });
    var urgent = actionable.some(function (i) { return i.level === 'urgent'; });
    badge.hidden = !state.total;
    badge.textContent = state.total > 99 ? '99+' : String(state.total);
    bell.classList.toggle('has', state.total > 0);
    bell.classList.toggle('urgent', urgent);
    bell.classList.toggle('ring', unseen.length > 0 && !reducedMotion());
    bell.setAttribute('aria-label', state.total ? state.total + ' việc cần xử lý — mở danh sách' : 'Không có việc cần xử lý');
    document.title = (state.total ? '(' + state.total + ') ' : '') + state.baseTitle;
  }

  // ---------- Thẻ thông báo nổi ----------
  function clearToasts() { toasts.innerHTML = ''; }
  function showToast(fresh) {
    clearToasts();
    var top = fresh[0];
    var t = TONES[top.tone] || TONES.blue;
    var anyUrgent = fresh.some(function (i) { return i.level === 'urgent'; });
    if (anyUrgent) t = TONES.red;
    var el = document.createElement('div'); el.className = 'wa-toast'; el.style.setProperty('--t', t); el.setAttribute('role', anyUrgent ? 'alert' : 'status');
    var body = fresh.length === 1
      ? '<div class="wa-sub">' + (top.level === 'urgent' ? 'Cần xử lý ngay' : 'Việc mới cần thao tác') + '</div><b>' + esc(top.title) + '</b>' + (top.hint ? '<span>' + esc(top.hint) + '</span>' : '')
      : '<div class="wa-sub">' + (anyUrgent ? 'Có việc cần xử lý ngay' : 'Có việc mới cần thao tác') + '</div><b>' + fresh.length + ' nhóm việc đang chờ bạn</b><ul>' +
        fresh.slice(0, 4).map(function (i) { return '<li>' + esc(i.title) + '</li>'; }).join('') + (fresh.length > 4 ? '<li>và ' + (fresh.length - 4) + ' nhóm khác…</li>' : '') + '</ul>';
    el.innerHTML = '<div class="wa-bar"></div><div class="wa-body"><span class="wa-ic" style="--t:' + t + '"><i class="fa-solid ' + (fresh.length === 1 ? (ICONS[top.key] || 'fa-bell') : 'fa-bell') + '" aria-hidden="true"></i></span><div class="wa-tx">' + body + '</div></div>' +
      '<div class="wa-acts">' + (fresh.length === 1 ? '<a href="' + esc(top.href) + '">Xử lý ngay</a>' : '<a href="#" data-open="1">Xem danh sách</a>') + '<button type="button">Để sau</button></div>';
    el.querySelector('.wa-acts button').addEventListener('click', function () { markSeen(fresh); el.remove(); updateBell(); });
    var open = el.querySelector('[data-open]');
    if (open) open.addEventListener('click', function (e) { e.preventDefault(); togglePanel(true); });
    else el.querySelector('.wa-acts a').addEventListener('click', function () { markSeen(fresh); });
    toasts.appendChild(el);
  }

  // ---------- Âm báo / nháy tab / thông báo máy tính ----------
  function unlockAudio() {
    try { var C = window.AudioContext || window.webkitAudioContext; if (C && !state.audio) state.audio = new C(); if (state.audio && state.audio.state === 'suspended') state.audio.resume(); } catch (e) {}
  }
  function chime(level) {
    if (!soundOn() || !state.audio || state.audio.state !== 'running') return;
    try {
      var ctx = state.audio, now = ctx.currentTime;
      var notes = level === 'urgent' ? [880, 660, 880] : [660, 880];
      notes.forEach(function (f, k) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        var t0 = now + k * 0.16;
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
        o.connect(g); g.connect(ctx.destination); o.start(t0); o.stop(t0 + 0.34);
      });
    } catch (e) {}
  }
  function startFlash(text) {
    stopFlash(); var on = false;
    state.flashTimer = setInterval(function () { on = !on; document.title = on ? '🔔 ' + text : (state.total ? '(' + state.total + ') ' : '') + state.baseTitle; }, 1200);
  }
  function stopFlash() { if (state.flashTimer) { clearInterval(state.flashTimer); state.flashTimer = null; updateBell(); } }
  function desktopNotify(fresh) {
    if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
    try {
      var top = fresh[0];
      var n = new Notification(fresh.length === 1 ? top.title : fresh.length + ' nhóm việc mới cần xử lý', {
        body: fresh.length === 1 ? (top.hint || 'Bấm để mở và xử lý') : fresh.slice(0, 3).map(function (i) { return '• ' + i.title; }).join('\n'),
        icon: '/images/favicon-32x32.png', tag: 'wvn-alerts', renotify: true
      });
      n.onclick = function () { window.focus(); if (fresh.length === 1) location.href = top.href; else togglePanel(true); n.close(); };
    } catch (e) {}
  }

  // ---------- Tải dữ liệu ----------
  function refresh(fresh) {
    var tk = token();
    if (!tk || state.loading) return;
    state.loading = true;
    fetch('/api/portal-alerts' + (fresh ? '?fresh=1' : ''), { headers: { 'X-Admin-Token': tk }, cache: 'no-store' })
      .then(function (r) { if (r.status === 401 || r.status === 403) return null; return r.json().catch(function () { return null; }); })
      .then(function (d) {
        if (!d || !d.success) return;
        if (!bell) build(); // chỉ hiện chuông khi đã đăng nhập hợp lệ (không hiện trên màn đăng nhập)
        state.items = d.items || []; state.total = d.total || 0; state.lastAt = new Date();
        var seen = readSeen();
        var fresh = state.items.filter(function (i) { return i.level !== 'info' && isNew(i, seen); });
        // Mục đã hết (đã xử lý xong) -> quên đi, để lần sau xuất hiện lại được báo như việc mới
        var alive = {}; state.items.forEach(function (i) { alive[i.key] = 1; });
        var changed = false; Object.keys(seen).forEach(function (k) { if (!alive[k]) { delete seen[k]; changed = true; } });
        if (changed) writeSeen(seen);
        updateBell();
        if (panel.classList.contains('open')) renderPanel();
        if (fresh.length && !panel.classList.contains('open')) {
          var sig = fresh.map(function (i) { return i.key + ':' + i.count; }).join('|');
          if (sig !== state.lastSig) {
            state.lastSig = sig;
            showToast(fresh);
            chime(fresh.some(function (i) { return i.level === 'urgent'; }) ? 'urgent' : 'action');
            if (document.hidden) { startFlash(fresh.length === 1 ? fresh[0].title : fresh.length + ' việc mới'); desktopNotify(fresh); }
          }
        }
      })
      .catch(function () { /* mạng chập chờn: thử lại ở lần hỏi sau */ })
      .then(function () { state.loading = false; });
  }

  // Lưu thành công ở bất kỳ màn hình nào (duyệt, xác nhận, cập nhật…) -> tự làm mới chuông sau 1,5 giây
  var origFetch = window.fetch, debounce = null;
  window.fetch = function (input, init) {
    var p = origFetch.apply(this, arguments);
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      if (method !== 'GET' && /\/api\/portal-(?!alerts)/.test(url)) {
        p.then(function (r) { if (r && r.ok) { clearTimeout(debounce); debounce = setTimeout(function () { refresh(true); }, 1500); } }).catch(function () {});
      }
    } catch (e) {}
    return p;
  };

  function start() {
    state.baseTitle = document.title;
    refresh();
    state.timer = setInterval(function () { refresh(); }, POLL_MS);
  }

  window.WVNAlerts = { refresh: refresh, open: function () { if (panel) togglePanel(true); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
