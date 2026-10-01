const crypto = require("crypto");
const { logAdminActivity, summarizeBody } = require("../_shared/activityLog");
const { requireAdmin } = require("../_shared/adminAuth");
const { getMemberDisplayName, getMemberGender, buildGreeting, salutationFor } = require("../_shared/memberName");
const { sendTrackedEmail } = require("../_shared/sendTrackedEmail");
const { isMarketingOptedOut } = require("../_shared/marketingConsent");
const { getTableClient } = require("../_shared/tableStorage");

const MAX_RECIPIENTS = 500; // giới hạn an toàn cho 1 lần gửi
const DEDUPE_DAYS = 60;     // đã nhận đúng nội dung này trong 60 ngày qua thì không gửi lại (trừ khi chọn gửi lại)
const CONCURRENCY = 4;      // gửi song song vừa phải: nhanh hơn, không quá tải dịch vụ gửi thư

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function mapLimit(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

// Những ai đã được gửi THÀNH CÔNG đúng nội dung này (cùng loại, tiêu đề, thân thư) trong DEDUPE_DAYS ngày qua.
// Trả về Map(email -> lần gửi gần nhất). Bảng chưa có (404) = chưa ai nhận; lỗi khác thì ném ra để KHÔNG gửi mù.
async function alreadyReceived(campaignKey) {
  const since = new Date(Date.now() - DEDUPE_DAYS * 864e5).toISOString();
  const map = new Map();
  try {
    const t = await getTableClient("EmailLogs");
    const filter = `PartitionKey eq 'log' and campaignKey eq '${campaignKey}' and success eq true and sentAt ge '${since}'`;
    for await (const e of t.listEntities({ queryOptions: { filter } })) {
      const k = String(e.to || "").toLowerCase();
      if (!map.has(k) || String(e.sentAt) > String(map.get(k))) map.set(k, e.sentAt);
    }
  } catch (err) {
    if (err && err.statusCode === 404) return map;
    throw err;
  }
  return map;
}

// Gửi email hàng loạt. Các lớp bảo vệ người nhận:
//   1. Bỏ qua người đã huỷ nhận quảng cáo (chỉ với loại "Bản tin / khuyến mãi").
//   2. KHÔNG gửi lại cho người đã nhận đúng nội dung này (dấu vân tay = loại + tiêu đề + nội dung) — chặn trùng do
//      bấm gửi lại, do mạng treo rồi gửi lần nữa, hoặc gửi lại cùng một bản tin. Muốn chủ động gửi lại: force = true.
//   3. dryRun = true: chỉ tính xem sẽ gửi cho bao nhiêu người, bỏ qua bao nhiêu và vì sao — không gửi gì cả.
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req, "bulkemail"))) return;

  const body = req.body || {};
  const subject = String(body.subject || "").trim();
  const message = String(body.message || "").trim();
  const dryRun = body.dryRun === true;
  const force = body.force === true;
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

  if (!dryRun && (!process.env.GRAPH_TENANT_ID || !process.env.GRAPH_CLIENT_ID || !process.env.GRAPH_CLIENT_SECRET || !process.env.GRAPH_SENDER_EMAIL)) {
    context.res.status = 500;
    context.res.body = { success: false, message: "Chưa cấu hình dịch vụ gửi email (thiếu GRAPH_TENANT_ID/GRAPH_CLIENT_ID/GRAPH_CLIENT_SECRET/GRAPH_SENDER_EMAIL)." };
    return;
  }

  // Loại email: "marketing" (bản tin/khuyến mãi — tự bỏ qua người đã huỷ nhận) hoặc "notice" (thông báo quan trọng
  // như nghỉ học, đổi lịch — gửi cho tất cả). Mặc định là quảng cáo để không làm phiền người đã huỷ.
  const category = body.category === "notice" ? "notice" : "marketing";
  const campaignKey = crypto.createHash("sha1").update([category, subject, message].join("\n")).digest("hex").slice(0, 16);

  let received;
  try { received = await alreadyReceived(campaignKey); }
  catch (err) {
    context.log.error("Không kiểm tra được lịch sử gửi:", err.message);
    context.res.status = 503;
    context.res.body = { success: false, message: "Chưa kiểm tra được lịch sử gửi nên tạm dừng để tránh gửi trùng. Vui lòng thử lại sau ít phút." };
    return;
  }
  const dupSet = force ? new Set() : new Set(received.keys());
  const lastReceivedAt = Array.from(received.values()).sort().pop() || "";

  // ---- Xem trước: không gửi gì
  if (dryRun) {
    const optedOut = category === "marketing" ? await mapLimit(recipients, 8, isMarketingOptedOut) : recipients.map(() => false);
    const optedOutCount = optedOut.filter((v, i) => v && !dupSet.has(recipients[i])).length;
    const duplicateCount = recipients.filter(r => dupSet.has(r)).length;
    context.res.status = 200;
    context.res.body = {
      success: true, dryRun: true, total: recipients.length, optedOutCount, duplicateCount,
      willSend: recipients.length - optedOutCount - duplicateCount, lastReceivedAt, dedupeDays: DEDUPE_DAYS, campaignKey
    };
    return;
  }

  const messageHtml = escapeHtml(message).replace(/\n/g, "<br>");

  let sentCount = 0;
  const failed = [];
  const skipped = [];
  const duplicates = recipients.filter(r => dupSet.has(r));
  const toSend = recipients.filter(r => !dupSet.has(r));

  await mapLimit(toSend, CONCURRENCY, async email => {
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
      type: category === "notice" ? "notice" : "bulk",
      eyebrow: category === "notice" ? "Thông Báo Quan Trọng" : "Tin Tức Từ Tri thức Việt",
      title: escapeHtml(fill(subject, displayName || "")),
      campaignKey,
      bodyHtml: `
        <p style="margin:0 0 16px;">${greeting}</p>
        <div style="line-height:1.7; white-space:pre-wrap;">${fill(messageHtml, escapeHtml(displayName || ""))}</div>`
    });
    if (result.success) sentCount++;
    else if (result.skipped) skipped.push(email);
    else failed.push(email);
  });

  await logAdminActivity(req, "Gửi email hàng loạt", summarizeBody(req.body));
  context.res.status = 200;
  context.res.body = {
    success: true,
    sentCount,
    optedOutCount: skipped.length,
    duplicateCount: duplicates.length,
    failedCount: failed.length,
    failed,
    campaignKey
  };
};
