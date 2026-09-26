const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");

const ATTENDANCE_TABLE = "Attendance";
const ALLOWED_STATUS = ["present", "absent", "late"];

// Lưu điểm danh cho CẢ LỚP trong 1 buổi cùng lúc — thay vì phải vào từng học sinh sửa tay.
// body: { program, date: "YYYY-MM-DD", records: [{ studentId, studentName, parentEmail, status, note }] }
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

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

    context.res.status = 200;
    context.res.body = { success: true, saved };
  } catch (err) {
    context.log.error("Lỗi lưu điểm danh:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
