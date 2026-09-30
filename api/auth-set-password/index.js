const crypto = require("crypto");
const { getTableClient } = require("../_shared/tableStorage");
const { hashPassword } = require("../_shared/password");
const { getApprovalStatus, PENDING_MESSAGE, REJECTED_MESSAGE } = require("../_shared/memberApproval");

const RESET_TABLE = "AuthResetTokens";
const MEMBERS_TABLE = "Members";
const SESSION_TABLE = "AuthSessions";
const SESSION_TTL_DAYS = 30;
const MIN_PASSWORD_LENGTH = 6;
const SETUP_TTL_MINUTES = 60;

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  const resetToken = String((req.body && req.body.resetToken) || "").trim();
  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  const password = String((req.body && req.body.password) || "");

  if (!resetToken || !email || !password) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu thông tin cần thiết." };
    return;
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    context.res.status = 400;
    context.res.body = { success: false, message: `Mật khẩu cần tối thiểu ${MIN_PASSWORD_LENGTH} ký tự.` };
    return;
  }

  try {
    const resetTable = await getTableClient(RESET_TABLE);
    let resetEntity;
    try {
      resetEntity = await resetTable.getEntity("reset", resetToken);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 400;
        context.res.body = { success: false, message: "Yêu cầu đã hết hạn, vui lòng xác minh lại email." };
        return;
      }
      throw err;
    }

    if (resetEntity.email !== email || new Date(resetEntity.expiresAt).getTime() < Date.now()) {
      context.res.status = 400;
      context.res.body = { success: false, message: "Yêu cầu không hợp lệ hoặc đã hết hạn, vui lòng xác minh lại email." };
      return;
    }

    // Nếu tài khoản đã bị khoá, không cho đặt lại mật khẩu để né việc bị chặn
    const membersTable = await getTableClient(MEMBERS_TABLE);
    let existingMember = null;
    try {
      existingMember = await membersTable.getEntity("member", email);
      if (existingMember.isBlocked) {
        context.res.status = 403;
        context.res.body = { success: false, message: "Tài khoản của bạn đã bị khoá. Vui lòng liên hệ với chúng tôi để được hỗ trợ." };
        return;
      }
    } catch (err) {
      if (err.statusCode !== 404) throw err; // 404 nghĩa là tài khoản mới, chưa từng có -> tiếp tục bình thường
    }

    // Tài khoản mới đăng ký -> "pending" (chờ đội ngũ phê duyệt). Tài khoản cũ giữ nguyên trạng thái;
    // tài khoản có từ trước khi có tính năng duyệt (không có approvalStatus) coi như đã duyệt.
    const approvalStatus = existingMember ? getApprovalStatus(existingMember) : "pending";
    if (approvalStatus === "rejected") {
      context.res.status = 403;
      context.res.body = { success: false, code: "rejected", message: REJECTED_MESSAGE };
      return;
    }

    // Hợp lệ -> lưu mật khẩu (Merge để KHÔNG xoá các trường khác như trạng thái duyệt), xoá vé dùng 1 lần
    await resetTable.deleteEntity("reset", resetToken).catch(() => {});

    const { salt, hash } = hashPassword(password);
    const now = new Date().toISOString();
    await membersTable.upsertEntity({
      partitionKey: "member",
      rowKey: email,
      passwordSalt: salt,
      passwordHash: hash,
      failedAttempts: 0,
      updatedAt: now,
      ...(existingMember ? {} : { approvalStatus: "pending", createdAt: now, isBlocked: false })
    }, "Merge");

    const sessionTable = await getTableClient(SESSION_TABLE);
    const token = crypto.randomBytes(32).toString("hex");

    if (approvalStatus === "pending") {
      // Chưa được duyệt -> KHÔNG tạo phiên đăng nhập. Chỉ tạo "vé hoàn tất hồ sơ" ngắn hạn
      // (partition "setup") để điền họ tên/SĐT ở bước cuối đăng ký. Các API thành viên khác
      // chỉ nhận partition "session" nên vé này không dùng để vào khu vực thành viên được.
      await sessionTable.upsertEntity({
        partitionKey: "setup",
        rowKey: token,
        email,
        expiresAt: new Date(Date.now() + SETUP_TTL_MINUTES * 60 * 1000).toISOString(),
        createdAt: now
      }, "Replace");
      context.res.status = 200;
      context.res.body = { success: true, pending: true, setupToken: token, email, message: PENDING_MESSAGE };
      return;
    }

    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await sessionTable.upsertEntity({
      partitionKey: "session",
      rowKey: token,
      email,
      expiresAt,
      createdAt: now
    }, "Replace");

    context.res.status = 200;
    context.res.body = { success: true, token, email };
  } catch (err) {
    context.log.error("Lỗi đặt mật khẩu:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
