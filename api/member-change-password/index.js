const { getTableClient } = require("../_shared/tableStorage");
const { hashPassword, verifyPassword } = require("../_shared/password");
const { getMemberDisplayName, buildGreeting } = require("../_shared/memberName");
const { sendTrackedEmail } = require("../_shared/sendTrackedEmail");

const SESSION_TABLE = "AuthSessions";
const MEMBERS_TABLE = "Members";
const MIN_PASSWORD_LENGTH = 6;

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

  const body = req.body || {};
  const currentPassword = String(body.currentPassword || "");
  const newPassword = String(body.newPassword || "");

  if (!currentPassword || !newPassword) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Vui lòng nhập đủ mật khẩu hiện tại và mật khẩu mới." };
    return;
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    context.res.status = 400;
    context.res.body = { success: false, message: `Mật khẩu mới cần tối thiểu ${MIN_PASSWORD_LENGTH} ký tự.` };
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

    const membersTable = await getTableClient(MEMBERS_TABLE);
    let member;
    try {
      member = await membersTable.getEntity("member", email);
    } catch (err) {
      context.res.status = 404;
      context.res.body = { success: false, message: "Không tìm thấy tài khoản." };
      return;
    }

    const isValid = verifyPassword(currentPassword, member.passwordSalt, member.passwordHash);
    if (!isValid) {
      context.res.status = 401;
      context.res.body = { success: false, message: "Mật khẩu hiện tại không đúng." };
      return;
    }

    const { salt, hash } = hashPassword(newPassword);
    await membersTable.updateEntity({
      partitionKey: "member",
      rowKey: email,
      passwordSalt: salt,
      passwordHash: hash,
      failedAttempts: 0,
      updatedAt: new Date().toISOString()
    }, "Merge");

    // Email bảo mật: luôn báo khi mật khẩu vừa bị đổi, để phát hiện sớm nếu không phải chính chủ thực hiện.
    const displayName = await getMemberDisplayName(email);
    const greeting = buildGreeting(displayName);
    await sendTrackedEmail(context, {
      to: email,
      subject: "Mật khẩu tài khoản của bạn vừa được thay đổi",
      type: "profile_update",
      eyebrow: "Bảo Mật Tài Khoản",
      title: "Mật khẩu đã được thay đổi",
      bodyHtml: `
        <p style="margin:0 0 16px;">${greeting}</p>
        <p style="margin:0;">Mật khẩu tài khoản của bạn tại Mạng Lưới Tri Thức Việt Nam vừa được thay đổi thành công vào lúc ${new Date().toLocaleString("vi-VN")}.</p>
        <p style="font-size:13px; color:#64748b; margin:14px 0 0;">Nếu bạn không thực hiện thay đổi này, vui lòng liên hệ với chúng tôi ngay để được hỗ trợ bảo vệ tài khoản.</p>`
    });

    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi đổi mật khẩu:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
