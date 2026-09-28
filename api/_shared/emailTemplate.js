// Template email DÙNG CHUNG cho toàn hệ thống. Mọi API gửi email nên build phần NỘI DUNG
// (bodyHtml) rồi gọi renderEmailHtml(...) để bọc khung/thiết kế — tuyệt đối không tự dựng
// <html>...</html> riêng nữa, để đảm bảo 100% email trông đồng nhất.
//
// QUY TẮC MÀU SẮC: CHỈ 1 BỘ KHUNG DUY NHẤT, dùng chung cho mọi email — bản thường và bản VIP
// (từ hạng Vàng trở lên) có CẤU TRÚC Y HỆT NHAU (cùng bố cục, cùng thứ tự khối, cùng kiểu dáng),
// chỉ khác 2 điều: bảng màu (thường dùng xanh thương hiệu, VIP dùng ánh vàng sang trọng) và nhãn
// rất nhỏ "Khách hàng VIP" ở góc trên bên phải phần đầu email (trong ô màu vàng) — khớp với nhãn VIP trong khu vực thành viên.
// Ngoài 2 điều đó không thêm bớt khối nào riêng cho VIP để tránh vênh nhau.
//
// QUAN TRỌNG VỀ EMAIL CLIENT: Outlook desktop (dùng engine Word) và một số client khác KHÔNG
// hỗ trợ CSS "background: linear-gradient(...)". Nếu chỉ khai gradient mà không có màu nền đặc
// (background-color) dự phòng, ô đó sẽ mất luôn màu nền -> chữ trắng biến mất trên nền trắng.
// Vì vậy MỌI nơi dùng gradient trong file này đều khai cả background-color đặc trước.
// Ngoài ra Outlook không đáng tin cậy khi kế thừa font-family vào <table>/<td> — nên MỌI thẻ
// (kể cả lồng trong bảng) đều tự khai lại font-family, không dựa vào kế thừa từ thẻ cha.

const BRAND_NAME = "Mạng Lưới Tri Thức Việt Nam";
const LOGO_URL = "https://wvn.vn/images/logo-wvn.png?v=20260927b";
// Logo đầy đủ bản CHỮ TRẮNG, nền trong suốt (chữ W + Tri Thức Việt Nam + khẩu hiệu) cho phần đầu email nền tối; ảnh 900px hiển thị 250px để nét trên màn hình retina
const HEADER_LOGO_URL = "https://wvn.vn/images/email-logo-wvn-dark.png?v=20260928d";
const SITE_URL = "https://wvn.vn/thanh-vien";
const FONT_STACK = "Arial,Helvetica,sans-serif"; // 1 phông DUY NHẤT cho toàn bộ email

// Mỗi mode định nghĩa ĐẦY ĐỦ các vai trò màu giống hệt nhau về cấu trúc — chỉ đổi giá trị màu.
const PALETTES = {
  standard: {
    // Khớp CHÍNH XÁC với biến CSS thương hiệu trên website: --blue-grad-primary / --blue-grad-btn
    headerSolid: "#0b1120",
    headerGradient: "linear-gradient(135deg,#0b1120 0%,#16233f 50%,#0284c7 100%)",
    outerBg: "#f1f5f9",
    cardBorder: "1px solid #e2e8f0",
    accentOnWhite: "#0284c7",
    btnSolid: "#2563eb",
    btnGradient: "linear-gradient(135deg,#2563eb 0%,#0284c7 100%)",
    btnTextColor: "#ffffff",
    footerBg: "#f8fafc",
    footerBorder: "1px solid #e2e8f0",
    footerTextColor: "#94a3b8",
    moneyBg: "#f0fdf4",
    moneyBorder: "1px dashed #86efac",
    moneyColor: "#15803d"
  },
  vip: {
    // Cùng cấu trúc dark -> mid -> bright như bản thường, chỉ đổi hệ màu sang ánh vàng sang trọng.
    headerSolid: "#3d2f06",
    headerGradient: "linear-gradient(135deg,#3d2f06 0%,#8a6d1a 50%,#d4af37 100%)",
    outerBg: "#fdf8ec",
    cardBorder: "1px solid #f0dfa8",
    accentOnWhite: "#a97c1f",
    btnSolid: "#d4af37",
    btnGradient: "linear-gradient(135deg,#d4af37 0%,#f5d67d 100%)",
    btnTextColor: "#2a1f05",
    footerBg: "#faf1d7",
    footerBorder: "1px solid #f0dfa8",
    footerTextColor: "#8a6d1a",
    moneyBg: "#fdf8ec",
    moneyBorder: "1px dashed #e8cd7a",
    moneyColor: "#a97c1f"
  }
};

// Nhãn "Khách hàng VIP" cho khách hàng ưu tiên (hạng Vàng trở lên): rất nhỏ, nằm TRONG phần đầu
// email màu vàng, ở góc trên bên phải. Là 1 hàng riêng căn phải (không dùng position/float) để hiện
// đúng góc trên Gmail/Outlook/điện thoại; logo + tên thương hiệu vẫn căn giữa ở hàng dưới.
const VIP_BADGE_SPAN = `<span style="display:inline-block;border:1px solid #f5d67d;border-radius:999px;padding:1px 7px;font-family:${FONT_STACK};font-size:9px;font-weight:600;letter-spacing:0.3px;color:#fff6d6;background-color:#3d2f06;line-height:14px;mso-line-height-rule:exactly;white-space:nowrap;">&#9733; Khách hàng VIP</span>`;

function escapeAttr(str) {
  return String(str == null ? "" : str).replace(/"/g, "&quot;");
}

function ctaButtonsHtml(ctas, p) {
  if (!Array.isArray(ctas) || ctas.length === 0) return "";
  const html = ctas.map(c => {
    const isPrimary = c.style !== "secondary" && c.style !== "danger";
    const isDanger = c.style === "danger";
    let bgStyle = `background-color:${p.btnSolid};background:${p.btnGradient};`, color = p.btnTextColor, border = "none";
    if (isDanger) {
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
 * - isVip: true nếu người nhận từ hạng Vàng trở lên -> dùng ĐÚNG khung này nhưng đổi sang bảng
 *   màu vàng sang trọng (không có khối/nội dung nào khác biệt ngoài màu sắc).
 */
function renderEmailHtml({ isVip, eyebrow, title, bodyHtml, ctas, footerNote }) {
  const p = isVip ? PALETTES.vip : PALETTES.standard;

  const eyebrowHtml = eyebrow
    ? `<div style="text-align:center; font-size:11px; font-weight:800; letter-spacing:1.5px; text-transform:uppercase; color:${p.accentOnWhite}; font-family:${FONT_STACK}; margin-bottom:10px;">${eyebrow}</div>`
    : "";
  const titleHtml = title
    ? `<h1 style="text-align:center; font-size:20px; font-weight:800; color:#0f172a; margin:0 0 18px; font-family:${FONT_STACK};">${title}</h1>`
    : "";

  return `<!DOCTYPE html>
<html lang="vi">
  <head><meta charset="utf-8"><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body style="margin:0;padding:0;background-color:${p.outerBg};font-family:${FONT_STACK};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${p.outerBg};padding:32px 16px;font-family:${FONT_STACK};">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:500px;background-color:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 12px 34px rgba(0,0,0,0.12);font-family:${FONT_STACK};border:${p.cardBorder};">
          <tr><td bgcolor="${p.headerSolid}" style="background-color:${p.headerSolid};background:${p.headerGradient};padding:${isVip ? "0" : "28px 32px 24px"};text-align:center;">
            ${isVip ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr><td align="right" style="text-align:right;padding:12px 14px 0;font-family:${FONT_STACK};line-height:14px;">${VIP_BADGE_SPAN}</td></tr>
              <tr><td align="center" style="text-align:center;padding:2px 32px 24px;">` : ""}
            <img src="${HEADER_LOGO_URL}" alt="${BRAND_NAME} · Kiến tạo giá trị vượt thời gian" width="300" style="display:block;width:300px;max-width:80%;height:auto;margin:0 auto;border:0;outline:none;text-decoration:none;">
            ${isVip ? `</td></tr></table>` : ""}
          </td></tr>
          <tr><td height="4" bgcolor="${p.headerSolid}" style="height:4px;line-height:4px;font-size:0;background-color:${p.headerSolid};background:${isVip ? "linear-gradient(90deg,#8a6d1a 0%,#d4af37 50%,#f5d67d 100%)" : "linear-gradient(90deg,#00d2ff 0%,#1f5bff 55%,#b8f23a 100%)"};">&nbsp;</td></tr>
          <tr><td style="padding:32px 32px 28px;font-family:${FONT_STACK};">
            ${eyebrowHtml}
            ${titleHtml}
            <div style="font-size:14px;color:#334155;line-height:1.7;font-family:${FONT_STACK};">${bodyHtml || ""}</div>
            ${ctaButtonsHtml(ctas, p)}
            ${footerNote ? `<p style="font-size:12px;color:#94a3b8;margin:20px 0 0;text-align:center;font-family:${FONT_STACK};">${footerNote}</p>` : ""}
          </td></tr>
          <tr><td bgcolor="${p.footerBg}" style="background-color:${p.footerBg}; padding:14px 24px; text-align:center; border-top:${p.footerBorder};">
            <div style="font-size:11px; color:${p.footerTextColor}; font-family:${FONT_STACK};">© ${new Date().getFullYear()} ${BRAND_NAME}</div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

// Vài khối nội dung dùng lặp lại nhiều nơi — gom sẵn cho đồng nhất.
function moneyBadgeHtml(amount, isVip) {
  const p = isVip ? PALETTES.vip : PALETTES.standard;
  return `<div style="text-align:center;margin:18px 0;"><span style="display:inline-block;font-size:22px;font-weight:800;color:${p.moneyColor};font-family:${FONT_STACK};background-color:${p.moneyBg};border:${p.moneyBorder};border-radius:10px;padding:10px 26px;">${Number(amount).toLocaleString("vi-VN")}đ</span></div>`;
}

module.exports = { renderEmailHtml, moneyBadgeHtml, BRAND_NAME, SITE_URL };
