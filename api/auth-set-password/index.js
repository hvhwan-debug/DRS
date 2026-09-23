const crypto = require("crypto");
const { getTableClient } = require("../_shared/tableStorage");
const { hashPassword } = require("../_shared/password");

const RESET_TABLE = "AuthResetTokens";
const MEMBERS_TABLE = "Members";
const SESSION_TABLE = "AuthSessions";
const SESSION_TTL_DAYS = 30;
const MIN_PASSWORD_LENGTH = 6;

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  const resetToken = String((req.body && req.body.resetToken) || "").trim();
  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  const password = String((req.body && req.body.password) || "");

  if (!resetToken || !email || !password) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu thông tin cần thiết." };
    return;
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    context.res.status = 400;
    context.res.body = { success: false, message: `Mật khẩu cần tối thiểu ${MIN_PASSWORD_LENGTH} ký tự.` };
    return;
  }

  try {
    const resetTable = await getTableClient(RESET_TABLE);
    let resetEntity;
    try {
      resetEntity = await resetTable.getEntity("reset", resetToken);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 400;
        context.res.body = { success: false, message: "Yêu cầu đã hết hạn, vui lòng xác minh lại email." };
        return;
      }
      throw err;
    }

    if (resetEntity.email !== email || new Date(resetEntity.expiresAt).getTime() < Date.now()) {
      context.res.status = 400;
      context.res.body = { success: false, message: "Yêu cầu không hợp lệ hoặc đã hết hạn, vui lòng xác minh lại email." };
      return;
    }

    // Hợp lệ -> lưu mật khẩu, xoá vé dùng 1 lần, tạo phiên đăng nhập
    await resetTable.deleteEntity("reset", resetToken).catch(() => {});

    const { salt, hash } = hashPassword(password);
    const membersTable = await getTableClient(MEMBERS_TABLE);
    await membersTable.upsertEntity({
      partitionKey: "member",
      rowKey: email,
      passwordSalt: salt,
      passwordHash: hash,
      failedAttempts: 0,
      updatedAt: new Date().toISOString()
    }, "Replace");

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
    context.log.error("Lỗi đặt mật khẩu:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
