const { logAdminActivity, summarizeBody } = require("../_shared/activityLog");
const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin, getAdminIdentity } = require("../_shared/adminAuth");

const ATTENDANCE_TABLE = "Attendance";
const ALLOWED_STATUS = ["present", "absent", "late"];

// Lưu điểm danh cho CẢ LỚP trong 1 buổi cùng lúc — thay vì phải vào từng học sinh sửa tay.
// body: { program, date: "YYYY-MM-DD", records: [{ studentId, studentName, parentEmail, status, note }] }
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req, "attendance"))) return;

  const body = req.body || {};
  const program = String(body.program || "").trim();
  const date = String(body.date || "").trim();
  const records = Array.isArray(body.records) ? body.records : [];

  if (!program || !date || records.length === 0) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu chương trình, ngày, hoặc danh sách điểm danh." };
    return;
  }

  try {
    const table = await getTableClient(ATTENDANCE_TABLE);
    let saved = 0;
    for (const r of records) {
      const studentId = String((r && r.studentId) || "").trim();
      const status = ALLOWED_STATUS.includes(r && r.status) ? r.status : "present";
      if (!studentId) continue;
      await table.upsertEntity({
        partitionKey: program,
        rowKey: `${date}_${studentId}`,
        date,
        studentId,
        studentName: String((r && r.studentName) || "").trim(),
        parentEmail: String((r && r.parentEmail) || "").trim().toLowerCase(),
        status,
        note: String((r && r.note) || "").trim(),
        recordedAt: new Date().toISOString()
      }, "Replace");
      saved++;
    }

    // Đã điểm danh buổi đó -> đơn xin nghỉ của phụ huynh cho buổi này coi như đã được xử lý
    // (không còn hiện ở chuông thông báo / "Việc từ hệ thống")
    try {
      const lt = await getTableClient("LeaveRequests");
      const who = await getAdminIdentity(req);
      for (const r of records) {
        const email = String((r && r.parentEmail) || "").trim().toLowerCase();
        const sid = String((r && r.studentId) || "").trim();
        if (!email || !sid) continue;
        try {
          const l = await lt.getEntity(email, `${date}_${sid}`);
          if ((l.status || "submitted") === "submitted") {
            await lt.updateEntity({ partitionKey: email, rowKey: l.rowKey, status: "noted", notedAt: new Date().toISOString(), notedBy: (who && who.displayName) || "" }, "Merge");
          }
        } catch (e) { if (e.statusCode !== 404) throw e; }
      }
    } catch (e) { context.log.warn("Không cập nhật được đơn xin nghỉ:", e.message); }

    await logAdminActivity(req, "Lưu điểm danh", summarizeBody(req.body));
    context.res.status = 200;
    context.res.body = { success: true, saved };
  } catch (err) {
    context.log.error("Lỗi lưu điểm danh:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
