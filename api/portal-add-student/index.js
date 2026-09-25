const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");

const STUDENTS_TABLE = "Students";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const body = req.body || {};
  const id = String(body.id || "").trim(); // nếu có -> sửa, không có -> tạo mới
  const parentEmail = String(body.parentEmail || "").trim().toLowerCase();
  const studentName = String(body.studentName || "").trim();
  const dob = String(body.dob || "").trim();
  const program = String(body.program || "").trim();
  const note = String(body.note || "").trim();

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail);
  if (!emailValid || !studentName) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Vui lòng nhập đủ email phụ huynh và tên học sinh." };
    return;
  }

  try {
    const studentsTable = await getTableClient(STUDENTS_TABLE);
    const rowKey = id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await studentsTable.upsertEntity({
      partitionKey: parentEmail,
      rowKey,
      studentName,
      dob,
      program,
      note,
      enrolledAt: new Date().toISOString()
    }, "Merge");

    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi thêm/sửa học sinh:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
