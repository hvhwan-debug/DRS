const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");

const SCHEDULE_TABLE = "ClassSchedules";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const id = String((req.body && req.body.id) || "").trim();
  if (!id) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu id lịch học." };
    return;
  }

  try {
    const scheduleTable = await getTableClient(SCHEDULE_TABLE);
    await scheduleTable.deleteEntity("schedule", id);
    await logAdminActivity(req, "Xoá lịch học", `id: ${id}`);
    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    if (err.statusCode === 404) {
      context.res.status = 404;
      context.res.body = { success: false, message: "Không tìm thấy lịch học này." };
      return;
    }
    context.log.error("Lỗi xoá lịch học:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
