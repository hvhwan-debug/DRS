// Template email DÙNG CHUNG cho toàn hệ thống. Mọi API gửi email nên build phần NỘI DUNG
// (bodyHtml) rồi gọi renderEmailHtml(...) để bọc khung/thiết kế — tuyệt đối không tự dựng
// <html>...</html> riêng nữa, để đảm bảo 100% email trông đồng nhất.
//
// QUY TẮC MÀU SẮC: chỉ có 2 chế độ, không phân biệt theo từng hạng cụ thể (không ghi tên hạng
// trong email):
//   - isVip = false (dưới hạng Vàng): giao diện chuẩn thương hiệu — xanh than/xanh dương.
//   - isVip = true (từ hạng Vàng trở lên): giao diện VÀNG sang trọng, ánh kim, đồng nhất cho
//     MỌI hạng VIP (Vàng, Kim Cương...) — không đổi màu riêng theo từng hạng.
//
// QUAN TRỌNG VỀ EMAIL CLIENT: Outlook desktop (dùng engine Word) và một số client khác KHÔNG
// hỗ trợ CSS "background: linear-gradient(...)". Nếu chỉ khai gradient mà không có màu nền đặc
// (background-color) dự phòng, ô đó sẽ mất luôn màu nền -> chữ trắng biến mất trên nền trắng.
// Vì vậy MỌI nơi dùng gradient trong file này đều khai cả background-color đặc trước.

const BRAND_NAME = "Mạng Lưới Tri Thức Việt Nam";
const LOGO_URL = "https://wvn.vn/images/logo-wvn.png";
const SITE_URL = "https://wvn.vn/thanh-vien-index.html";
const FONT_STACK = "Arial,Helvetica,sans-serif"; // 1 phông DUY NHẤT cho toàn bộ email — không trộn với phông chân serif

// Khớp CHÍNH XÁC với biến CSS thương hiệu trên website (thanh-vien-index.html):
// --blue-grad-primary và --blue-grad-btn — để email luôn cùng tông màu với website, không lệch.
const STANDARD_HEADER_SOLID = "#0b1120";
const STANDARD_HEADER_GRADIENT = "linear-gradient(135deg,#0b1120 0%,#16233f 50%,#0284c7 100%)";
const STANDARD_BTN_SOLID = "#2563eb";
const STANDARD_BTN_GRADIENT = "linear-gradient(135deg,#2563eb 0%,#0284c7 100%)";
const STANDARD_ACCENT = "#0284c7";

// Bảng màu VÀNG sang trọng — dùng CỐ ĐỊNH cho mọi hạng VIP (không đổi theo từng hạng riêng).
const GOLD_DARK = "#161008";          // nền than đen ấm làm nền cho các mảng vàng
const GOLD_MAIN = "#d4af37";          // vàng kim chủ đạo
const GOLD_LIGHT = "#f5d67d";         // vàng nhạt dùng cho gradient/nhấn sáng
const GOLD_SOFT = "#f6ecc9";          // kem vàng — dùng cho chữ trên nền tối, tương phản tốt

function escapeAttr(str) {
  return String(str == null ? "" : str).replace(/"/g, "&quot;");
}

function ctaButtonsHtml(ctas, isVip) {
  if (!Array.isArray(ctas) || ctas.length === 0) return "";
  const html = ctas.map(c => {
    const isPrimary = c.style !== "secondary" && c.style !== "danger";
    const isDanger = c.style === "danger";
    let bgStyle = `background-color:${STANDARD_BTN_SOLID};background:${STANDARD_BTN_GRADIENT};`, color = "#ffffff", border = "none";
    if (isVip && isPrimary) {
      bgStyle = `background-color:${GOLD_MAIN};background:linear-gradient(135deg, ${GOLD_MAIN}, ${GOLD_LIGHT});`;
      color = "#2a1f05";
    } else if (isDanger) {
      bgStyle = "background-color:#ffffff;";
      color = "#b91c1c"; border = "1.5px solid #fecaca";
    } else if (!isPrimary) {
      bgStyle = "background-color:#ffffff;";
      color = "#334155"; border = "1.5px solid #e2e8f0";
    }
    return `<a href="${escapeAttr(c.href)}" style="display:inline-block; ${bgStyle} color:${color}; text-decoration:none; font-weight:700; font-size:14px; font-family:${FONT_STACK}; padding:12px 24px; border-radius:9px; margin:0 6px 10px; border:${border};">${c.label}</a>`;
  }).join("");
  return `<div style="text-align:center; margin:22px 0 8px;">${html}</div>`;
}

/**
 * renderEmailHtml({ isVip, eyebrow, title, bodyHtml, ctas, footerNote })
 * - isVip: true nếu người nhận từ hạng Vàng trở lên -> dùng bản vàng sang trọng (không cần
 *   truyền/hiển thị tên hạng cụ thể — giao diện chỉ có 2 chế độ: chuẩn thương hiệu hoặc VIP vàng).
 * - eyebrow: nhãn nhỏ phía trên tiêu đề, in hoa (vd: "XÁC NHẬN HỌC PHÍ")
 * - title: tiêu đề chính trong thẻ nội dung
 * - bodyHtml: nội dung chính (đoạn văn, hộp nổi bật...) — HTML thuần
 * - ctas: mảng { label, href, style: 'primary'|'secondary'|'danger' } — các nút bấm hành động
 * - footerNote: dòng phụ nhỏ cuối thư (tuỳ chọn, vd link đăng nhập khu vực thành viên)
 */
function renderEmailHtml({ isVip, eyebrow, title, bodyHtml, ctas, footerNote }) {
  const headerStyle = isVip
    ? `background-color:${GOLD_DARK};background:linear-gradient(135deg, ${GOLD_DARK} 0%, ${GOLD_MAIN} 55%, ${GOLD_DARK} 100%);`
    : `background-color:${STANDARD_HEADER_SOLID};background:${STANDARD_HEADER_GRADIENT};`;
  const accentOnWhite = isVip ? "#a97c1f" : STANDARD_ACCENT; // bản vàng đậm hơn 1 chút để đủ tương phản trên nền trắng
  const outerBg = isVip ? GOLD_DARK : "#f1f5f9";

  const eyebrowHtml = eyebrow
    ? `<div style="text-align:center; font-size:11px; font-weight:800; letter-spacing:1.5px; text-transform:uppercase; color:${accentOnWhite}; font-family:${FONT_STACK}; margin-bottom:10px;">${eyebrow}</div>`
    : "";
  const titleHtml = title
    ? `<h1 style="text-align:center; font-size:20px; font-weight:800; color:#0f172a; margin:0 0 18px; font-family:${FONT_STACK};">${title}</h1>`
    : "";

  return `<!DOCTYPE html>
<html lang="vi">
  <body style="margin:0;padding:0;background-color:${outerBg};font-family:${FONT_STACK};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${outerBg};padding:32px 16px;font-family:${FONT_STACK};">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:500px;background-color:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 12px 34px rgba(0,0,0,0.22);font-family:${FONT_STACK};${isVip ? `border:2px solid ${GOLD_MAIN};` : "border:1px solid #e2e8f0;"}">
          <tr><td bgcolor="${isVip ? GOLD_DARK : STANDARD_HEADER_SOLID}" style="${headerStyle}padding:30px 32px;text-align:center;">
            <img src="${LOGO_URL}" alt="WVN" width="52" style="display:block;height:auto;margin:0 auto 10px;">
            <div style="color:#ffffff;font-size:17px;font-weight:800;letter-spacing:0.2px;font-family:${FONT_STACK};">${BRAND_NAME}</div>
          </td></tr>
          <tr><td style="padding:32px 32px 28px;font-family:${FONT_STACK};">
            ${eyebrowHtml}
            ${titleHtml}
            <div style="font-size:14px;color:#334155;line-height:1.7;font-family:${FONT_STACK};">${bodyHtml || ""}</div>
            ${ctaButtonsHtml(ctas, isVip)}
            ${footerNote ? `<p style="font-size:12px;color:#94a3b8;margin:20px 0 0;text-align:center;font-family:${FONT_STACK};">${footerNote}</p>` : ""}
          </td></tr>
          ${isVip ? `
          <tr><td bgcolor="${GOLD_DARK}" style="background-color:${GOLD_DARK}; padding:16px 24px; text-align:center; border-top:1px solid rgba(212,175,55,0.35);">
            <div style="font-size:12px; color:${GOLD_SOFT}; font-weight:700; font-family:${FONT_STACK};">Cảm ơn sự đồng hành đặc biệt của bạn cùng ${BRAND_NAME}</div>
          </td></tr>` : `
          <tr><td bgcolor="#f8fafc" style="background-color:#f8fafc; padding:14px 24px; text-align:center; border-top:1px solid #e2e8f0;">
            <div style="font-size:11px; color:#94a3b8; font-family:${FONT_STACK};">© ${new Date().getFullYear()} ${BRAND_NAME}</div>
          </td></tr>`}
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

// Vài khối nội dung dùng lặp lại nhiều nơi — gom sẵn cho đồng nhất.
function moneyBadgeHtml(amount, isVip) {
  const color = isVip ? "#2a1f05" : "#15803d";
  const bgStyle = isVip
    ? `background-color:${GOLD_MAIN};background:linear-gradient(135deg, ${GOLD_MAIN}, ${GOLD_LIGHT});`
    : "background-color:#f0fdf4;";
  const border = isVip ? "none" : "1px dashed #86efac";
  return `<div style="text-align:center;margin:18px 0;"><span style="display:inline-block;font-size:22px;font-weight:800;color:${color};font-family:${FONT_STACK};${bgStyle}border:${border};border-radius:10px;padding:10px 26px;">${Number(amount).toLocaleString("vi-VN")}đ</span></div>`;
}

module.exports = { renderEmailHtml, moneyBadgeHtml, BRAND_NAME, SITE_URL };
