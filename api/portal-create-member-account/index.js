const crypto = require("crypto");
const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { hashPassword } = require("../_shared/password");
const { buildGreeting } = require("../_shared/memberName");
const { sendTrackedEmail } = require("../_shared/sendTrackedEmail");

const MEMBERS_TABLE = "Members";
const PROFILES_TABLE = "MemberProfiles";

function generateTempPassword() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let pw = "";
  for (let i = 0; i < 10; i++) pw += chars[crypto.randomInt(chars.length)];
  return pw;
}

function buildWelcomeEmailHtml(tempPassword, greeting) {
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
            <p style="font-size:15px;color:#0f172a;margin:0 0 18px;">Đội ngũ đã tạo cho bạn 1 tài khoản trong khu vực thành viên của Mạng Lưới Tri Thức Việt Nam. Mật khẩu tạm thời của bạn là:</p>
            <div style="text-align:center;margin:20px 0;">
              <span style="display:inline-block;font-size:22px;font-weight:800;letter-spacing:2px;color:#0369a1;background:#f0f9ff;border:1px dashed #7dd3fc;border-radius:10px;padding:12px 26px;">${tempPassword}</span>
            </div>
            <p style="font-size:13px;color:#64748b;margin:0 0 16px;">Vì lý do bảo mật, bạn nên đăng nhập và đổi sang mật khẩu riêng của mình ngay khi có thể (mục "Đổi mật khẩu" trong trang Tài Khoản).</p>
            <div style="text-align:center;margin-top:12px;">
              <a href="https://wvn.vn/dang-nhap.html" style="display:inline-block;background:#0284c7;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:10px 22px;border-radius:8px;">Đăng Nhập Ngay</a>
            </div>
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

  const body = req.body || {};
  const email = String(body.email || "").trim().toLowerCase();
  const fullName = String(body.fullName || "").trim();
  const phone = String(body.phone || "").trim();
  const address = String(body.address || "").trim();
  const dob = String(body.dob || "").trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Email không hợp lệ." };
    return;
  }

  try {
    const membersTable = await getTableClient(MEMBERS_TABLE);
    try {
      await membersTable.getEntity("member", email);
      context.res.status = 409;
      context.res.body = { success: false, message: "Email này đã có tài khoản trong hệ thống." };
      return;
    } catch (err) {
      if (err.statusCode !== 404) throw err; // 404 nghĩa là chưa có -> tiếp tục tạo mới
    }

    const tempPassword = generateTempPassword();
    const { salt, hash } = hashPassword(tempPassword);
    await membersTable.createEntity({
      partitionKey: "member",
      rowKey: email,
      passwordSalt: salt,
      passwordHash: hash,
      failedAttempts: 0,
      isBlocked: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    if (fullName || phone || address || dob) {
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
    }

    const greeting = buildGreeting(fullName || null);
    const emailResult = await sendTrackedEmail(context, {
      to: email,
      subject: "Tài khoản của bạn tại Mạng Lưới Tri Thức Việt Nam đã được tạo",
      html: buildWelcomeEmailHtml(tempPassword, greeting),
      type: "create_account"
    });

    context.res.status = 200;
    context.res.body = {
      success: true,
      tempPassword,
      warning: emailResult.success ? null : "Đã tạo tài khoản, nhưng gửi email báo thất bại."
    };
  } catch (err) {
    context.log.error("Lỗi khởi tạo tài khoản thành viên:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
