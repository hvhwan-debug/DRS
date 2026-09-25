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
      students.push({
        id: entity.rowKey,
        parentEmail: entity.partitionKey,
        studentName: entity.studentName,
        dob: entity.dob || "",
        program: entity.program || "",
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
