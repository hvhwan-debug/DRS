const { getTableClient } = require("./tableStorage");

const ADMIN_SESSION_TABLE = "AdminSessions";
const ADMIN_ACCOUNTS_TABLE = "AdminAccounts";

function getAdminToken(req) {
  const header = req.headers && (req.headers["x-admin-token"] || req.headers["X-Admin-Token"]);
  return header ? header.trim() : null;
}

// Trả về true nếu token hợp lệ, còn hạn, VÀ tài khoản gắn với token đó vẫn đang hoạt động
// (chưa bị vô hiệu hoá) — tự trả lời 401 và trả về false nếu không.
async function requireAdmin(context, req) {
  const token = getAdminToken(req);
  if (!token) {
    context.res.status = 401;
    context.res.body = { success: false, message: "Chưa đăng nhập quản trị." };
    return false;
  }

  const sessionTable = await getTableClient(ADMIN_SESSION_TABLE);
  let session;
  try {
    session = await sessionTable.getEntity("admin-session", token);
  } catch (err) {
    if (err.statusCode === 404) {
      context.res.status = 401;
      context.res.body = { success: false, message: "Phiên quản trị không hợp lệ." };
      return false;
    }
    throw err;
  }
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    context.res.status = 401;
    context.res.body = { success: false, message: "Phiên quản trị đã hết hạn." };
    return false;
  }

  // Tài khoản có thể đã bị người khác vô hiệu hoá SAU khi phiên này được tạo — kiểm tra lại để
  // việc vô hiệu hoá có hiệu lực ngay, không cần đợi phiên cũ tự hết hạn.
  if (session.adminEmail) {
    try {
      const accountsTable = await getTableClient(ADMIN_ACCOUNTS_TABLE);
      const account = await accountsTable.getEntity("admin", session.adminEmail);
      if (account.isActive === false) {
        context.res.status = 401;
        context.res.body = { success: false, message: "Tài khoản của bạn đã bị vô hiệu hoá." };
        return false;
      }
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 401;
        context.res.body = { success: false, message: "Tài khoản không còn tồn tại." };
        return false;
      }
      throw err;
    }
  }

  return true;
}

// Lấy danh tính admin ĐÃ XÁC THỰC từ phiên đăng nhập hiện tại — dùng cho nhật ký thao tác,
// KHÔNG dựa vào bất kỳ giá trị nào do client tự gửi lên (như tên tự nhập trước đây).
async function getAdminIdentity(req) {
  const token = getAdminToken(req);
  if (!token) return null;
  try {
    const sessionTable = await getTableClient(ADMIN_SESSION_TABLE);
    const session = await sessionTable.getEntity("admin-session", token);
    return { email: session.adminEmail || null, displayName: session.displayName || "Không rõ" };
  } catch (e) {
    return null;
  }
}

module.exports = { getAdminToken, requireAdmin, getAdminIdentity, ADMIN_SESSION_TABLE, ADMIN_ACCOUNTS_TABLE };
