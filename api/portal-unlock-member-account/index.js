const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { getMemberDisplayName, buildGreeting } = require("../_shared/memberName");
const { sendTrackedEmail } = require("../_shared/sendTrackedEmail");

const MEMBERS_TABLE = "Members";

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
      await membersTable.updateEntity({
        partitionKey: "member",
        rowKey: email,
        failedAttempts: 0
      }, "Merge");
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Không tìm thấy tài khoản này." };
        return;
      }
      throw err;
    }

    // Báo cho thành viên biết tài khoản vừa được mở khoá — giúp phát hiện sớm nếu không phải họ yêu cầu.
    const displayName = await getMemberDisplayName(email);
    const greeting = buildGreeting(displayName);
    const emailResult = await sendTrackedEmail(context, {
      to: email,
      subject: "Tài khoản của bạn vừa được mở khoá đăng nhập",
      type: "other",
      eyebrow: "Bảo Mật Tài Khoản",
      title: "Đã mở khoá đăng nhập",
      bodyHtml: `
        <p style="margin:0 0 16px;">${greeting}</p>
        <p style="margin:0;">Tài khoản của bạn vừa được đội ngũ mở khoá sau khi bị tạm khoá do nhập sai mật khẩu nhiều lần. Bạn có thể đăng nhập lại bình thường.</p>
        <p style="font-size:13px; color:#64748b; margin-top:14px;">Nếu bạn không yêu cầu điều này, vui lòng liên hệ với chúng tôi ngay.</p>`,
      ctas: [{ label: "Đăng Nhập Ngay", href: "https://wvn.vn/dang-nhap.html", style: "primary" }]
    });

    context.res.status = 200;
    context.res.body = { success: true, warning: emailResult.success ? null : "Đã mở khoá tài khoản, nhưng gửi email báo thất bại." };
  } catch (err) {
    context.log.error("Lỗi mở khoá tài khoản:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
