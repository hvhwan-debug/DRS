// Template email DÙNG CHUNG cho toàn hệ thống. Mọi API gửi email nên build phần NỘI DUNG
// (bodyHtml) rồi gọi renderEmailHtml(...) để bọc khung/thiết kế — tuyệt đối không tự dựng
// <html>...</html> riêng nữa, để đảm bảo 100% email trông đồng nhất.
//
// QUAN TRỌNG VỀ EMAIL CLIENT: Outlook desktop (dùng engine Word) và một số client khác KHÔNG
// hỗ trợ CSS "background: linear-gradient(...)". Nếu chỉ khai gradient mà không có màu nền đặc
// (background-color) dự phòng, ô đó sẽ mất luôn màu nền -> chữ trắng biến mất trên nền trắng.
// Vì vậy MỌI nơi dùng gradient trong file này đều khai cả background-color đặc trước, để nếu
// gradient bị bỏ qua thì vẫn còn màu nền đặc, chữ vẫn đọc được.
//
// Từ hạng Vàng trở lên (isVip = true): tự động chuyển sang bản "premium" — nền than đen + ánh
// kim theo màu hạng, viền vàng kép, chữ vàng-kem trên nền tối (KHÔNG dùng thẳng màu hạng cho chữ
// trên nền tối, vì vài màu hạng khá trầm/xỉn, để nguyên sẽ khó đọc — xem PREMIUM_ACCENT bên dưới).

const BRAND_NAME = "Mạng Lưới Tri Thức Việt Nam";
const LOGO_URL = "https://wvn.vn/images/logo-wvn.png";
const SITE_URL = "https://wvn.vn/thanh-vien-index.html";

const STANDARD_HEADER_SOLID = "#0f172a";
const STANDARD_HEADER_GRADIENT = "linear-gradient(135deg,#0f172a 0%,#1e3a8a 50%,#0284c7 100%)";

const PREMIUM_DARK = "#161008";       // nền than đen ấm cho các khối tối trong bản premium
// Vàng-kem cố định dùng cho MỌI chữ trên nền tối ở bản premium — không dùng thẳng màu hạng vì
// một số hạng (Bạc, Titanium...) màu khá trầm, đặt trên nền đen sẽ mờ/khó đọc.
const PREMIUM_ACCENT = "#e8c766";
const PREMIUM_ACCENT_SOFT = "#f6ecc9";

function escapeAttr(str) {
  return String(str == null ? "" : str).replace(/"/g, "&quot;");
}

// Nền header bản premium: màu đặc PREMIUM_DARK trước (dự phòng), gradient ánh kim theo màu hạng sau.
function premiumHeaderStyle(tierColor) {
  return `background-color:${PREMIUM_DARK};background:linear-gradient(135deg, ${PREMIUM_DARK} 0%, ${tierColor} 55%, ${PREMIUM_DARK} 100%);`;
}

function ctaButtonsHtml(ctas, isVip, tierColor) {
  if (!Array.isArray(ctas) || ctas.length === 0) return "";
  const html = ctas.map(c => {
    const isPrimary = c.style !== "secondary" && c.style !== "danger";
    const isDanger = c.style === "danger";
    let bgStyle = "background-color:#0284c7;", color = "#ffffff", border = "none";
    if (isVip && isPrimary) {
      bgStyle = `background-color:${tierColor};background:linear-gradient(135deg, ${tierColor}, ${PREMIUM_ACCENT_SOFT});`;
      color = "#1a1305";
    } else if (isDanger) {
      bgStyle = "background-color:#ffffff;";
      color = "#b91c1c"; border = "1.5px solid #fecaca";
    } else if (!isPrimary) {
      bgStyle = "background-color:#ffffff;";
      color = "#334155"; border = "1.5px solid #e2e8f0";
    }
    return `<a href="${escapeAttr(c.href)}" style="display:inline-block; ${bgStyle} color:${color}; text-decoration:none; font-weight:700; font-size:14px; padding:12px 24px; border-radius:9px; margin:0 6px 10px; border:${border};">${c.label}</a>`;
  }).join("");
  return `<div style="text-align:center; margin:22px 0 8px;">${html}</div>`;
}

/**
 * renderEmailHtml({ tier, isVip, eyebrow, title, bodyHtml, ctas, footerNote })
 * - tier: { name, color, icon } | null — hạng của người nhận (nếu biết)
 * - isVip: true nếu từ hạng Vàng trở lên -> dùng bản premium
 * - eyebrow: nhãn nhỏ phía trên tiêu đề, in hoa (vd: "XÁC NHẬN HỌC PHÍ")
 * - title: tiêu đề chính trong thẻ nội dung
 * - bodyHtml: nội dung chính (đoạn văn, hộp nổi bật...) — HTML thuần, canh giữa theo mặc định thẻ cha
 * - ctas: mảng { label, href, style: 'primary'|'secondary'|'danger' } — các nút bấm hành động
 * - footerNote: dòng phụ nhỏ cuối thư (tuỳ chọn, vd link đăng nhập khu vực thành viên)
 */
function renderEmailHtml({ tier, isVip, eyebrow, title, bodyHtml, ctas, footerNote }) {
  const premium = isVip && tier;
  const headerStyle = premium ? premiumHeaderStyle(tier.color) : `background-color:${STANDARD_HEADER_SOLID};background:${STANDARD_HEADER_GRADIENT};`;
  // Màu nhấn TRÊN NỀN TRẮNG (eyebrow, viền thẻ) vẫn dùng đúng màu hạng — các màu hạng hiện có
  // đều đủ đậm để đọc tốt trên nền trắng, chỉ có vấn đề khi đặt trên nền tối (xử lý riêng ở dưới).
  const accentOnWhite = premium ? tier.color : "#0284c7";
  const outerBg = premium ? PREMIUM_DARK : "#f1f5f9";

  const tierRibbon = premium
    ? `<div style="background-color:${PREMIUM_DARK}; color:${PREMIUM_ACCENT}; text-align:center; font-size:12px; font-weight:800; letter-spacing:1px; padding:9px 12px; text-transform:uppercase; border-bottom:1px solid rgba(232,199,102,0.35);">✦ Ưu Đãi Dành Riêng Thành Viên Hạng ${tier.name} ✦</div>`
    : "";
  const eyebrowHtml = eyebrow
    ? `<div style="text-align:center; font-size:11px; font-weight:800; letter-spacing:1.5px; text-transform:uppercase; color:${accentOnWhite}; margin-bottom:10px;">${eyebrow}</div>`
    : "";
  const titleHtml = title
    ? `<h1 style="text-align:center; font-size:20px; font-weight:800; color:#0f172a; margin:0 0 18px; font-family:Georgia,'Times New Roman',serif;">${title}</h1>`
    : "";

  return `<!DOCTYPE html>
<html lang="vi">
  <body style="margin:0;padding:0;background-color:${outerBg};font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${outerBg};padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:500px;background-color:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 12px 34px rgba(0,0,0,0.22);${premium ? `border:2px solid ${PREMIUM_ACCENT};` : "border:1px solid #e2e8f0;"}">
          ${tierRibbon}
          <tr><td bgcolor="${premium ? PREMIUM_DARK : STANDARD_HEADER_SOLID}" style="${headerStyle}padding:30px 32px;text-align:center;">
            <img src="${LOGO_URL}" alt="WVN" width="52" style="display:block;height:auto;margin:0 auto 10px;">
            <div style="color:#ffffff;font-size:17px;font-weight:800;letter-spacing:0.2px;font-family:Georgia,'Times New Roman',serif;">${BRAND_NAME}</div>
            ${premium ? `<div style="margin-top:10px; display:inline-block; background-color:rgba(232,199,102,0.16); border:1px solid ${PREMIUM_ACCENT}; border-radius:999px; padding:4px 16px; color:${PREMIUM_ACCENT_SOFT}; font-size:12px; font-weight:700; letter-spacing:0.3px;">★ Hạng ${tier.name}</div>` : ""}
          </td></tr>
          <tr><td style="padding:32px 32px 28px;">
            ${eyebrowHtml}
            ${titleHtml}
            <div style="font-size:14px;color:#334155;line-height:1.7;">${bodyHtml || ""}</div>
            ${ctaButtonsHtml(ctas, premium, tier ? tier.color : null)}
            ${footerNote ? `<p style="font-size:12px;color:#94a3b8;margin:20px 0 0;text-align:center;">${footerNote}</p>` : ""}
          </td></tr>
          ${premium ? `
          <tr><td bgcolor="${PREMIUM_DARK}" style="background-color:${PREMIUM_DARK}; padding:16px 24px; text-align:center; border-top:1px solid rgba(232,199,102,0.35);">
            <div style="font-size:12px; color:${PREMIUM_ACCENT}; font-weight:700;">Cảm ơn sự đồng hành đặc biệt của bạn cùng ${BRAND_NAME}</div>
          </td></tr>` : `
          <tr><td bgcolor="#f8fafc" style="background-color:#f8fafc; padding:14px 24px; text-align:center; border-top:1px solid #e2e8f0;">
            <div style="font-size:11px; color:#94a3b8;">© ${new Date().getFullYear()} ${BRAND_NAME}</div>
          </td></tr>`}
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

// Vài khối nội dung dùng lặp lại nhiều nơi — gom sẵn cho đồng nhất.
function moneyBadgeHtml(amount, isVip, tierColor) {
  const color = isVip ? "#1a1305" : "#15803d";
  const bgStyle = isVip
    ? `background-color:${tierColor};background:linear-gradient(135deg, ${tierColor}, #f5d67d);`
    : "background-color:#f0fdf4;";
  const border = isVip ? "none" : "1px dashed #86efac";
  return `<div style="text-align:center;margin:18px 0;"><span style="display:inline-block;font-size:22px;font-weight:800;color:${color};${bgStyle}border:${border};border-radius:10px;padding:10px 26px;">${Number(amount).toLocaleString("vi-VN")}đ</span></div>`;
}

module.exports = { renderEmailHtml, moneyBadgeHtml, BRAND_NAME, SITE_URL };
