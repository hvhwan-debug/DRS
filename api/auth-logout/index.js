const { getTableClient } = require("../_shared/tableStorage");

const SESSION_TABLE = "AuthSessions";

function getBearerToken(req) {
  // Không dùng header "Authorization" vì Azure Static Web Apps có thể can thiệp/loại bỏ
  // header này trước khi chuyển tới Azure Function (dành riêng cho hệ xác thực EasyAuth của Azure).
  // Dùng header tùy chỉnh "x-member-token" để tránh xung đột.
  const header = req.headers && (req.headers["x-member-token"] || req.headers["X-Member-Token"]);
  return header ? header.trim() : null;
}

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  const token = getBearerToken(req);
  if (token) {
    try {
      const sessionTable = await getTableClient(SESSION_TABLE);
      await sessionTable.deleteEntity("session", token);
    } catch (err) {
      // Không quan trọng nếu phiên không tồn tại hoặc đã hết hạn — vẫn coi như đăng xuất thành công
    }
  }

  context.res.status = 200;
  context.res.body = { success: true };
};
