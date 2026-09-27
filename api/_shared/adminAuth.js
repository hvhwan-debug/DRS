const { getTableClient } = require("./tableStorage");

const ADMIN_SESSION_TABLE = "AdminSessions";
const ADMIN_ACCOUNTS_TABLE = "AdminAccounts";

function getAdminToken(req) {
  const header = req.headers && (req.headers["x-admin-token"] || req.headers["X-Admin-Token"]);
  return header ? header.trim() : null;
}

// Đọc phiên đăng nhập + tài khoản gắn với token, dùng chung cho mọi hàm kiểm tra quyền bên dưới.
// Trả về null nếu phiên/tài khoản không hợp lệ; nếu context được truyền vào, TỰ trả lời lỗi phù hợp.
async function loadSessionAndAccount(context, req) {
  const token = getAdminToken(req);
  if (!token) {
    if (context) { context.res.status = 401; context.res.body = { success: false, message: "Chưa đăng nhập quản trị." }; }
    return null;
  }

  const sessionTable = await getTableClient(ADMIN_SESSION_TABLE);
  let session;
  try {
    session = await sessionTable.getEntity("admin-session", token);
  } catch (err) {
    if (err.statusCode === 404) {
      if (context) { context.res.status = 401; context.res.body = { success: false, message: "Phiên quản trị không hợp lệ." }; }
      return null;
    }
    throw err;
  }
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    if (context) { context.res.status = 401; context.res.body = { success: false, message: "Phiên quản trị đã hết hạn." }; }
    return null;
  }

  let account = null;
  if (session.adminEmail) {
    const accountsTable = await getTableClient(ADMIN_ACCOUNTS_TABLE);
    try {
      account = await accountsTable.getEntity("admin", session.adminEmail);
    } catch (err) {
      if (err.statusCode === 404) {
        if (context) { context.res.status = 401; context.res.body = { success: false, message: "Tài khoản không còn tồn tại." }; }
        return null;
      }
      throw err;
    }
    if (account.isActive === false) {
      if (context) { context.res.status = 401; context.res.body = { success: false, message: "Tài khoản của bạn đã bị vô hiệu hoá." }; }
      return null;
    }
  }

  return { session, account };
}

function accountPermissions(account) {
  if (!account) return [];
  try {
    return JSON.parse(account.permissionsJson || "[]");
  } catch (e) {
    return [];
  }
}

function isSuperAdmin(account) {
  // Phiên KHÔNG gắn tài khoản nào thì KHÔNG được coi là quản trị viên chính. Trước đây cho qua để
  // tương thích phiên cũ (trước khi có hệ thống vai trò), nhưng mọi phiên hiện nay đều gắn email
  // khi đăng nhập và phiên chỉ sống 12 giờ, nên giữ ngoại lệ này chỉ tạo rủi ro leo thang quyền.
  if (!account) return false;
  return account.role === "super";
}

// Trả về true nếu token hợp lệ, còn hạn, tài khoản đang hoạt động. Nếu truyền permissionKey,
// còn kiểm tra thêm: quản trị viên chính (role 'super') luôn qua; tài khoản 'staff' phải được
// gán ĐÚNG quyền đó mới qua — nếu không, trả lời 403 và trả về false.
async function requireAdmin(context, req, permissionKey) {
  const result = await loadSessionAndAccount(context, req);
  if (!result) return false; // loadSessionAndAccount đã tự trả lời lỗi phù hợp

  if (permissionKey && !isSuperAdmin(result.account)) {
    const perms = accountPermissions(result.account);
    if (!perms.includes(permissionKey)) {
      context.res.status = 403;
      context.res.body = { success: false, message: "Bạn không có quyền truy cập chức năng này. Liên hệ quản trị viên chính để được cấp quyền." };
      return false;
    }
  }
  return true;
}

// Chỉ Quản Trị Viên Chính mới qua được — dùng cho các API quản lý tài khoản/vai trò,
// sao lưu dữ liệu, và xem nhật ký thao tác.
async function requireSuperAdmin(context, req) {
  const result = await loadSessionAndAccount(context, req);
  if (!result) return false;
  if (!isSuperAdmin(result.account)) {
    context.res.status = 403;
    context.res.body = { success: false, message: "Chỉ Quản Trị Viên Chính mới có quyền thực hiện thao tác này." };
    return false;
  }
  return true;
}

// Lấy danh tính admin ĐÃ XÁC THỰC từ phiên đăng nhập hiện tại — dùng cho nhật ký thao tác,
// KHÔNG dựa vào bất kỳ giá trị nào do client tự gửi lên.
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

module.exports = {
  getAdminToken, requireAdmin, requireSuperAdmin, getAdminIdentity,
  loadSessionAndAccount, accountPermissions, isSuperAdmin,
  ADMIN_SESSION_TABLE, ADMIN_ACCOUNTS_TABLE
};
