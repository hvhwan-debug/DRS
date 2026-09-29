/*
 * Tri thức Việt · Tiện ích thao tác cho Quản trị, CRM và Khu thành viên (đi cùng wvn-luxe.css)
 *
 * Chỉ GẮN THÊM, không sửa logic sẵn có của trang:
 *  - Bảng lệnh nhanh Ctrl/⌘ + K: gõ vài chữ (không cần dấu) để nhảy tới bất kỳ mục nào.
 *  - Quản trị: gom thanh bên thành nhóm, thu gọn thanh bên (nhớ lựa chọn), liên kết trực tiếp tới
 *    từng mục qua #ten-muc (tải lại trang vẫn ở đúng mục), thẻ số liệu ở Tổng quan bấm được để mở mục.
 *  - CRM: Ctrl/⌘ + K hoặc "/" để tìm học sinh, phím 1–4 đổi chế độ xem.
 *  - Nút lên đầu trang khi cuộn dài.
 */
(function () {
  'use strict';
  var body = document.body;
  if (!body) return;
  var PAGE = body.classList.contains('wvn-admin') ? 'admin' : body.classList.contains('wvn-crm') ? 'crm' : body.classList.contains('wvn-member') ? 'member' : '';
  if (!PAGE) return;

  var IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  var MOD = IS_MAC ? '⌘' : 'Ctrl';
  var norm = function (s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().trim(); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* bỏ qua */ } }
  };
  var isTyping = function (el) { return el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)); };
  var visible = function (el) { return el && el.style.display !== 'none' && !el.hidden && getComputedStyle(el).display !== 'none'; };
  var labelOf = function (el) { return (el.textContent || '').replace(/\s+/g, ' ').trim(); };
  var iconOf = function (el) { var i = el.querySelector('i'); return i ? i.className : 'fa-solid fa-arrow-right'; };

  // ====================== Bảng lệnh nhanh ======================
  var pal = null, palItems = [], palSel = 0, palReturn = null, palSource = null;
  function buildPalette() {
    var scrim = document.createElement('div');
    scrim.className = 'lx-pal-scrim';
    scrim.hidden = true;
    scrim.innerHTML =
      '<div class="lx-pal" role="dialog" aria-modal="true" aria-label="Đi tới nhanh">' +
        '<div class="lx-pal-top"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>' +
          '<input type="text" role="combobox" aria-expanded="true" aria-controls="lxPalList" aria-autocomplete="list" placeholder="Bạn muốn mở mục nào? Gõ vài chữ, không cần dấu…" autocomplete="off" spellcheck="false"></div>' +
        '<ul class="lx-pal-list" id="lxPalList" role="listbox"></ul>' +
        '<div class="lx-pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> chọn</span><span><kbd>Enter</kbd> mở</span><span><kbd>Esc</kbd> đóng</span><span style="margin-left:auto;"><kbd>' + MOD + '</kbd><kbd>K</kbd> mở lại bất cứ lúc nào</span></div>' +
      '</div>';
    document.body.appendChild(scrim);
    var input = scrim.querySelector('input'), list = scrim.querySelector('.lx-pal-list');
    scrim.addEventListener('mousedown', function (e) { if (e.target === scrim) closePalette(); });
    input.addEventListener('input', function () { palSel = 0; renderPalette(input.value); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); movePal(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); movePal(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); runPal(palSel); }
      else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
      else if (e.key === 'Tab') { e.preventDefault(); movePal(e.shiftKey ? -1 : 1); }
    });
    list.addEventListener('mousemove', function (e) {
      var li = e.target.closest('.lx-pal-item'); if (!li) return;
      var i = +li.dataset.i; if (i !== palSel) { palSel = i; markPal(); }
    });
    list.addEventListener('click', function (e) { var li = e.target.closest('.lx-pal-item'); if (li) runPal(+li.dataset.i); });
    return { scrim: scrim, input: input, list: list };
  }
  function renderPalette(q) {
    var all = palSource ? palSource() : [];
    var nq = norm(q), words = nq.split(/\s+/).filter(Boolean);
    palItems = !words.length ? all : all.filter(function (it) {
      var hay = norm(it.label + ' ' + (it.group || '') + ' ' + (it.keys || ''));
      return words.every(function (w) { return hay.indexOf(w) > -1; });
    }).sort(function (a, b) { return (norm(a.label).indexOf(nq) === 0 ? 0 : 1) - (norm(b.label).indexOf(nq) === 0 ? 0 : 1); });
    if (!palItems.length) { pal.list.innerHTML = '<li class="lx-pal-empty">Không có mục nào khớp "' + esc(q) + '". Thử gõ ngắn hơn, ví dụ "hoc phi".</li>'; return; }
    var html = '', lastGroup = null;
    palItems.forEach(function (it, i) {
      var g = words.length ? '' : (it.group || '');
      if (g !== lastGroup && g) html += '<li class="lx-pal-sec" role="presentation">' + esc(g) + '</li>';
      lastGroup = g;
      html += '<li class="lx-pal-item" role="option" id="lxPalOpt' + i + '" data-i="' + i + '" aria-selected="' + (i === palSel) + '"><i class="' + esc(it.icon) + '" aria-hidden="true"></i><span>' + esc(it.label) + '</span>' + (it.hint ? '<small>' + esc(it.hint) + '</small>' : '') + '</li>';
    });
    pal.list.innerHTML = html;
    markPal();
  }
  function markPal() {
    pal.list.querySelectorAll('.lx-pal-item').forEach(function (li) { li.setAttribute('aria-selected', +li.dataset.i === palSel); });
    var cur = pal.list.querySelector('[aria-selected="true"]');
    if (cur) { cur.scrollIntoView({ block: 'nearest' }); pal.input.setAttribute('aria-activedescendant', cur.id); }
  }
  function movePal(d) { if (!palItems.length) return; palSel = (palSel + d + palItems.length) % palItems.length; markPal(); }
  function runPal(i) { var it = palItems[i]; if (!it) return; closePalette(true); setTimeout(it.run, 10); }
  function openPalette() {
    if (!palSource) return;
    if (!pal) pal = buildPalette();
    palReturn = document.activeElement;
    pal.scrim.hidden = false; pal.input.value = ''; palSel = 0; renderPalette('');
    requestAnimationFrame(function () { pal.scrim.classList.add('open'); pal.input.focus(); });
  }
  function closePalette(keepFocus) {
    if (!pal || pal.scrim.hidden) return;
    pal.scrim.classList.remove('open'); pal.scrim.hidden = true;
    if (!keepFocus && palReturn && palReturn.focus) palReturn.focus();
  }
  var palOpen = function () { return pal && !pal.scrim.hidden; };

  // ====================== Nút lên đầu trang ======================
  (function () {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'lx-top'; b.setAttribute('aria-label', 'Lên đầu trang'); b.title = 'Lên đầu trang';
    b.innerHTML = '<i class="fa-solid fa-arrow-up" aria-hidden="true"></i>';
    b.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
    document.body.appendChild(b);
    var tick = false;
    window.addEventListener('scroll', function () {
      if (tick) return; tick = true;
      requestAnimationFrame(function () { b.classList.toggle('show', window.scrollY > 700); tick = false; });
    }, { passive: true });
  })();

  function sidebarHint(footer, onClick) {
    if (!footer) return;
    var h = document.createElement('button');
    h.type = 'button'; h.className = 'lx-kbd-hint';
    h.innerHTML = '<span><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>Tìm nhanh</span><span class="lx-kbd"><kbd>' + MOD + '</kbd><kbd>K</kbd></span>';
    h.addEventListener('click', onClick);
    footer.insertBefore(h, footer.firstChild);
  }
  function mobileSearchBtn(onClick) {
    var bar = document.querySelector('.mobile-topbar'), burger = bar && bar.querySelector('.hamburger-btn');
    if (!burger) return;
    var s = document.createElement('button');
    s.type = 'button'; s.className = 'lx-m-search'; s.setAttribute('aria-label', 'Đi tới nhanh');
    s.innerHTML = '<i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>';
    s.addEventListener('click', onClick);
    burger.parentNode.insertBefore(s, burger);
    burger.style.marginLeft = '0';
  }

  // ============================== QUẢN TRỊ ==============================
  if (PAGE === 'admin') {
    var nav = document.querySelector('.sidebar-nav');
    var GROUPS = [
      { label: '', keys: ['dashboard', '/admin/cong-viec'] },
      { label: 'Tuyển sinh & học tập', keys: ['registrations', 'students', '/admin/crm', 'schedule', 'attendance', 'grades'] },
      { label: 'Tài chính', keys: ['donations', 'tuition', 'invoices'] },
      { label: 'Thành viên & kết nối', keys: ['members', 'gifts', 'bulkemail'] },
      { label: 'Hệ thống', keys: ['activitylog', 'staffaccounts'] }
    ];
    var groupOfKey = {};
    var keyOf = function (btn) { return btn.dataset.tab || btn.getAttribute('href') || ''; };

    if (nav) {
      var btns = Array.prototype.slice.call(nav.querySelectorAll('.tab-btn'));
      var byKey = {}; btns.forEach(function (b) { byKey[keyOf(b)] = b; });
      var frag = document.createDocumentFragment(), used = {};
      GROUPS.forEach(function (g) {
        var wrap = document.createElement('div'); wrap.className = 'lx-nav-group';
        if (g.label) { var l = document.createElement('div'); l.className = 'lx-nav-label'; l.textContent = g.label; wrap.appendChild(l); }
        g.keys.forEach(function (k) { if (byKey[k]) { wrap.appendChild(byKey[k]); used[k] = 1; groupOfKey[k] = g.label; } });
        if (wrap.querySelector('.tab-btn')) frag.appendChild(wrap);
      });
      // Mục mới chưa có trong danh sách nhóm: giữ lại ở cuối, không làm mất
      btns.forEach(function (b) { if (!used[keyOf(b)]) { var last = frag.lastChild || frag; last.appendChild(b); } });
      nav.appendChild(frag);
      btns.forEach(function (b) { if (!b.title) b.title = labelOf(b); });

      var syncGroups = function () {
        nav.querySelectorAll('.lx-nav-group').forEach(function (g) {
          var any = Array.prototype.some.call(g.querySelectorAll('.tab-btn'), function (b) { return b.style.display !== 'none'; });
          g.hidden = !any;
        });
      };
      syncGroups();
      new MutationObserver(syncGroups).observe(nav, { subtree: true, attributes: true, attributeFilter: ['style'] });
    }

    // Thu gọn thanh bên
    var sidebar = document.getElementById('mainSidebar');
    if (sidebar) {
      var t = document.createElement('button');
      t.type = 'button'; t.className = 'lx-rail-toggle';
      t.innerHTML = '<i class="fa-solid fa-angles-left" aria-hidden="true"></i>';
      var setRail = function (on) {
        body.classList.toggle('lx-rail', on);
        t.setAttribute('aria-label', on ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên');
        t.title = t.getAttribute('aria-label') + ' (' + MOD + ' + B)';
        store.set('wvn_admin_rail', on ? '1' : '0');
      };
      t.addEventListener('click', function () { setRail(!body.classList.contains('lx-rail')); });
      window.__lxRailBtn = t;
      setRail(store.get('wvn_admin_rail') === '1');
      window.__lxToggleRail = function () { setRail(!body.classList.contains('lx-rail')); };
    }

    var openAdminPalette = function () { openPalette(); };
    palSource = function () {
      var items = [];
      document.querySelectorAll('.sidebar-nav .tab-btn').forEach(function (b) {
        if (!visible(b)) return;
        var k = keyOf(b);
        items.push({
          label: labelOf(b), icon: iconOf(b), group: groupOfKey[k] || 'Chung',
          hint: b.classList.contains('active') ? 'Đang mở' : (b.tagName === 'A' ? 'Trang riêng' : ''),
          run: function () { if (b.tagName === 'A') location.href = b.href; else b.click(); }
        });
      });
      if (window.__lxToggleRail && window.matchMedia('(min-width: 881px)').matches) {
        items.push({ label: body.classList.contains('lx-rail') ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên', icon: 'fa-solid fa-table-columns', group: 'Hiển thị', hint: MOD + ' B', keys: 'sidebar menu', run: window.__lxToggleRail });
      }
      return items;
    };
    var aFoot = document.querySelector('.sidebar-footer');
    sidebarHint(aFoot, openAdminPalette);
    if (aFoot) {
      var hint = aFoot.querySelector('.lx-kbd-hint'), row = document.createElement('div');
      row.className = 'lx-foot-row'; aFoot.insertBefore(row, hint); row.appendChild(hint);
      if (window.__lxRailBtn) row.appendChild(window.__lxRailBtn);
      // Tên người đăng nhập + nút đăng xuất gọn trên một hàng
      var who = row.nextElementSibling, out = aFoot.querySelector('.btn-outline');
      if (who && out && who.tagName === 'DIV') {
        var wr = document.createElement('div'); wr.className = 'lx-who-row';
        aFoot.insertBefore(wr, who); wr.appendChild(who); wr.appendChild(out);
        out.title = 'Đăng xuất'; out.setAttribute('aria-label', 'Đăng xuất');
      }
    }
    mobileSearchBtn(openAdminPalette);

    // Liên kết trực tiếp tới từng mục: #hoc-phi… (dùng tên mục gốc để ổn định)
    if (typeof window.switchTab === 'function') {
      var origSwitch = window.switchTab;
      window.switchTab = function (tab) {
        var r = origSwitch.apply(this, arguments);
        try { history.replaceState(null, '', tab === 'dashboard' ? location.pathname + location.search : '#' + tab); } catch (e) { /* bỏ qua */ }
        return r;
      };
      var wanted = (location.hash || '').replace('#', '');
      if (wanted && wanted !== 'dashboard') {
        var tries = 0;
        var waitPerm = setInterval(function () {
          tries++;
          // WVN_EXPORT_ALLOWED được gán ngay sau khi áp quyền xong -> lúc này mới biết mục có được phép không
          if (window.WVN_EXPORT_ALLOWED === undefined && tries < 60) return;
          clearInterval(waitPerm);
          var target = wanted === 'emaillogs' ? 'bulkemail' : wanted;
          var btn = document.querySelector('.tab-btn[data-tab="' + target + '"]');
          if (btn && btn.style.display !== 'none' && document.getElementById('panel-' + target)) window.switchTab(wanted);
        }, 150);
      }
    }

    // Thẻ số liệu ở Tổng quan: bấm để mở đúng mục
    var STAT_MAP = [[/thanh vien/, 'members'], [/don dang ky/, 'registrations'], [/quyen gop/, 'donations'], [/cong no|hoc phi/, 'tuition'], [/diem/, 'grades'], [/hoa don/, 'invoices'], [/hoc sinh/, 'students']];
    var statsRow = document.getElementById('dashboardStatsRow');
    var tagStats = function () {
      if (!statsRow) return;
      statsRow.querySelectorAll(':scope > .card').forEach(function (c) {
        if (c.dataset.lxGo) return;
        var head = c.querySelector(':scope > div:first-child'), txt = norm(head ? head.textContent : '');
        for (var i = 0; i < STAT_MAP.length; i++) {
          if (STAT_MAP[i][0].test(txt)) {
            var tab = STAT_MAP[i][1], btn = document.querySelector('.tab-btn[data-tab="' + tab + '"]');
            if (!btn || btn.style.display === 'none') return;
            c.dataset.lxGo = tab; c.setAttribute('role', 'link'); c.tabIndex = 0; c.title = 'Mở mục ' + labelOf(btn);
            return;
          }
        }
      });
    };
    if (statsRow) {
      tagStats();
      new MutationObserver(tagStats).observe(statsRow, { childList: true });
      var go = function (e) { var c = e.target.closest('[data-lx-go]'); if (c && !e.target.closest('a,button')) window.switchTab(c.dataset.lxGo); };
      statsRow.addEventListener('click', go);
      statsRow.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); } });
    }

    // Tô đỏ son cho nút phá huỷ (Xoá, Vô hiệu hoá, Từ chối…) để khó bấm nhầm
    var DANGER = /^(xoa|vo hieu hoa|tu choi|khoa tai khoan|huy)\b/;
    var main = document.querySelector('.main-content');
    var tagDanger = function (root) {
      (root || main).querySelectorAll('.btn-outline:not(.lx-checked)').forEach(function (b) {
        b.classList.add('lx-checked');
        if (DANGER.test(norm(b.textContent))) b.classList.add('lx-danger');
      });
    };
    if (main) {
      tagDanger();
      var dq = false;
      new MutationObserver(function () { if (dq) return; dq = true; requestAnimationFrame(function () { dq = false; tagDanger(); }); }).observe(main, { childList: true, subtree: true });
    }

    // Đường xà cừ ở mép khung chào + tên nhóm phía trên tiêu đề mỗi mục
    var decorate = function () {
      var hero = document.querySelector('.t-hero');
      if (hero && !hero.querySelector('.lx-nacre-edge')) { var e = document.createElement('span'); e.className = 'lx-nacre-edge'; e.setAttribute('aria-hidden', 'true'); hero.appendChild(e); }
      document.querySelectorAll('.panel > .t-page').forEach(function (h) {
        if (h.querySelector('.lx-crumb')) return;
        var key = h.parentNode.id.replace('panel-', ''), g = groupOfKey[key];
        if (!g) return;
        var c = document.createElement('div'); c.className = 'lx-crumb'; c.textContent = g;
        var box = document.createElement('div'); box.style.position = 'relative';
        while (h.firstChild) box.appendChild(h.firstChild);
        box.insertBefore(c, box.firstChild); h.appendChild(box);
      });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', decorate); else decorate();
    window.addEventListener('load', decorate);
  }

  // ============================ KHU THÀNH VIÊN ============================
  if (PAGE === 'member') {
    var openMemberPalette = function () { openPalette(); };
    palSource = function () {
      var items = [];
      document.querySelectorAll('.member-tab-btn').forEach(function (b) {
        if (!visible(b) || !visible(b.parentNode)) return;
        items.push({ label: labelOf(b), icon: iconOf(b), group: 'Khu thành viên', hint: b.classList.contains('active') ? 'Đang mở' : '', run: function () { b.click(); } });
      });
      return items;
    };
    var footer = document.getElementById('sidebarFooter');
    sidebarHint(footer, openMemberPalette);
    mobileSearchBtn(openMemberPalette);
  }

  // ================================= CRM =================================
  if (PAGE === 'crm') {
    var search = document.getElementById('globalSearch');
    if (search) {
      var k = document.createElement('span');
      k.className = 'lx-search-kbd lx-kbd'; k.setAttribute('aria-hidden', 'true');
      k.innerHTML = '<kbd>' + MOD + '</kbd><kbd>K</kbd>';
      search.parentNode.appendChild(k);
      search.setAttribute('aria-keyshortcuts', IS_MAC ? 'Meta+K' : 'Control+K');
    }
    var views = Array.prototype.slice.call(document.querySelectorAll('.view-btn'));
    views.forEach(function (b, i) {
      if (i > 8) return;
      b.setAttribute('aria-keyshortcuts', String(i + 1)); b.title = 'Phím tắt: ' + (i + 1);
    });
    document.addEventListener('keydown', function (e) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      var drawer = document.getElementById('drawer');
      if (drawer && drawer.getAttribute('aria-hidden') === 'false') return;
      if (/^[1-9]$/.test(e.key) && views[+e.key - 1]) { e.preventDefault(); views[+e.key - 1].click(); views[+e.key - 1].focus(); }
      else if (e.key === '/' && search) { e.preventDefault(); search.focus(); search.select(); }
    });
  }

  // ========================= Phím tắt toàn cục =========================
  document.addEventListener('keydown', function (e) {
    var mod = IS_MAC ? e.metaKey : e.ctrlKey;
    if (mod && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (PAGE === 'crm') { var s = document.getElementById('globalSearch'); if (s) { s.focus(); s.select(); } return; }
      if (palOpen()) closePalette(); else openPalette();
      return;
    }
    if (PAGE === 'admin' && mod && !e.shiftKey && (e.key === 'b' || e.key === 'B') && window.__lxToggleRail && !isTyping(e.target)) {
      e.preventDefault(); window.__lxToggleRail();
    }
    if (PAGE !== 'crm' && e.key === '/' && !palOpen() && !isTyping(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault(); openPalette();
    }
  });
})();
