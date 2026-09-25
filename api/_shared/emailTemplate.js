// Template email DÙNG CHUNG cho toàn hệ thống. Mọi API gửi email nên build phần NỘI DUNG
// (bodyHtml) rồi gọi renderEmailHtml(...) để bọc khung/thiết kế — tuyệt đối không tự dựng
// <html>...</html> riêng nữa, để đảm bảo 100% email trông đồng nhất.
//
// Từ hạng Vàng trở lên (isVip = true): tự động chuyển sang bản "premium" — nền màu theo đúng
// màu hạng, hiệu ứng ánh kim (foil) trên header, khung viền vàng, nút bấm gradient, và banner
// hạng ở đầu + chữ ký cảm ơn riêng ở cuối thư. Đây là điểm khác biệt trực quan rõ rệt so với
// bản thường (nền xanh than tiêu chuẩn), đúng tinh thần "được đối xử đặc biệt" cho khách VIP.

const BRAND_NAME = "Mạng Lưới Tri Thức Việt Nam";
const LOGO_URL = "https://wvn.vn/images/logo-wvn.png";
const SITE_URL = "https://wvn.vn/thanh-vien-index.html";

const STANDARD_HEADER_BG = "linear-gradient(135deg,#0f172a 0%,#1e3a8a 50%,#0284c7 100%)";

function escapeAttr(str) {
  return String(str == null ? "" : str).replace(/"/g, "&quot;");
}

// Trộn màu hạng với đen để tạo gradient "ánh kim" sang trọng thay vì màu phẳng.
function premiumHeaderBg(tierColor) {
  return `linear-gradient(135deg, #14110a 0%, ${tierColor} 55%, #14110a 100%)`;
}

function ctaButtonsHtml(ctas, isVip, tierColor) {
  if (!Array.isArray(ctas) || ctas.length === 0) return "";
  const html = ctas.map(c => {
    const isPrimary = c.style !== "secondary" && c.style !== "danger";
    const isDanger = c.style === "danger";
    let bg = "#0284c7", color = "#ffffff", border = "none";
    if (isVip && isPrimary) { bg = `linear-gradient(135deg, ${tierColor}, #f5d67d)`; color = "#1a1305"; }
    else if (isDanger) { bg = "#ffffff"; color = "#b91c1c"; border = "1.5px solid #fecaca"; }
    else if (!isPrimary) { bg = "#ffffff"; color = "#334155"; border = "1.5px solid #e2e8f0"; }
    return `<a href="${escapeAttr(c.href)}" style="display:inline-block; background:${bg}; color:${color}; text-decoration:none; font-weight:700; font-size:14px; padding:12px 24px; border-radius:9px; margin:0 6px 10px; border:${border};">${c.label}</a>`;
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
  const headerBg = isVip && tier ? premiumHeaderBg(tier.color) : STANDARD_HEADER_BG;
  const accentColor = isVip && tier ? tier.color : "#0284c7";
  const cardBorder = isVip ? `2px solid ${accentColor}` : "1px solid #e2e8f0";
  const tierRibbon = isVip && tier
    ? `<div style="background:#14110a; color:${accentColor}; text-align:center; font-size:12px; font-weight:800; letter-spacing:1px; padding:8px 12px; text-transform:uppercase;">✦ Ưu Đãi Dành Riêng Thành Viên Hạng ${tier.name} ✦</div>`
    : "";
  const eyebrowHtml = eyebrow
    ? `<div style="text-align:center; font-size:11px; font-weight:800; letter-spacing:1.5px; text-transform:uppercase; color:${accentColor}; margin-bottom:10px;">${eyebrow}</div>`
    : "";
  const titleHtml = title
    ? `<h1 style="text-align:center; font-size:20px; font-weight:800; color:#0f172a; margin:0 0 18px; font-family:Georgia,'Times New Roman',serif;">${title}</h1>`
    : "";

  return `<!DOCTYPE html>
<html lang="vi">
  <body style="margin:0;padding:0;background:${isVip ? "#0b0906" : "#f1f5f9"};font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${isVip ? "#0b0906" : "#f1f5f9"};padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:500px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 12px 34px rgba(0,0,0,0.22);border:${cardBorder};">
          ${tierRibbon}
          <tr><td style="background:${headerBg};padding:30px 32px;text-align:center;">
            <img src="${LOGO_URL}" alt="WVN" width="52" style="display:block;height:auto;margin:0 auto 10px;">
            <div style="color:#ffffff;font-size:17px;font-weight:800;letter-spacing:0.2px;">${BRAND_NAME}</div>
            ${isVip && tier ? `<div style="margin-top:8px; display:inline-block; background:rgba(255,255,255,0.14); border:1px solid rgba(255,255,255,0.35); border-radius:999px; padding:4px 14px; color:#ffffff; font-size:12px; font-weight:700;"><i style="font-style:normal;">★</i> Hạng ${tier.name}</div>` : ""}
          </td></tr>
          <tr><td style="padding:32px 32px 28px;">
            ${eyebrowHtml}
            ${titleHtml}
            <div style="font-size:14px;color:#334155;line-height:1.7;">${bodyHtml || ""}</div>
            ${ctaButtonsHtml(ctas, isVip, accentColor)}
            ${footerNote ? `<p style="font-size:12px;color:#94a3b8;margin:20px 0 0;text-align:center;">${footerNote}</p>` : ""}
          </td></tr>
          ${isVip && tier ? `
          <tr><td style="background:#14110a; padding:16px 24px; text-align:center;">
            <div style="font-size:12px; color:${accentColor}; font-weight:700;">Cảm ơn sự đồng hành đặc biệt của bạn cùng ${BRAND_NAME}</div>
          </td></tr>` : `
          <tr><td style="background:#f8fafc; padding:14px 24px; text-align:center; border-top:1px solid #e2e8f0;">
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
  const color = isVip ? "#14110a" : "#15803d";
  const bg = isVip ? `linear-gradient(135deg, ${tierColor}, #f5d67d)` : "#f0fdf4";
  const border = isVip ? "none" : "1px dashed #86efac";
  return `<div style="text-align:center;margin:18px 0;"><span style="display:inline-block;font-size:22px;font-weight:800;color:${color};background:${bg};border:${border};border-radius:10px;padding:10px 26px;">${Number(amount).toLocaleString("vi-VN")}đ</span></div>`;
}

module.exports = { renderEmailHtml, moneyBadgeHtml, BRAND_NAME, SITE_URL };
