const { getTableClient } = require("../_shared/tableStorage");

const SESSION_TABLE = "AuthSessions";
const PROFILES_TABLE = "MemberProfiles";

function getMemberToken(req) {
  const header = req.headers && (req.headers["x-member-token"] || req.headers["X-Member-Token"]);
  return header ? header.trim() : null;
}

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
    const body = req.body || {};
    const fullName = String(body.fullName || "").trim();
    const phone = String(body.phone || "").trim();
    const address = String(body.address || "").trim();
    let dob = String(body.dob || "").trim();
    if (dob) {
      const dobYear = Number(dob.slice(0, 4));
      const currentYear = new Date().getFullYear();
      if (isNaN(dobYear) || dobYear < 1920 || dobYear > currentYear) {
        dob = ""; // Bỏ qua giá trị năm sinh bất thường thay vì lưu lại
      }
    }

    const profilesTable = await getTableClient(PROFILES_TABLE);
    await profilesTable.upsertEntity({
      partitionKey: "profile",
      rowKey: email,
      fullName,
      phone,
      address,
      dob,
      updatedAt: new Date().toISOString()
    }, "Merge");

    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi cập nhật thông tin thành viên:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
