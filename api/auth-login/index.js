const crypto = require("crypto");
const { getTableClient } = require("../_shared/tableStorage");
const { verifyPassword } = require("../_shared/password");

const MEMBERS_TABLE = "Members";
const SESSION_TABLE = "AuthSessions";
const SESSION_TTL_DAYS = 30;
const MAX_FAILED_ATTEMPTS = 8;

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
    const membersTable = await getTableClient(MEMBERS_TABLE);
    let member;
    try {
      member = await membersTable.getEntity("member", email);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Email này chưa có tài khoản. Vui lòng đăng ký bằng mã xác nhận." };
        return;
      }
      throw err;
    }

    if (member.isBlocked) {
      context.res.status = 403;
      context.res.body = { success: false, message: "Tài khoản của bạn đã bị khoá. Vui lòng liên hệ với chúng tôi để được hỗ trợ." };
      return;
    }

    if ((member.failedAttempts || 0) >= MAX_FAILED_ATTEMPTS) {
      context.res.status = 429;
      context.res.body = { success: false, message: "Tài khoản tạm khoá do nhập sai quá nhiều lần. Vui lòng dùng \"Quên mật khẩu\" để đặt lại." };
      return;
    }

    const isValid = verifyPassword(password, member.passwordSalt, member.passwordHash);
    if (!isValid) {
      await membersTable.updateEntity({
        partitionKey: "member",
        rowKey: email,
        failedAttempts: (member.failedAttempts || 0) + 1
      }, "Merge");
      context.res.status = 401;
      context.res.body = { success: false, message: "Mật khẩu không đúng." };
      return;
    }

    // Đăng nhập đúng -> reset số lần sai, tạo phiên đăng nhập mới
    await membersTable.updateEntity({ partitionKey: "member", rowKey: email, failedAttempts: 0 }, "Merge").catch(() => {});

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const sessionTable = await getTableClient(SESSION_TABLE);
    await sessionTable.upsertEntity({
      partitionKey: "session",
      rowKey: token,
      email,
      expiresAt,
      createdAt: new Date().toISOString()
    }, "Replace");

    context.res.status = 200;
    context.res.body = { success: true, token, email };
  } catch (err) {
    context.log.error("Lỗi đăng nhập:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
