const sgMail = require("@sendgrid/mail");
const crypto = require("crypto");
const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { hashPassword } = require("../_shared/password");
const { getMemberDisplayName, buildGreeting } = require("../_shared/memberName");

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

function buildResetPasswordEmailHtml(tempPassword, greeting) {
  return `<!DOCTYPE html>
<html lang="vi">
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 28px rgba(15,23,42,0.10);">
          <tr><td bgcolor="#0f172a" style="background-color:#0f172a;background:linear-gradient(135deg,#0f172a 0%,#1e3a8a 50%,#0284c7 100%);padding:28px 32px;text-align:center;">
            <img src="https://wvn.vn/images/logo-wvn.png" alt="WVN" width="56" style="display:block;height:auto;margin:0 auto 10px;">
            <div style="color:#ffffff;font-size:17px;font-weight:800;">Mạng Lưới Tri Thức Việt Nam</div>
          </td></tr>
          <tr><td style="padding:32px;">
            <p style="font-size:14px;color:#334155;margin:0 0 16px;">${greeting}</p>
            <p style="font-size:15px;color:#0f172a;margin:0 0 18px;">Đội ngũ vừa đặt lại mật khẩu cho tài khoản của bạn theo yêu cầu. Mật khẩu tạm thời của bạn là:</p>
            <div style="text-align:center;margin:20px 0;">
              <span style="display:inline-block;font-size:22px;font-weight:800;letter-spacing:2px;color:#0369a1;background:#f0f9ff;border:1px dashed #7dd3fc;border-radius:10px;padding:12px 26px;">${tempPassword}</span>
            </div>
            <p style="font-size:13px;color:#64748b;margin:0 0 16px;">Vì lý do bảo mật, bạn nên đăng nhập và đổi sang mật khẩu riêng của mình ngay khi có thể (mục "Đổi mật khẩu" trong trang Tài Khoản).</p>
            <div style="text-align:center;margin-top:12px;">
              <a href="https://wvn.vn/dang-nhap.html" style="display:inline-block;background:#0284c7;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:10px 22px;border-radius:8px;">Đăng Nhập Ngay</a>
            </div>
            <p style="font-size:13px;color:#94a3b8;margin:20px 0 0;">Nếu bạn không yêu cầu điều này, vui lòng liên hệ với chúng tôi ngay.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
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

    let warning = null;
    const apiKey = process.env.SENDGRID_API_KEY;
    const fromEmail = process.env.SENDGRID_FROM_EMAIL;
    if (apiKey && fromEmail) {
      try {
        const displayName = await getMemberDisplayName(email);
        const greeting = buildGreeting(displayName);
        sgMail.setApiKey(apiKey);
        await sgMail.send({
          to: email,
          from: { email: fromEmail, name: "Mạng Lưới Tri Thức Việt Nam" },
          subject: "Mật khẩu tài khoản của bạn đã được đặt lại",
          html: buildResetPasswordEmailHtml(tempPassword, greeting)
        });
      } catch (err) {
        context.log.error("Gửi email mật khẩu mới thất bại:", err?.response?.body || err.message);
        warning = "Đã đặt lại mật khẩu, nhưng gửi email báo thất bại.";
      }
    } else {
      warning = "Đã đặt lại mật khẩu, nhưng chưa cấu hình gửi email.";
    }

    context.res.status = 200;
    context.res.body = { success: true, tempPassword, warning };
  } catch (err) {
    context.log.error("Lỗi đặt lại mật khẩu:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
