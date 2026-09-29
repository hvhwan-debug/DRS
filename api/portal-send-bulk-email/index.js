const { logAdminActivity, summarizeBody } = require("../_shared/activityLog");
const { requireAdmin } = require("../_shared/adminAuth");
const { getMemberDisplayName, getMemberGender, buildGreeting, salutationFor } = require("../_shared/memberName");
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

  if (!(await requireAdmin(context, req, "bulkemail"))) return;

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

  if (!process.env.GRAPH_TENANT_ID || !process.env.GRAPH_CLIENT_ID || !process.env.GRAPH_CLIENT_SECRET || !process.env.GRAPH_SENDER_EMAIL) {
    context.res.status = 500;
    context.res.body = { success: false, message: "Chưa cấu hình dịch vụ gửi email (thiếu GRAPH_TENANT_ID/GRAPH_CLIENT_ID/GRAPH_CLIENT_SECRET/GRAPH_SENDER_EMAIL)." };
    return;
  }

  const messageHtml = escapeHtml(message).replace(/\n/g, "<br>");

  let sentCount = 0;
  const failed = [];

  // Tôn trọng tuỳ chọn của thành viên: ai tắt "Tin tức & sự kiện" thì không nhận email hàng loạt
  const optedOut = new Set();
  try {
    const { getTableClient: gtc } = require("../_shared/tableStorage");
    const pt = await gtc("MemberProfiles");
    for await (const p of pt.listEntities({ queryOptions: { select: ["rowKey", "prefsJson"] } })) {
      try { if (JSON.parse(p.prefsJson || "{}").news === false) optedOut.add(String(p.rowKey).toLowerCase()); } catch (e) {}
    }
  } catch (e) {}
  const skipped = recipients.filter(e => optedOut.has(String(e).toLowerCase()));
  recipients = recipients.filter(e => !optedOut.has(String(e).toLowerCase()));
  for (const email of recipients) {
    const displayName = await getMemberDisplayName(email);
    const gender = await getMemberGender(email);
    const greeting = buildGreeting(displayName, gender);
    // Trường chèn trong nội dung/tiêu đề: {{XungHo}} -> anh/chị (chưa rõ: anh/chị), {{XungHoHoa}} -> Anh/Chị, {{HoTen}}
    const xh = salutationFor(gender) || "anh/chị";
    const fill = (t, nameText) => t.replace(/\{\{\s*XungHoHoa\s*\}\}/gi, xh.charAt(0).toUpperCase() + xh.slice(1))
      .replace(/\{\{\s*XungHo\s*\}\}/gi, xh)
      .replace(/\{\{\s*HoTen\s*\}\}/gi, nameText);
    // Mỗi người nhận tự thấy đúng bản giao diện của hạng mình (thường / premium) — sendTrackedEmail lo việc này.
    const result = await sendTrackedEmail(context, {
      to: email,
      subject: fill(subject, displayName || ""),
      type: "bulk",
      eyebrow: "Thông Báo Từ Đội Ngũ",
      title: escapeHtml(fill(subject, displayName || "")),
      bodyHtml: `
        <p style="margin:0 0 16px;">${greeting}</p>
        <div style="line-height:1.7; white-space:pre-wrap;">${fill(messageHtml, escapeHtml(displayName || ""))}</div>`
    });
    if (result.success) sentCount++;
    else failed.push(email);
  }

  await logAdminActivity(req, "Gửi email hàng loạt", summarizeBody(req.body));
  context.res.status = 200;
  context.res.body = {
    success: true,
    sentCount,
    optedOutCount: skipped.length,
    failedCount: failed.length,
    failed
  };
};
