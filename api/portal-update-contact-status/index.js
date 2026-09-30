const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");

const TABLE = "ContactMessages";
const VALID = ["Mới", "Đã trả lời"];

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireAdmin(context, req, "registrations"))) return;

  const b = req.body || {};
  const id = String(b.id || "").trim();
  const status = String(b.status || "").trim();
  if (!id || !VALID.includes(status)) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu thông tin hoặc trạng thái không hợp lệ." };
    return;
  }

  try {
    const table = await getTableClient(TABLE);
    await table.updateEntity({ partitionKey: "message", rowKey: id, status }, "Merge");
    await logAdminActivity(req, "Liên hệ: cập nhật trạng thái", `${id} - ${status}`);
    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    if (err.statusCode === 404) {
      context.res.status = 404;
      context.res.body = { success: false, message: "Không tìm thấy tin nhắn này." };
      return;
    }
    context.log.error("Lỗi cập nhật trạng thái liên hệ:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
