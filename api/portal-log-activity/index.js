const { requireAdmin } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");

// Ghi nhật ký cho các thao tác chỉ diễn ra trên trình duyệt (hiện là xuất Excel), để tra lại ai đã
// tải dữ liệu nào, lúc nào. Chỉ nhận đúng các loại hành động cho phép; người thao tác lấy từ phiên đăng nhập.
const ALLOWED = new Set(["Xuất Excel"]);

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireAdmin(context, req))) return;
  const b = req.body || {};
  const action = String(b.action || "");
  if (!ALLOWED.has(action)) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Loại thao tác không hợp lệ." };
    return;
  }
  await logAdminActivity(req, action, String(b.details || "").slice(0, 300));
  context.res.status = 200;
  context.res.body = { success: true };
};
