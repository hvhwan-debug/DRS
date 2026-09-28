const { getTableClient } = require("../_shared/tableStorage");
const { requireSuperAdmin, checkSuperAdminLock, ADMIN_ACCOUNTS_TABLE } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireSuperAdmin(context, req))) return;

  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  const isActive = !!(req.body && req.body.isActive);
  if (!email) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu email." };
    return;
  }

  try {
    const accountsTable = await getTableClient(ADMIN_ACCOUNTS_TABLE);

    if (!isActive) {
      // Không cho vô hiệu hoá tài khoản quản trị ĐANG HOẠT ĐỘNG cuối cùng, VÀ không cho vô hiệu
      // hoá Quản Trị Viên Chính đang hoạt động cuối cùng (nếu không sẽ không còn ai gán được vai
      // trò/quyền cho người khác nữa — vẫn còn "chìa khoá dự phòng" ADMIN_PASSWORD, nhưng nên tránh).
      let activeCount = 0;
      let activeSuperCount = 0;
      let targetIsCurrentlyActive = true;
      let targetRole = "staff";
      for await (const entity of accountsTable.listEntities()) {
        const active = entity.isActive !== false;
        if (active) activeCount++;
        if (active && entity.role === "super") activeSuperCount++;
        if (entity.rowKey === email) {
          targetIsCurrentlyActive = active;
          targetRole = entity.role === "super" ? "super" : "staff";
        }
      }
      {
        const blocked = await checkSuperAdminLock(req, email, targetRole, "disable");
        if (blocked) { context.res.status = blocked.status; context.res.body = { success: false, message: blocked.message, locked: true }; return; }
      }
      if (targetIsCurrentlyActive && activeCount <= 1) {
        context.res.status = 409;
        context.res.body = { success: false, message: "Không thể vô hiệu hoá tài khoản quản trị đang hoạt động cuối cùng." };
        return;
      }
      if (targetIsCurrentlyActive && targetRole === "super" && activeSuperCount <= 1) {
        context.res.status = 409;
        context.res.body = { success: false, message: "Không thể vô hiệu hoá Quản Trị Viên Chính đang hoạt động cuối cùng." };
        return;
      }
    }

    try {
      await accountsTable.updateEntity({ partitionKey: "admin", rowKey: email, isActive }, "Merge");
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Không tìm thấy tài khoản này." };
        return;
      }
      throw err;
    }

    await logAdminActivity(req, isActive ? "Kích hoạt tài khoản quản trị" : "Vô hiệu hoá tài khoản quản trị", email);

    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi cập nhật tài khoản quản trị:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
