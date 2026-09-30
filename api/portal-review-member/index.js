const { requireAdmin, getAdminIdentity } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");
const { reviewMemberAccount } = require("../_shared/memberApproval");

// Duyệt / từ chối tài khoản thành viên tự đăng ký (từ Trang Quản Trị).
// Body: { email, action: "approve" | "reject", reason? }
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req, "members"))) return;

  const body = req.body || {};
  const email = String(body.email || "").trim().toLowerCase();
  const action = String(body.action || "");
  const reason = String(body.reason || "").trim().slice(0, 500);

  if (!email || !["approve", "reject"].includes(action)) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu email hoặc thao tác không hợp lệ." };
    return;
  }

  try {
    const approve = action === "approve";
    const by = (await getAdminIdentity(req)) || { displayName: "Quản trị viên" };
    const result = await reviewMemberAccount(context, { email, approve, reason, by });
    if (result.notFound) {
      context.res.status = 404;
      context.res.body = { success: false, message: "Không tìm thấy tài khoản này." };
      return;
    }
    await logAdminActivity(req, approve ? "Duyệt tài khoản thành viên" : "Từ chối tài khoản thành viên", email + (reason && !approve ? ` - ${reason}` : ""));

    context.res.status = 200;
    context.res.body = {
      success: true,
      warning: result.emailSent ? null : (approve ? "Đã duyệt tài khoản, nhưng gửi email báo thất bại." : "Đã từ chối tài khoản, nhưng gửi email báo thất bại.")
    };
  } catch (err) {
    context.log.error("Lỗi duyệt tài khoản thành viên:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
