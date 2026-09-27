const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin, ADMIN_ACCOUNTS_TABLE } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  if (!email) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu email." };
    return;
  }

  try {
    const accountsTable = await getTableClient(ADMIN_ACCOUNTS_TABLE);

    let activeCount = 0;
    let targetIsActive = true;
    for await (const entity of accountsTable.listEntities()) {
      if (entity.isActive !== false) activeCount++;
      if (entity.rowKey === email) targetIsActive = entity.isActive !== false;
    }
    if (targetIsActive && activeCount <= 1) {
      context.res.status = 409;
      context.res.body = { success: false, message: "Không thể xoá tài khoản quản trị đang hoạt động cuối cùng." };
      return;
    }

    try {
      await accountsTable.deleteEntity("admin", email);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Không tìm thấy tài khoản này." };
        return;
      }
      throw err;
    }

    await logAdminActivity(req, "Xoá tài khoản quản trị", email);

    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi xoá tài khoản quản trị:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
