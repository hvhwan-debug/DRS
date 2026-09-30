const { sendEmail } = require("./mailer");
const { getTableClient } = require("./tableStorage");
const { getTierInfoForEmail } = require("./memberTier");
const { renderEmailHtml } = require("./emailTemplate");

const EMAIL_LOGS_TABLE = "EmailLogs";

// Gửi 1 email và ghi log lại (best-effort — lỗi ghi log không làm hỏng việc gửi email).
//
// CÁCH DÙNG CHUẨN (khuyến khích, đảm bảo mọi email đồng nhất 1 giao diện):
//   sendTrackedEmail(context, { to, subject, type, eyebrow, title, bodyHtml, ctas, footerNote })
//   -> hàm tự tra hạng của "to" và build HTML qua renderEmailHtml() trong emailTemplate.js.
//      Từ hạng Vàng trở lên, email TỰ ĐỘNG chuyển sang bản thiết kế premium (không cần làm gì thêm).
//
// CÁCH DÙNG CŨ (vẫn hỗ trợ, không khuyến khích): truyền thẳng `html` đầy đủ — dùng khi cần 1 email
// có cấu trúc đặc biệt không theo khung chung (hiếm khi cần).
async function sendTrackedEmail(context, { to, subject, html, type, eyebrow, title, bodyHtml, ctas, footerNote }) {
  let success = false;
  let errorMessage = "";

  // Email QUẢNG CÁO: bỏ qua người đã huỷ nhận; người còn nhận luôn thấy link huỷ ở cuối email.
  // Email THÔNG BÁO (mọi type khác) không bị ảnh hưởng.
  const { isMarketing, isMarketingOptedOut, unsubscribeUrlFor } = require("./marketingConsent");
  if (isMarketing(type)) {
    if (await isMarketingOptedOut(to)) {
      try {
        const lt = await getTableClient(EMAIL_LOGS_TABLE);
        await lt.createEntity({ partitionKey: "log", rowKey: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, to, subject, type: type || "other", success: false, skipped: true, errorMessage: "Bỏ qua: người nhận đã huỷ nhận email quảng cáo", sentAt: new Date().toISOString() });
      } catch (err) {}
      return { success: false, skipped: true, errorMessage: "Người nhận đã huỷ nhận email quảng cáo." };
    }
    try {
      const url = await unsubscribeUrlFor(to);
      const note = `Bạn nhận email này vì đã đăng ký nhận tin từ Tri thức Việt. <a href="${url}" style="color:#64748b;text-decoration:underline;">Huỷ nhận email quảng cáo</a>. Các thông báo về học tập, học phí và tài khoản vẫn được gửi bình thường.`;
      footerNote = footerNote ? footerNote + "<br>" + note : note;
      if (html && !/public-newsletter-unsubscribe/.test(html)) html = html.replace(/<\/body>/i, `<p style="font-size:12px;color:#94a3b8;text-align:center;margin:16px 0;">${note}</p></body>`);
    } catch (err) {}
  }

  let finalHtml = html;
  if (!finalHtml) {
    let isVip = false;
    try {
      const looksLikeEmail = typeof to === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to);
      if (looksLikeEmail) {
        const info = await getTierInfoForEmail(to.toLowerCase());
        isVip = info.isVip;
      }
    } catch (err) {
      // Tra cứu hạng lỗi (vd. email không phải thành viên có học phí) -> dùng bản thường
    }
    finalHtml = renderEmailHtml({ isVip, eyebrow, title, bodyHtml, ctas, footerNote });
  }

  try {
    await sendEmail({ to, subject, html: finalHtml });
    success = true;
  } catch (err) {
    errorMessage = err.message || "Lỗi không rõ.";
    if (context && context.log) context.log.error(`Gửi email tới ${to} thất bại:`, errorMessage);
  }

  try {
    const logsTable = await getTableClient(EMAIL_LOGS_TABLE);
    await logsTable.createEntity({
      partitionKey: "log",
      rowKey: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      to,
      subject,
      type: type || "other",
      success,
      errorMessage,
      sentAt: new Date().toISOString()
    });
  } catch (err) {
    if (context && context.log) context.log.error("Ghi log email thất bại:", err.message);
  }

  return { success, errorMessage };
}

module.exports = { sendTrackedEmail };
