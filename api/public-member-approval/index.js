const { getTableClient } = require("../_shared/tableStorage");
const { logAdminActivity } = require("../_shared/activityLog");
const { getApprovalStatus, readApprovalToken, markApprovalTokenUsed, reviewMemberAccount } = require("../_shared/memberApproval");

// Duyệt / từ chối tài khoản thành viên bằng link trong email báo admin (không cần đăng nhập quản trị).
// GET  ?token=...                 -> thông tin tài khoản + trạng thái hiện tại (để trang xác nhận hiển thị)
// POST { token, action, reason }  -> thực hiện duyệt / từ chối
// Chỉ thực hiện bằng POST (sau khi người bấm xác nhận trên trang), để các trình quét link của hộp thư
// (tự mở link trong email để kiểm tra an toàn) không vô tình duyệt/từ chối thay admin.
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } };
  const isPost = String(req.method || "").toUpperCase() === "POST";
  const body = req.body || {};
  const token = String((isPost ? body.token : (req.query && req.query.token)) || "").trim();

  try {
    const tk = await readApprovalToken(token);
    if (!tk) {
      context.res.status = 404;
      context.res.body = { success: false, message: "Link duyệt không hợp lệ hoặc đã hết hạn. Vui lòng xử lý trong Trang Quản Trị → Thành Viên." };
      return;
    }

    const membersTable = await getTableClient("Members");
    let member;
    try { member = await membersTable.getEntity("member", tk.email); }
    catch (err) {
      if (err.statusCode !== 404) throw err;
      context.res.status = 404;
      context.res.body = { success: false, message: "Tài khoản này không còn tồn tại (có thể đã bị xoá)." };
      return;
    }

    let profile = {};
    try { profile = await (await getTableClient("MemberProfiles")).getEntity("profile", tk.email); } catch (e) { /* chưa có hồ sơ */ }
    const info = {
      email: tk.email,
      fullName: profile.fullName || "",
      phone: profile.phone || "",
      address: profile.address || "",
      dob: profile.dob || "",
      registeredAt: member.createdAt || member.updatedAt || null,
      status: getApprovalStatus(member),
      reviewedBy: member.approvalReviewedBy || "",
      reviewedAt: member.approvalReviewedAt || null
    };

    if (!isPost) {
      context.res.status = 200;
      context.res.body = { success: true, member: info };
      return;
    }

    const action = String(body.action || "");
    if (!["approve", "reject"].includes(action)) {
      context.res.status = 400;
      context.res.body = { success: false, message: "Thao tác không hợp lệ." };
      return;
    }
    // Đã được xử lý rồi (từ trang quản trị hoặc từ email khác) -> không làm lại, không gửi email trùng
    if (info.status !== "pending") {
      context.res.status = 409;
      context.res.body = { success: false, alreadyReviewed: true, member: info, message: `Tài khoản này đã được ${info.status === "approved" ? "duyệt" : "từ chối"}${info.reviewedBy ? " bởi " + info.reviewedBy : ""} trước đó.` };
      return;
    }

    const approve = action === "approve";
    const reason = String(body.reason || "").trim().slice(0, 500);
    const by = { displayName: "Duyệt qua email", email: process.env.NOTIFY_TO_EMAIL || "hotro@wvn.vn" };
    const result = await reviewMemberAccount(context, { email: tk.email, approve, reason, by });
    await markApprovalTokenUsed(token, action);
    await logAdminActivity(req, approve ? "Duyệt tài khoản thành viên (qua email)" : "Từ chối tài khoản thành viên (qua email)", tk.email + (reason && !approve ? ` - ${reason}` : ""), by);

    context.res.status = 200;
    context.res.body = {
      success: true,
      status: result.status,
      member: { ...info, status: result.status },
      warning: result.emailSent ? null : "Đã lưu, nhưng gửi email báo cho thành viên thất bại."
    };
  } catch (err) {
    context.log.error("Lỗi duyệt tài khoản qua email:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
