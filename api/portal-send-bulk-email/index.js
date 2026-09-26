const { requireAdmin } = require("../_shared/adminAuth");
const { getMemberDisplayName, buildGreeting } = require("../_shared/memberName");
const { sendTrackedEmail } = require("../_shared/sendTrackedEmail");

const MAX_RECIPIENTS = 500; // giới hạn an toàn cho 1 lần gửi

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

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    context.res.status = 500;
    context.res.body = { success: false, message: "Chưa cấu hình dịch vụ gửi email (thiếu SMTP_USER/SMTP_PASS)." };
    return;
  }

  const messageHtml = escapeHtml(message).replace(/\n/g, "<br>");

  let sentCount = 0;
  const failed = [];

  for (const email of recipients) {
    const displayName = await getMemberDisplayName(email);
    const greeting = buildGreeting(displayName);
    // Mỗi người nhận tự thấy đúng bản giao diện của hạng mình (thường / premium) — sendTrackedEmail lo việc này.
    const result = await sendTrackedEmail(context, {
      to: email,
      subject,
      type: "bulk",
      eyebrow: "Thông Báo Từ Đội Ngũ",
      title: subject,
      bodyHtml: `
        <p style="margin:0 0 16px;">${greeting}</p>
        <div style="line-height:1.7; white-space:pre-wrap;">${messageHtml}</div>`
    });
    if (result.success) sentCount++;
    else failed.push(email);
  }

  context.res.status = 200;
  context.res.body = {
    success: true,
    sentCount,
    failedCount: failed.length,
    failed
  };
};
