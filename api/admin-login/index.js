const crypto = require("crypto");
const { getTableClient } = require("../_shared/tableStorage");
const { ADMIN_SESSION_TABLE } = require("../_shared/adminAuth");

const SESSION_TTL_HOURS = 12;

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    context.log.error("Thiếu ADMIN_PASSWORD trong Application settings.");
    context.res.status = 500;
    context.res.body = { success: false, message: "Chưa cấu hình mật khẩu quản trị." };
    return;
  }

  const password = String((req.body && req.body.password) || "");
  if (!password) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Vui lòng nhập mật khẩu." };
    return;
  }

  // So sánh an toàn (không lộ thời gian xử lý khác nhau giữa đúng/sai)
  const a = Buffer.from(password);
  const b = Buffer.from(adminPassword);
  const isValid = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!isValid) {
    context.res.status = 401;
    context.res.body = { success: false, message: "Mật khẩu quản trị không đúng." };
    return;
  }

  try {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();
    const sessionTable = await getTableClient(ADMIN_SESSION_TABLE);
    await sessionTable.upsertEntity({
      partitionKey: "admin-session",
      rowKey: token,
      expiresAt,
      createdAt: new Date().toISOString()
    }, "Replace");

    context.res.status = 200;
    context.res.body = { success: true, token };
  } catch (err) {
    context.log.error("Lỗi đăng nhập quản trị:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
