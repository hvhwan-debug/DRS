const { getTableClient } = require("../_shared/tableStorage");
const { requireSuperAdmin } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");

const NOTES_TABLE = "EmployeeNotes";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireSuperAdmin(context, req))) return;

  const employeeId = String((req.body && req.body.employeeId) || "").trim();
  const noteId = String((req.body && req.body.noteId) || "").trim();
  if (!employeeId || !noteId) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu thông tin ghi chú cần xoá." };
    return;
  }

  try {
    const notesTable = await getTableClient(NOTES_TABLE);
    try { await notesTable.deleteEntity(employeeId, noteId); } catch (err) { if (err.statusCode !== 404) throw err; }
    await logAdminActivity(req, "Xoá ghi chú hồ sơ nhân sự", `${employeeId}/${noteId}`);
    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi xoá ghi chú hồ sơ nhân sự:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
