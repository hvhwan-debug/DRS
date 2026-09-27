const crypto = require("crypto");
const { getTableClient } = require("../_shared/tableStorage");
const { requireSuperAdmin, ADMIN_ACCOUNTS_TABLE } = require("../_shared/adminAuth");
const { hashPassword } = require("../_shared/password");
const { logAdminActivity } = require("../_shared/activityLog");

function generateTempPassword() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let pw = "";
  for (let i = 0; i < 10; i++) pw += chars[crypto.randomInt(chars.length)];
  return pw;
}

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireSuperAdmin(context, req))) return;

  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  if (!email) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu email." };
    return;
  }

  try {
    const accountsTable = await getTableClient(ADMIN_ACCOUNTS_TABLE);
    const tempPassword = generateTempPassword();
    const { salt, hash } = hashPassword(tempPassword);
    try {
      await accountsTable.updateEntity({
        partitionKey: "admin",
        rowKey: email,
        passwordSalt: salt,
        passwordHash: hash
      }, "Merge");
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Không tìm thấy tài khoản này." };
        return;
      }
      throw err;
    }

    await logAdminActivity(req, "Đặt lại mật khẩu quản trị", email);

    context.res.status = 200;
    context.res.body = { success: true, tempPassword };
  } catch (err) {
    context.log.error("Lỗi đặt lại mật khẩu quản trị:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
