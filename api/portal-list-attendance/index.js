const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");

const ATTENDANCE_TABLE = "Attendance";

// body: { program?, date? } — không truyền gì thì trả toàn bộ (dùng để admin xem lịch sử điểm danh
// và tính tỉ lệ chuyên cần theo học sinh); có program/date thì lọc để tải lại đúng buổi đang xem.
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req, "attendance"))) return;

  const body = req.body || {};
  const program = String(body.program || "").trim();
  const date = String(body.date || "").trim();

  try {
    const table = await getTableClient(ATTENDANCE_TABLE);
    const filters = [];
    if (program) filters.push(`PartitionKey eq '${program.replace(/'/g, "''")}'`);
    if (date) filters.push(`date eq '${date.replace(/'/g, "''")}'`);
    const queryOptions = filters.length > 0 ? { queryOptions: { filter: filters.join(" and ") } } : undefined;

    const records = [];
    const iterator = queryOptions ? table.listEntities(queryOptions) : table.listEntities();
    for await (const entity of iterator) {
      records.push({
        program: entity.partitionKey,
        date: entity.date,
        studentId: entity.studentId,
        studentName: entity.studentName,
        parentEmail: entity.parentEmail,
        status: entity.status,
        note: entity.note || ""
      });
    }
    records.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Đơn phụ huynh xin nghỉ cho đúng ngày đang điểm danh -> để màn điểm danh tự đánh "Vắng"
    const leaves = [];
    if (date) {
      try {
        const lt = await getTableClient("LeaveRequests");
        for await (const l of lt.listEntities({ queryOptions: { filter: `date eq '${date.replace(/'/g, "''")}'` } })) {
          leaves.push({ studentId: l.studentId, studentName: l.studentName || "", reason: l.reason || "", status: l.status || "submitted" });
        }
      } catch (e) { /* không chặn điểm danh */ }
    }

    context.res.status = 200;
    context.res.body = { success: true, records, leaves };
  } catch (err) {
    context.log.error("Lỗi lấy điểm danh:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
