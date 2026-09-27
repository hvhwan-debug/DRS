const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");
const { INTERACTIONS_TABLE, clean, isValidStudentId } = require("../_shared/crm");

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req, "students"))) return;

  const body = req.body || {};
  const studentId = clean(body.studentId, 80);
  const id = clean(body.id, 80);
  if (!isValidStudentId(studentId) || !/^[0-9]+-[a-z0-9]+$/.test(id)) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu thông tin." };
    return;
  }

  try {
    const table = await getTableClient(INTERACTIONS_TABLE);
    await table.deleteEntity(studentId, id);
    await logAdminActivity(req, "CRM: xoá ghi nhận chăm sóc", `id học sinh: ${studentId}`);
    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    if (err.statusCode === 404) {
      context.res.status = 404;
      context.res.body = { success: false, message: "Ghi nhận này không còn tồn tại." };
      return;
    }
    context.log.error("Lỗi xoá ghi nhận chăm sóc:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
