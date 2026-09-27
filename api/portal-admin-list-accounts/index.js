const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin, ADMIN_ACCOUNTS_TABLE } = require("../_shared/adminAuth");

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  try {
    const table = await getTableClient(ADMIN_ACCOUNTS_TABLE);
    const accounts = [];
    for await (const entity of table.listEntities()) {
      accounts.push({
        email: entity.rowKey,
        displayName: entity.displayName,
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
