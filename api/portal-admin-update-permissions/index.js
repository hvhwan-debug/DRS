const { getTableClient } = require("../_shared/tableStorage");
const { requireSuperAdmin, checkSuperAdminLock, ADMIN_ACCOUNTS_TABLE } = require("../_shared/adminAuth");
const { sanitizePermissions, PERMISSIONS } = require("../_shared/permissions");
const { logAdminActivity } = require("../_shared/activityLog");

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireSuperAdmin(context, req))) return;

  const body = req.body || {};
  const email = String(body.email || "").trim().toLowerCase();
  const role = body.role === "super" ? "super" : "staff";
  if (!email) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu email." };
    return;
  }

  const permissions = role === "super" ? PERMISSIONS.map(p => p.key) : sanitizePermissions(body.permissions);

  try {
    const accountsTable = await getTableClient(ADMIN_ACCOUNTS_TABLE);

    // Nếu đang HẠ tài khoản này từ Quản Trị Viên Chính xuống Nhân viên, đảm bảo vẫn còn ít nhất
    // 1 Quản Trị Viên Chính khác đang hoạt động — không thì không ai gán được quyền nữa.
    let target;
    try {
      target = await accountsTable.getEntity("admin", email);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Không tìm thấy tài khoản này." };
        return;
      }
      throw err;
    }
    const wasSuper = target.role === "super";
    // Khoá bảo vệ: không tự đổi vai trò của mình; hạ quyền 1 Quản Trị Viên Chính khác cần xác nhận email
    {
      const me = await checkSuperAdminLock(req, email, wasSuper && role !== "super" ? "super" : "staff", "demote");
      if (me) { context.res.status = me.status; context.res.body = { success: false, message: me.message, locked: true }; return; }
    }
    if (wasSuper && role !== "super") {
      let otherActiveSuperCount = 0;
      for await (const entity of accountsTable.listEntities()) {
        if (entity.rowKey !== email && entity.isActive !== false && entity.role === "super") otherActiveSuperCount++;
      }
      if (otherActiveSuperCount === 0) {
        context.res.status = 409;
        context.res.body = { success: false, message: "Không thể hạ quyền — đây là Quản Trị Viên Chính đang hoạt động cuối cùng." };
        return;
      }
    }

    await accountsTable.updateEntity({
      partitionKey: "admin",
      rowKey: email,
      role,
      permissionsJson: JSON.stringify(permissions)
    }, "Merge");

    await logAdminActivity(
      req,
      "Cập nhật vai trò/quyền",
      `${email} -> ${role === "super" ? "Quản trị viên chính (toàn quyền)" : "Nhân viên: " + (permissions.join(", ") || "chưa cấp quyền nào")}`
    );

    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi cập nhật vai trò/quyền:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
