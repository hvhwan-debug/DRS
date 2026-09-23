const { getTableClient } = require("../_shared/tableStorage");

const SESSION_TABLE = "AuthSessions";

function getBearerToken(req) {
  const header = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
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
