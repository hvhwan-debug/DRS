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
  const note = String(body.note || "").trim();

  // Mục 6: 1 học sinh có thể tham gia NHIỀU chương trình cùng lúc.
  // Chấp nhận body.programs (mảng) — nếu không có thì dùng body.program (chuỗi, tương thích ngược).
  let programs = [];
  if (Array.isArray(body.programs)) {
    programs = body.programs.map(p => String(p || "").trim()).filter(Boolean);
  } else if (typeof body.programs === "string" && body.programs.trim()) {
    programs = body.programs.split(",").map(p => p.trim()).filter(Boolean);
  } else if (body.program) {
    programs = [String(body.program).trim()].filter(Boolean);
  }
  programs = Array.from(new Set(programs)); // bỏ trùng

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
      program: programs[0] || "", // giữ để tương thích ngược với code cũ chỉ đọc field "program"
      programsJson: JSON.stringify(programs),
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
