const { getTableClient } = require("../_shared/tableStorage");
const { getTierInfoForEmail } = require("../_shared/memberTier");

const SESSION_TABLE = "AuthSessions";
const PROFILES_TABLE = "MemberProfiles";

function getMemberToken(req) {
  const header = req.headers && (req.headers["x-member-token"] || req.headers["X-Member-Token"]);
  return header ? header.trim() : null;
}

// Gọi khi thành viên đã thấy popup "Chúc mừng đổi hạng" — ghi lại hạng hiện tại để
// lần đăng nhập sau không hiện lại popup cho tới khi hạng thực sự thay đổi tiếp.
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  const token = getMemberToken(req);
  if (!token) {
    context.res.status = 401;
    context.res.body = { success: false, message: "Chưa đăng nhập." };
    return;
  }

  try {
    const sessionTable = await getTableClient(SESSION_TABLE);
    let session;
    try {
      session = await sessionTable.getEntity("session", token);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 401;
        context.res.body = { success: false, message: "Phiên đăng nhập không hợp lệ." };
        return;
      }
      throw err;
    }
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      context.res.status = 401;
      context.res.body = { success: false, message: "Phiên đăng nhập đã hết hạn." };
      return;
    }

    const email = session.email;
    const { tier } = await getTierInfoForEmail(email);

    const profilesTable = await getTableClient(PROFILES_TABLE);
    await profilesTable.upsertEntity({
      partitionKey: "profile",
      rowKey: email,
      lastSeenTier: tier.name
    }, "Merge");

    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi ghi nhận hạng đã xem:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
