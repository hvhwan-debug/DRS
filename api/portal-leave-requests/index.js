const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin, getAdminIdentity } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");

// Đơn xin nghỉ học phụ huynh gửi từ trang thành viên.
//   GET                                   -> danh sách (mặc định: từ 14 ngày trước trở đi)
//   POST { email, key, action: "ack" }    -> đánh dấu "Đã ghi nhận" (giáo viên đã biết)
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireAdmin(context, req))) return;
  try {
    const t = await getTableClient("LeaveRequests");
    if ((req.method || "GET").toUpperCase() === "POST") {
      const b = req.body || {};
      const email = String(b.email || "").toLowerCase(), key = String(b.key || "");
      if (!email || !/^\d{4}-\d{2}-\d{2}_[A-Za-z0-9_-]+$/.test(key)) { context.res.status = 400; context.res.body = { success: false, message: "Thiếu thông tin đơn." }; return; }
      const who = (await getAdminIdentity(req)) || {};
      await t.updateEntity({ partitionKey: email, rowKey: key, status: "acknowledged", ackBy: who.displayName || who.email || "", ackAt: new Date().toISOString() }, "Merge");
      await logAdminActivity(req, "Ghi nhận đơn xin nghỉ học", `${email} - ${key}`);
      context.res.status = 200; context.res.body = { success: true }; return;
    }
    const since = new Date(Date.now() + 7 * 3600e3 - 14 * 864e5).toISOString().slice(0, 10);
    const rows = [];
    for await (const r of t.listEntities()) {
      if (String(r.date) < since) continue;
      rows.push({ email: r.partitionKey, key: r.rowKey, studentId: r.studentId, studentName: r.studentName || "", program: r.program || "", date: r.date, reason: r.reason || "", status: r.status || "submitted", createdAt: r.createdAt, ackBy: r.ackBy || "" });
    }
    rows.sort((a, b) => (a.status === "submitted" ? 0 : 1) - (b.status === "submitted" ? 0 : 1) || String(a.date).localeCompare(String(b.date)));
    context.res.status = 200; context.res.body = { success: true, leaves: rows };
  } catch (err) {
    context.log.error("Lỗi đơn xin nghỉ:", err.message);
    context.res.status = 500; context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
