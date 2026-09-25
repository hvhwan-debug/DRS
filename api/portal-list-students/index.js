const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");

const STUDENTS_TABLE = "Students";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  try {
    const studentsTable = await getTableClient(STUDENTS_TABLE);
    const students = [];
    for await (const entity of studentsTable.listEntities()) {
      let programs = [];
      try {
        programs = JSON.parse(entity.programsJson || "[]");
      } catch (e) { /* dữ liệu cũ chưa có programsJson -> dùng fallback bên dưới */ }
      if (!Array.isArray(programs) || programs.length === 0) {
        programs = entity.program ? [entity.program] : [];
      }
      students.push({
        id: entity.rowKey,
        parentEmail: entity.partitionKey,
        studentName: entity.studentName,
        dob: entity.dob || "",
        program: entity.program || "", // tương thích ngược
        programs,
        note: entity.note || "",
        enrolledAt: entity.enrolledAt
      });
    }
    students.sort((a, b) => a.studentName.localeCompare(b.studentName));

    context.res.status = 200;
    context.res.body = { success: true, students };
  } catch (err) {
    context.log.error("Lỗi lấy danh sách học sinh:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
