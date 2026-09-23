const crypto = require("crypto");
const { getTableClient } = require("../_shared/tableStorage");

const OTP_TABLE = "AuthOtpCodes";
const RESET_TABLE = "AuthResetTokens";
const MAX_ATTEMPTS = 5;
const RESET_TOKEN_TTL_MINUTES = 15;

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  const code = String((req.body && req.body.code) || "").trim();

  if (!email || !code) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu email hoặc mã xác nhận." };
    return;
  }

  try {
    const otpTable = await getTableClient(OTP_TABLE);

    let entity;
    try {
      entity = await otpTable.getEntity("otp", email);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 400;
        context.res.body = { success: false, message: "Chưa có mã nào được gửi cho email này, vui lòng yêu cầu lại." };
        return;
      }
      throw err;
    }

    if (entity.attempts >= MAX_ATTEMPTS) {
      context.res.status = 429;
      context.res.body = { success: false, message: "Bạn đã nhập sai quá nhiều lần, vui lòng yêu cầu mã mới." };
      return;
    }

    if (new Date(entity.expiresAt).getTime() < Date.now()) {
      context.res.status = 400;
      context.res.body = { success: false, message: "Mã đã hết hạn, vui lòng yêu cầu mã mới." };
      return;
    }

    if (entity.code !== code) {
      await otpTable.updateEntity({
        partitionKey: "otp",
        rowKey: email,
        attempts: (entity.attempts || 0) + 1
      }, "Merge");
      context.res.status = 400;
      context.res.body = { success: false, message: "Mã xác nhận không đúng, vui lòng kiểm tra lại." };
      return;
    }

    // Mã đúng -> xoá mã (không dùng lại được) và tạo "vé" tạm để đặt mật khẩu
    // (không đăng nhập ngay qua OTP — OTP chỉ dùng để xác minh quyền sở hữu email
    // khi tạo tài khoản mới hoặc quên mật khẩu; từ lần sau đăng nhập bằng mật khẩu).
    await otpTable.deleteEntity("otp", email).catch(() => {});

    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000).toISOString();

    const resetTable = await getTableClient(RESET_TABLE);
    await resetTable.upsertEntity({
      partitionKey: "reset",
      rowKey: resetToken,
      email,
      expiresAt: resetExpiresAt
    }, "Replace");

    context.res.status = 200;
    context.res.body = { success: true, resetToken, email };
  } catch (err) {
    context.log.error("Lỗi xác minh OTP:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
