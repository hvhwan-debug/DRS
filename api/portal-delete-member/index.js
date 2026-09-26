const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");
const { getMemberDisplayName, buildGreeting } = require("../_shared/memberName");
const { sendTrackedEmail } = require("../_shared/sendTrackedEmail");

const MEMBERS_TABLE = "Members";
const SESSION_TABLE = "AuthSessions";

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
    // Lấy tên hiển thị + gửi email báo TRƯỚC khi xoá (sau khi xoá sẽ không còn hồ sơ để tra tên).
    const displayName = await getMemberDisplayName(email);
    const greeting = buildGreeting(displayName);

    const membersTable = await getTableClient(MEMBERS_TABLE);
    await membersTable.deleteEntity("member", email);
    await logAdminActivity(req, "Xoá tài khoản thành viên", email);

    // Huỷ luôn mọi phiên đăng nhập hiện tại của email này (best-effort)
    try {
      const sessionTable = await getTableClient(SESSION_TABLE);
      const iterator = sessionTable.listEntities({
        queryOptions: { filter: `PartitionKey eq 'session' and email eq '${email.replace(/'/g, "''")}'` }
      });
      for await (const s of iterator) {
        await sessionTable.deleteEntity("session", s.rowKey).catch(() => {});
      }
    } catch (err) {
      context.log.error("Huỷ phiên đăng nhập thất bại:", err.message);
    }

    const emailResult = await sendTrackedEmail(context, {
      to: email,
      subject: "Tài khoản của bạn đã bị xoá khỏi hệ thống",
      type: "other",
      eyebrow: "Thông Báo Tài Khoản",
      title: "Tài khoản đã bị xoá",
      bodyHtml: `
        <p style="margin:0 0 16px;">${greeting}</p>
        <p style="margin:0;">Tài khoản đăng nhập khu vực thành viên của bạn tại Mạng Lưới Tri Thức Việt Nam đã bị xoá khỏi hệ thống. Bạn sẽ không thể đăng nhập bằng tài khoản này nữa.</p>
        <p style="font-size:13px; color:#64748b; margin-top:14px;">Nếu bạn cho rằng đây là nhầm lẫn, vui lòng liên hệ với chúng tôi ngay.</p>`
    });

    context.res.status = 200;
    context.res.body = { success: true, warning: emailResult.success ? null : "Đã xoá tài khoản, nhưng gửi email báo thất bại." };
  } catch (err) {
    if (err.statusCode === 404) {
      context.res.status = 404;
      context.res.body = { success: false, message: "Không tìm thấy tài khoản này." };
      return;
    }
    context.log.error("Lỗi xoá thành viên:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
