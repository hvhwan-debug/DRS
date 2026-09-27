const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin, getAdminIdentity, ADMIN_ACCOUNTS_TABLE } = require("../_shared/adminAuth");
const { hashPassword, verifyPassword } = require("../_shared/password");
const { logAdminActivity } = require("../_shared/activityLog");

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const identity = await getAdminIdentity(req);
  if (!identity || !identity.email) {
    context.res.status = 401;
    context.res.body = { success: false, message: "Không xác định được tài khoản của bạn." };
    return;
  }

  const currentPassword = String((req.body && req.body.currentPassword) || "");
  const newPassword = String((req.body && req.body.newPassword) || "");
  if (!currentPassword || newPassword.length < 6) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Mật khẩu mới cần tối thiểu 6 ký tự." };
    return;
  }

  try {
    const accountsTable = await getTableClient(ADMIN_ACCOUNTS_TABLE);
    const account = await accountsTable.getEntity("admin", identity.email);

    if (!verifyPassword(currentPassword, account.passwordSalt, account.passwordHash)) {
      context.res.status = 401;
      context.res.body = { success: false, message: "Mật khẩu hiện tại không đúng." };
      return;
    }

    const { salt, hash } = hashPassword(newPassword);
    await accountsTable.updateEntity({
      partitionKey: "admin",
      rowKey: identity.email,
      passwordSalt: salt,
      passwordHash: hash
    }, "Merge");

    await logAdminActivity(req, "Tự đổi mật khẩu quản trị", identity.email);

    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi tự đổi mật khẩu quản trị:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
