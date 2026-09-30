/*
 * Thẻ quảng cáo & đo lường dùng chung cho mọi trang công khai của wvn.vn
 * (đặt SAU thẻ Google AW-18460459117 / G-JK8MMT808Y sẵn có trên trang).
 *
 * 1. Bảo đảm trang nào cũng gửi số liệu về Google Analytics 4 (G-JK8MMT808Y).
 * 2. Chuyển đổi nâng cao (Enhanced Conversions): khi một biểu mẫu gửi THÀNH CÔNG, gửi email/SĐT
 *    của người đăng ký cho thẻ Google (Google tự mã hoá SHA-256 trước khi gửi) để Google Ads ghép
 *    lượt chuyển đổi chính xác hơn. Mã chuyển đổi riêng của từng trang (Luyện chữ, Tiền tiểu học,
 *    Học thêm) vẫn do chính trang đó gọi như cũ.
 * 3. Sự kiện GA4 chuẩn để nhập làm chuyển đổi trong Google Ads:
 *      generate_lead  – gửi thành công bất kỳ biểu mẫu nào (kèm form_type)
 *      sign_up        – tạo tài khoản thành viên
 *      contact_click  – bấm gọi điện / email / Zalo / Messenger
 *      donate_click   – bấm nút quyên góp / mở mã QR ủng hộ
 *      register_click – bấm nút "Đăng ký" một chương trình
 */
(function () {
  'use strict';
  var AW = 'AW-18460459117', GA4 = 'G-JK8MMT808Y';
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== 'function') { window.gtag = function () { window.dataLayer.push(arguments); }; }
  var gtag = window.gtag;

  // ---------- 1. GA4 trên mọi trang ----------
  var hasCfg = function (id) { return window.dataLayer.some(function (a) { return a && a[0] === 'config' && a[1] === id; }); };
  if (!hasCfg(GA4)) {
    if (!document.querySelector('script[src*="googletagmanager.com/gtag/js?id=' + GA4 + '"]')) {
      var s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4; document.head.appendChild(s);
    }
    gtag('config', GA4);
  }
  if (!hasCfg(AW)) gtag('config', AW);

  // ---------- 2 & 3. Biểu mẫu gửi thành công ----------
  var FORM_NAMES = {
    luyen_chu_phu_huynh: 'Luyện Chữ Đẹp', luyen_chu_tinh_nguyen: 'Luyện Chữ Đẹp – TNV', luyen_chu_tai_tro: 'Luyện Chữ Đẹp – Tài trợ',
    tien_tieu_hoc: 'Tiền Tiểu Học', day_kem_tieu_hoc: 'Học thêm lớp 1–5', volunteer: 'Tình nguyện viên', donor: 'Nhà tài trợ',
    item: 'Gây quỹ hiện vật', support: 'Cần hỗ trợ', contact: 'Liên hệ', newsletter: 'Bản tin'
  };
  function phoneE164(p) {
    p = String(p || '').replace(/[^\d+]/g, '');
    if (!p) return '';
    if (p.charAt(0) === '+') return p;
    if (p.indexOf('84') === 0) return '+' + p;
    if (p.charAt(0) === '0') return '+84' + p.slice(1);
    return '';
  }
  function first(d, keys) { for (var i = 0; i < keys.length; i++) if (d && d[keys[i]]) return String(d[keys[i]]).trim(); return ''; }
  function setUserData(d) {
    var email = first(d, ['email', 'email_phu_huynh', 'email_tnv', 'email_tai_tro']).toLowerCase();
    var phone = phoneE164(first(d, ['sdt_phu_huynh', 'phone', 'sdt_tnv', 'sdt_tai_tro', 'so_dien_thoai']));
    var ud = {};
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ud.email = email;
    if (phone) ud.phone_number = phone;
    if (ud.email || ud.phone_number) gtag('set', 'user_data', ud);
  }
  var origFetch = window.fetch;
  if (origFetch && !window.__wvnAdsFetch) {
    window.__wvnAdsFetch = true;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var p = origFetch.apply(this, arguments);
      var isForm = /\/api\/send-notification/.test(url), isSignup = /\/api\/member-update-profile/.test(url) && /dang-ky/.test(location.pathname);
      if (!(isForm || isSignup) || !init || !init.body || typeof init.body !== 'string') return p;
      var body = {}; try { body = JSON.parse(init.body); } catch (e) {}
      // đặt user_data NGAY khi gửi, để mã chuyển đổi của trang (gọi sau khi gửi thành công) mang theo dữ liệu nâng cao
      if (isForm) setUserData(body.data || {});
      return p.then(function (res) {
        try {
          if (res && res.ok) {
            res.clone().json().then(function (j) {
              if (!j || j.success === false) return;
              if (isForm) {
                gtag('event', 'generate_lead', { form_type: body.formType || 'other', form_name: FORM_NAMES[body.formType] || body.formType || 'Biểu mẫu', page_path: location.pathname, value: 1, currency: 'USD' });
              } else {
                gtag('event', 'sign_up', { method: 'email' });
              }
            }).catch(function () {});
          }
        } catch (e) {}
        return res;
      });
    };
  }

  // ---------- 3. Bấm liên hệ / quyên góp / đăng ký ----------
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a, button'); if (!a) return;
    var href = (a.getAttribute('href') || '').toLowerCase(), text = (a.textContent || '').trim().toLowerCase();
    if (/^tel:/.test(href)) return gtag('event', 'contact_click', { method: 'phone' });
    if (/^mailto:/.test(href)) return gtag('event', 'contact_click', { method: 'email' });
    if (/zalo\.me/.test(href)) return gtag('event', 'contact_click', { method: 'zalo' });
    if (/m\.me\/|messenger\.com/.test(href)) return gtag('event', 'contact_click', { method: 'messenger' });
    if (/quyen-gop|ung-ho|donate/.test(href) || /quyên góp|ủng hộ/.test(text) || a.hasAttribute('data-qr') || /qr/.test(a.className || '')) return gtag('event', 'donate_click', { link_text: text.slice(0, 60), page_path: location.pathname });
    if (/dang-ky-|\/hocthem|^hocthem/.test(href) && /đăng ký/.test(text)) return gtag('event', 'register_click', { link_url: href, page_path: location.pathname });
  }, true);
})();
