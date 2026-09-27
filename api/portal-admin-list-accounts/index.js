const { getTableClient } = require("../_shared/tableStorage");
const { requireSuperAdmin, ADMIN_ACCOUNTS_TABLE } = require("../_shared/adminAuth");

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireSuperAdmin(context, req))) return;

  try {
    const table = await getTableClient(ADMIN_ACCOUNTS_TABLE);
    const accounts = [];
    for await (const entity of table.listEntities()) {
      let permissions = [];
      try { permissions = JSON.parse(entity.permissionsJson || "[]"); } catch (e) {}
      accounts.push({
        email: entity.rowKey,
        displayName: entity.displayName,
        role: entity.role === "super" ? "super" : "staff",
        permissions,
        isActive: entity.isActive !== false,
        createdAt: entity.createdAt,
        lastLoginAt: entity.lastLoginAt || null
      });
    }
    accounts.sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));

    context.res.status = 200;
    context.res.body = { success: true, accounts };
  } catch (err) {
    context.log.error("Lỗi lấy danh sách tài khoản quản trị:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
