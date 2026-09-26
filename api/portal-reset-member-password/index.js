const crypto = require("crypto");
const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");
const { hashPassword } = require("../_shared/password");
const { getMemberDisplayName, buildGreeting } = require("../_shared/memberName");
const { sendTrackedEmail } = require("../_shared/sendTrackedEmail");

const MEMBERS_TABLE = "Members";

function generateTempPassword() {
  // 10 ký tự dễ đọc, tránh các ký tự dễ nhầm lẫn (0/O, 1/l/I)
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let pw = "";
  for (let i = 0; i < 10; i++) {
    pw += chars[crypto.randomInt(chars.length)];
  }
  return pw;
}

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  if (!email) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu email." };
    return;
  }

  try {
    const membersTable = await getTableClient(MEMBERS_TABLE);
    try {
      await membersTable.getEntity("member", email);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Không tìm thấy tài khoản này." };
        return;
      }
      throw err;
    }

    const tempPassword = generateTempPassword();
    const { salt, hash } = hashPassword(tempPassword);
    await membersTable.updateEntity({
      partitionKey: "member",
      rowKey: email,
      passwordSalt: salt,
      passwordHash: hash,
      failedAttempts: 0,
      updatedAt: new Date().toISOString()
    }, "Merge");
    await logAdminActivity(req, "Đặt lại mật khẩu thành viên", email);

    const displayName = await getMemberDisplayName(email);
    const greeting = buildGreeting(displayName);
    const emailResult = await sendTrackedEmail(context, {
      to: email,
      subject: "Mật khẩu tài khoản của bạn đã được đặt lại",
      type: "reset_password",
      eyebrow: "Bảo Mật Tài Khoản",
      title: "Mật khẩu đã được đặt lại",
      bodyHtml: `
        <p style="margin:0 0 16px;">${greeting}</p>
        <p style="margin:0 0 18px;">Đội ngũ vừa đặt lại mật khẩu cho tài khoản của bạn theo yêu cầu. Mật khẩu tạm thời của bạn là:</p>
        <div style="text-align:center;margin:20px 0;">
          <span style="display:inline-block;font-size:22px;font-weight:800;letter-spacing:2px;color:#0369a1;background:#f0f9ff;border:1px dashed #7dd3fc;border-radius:10px;padding:12px 26px;">${tempPassword}</span>
        </div>
        <p style="font-size:13px;color:#64748b;margin:0;">Vì lý do bảo mật, bạn nên đăng nhập và đổi sang mật khẩu riêng của mình ngay khi có thể (mục "Đổi mật khẩu" trong trang Tài Khoản). Nếu bạn không yêu cầu điều này, vui lòng liên hệ với chúng tôi ngay.</p>`,
      ctas: [{ label: "Đăng Nhập Ngay", href: "https://wvn.vn/dang-nhap.html", style: "primary" }]
    });
    const warning = emailResult.success ? null : "Đã đặt lại mật khẩu, nhưng gửi email báo thất bại.";

    context.res.status = 200;
    context.res.body = { success: true, tempPassword, warning };
  } catch (err) {
    context.log.error("Lỗi đặt lại mật khẩu:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
