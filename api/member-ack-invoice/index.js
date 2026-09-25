const { getTableClient } = require("../_shared/tableStorage");

const SESSION_TABLE = "AuthSessions";
const PROFILES_TABLE = "MemberProfiles";

function getMemberToken(req) {
  const header = req.headers && (req.headers["x-member-token"] || req.headers["X-Member-Token"]);
  return header ? header.trim() : null;
}

// Gọi khi thành viên bấm "Để sau" (hoặc "Thanh toán ngay") trên popup hoá đơn mới —
// ghi lại id hoá đơn đã xem để lần đăng nhập sau không hiện lại popup cho hoá đơn đó nữa.
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  const token = getMemberToken(req);
  if (!token) {
    context.res.status = 401;
    context.res.body = { success: false, message: "Chưa đăng nhập." };
    return;
  }

  const invoiceId = String((req.body && req.body.invoiceId) || "").trim();
  if (!invoiceId) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu invoiceId." };
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
    const profilesTable = await getTableClient(PROFILES_TABLE);
    let ackedIds = [];
    try {
      const p = await profilesTable.getEntity("profile", email);
      ackedIds = JSON.parse(p.ackedInvoiceIds || "[]");
    } catch (e) { /* chưa có hồ sơ hoặc chưa có danh sách -> mảng rỗng */ }

    if (!ackedIds.includes(invoiceId)) ackedIds.push(invoiceId);

    await profilesTable.upsertEntity({
      partitionKey: "profile",
      rowKey: email,
      ackedInvoiceIds: JSON.stringify(ackedIds)
    }, "Merge");

    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi ghi nhận đã xem hoá đơn:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
