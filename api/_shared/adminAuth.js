const { getTableClient } = require("./tableStorage");

const ADMIN_SESSION_TABLE = "AdminSessions";

function getAdminToken(req) {
  const header = req.headers && (req.headers["x-admin-token"] || req.headers["X-Admin-Token"]);
  return header ? header.trim() : null;
}

// Trả về true nếu token hợp lệ và còn hạn; tự trả lời 401 và trả về false nếu không.
async function requireAdmin(context, req) {
  const token = getAdminToken(req);
  if (!token) {
    context.res.status = 401;
    context.res.body = { success: false, message: "Chưa đăng nhập quản trị." };
    return false;
  }

  const sessionTable = await getTableClient(ADMIN_SESSION_TABLE);
  try {
    const session = await sessionTable.getEntity("admin-session", token);
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      context.res.status = 401;
      context.res.body = { success: false, message: "Phiên quản trị đã hết hạn." };
      return false;
    }
    return true;
  } catch (err) {
    if (err.statusCode === 404) {
      context.res.status = 401;
      context.res.body = { success: false, message: "Phiên quản trị không hợp lệ." };
      return false;
    }
    throw err;
  }
}

module.exports = { getAdminToken, requireAdmin, ADMIN_SESSION_TABLE };
