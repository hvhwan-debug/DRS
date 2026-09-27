const crypto = require("crypto");
const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin, ADMIN_ACCOUNTS_TABLE } = require("../_shared/adminAuth");
const { hashPassword } = require("../_shared/password");
const { logAdminActivity } = require("../_shared/activityLog");

function generateTempPassword() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let pw = "";
  for (let i = 0; i < 10; i++) pw += chars[crypto.randomInt(chars.length)];
  return pw;
}

// Tạo tài khoản quản trị mới. Cho phép truy cập theo 1 trong 2 cách:
//   (a) Đang đăng nhập với 1 tài khoản quản trị đang hoạt động (dùng khi thêm nhân viên mới bình thường).
//   (b) Chưa ai đăng nhập được (VD lần đầu thiết lập, hoặc lỡ vô hiệu hoá hết mọi tài khoản):
//       cung cấp đúng "masterPassword" = ADMIN_PASSWORD trong Application settings, coi như chìa khoá
//       khôi phục dự phòng do chủ hệ thống (người quản lý Azure) nắm giữ.
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  const body = req.body || {};
  const masterPassword = String(body.masterPassword || "");
  let isAuthorized = false;
  let viaMasterKey = false;

  if (masterPassword) {
    const expected = process.env.ADMIN_PASSWORD || "";
    const a = Buffer.from(masterPassword);
    const b = Buffer.from(expected);
    if (expected && a.length === b.length && crypto.timingSafeEqual(a, b)) {
      isAuthorized = true;
      viaMasterKey = true;
    }
  }
  if (!isAuthorized) {
    isAuthorized = await requireAdmin(context, req);
    if (!isAuthorized) return; // requireAdmin đã tự trả lời 401
  }

  const email = String(body.email || "").trim().toLowerCase();
  const displayName = String(body.displayName || "").trim();
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!emailValid || !displayName) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Vui lòng nhập đúng email và tên hiển thị." };
    return;
  }

  try {
    const accountsTable = await getTableClient(ADMIN_ACCOUNTS_TABLE);
    try {
      await accountsTable.getEntity("admin", email);
      context.res.status = 409;
      context.res.body = { success: false, message: "Email này đã có tài khoản quản trị." };
      return;
    } catch (err) {
      if (err.statusCode !== 404) throw err;
      // 404 = chưa tồn tại, tiếp tục tạo mới
    }

    const tempPassword = generateTempPassword();
    const { salt, hash } = hashPassword(tempPassword);
    await accountsTable.createEntity({
      partitionKey: "admin",
      rowKey: email,
      displayName,
      passwordSalt: salt,
      passwordHash: hash,
      isActive: true,
      createdAt: new Date().toISOString(),
      lastLoginAt: ""
    });

    if (!viaMasterKey) {
      await logAdminActivity(req, "Tạo tài khoản quản trị mới", `${displayName} (${email})`);
    }

    context.res.status = 200;
    context.res.body = { success: true, email, tempPassword };
  } catch (err) {
    context.log.error("Lỗi tạo tài khoản quản trị:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
