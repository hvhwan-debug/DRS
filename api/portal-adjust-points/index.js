const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin, getAdminIdentity } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");
const { addAdjustment, getPointsBalance } = require("../_shared/memberTier");

const MEMBERS_TABLE = "Members";

// Cộng/trừ điểm tích luỹ THỦ CÔNG cho 1 thành viên — dùng khi hệ thống tính tự động bị lệch
// (vd. do lỗi dữ liệu học phí cũ) hoặc cần thưởng/phạt điểm ngoài quy tắc thông thường.
// Ghi thành 1 dòng RIÊNG trong bảng PointAdjustments (không sửa đè số cũ) để luôn tra soát được
// ai cộng/trừ, bao nhiêu, lý do gì, lúc nào — xem listAdjustments().
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req, "members"))) return;

  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  const delta = Math.round(Number(req.body && req.body.delta));
  const reason = String((req.body && req.body.reason) || "").trim();

  if (!email) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu email." };
    return;
  }
  if (!delta || !Number.isFinite(delta)) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Số điểm không hợp lệ (phải khác 0)." };
    return;
  }
  if (!reason) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Vui lòng nhập lý do cộng/trừ điểm để tiện tra soát sau này." };
    return;
  }

  try {
    const membersTable = await getTableClient(MEMBERS_TABLE);
    try {
      await membersTable.getEntity("member", email);
    } catch (e) {
      if (e.statusCode === 404) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Không tìm thấy thành viên với email này." };
        return;
      }
      throw e;
    }

    const identity = await getAdminIdentity(req);
    await addAdjustment(email, delta, reason, identity ? identity.displayName : "");
    await logAdminActivity(req, "Cộng/trừ điểm thưởng", `${email}: ${delta > 0 ? "+" : ""}${delta} điểm - ${reason}`);

    const balance = await getPointsBalance(email);
    context.res.status = 200;
    context.res.body = {
      success: true,
      message: `Đã ${delta > 0 ? "cộng" : "trừ"} ${Math.abs(delta).toLocaleString("vi-VN")} điểm cho ${email}.`,
      balance
    };
  } catch (err) {
    context.log.error("Lỗi cộng/trừ điểm thưởng:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
