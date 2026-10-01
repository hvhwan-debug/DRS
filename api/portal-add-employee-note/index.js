const { getTableClient } = require("../_shared/tableStorage");
const { requireSuperAdmin, getAdminIdentity } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");

const EMPLOYEES_TABLE = "Employees";
const NOTES_TABLE = "EmployeeNotes";

// Thêm 1 dòng lịch sử công tác / đánh giá nội bộ — CHỈ GHI THÊM, không sửa/đè dòng cũ,
// để luôn giữ nguyên lịch sử thật đã xảy ra.
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireSuperAdmin(context, req))) return;

  const employeeId = String((req.body && req.body.employeeId) || "").trim();
  const note = String((req.body && req.body.note) || "").trim();
  if (!employeeId || !note) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu nội dung ghi chú." };
    return;
  }

  try {
    const employeesTable = await getTableClient(EMPLOYEES_TABLE);
    try {
      await employeesTable.getEntity("employee", employeeId);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Không tìm thấy hồ sơ nhân sự." };
        return;
      }
      throw err;
    }

    const identity = await getAdminIdentity(req);
    const at = new Date().toISOString();
    const rowKey = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const notesTable = await getTableClient(NOTES_TABLE);
    await notesTable.createEntity({
      partitionKey: employeeId, rowKey, note,
      type: String((req.body && req.body.type) || "note"),
      author: identity ? identity.displayName : "", at
    });

    await logAdminActivity(req, "Thêm ghi chú hồ sơ nhân sự", note.slice(0, 100));
    context.res.status = 200;
    context.res.body = { success: true, id: rowKey, at };
  } catch (err) {
    context.log.error("Lỗi thêm ghi chú hồ sơ nhân sự:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
