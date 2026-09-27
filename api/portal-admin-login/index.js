const crypto = require("crypto");
const { getTableClient } = require("../_shared/tableStorage");
const { verifyPassword } = require("../_shared/password");
const { ADMIN_SESSION_TABLE, ADMIN_ACCOUNTS_TABLE } = require("../_shared/adminAuth");

const SESSION_TTL_HOURS = 12;

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  const password = String((req.body && req.body.password) || "");
  if (!email || !password) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Vui lòng nhập email và mật khẩu." };
    return;
  }

  try {
    const accountsTable = await getTableClient(ADMIN_ACCOUNTS_TABLE);
    let account;
    try {
      account = await accountsTable.getEntity("admin", email);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 401;
        context.res.body = { success: false, message: "Email hoặc mật khẩu không đúng." };
        return;
      }
      throw err;
    }

    if (account.isActive === false) {
      context.res.status = 401;
      context.res.body = { success: false, message: "Tài khoản của bạn đã bị vô hiệu hoá. Liên hệ quản trị viên khác để được hỗ trợ." };
      return;
    }

    const isValid = verifyPassword(password, account.passwordSalt, account.passwordHash);
    if (!isValid) {
      context.res.status = 401;
      context.res.body = { success: false, message: "Email hoặc mật khẩu không đúng." };
      return;
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();
    const sessionTable = await getTableClient(ADMIN_SESSION_TABLE);
    await sessionTable.upsertEntity({
      partitionKey: "admin-session",
      rowKey: token,
      adminEmail: email,
      displayName: account.displayName || email,
      expiresAt,
      createdAt: new Date().toISOString()
    }, "Replace");

    await accountsTable.upsertEntity({ partitionKey: "admin", rowKey: email, lastLoginAt: new Date().toISOString() }, "Merge");

    context.res.status = 200;
    context.res.body = { success: true, token, displayName: account.displayName || email };
  } catch (err) {
    context.log.error("Lỗi đăng nhập quản trị:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
