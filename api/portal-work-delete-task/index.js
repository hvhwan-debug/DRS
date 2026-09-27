const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin, loadSessionAndAccount, isSuperAdmin } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");
const W = require("../_shared/work");

// Chỉ người tạo công việc hoặc Quản Trị Viên Chính mới xoá được.
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireAdmin(context, req))) return;
  const id = String((req.body && req.body.id) || "");
  if (!W.isId(id)) { context.res.status = 400; context.res.body = { success: false, message: "Thiếu mã công việc." }; return; }
  try {
    const { session, account } = await loadSessionAndAccount(null, req);
    const table = await getTableClient(W.TASKS_TABLE);
    let e;
    try { e = await table.getEntity("task", id); } catch (err) { if (err.statusCode === 404) { context.res.status = 200; context.res.body = { success: true }; return; } throw err; }
    if (!isSuperAdmin(account) && e.createdBy && e.createdBy !== session.adminEmail) {
      context.res.status = 403; context.res.body = { success: false, message: "Chỉ người tạo việc hoặc Quản Trị Viên Chính mới xoá được việc này." }; return;
    }
    await table.deleteEntity("task", id);
    await logAdminActivity(req, "Xoá công việc", e.title || id);
    context.res.status = 200; context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi xoá công việc:", err.message);
    context.res.status = 500; context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
