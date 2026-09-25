const sgMail = require("@sendgrid/mail");
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
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL;
  let success = false;
  let errorMessage = "";

  let finalHtml = html;
  if (!finalHtml) {
    let tier = null;
    let isVip = false;
    try {
      const looksLikeEmail = typeof to === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to);
      if (looksLikeEmail) {
        const info = await getTierInfoForEmail(to.toLowerCase());
        tier = info.tier;
        isVip = info.isVip;
      }
    } catch (err) {
      // Tra cứu hạng lỗi (vd. email không phải thành viên có học phí) -> dùng bản thường
    }
    finalHtml = renderEmailHtml({ tier, isVip, eyebrow, title, bodyHtml, ctas, footerNote });
  }

  if (!apiKey || !fromEmail) {
    errorMessage = "Thiếu SENDGRID_API_KEY hoặc SENDGRID_FROM_EMAIL.";
  } else {
    try {
      sgMail.setApiKey(apiKey);
      await sgMail.send({
        to,
        from: { email: fromEmail, name: "Mạng Lưới Tri Thức Việt Nam" },
        subject,
        html: finalHtml
      });
      success = true;
    } catch (err) {
      errorMessage = (err && err.response && JSON.stringify(err.response.body)) || err.message || "Lỗi không rõ.";
      if (context && context.log) context.log.error(`Gửi email tới ${to} thất bại:`, errorMessage);
    }
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
