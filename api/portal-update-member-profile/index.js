const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { buildGreeting } = require("../_shared/memberName");
const { sendTrackedEmail } = require("../_shared/sendTrackedEmail");

const PROFILES_TABLE = "MemberProfiles";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const body = req.body || {};
  const email = String(body.email || "").trim().toLowerCase();
  if (!email) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu email." };
    return;
  }

  const fullName = String(body.fullName || "").trim();
  const phone = String(body.phone || "").trim();
  const address = String(body.address || "").trim();
  let dob = String(body.dob || "").trim();

  if (dob) {
    const dobYear = Number(dob.slice(0, 4));
    const currentYear = new Date().getFullYear();
    if (isNaN(dobYear) || dobYear < 1920 || dobYear > currentYear) {
      dob = ""; // Bỏ qua giá trị năm sinh bất thường
    }
  }

  try {
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

    // Gửi email báo cho thành viên — mọi thay đổi thông tin tài khoản (kể cả do đội ngũ sửa) đều cần báo.
    const greeting = buildGreeting(fullName || null);
    const emailResult = await sendTrackedEmail(context, {
      to: email,
      subject: "Thông tin tài khoản của bạn vừa được cập nhật",
      type: "profile_update",
      eyebrow: "Bảo Mật Tài Khoản",
      title: "Thông tin tài khoản đã thay đổi",
      bodyHtml: `
        <p style="margin:0 0 16px;">${greeting}</p>
        <p style="margin:0 0 14px;">Đội ngũ Mạng Lưới Tri Thức Việt Nam vừa cập nhật thông tin tài khoản của bạn:</p>
        <table style="width:100%; border-collapse:collapse; font-size:13px; margin-bottom:14px;">
          <tr><td style="padding:6px 0; color:#64748b; width:120px;">Họ và tên</td><td style="padding:6px 0; font-weight:700;">${fullName || "—"}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">Số điện thoại</td><td style="padding:6px 0; font-weight:700;">${phone || "—"}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">Ngày sinh</td><td style="padding:6px 0; font-weight:700;">${dob || "—"}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">Địa chỉ</td><td style="padding:6px 0; font-weight:700;">${address || "—"}</td></tr>
        </table>
        <p style="font-size:13px; color:#64748b; margin:0;">Nếu bạn thấy thông tin này không chính xác, vui lòng liên hệ với chúng tôi.</p>`
    });

    context.res.status = 200;
    context.res.body = { success: true, warning: emailResult.success ? null : "Đã cập nhật hồ sơ, nhưng gửi email báo thất bại." };
  } catch (err) {
    context.log.error("Lỗi admin cập nhật hồ sơ thành viên:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
