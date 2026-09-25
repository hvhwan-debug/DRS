const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { getMemberDisplayName, buildGreeting } = require("../_shared/memberName");
const { sendTrackedEmail } = require("../_shared/sendTrackedEmail");

const MEMBERS_TABLE = "Members";
const SESSION_TABLE = "AuthSessions";

function blockStatusBodyHtml(blocked, greeting) {
  const title = blocked ? "Tài khoản của bạn đã tạm bị khoá" : "Tài khoản của bạn đã được mở lại";
  const color = blocked ? "#b91c1c" : "#15803d";
  const bodyText = blocked
    ? "Chúng tôi xin thông báo tài khoản của bạn tại Mạng Lưới Tri Thức Việt Nam hiện đang tạm khoá nên chưa thể đăng nhập được. Nếu bạn cho rằng đây là một sự nhầm lẫn, xin vui lòng liên hệ với chúng tôi để được hỗ trợ kiểm tra lại sớm nhất."
    : "Chúng tôi xin thông báo tài khoản của bạn tại Mạng Lưới Tri Thức Việt Nam đã được mở lại. Bạn có thể đăng nhập và sử dụng bình thường trở lại. Cảm ơn bạn đã kiên nhẫn chờ đợi.";

  return `
    <p style="margin:0 0 16px;">${greeting}</p>
    <p style="font-size:16px;color:${color};margin:0 0 14px;font-weight:700;">${title}</p>
    <p style="margin:0;line-height:1.7;">${bodyText}</p>`;
}

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  const blocked = !!(req.body && req.body.blocked);

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
        isBlocked: blocked
      }, "Merge");
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Không tìm thấy tài khoản này." };
        return;
      }
      throw err;
    }

    // Nếu chặn, huỷ luôn mọi phiên đăng nhập hiện tại (best-effort)
    if (blocked) {
      try {
        const sessionTable = await getTableClient(SESSION_TABLE);
        const iterator = sessionTable.listEntities({
          queryOptions: { filter: `PartitionKey eq 'session' and email eq '${email.replace(/'/g, "''")}'` }
        });
        for await (const s of iterator) {
          await sessionTable.deleteEntity("session", s.rowKey).catch(() => {});
        }
      } catch (err) {
        context.log.error("Huỷ phiên đăng nhập khi chặn thất bại:", err.message);
      }
    }

    // Gửi email báo cho thành viên (best-effort — không chặn phản hồi thành công nếu gửi lỗi)
    const displayName = await getMemberDisplayName(email);
    const greeting = buildGreeting(displayName);
    const emailResult = await sendTrackedEmail(context, {
      to: email,
      subject: blocked ? "Thông báo về tài khoản của bạn" : "Tài khoản của bạn đã được mở lại",
      type: "block",
      eyebrow: "Thông Báo Tài Khoản",
      title: blocked ? "Tài khoản tạm khoá" : "Tài khoản đã mở lại",
      bodyHtml: blockStatusBodyHtml(blocked, greeting),
      ctas: !blocked ? [{ label: "Đăng Nhập Ngay", href: "https://wvn.vn/dang-nhap.html", style: "primary" }] : []
    });
    const warning = emailResult.success ? null : (blocked ? "Đã chặn tài khoản, nhưng gửi email báo thất bại." : "Đã bỏ chặn tài khoản, nhưng gửi email báo thất bại.");

    context.res.status = 200;
    context.res.body = { success: true, warning };
  } catch (err) {
    context.log.error("Lỗi chặn/bỏ chặn thành viên:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
