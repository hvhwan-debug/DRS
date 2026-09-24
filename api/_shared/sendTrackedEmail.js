const sgMail = require("@sendgrid/mail");
const { getTableClient } = require("./tableStorage");

const EMAIL_LOGS_TABLE = "EmailLogs";

// Gửi 1 email và ghi log lại (best-effort — lỗi ghi log không làm hỏng việc gửi email)
// params: { to, subject, html, type } — type: 'status' | 'grade' | 'donation' | 'tuition' | 'block' | 'reset_password' | 'bulk' | 'other'
async function sendTrackedEmail(context, { to, subject, html, type }) {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL;
  let success = false;
  let errorMessage = "";

  if (!apiKey || !fromEmail) {
    errorMessage = "Thiếu SENDGRID_API_KEY hoặc SENDGRID_FROM_EMAIL.";
  } else {
    try {
      sgMail.setApiKey(apiKey);
      await sgMail.send({
        to,
        from: { email: fromEmail, name: "Mạng Lưới Tri Thức Việt Nam" },
        subject,
        html
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
