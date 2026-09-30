const { getTableClient } = require("../_shared/tableStorage");
const { sendTrackedEmail } = require("../_shared/sendTrackedEmail");
const W = require("../_shared/work");

// EMAIL TỔNG HỢP MỖI SÁNG cho từng thành viên đội ngũ: việc quá hạn + việc hạn hôm nay (+ việc khẩn sắp tới).
// Được GitHub Actions gọi lúc 7:00 sáng giờ Việt Nam (.github/workflows/work-daily-digest.yml).
// Bảo vệ: nếu đặt biến CRON_SECRET trên Azure thì bắt buộc header X-Cron-Secret khớp; nếu chưa đặt thì chỉ
// chạy trong khung 6:00–9:00 sáng giờ VN. Mỗi người nhận tối đa 1 email / ngày (ghi vào bảng WorkDigestLog),
// nên gọi lặp lại cũng không gửi trùng. Quản trị viên chính có thể chạy thử ngay bằng phiên đăng nhập.
const esc = s => String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const vnNow = () => new Date(Date.now() + 7 * 3600e3);
const fmt = d => d ? d.split("-").reverse().slice(0, 2).join("/") : "";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  const h = req.headers || {};
  const secret = String(process.env.CRON_SECRET || "");
  const given = String(h["x-cron-secret"] || "");
  let manual = false;
  if (h["x-admin-token"]) {
    const { requireSuperAdmin } = require("../_shared/adminAuth");
    if (!(await requireSuperAdmin(context, req))) return;
    manual = true;
  } else if (secret) {
    if (given !== secret) { context.res.status = 401; context.res.body = { success: false, message: "Sai mã." }; return; }
  } else {
    const hr = vnNow().getUTCHours();
    if (hr < 6 || hr >= 9) { context.res.status = 403; context.res.body = { success: false, message: "Ngoài khung giờ gửi (6:00–9:00 sáng)." }; return; }
  }
  try {
    const today = vnNow().toISOString().slice(0, 10);
    const in3 = new Date(Date.now() + 7 * 3600e3 + 3 * 864e5).toISOString().slice(0, 10);
    const tasks = [];
    const tt = await getTableClient(W.TASKS_TABLE);
    for await (const e of tt.listEntities({ queryOptions: { filter: "PartitionKey eq 'task'" } })) { const t = W.toTask(e); if (t.status !== "done") tasks.push(t); }
    const acc = await getTableClient("AdminAccounts");
    const staff = [];
    for await (const a of acc.listEntities({ queryOptions: { filter: "PartitionKey eq 'admin'" } })) if (a.isActive !== false && a.digestOptOut !== true) staff.push({ email: String(a.rowKey).toLowerCase(), name: a.displayName || a.rowKey });
    const log = await getTableClient("WorkDigestLog");
    let sent = 0, skipped = 0;
    const PRI = { urgent: "Khẩn", high: "Cao" };
    for (const s of staff) {
      const mine = tasks.filter(t => (t.assignees || []).map(x => String(x).toLowerCase()).includes(s.email));
      const overdue = mine.filter(t => t.dueDate && t.dueDate < today).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      const todays = mine.filter(t => t.dueDate === today);
      const soonUrgent = mine.filter(t => t.dueDate > today && t.dueDate <= in3 && (t.priority === "urgent" || t.priority === "high"));
      if (!overdue.length && !todays.length && !soonUrgent.length) { skipped++; continue; }
      let already = false; try { await log.getEntity(today, s.email); already = true; } catch (e) {}
      if (already && !manual) { skipped++; continue; }
      const row = t => `<tr><td style="padding:8px 0;border-bottom:1px solid #eef1f6;"><b style="color:#0f172a;">${esc(t.title)}</b>${PRI[t.priority] ? ` <span style="font-size:12px;color:#b91c1c;background:#fee2e2;border-radius:6px;padding:1px 6px;">${PRI[t.priority]}</span>` : ""}</td><td style="padding:8px 0;border-bottom:1px solid #eef1f6;text-align:right;color:#64748b;font-size:13px;white-space:nowrap;">${t.dueTime ? esc(t.dueTime) + " · " : ""}${fmt(t.dueDate)}</td></tr>`;
      const sec = (title, color, list) => list.length ? `<p style="margin:18px 0 6px;font-weight:700;color:${color};">${title} (${list.length})</p><table role="presentation" width="100%" style="border-collapse:collapse;">${list.slice(0, 15).map(row).join("")}</table>${list.length > 15 ? `<p style="margin:6px 0 0;color:#64748b;font-size:13px;">và ${list.length - 15} việc khác…</p>` : ""}` : "";
      const r = await sendTrackedEmail(context, {
        to: s.email, type: "work",
        subject: `☀️ Việc hôm nay của bạn: ${todays.length} việc${overdue.length ? `, ${overdue.length} quá hạn` : ""}`,
        eyebrow: "Công Việc · Tổng hợp buổi sáng", title: `Chào buổi sáng, ${esc(String(s.name).split(" ").pop())}`,
        bodyHtml: `<p style="margin:0;">Đây là những việc cần bạn quan tâm hôm nay.</p>${sec("Quá hạn", "#b91c1c", overdue)}${sec("Hạn hôm nay", "#0f172a", todays)}${sec("Ưu tiên cao trong 3 ngày tới", "#a16207", soonUrgent)}`,
        ctas: [{ label: "Mở Công Việc", href: "https://admin.wvn.vn/admin/cong-viec#today", style: "primary" }],
        footerNote: "Email gửi lúc 7:00 mỗi sáng khi bạn có việc quá hạn hoặc đến hạn. Không có việc thì không gửi."
      });
      if (r && r.success) { sent++; await log.upsertEntity({ partitionKey: today, rowKey: s.email, sentAt: new Date().toISOString() }, "Replace").catch(() => {}); }
      try {
        const { sendPush } = require("../_shared/push");
        const parts = [];
        if (overdue.length) parts.push(`${overdue.length} quá hạn`);
        if (todays.length) parts.push(`${todays.length} hạn hôm nay`);
        await sendPush(context, s.email, { title: "☀️ Việc hôm nay của bạn", body: parts.join(", ") || "Xem danh sách việc cần làm hôm nay", url: "/admin/cong-viec#today" });
      } catch (e) { /* best-effort */ }
    }
    context.res.status = 200; context.res.body = { success: true, sent, skipped, date: today };
  } catch (err) {
    context.log.error("Lỗi email tổng hợp:", err.message);
    context.res.status = 500; context.res.body = { success: false, message: "Đã có lỗi xảy ra." };
  }
};
