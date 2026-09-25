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
      type: "create_account",
      eyebrow: "Chào Mừng Thành Viên Mới",
      title: "Tài khoản đã được tạo",
      bodyHtml: `
        <p style="margin:0 0 16px;">${greeting}</p>
        <p style="margin:0 0 18px;">Đội ngũ đã tạo cho bạn 1 tài khoản trong khu vực thành viên của Mạng Lưới Tri Thức Việt Nam. Mật khẩu tạm thời của bạn là:</p>
        <div style="text-align:center;margin:20px 0;">
          <span style="display:inline-block;font-size:22px;font-weight:800;letter-spacing:2px;color:#0369a1;background:#f0f9ff;border:1px dashed #7dd3fc;border-radius:10px;padding:12px 26px;">${tempPassword}</span>
        </div>
        <p style="font-size:13px;color:#64748b;margin:0;">Vì lý do bảo mật, bạn nên đăng nhập và đổi sang mật khẩu riêng của mình ngay khi có thể (mục "Đổi mật khẩu" trong trang Tài Khoản).</p>`,
      ctas: [{ label: "Đăng Nhập Ngay", href: "https://wvn.vn/dang-nhap.html", style: "primary" }]
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
