const sgMail = require("@sendgrid/mail");
const { requireAdmin } = require("../_shared/adminAuth");
const { getMemberDisplayName, buildGreeting } = require("../_shared/memberName");

const MAX_RECIPIENTS = 500; // giới hạn an toàn cho 1 lần gửi

function buildBulkEmailHtml(subject, messageHtml, greeting) {
  return `<!DOCTYPE html>
<html lang="vi">
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 28px rgba(15,23,42,0.10);">
          <tr><td bgcolor="#0f172a" style="background-color:#0f172a;background:linear-gradient(135deg,#0f172a 0%,#1e3a8a 50%,#0284c7 100%);padding:28px 32px;text-align:center;">
            <img src="https://wvn.vn/images/logo-wvn.png" alt="WVN" width="56" style="display:block;height:auto;margin:0 auto 10px;">
            <div style="color:#ffffff;font-size:17px;font-weight:800;">Mạng Lưới Tri Thức Việt Nam</div>
          </td></tr>
          <tr><td style="padding:32px;">
            <p style="font-size:14px;color:#334155;margin:0 0 16px;">${greeting}</p>
            <div style="font-size:14px;color:#334155;line-height:1.7; white-space:pre-wrap;">${messageHtml}</div>
            <p style="font-size:13px;color:#94a3b8;margin:24px 0 0;">Trân trọng,<br>Mạng Lưới Tri Thức Việt Nam</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const body = req.body || {};
  const subject = String(body.subject || "").trim();
  const message = String(body.message || "").trim();
  let recipients = Array.isArray(body.recipients) ? body.recipients : [];

  recipients = Array.from(new Set(
    recipients
      .map(r => String(r || "").trim().toLowerCase())
      .filter(r => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r))
  ));

  if (!subject || !message) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Vui lòng nhập đủ tiêu đề và nội dung email." };
    return;
  }
  if (recipients.length === 0) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Không có người nhận hợp lệ nào." };
    return;
  }
  if (recipients.length > MAX_RECIPIENTS) {
    context.res.status = 400;
    context.res.body = { success: false, message: `Chỉ được gửi tối đa ${MAX_RECIPIENTS} người nhận trong 1 lần.` };
    return;
  }

  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL;
  if (!apiKey || !fromEmail) {
    context.res.status = 500;
    context.res.body = { success: false, message: "Chưa cấu hình dịch vụ gửi email (thiếu SENDGRID_API_KEY/SENDGRID_FROM_EMAIL)." };
    return;
  }
  sgMail.setApiKey(apiKey);

  const messageHtml = escapeHtml(message).replace(/\n/g, "<br>");

  let sentCount = 0;
  const failed = [];

  for (const email of recipients) {
    try {
      const displayName = await getMemberDisplayName(email);
      const greeting = buildGreeting(displayName);
      await sgMail.send({
        to: email,
        from: { email: fromEmail, name: "Mạng Lưới Tri Thức Việt Nam" },
        subject,
        html: buildBulkEmailHtml(subject, messageHtml, greeting)
      });
      sentCount++;
    } catch (err) {
      context.log.error(`Gửi email tới ${email} thất bại:`, err?.response?.body || err.message);
      failed.push(email);
    }
  }

  context.res.status = 200;
  context.res.body = {
    success: true,
    sentCount,
    failedCount: failed.length,
    failed
  };
};
