const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");

const TABLE = "ContactMessages";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireAdmin(context, req, "registrations"))) return;

  const b = req.body || {};
  const id = String(b.id || "").trim();
  if (!id) { context.res.status = 400; context.res.body = { success: false, message: "Thiếu thông tin." }; return; }

  try {
    const table = await getTableClient(TABLE);
    await table.deleteEntity("message", id);
    await logAdminActivity(req, "Liên hệ: xoá tin nhắn", id);
    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    if (err.statusCode === 404) {
      context.res.status = 404;
      context.res.body = { success: false, message: "Không tìm thấy tin nhắn này." };
      return;
    }
    context.log.error("Lỗi xoá tin nhắn liên hệ:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
