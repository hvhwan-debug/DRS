const sgMail = require("@sendgrid/mail");
const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { getMemberDisplayName, buildGreeting } = require("../_shared/memberName");

const MEMBERS_TABLE = "Members";
const SESSION_TABLE = "AuthSessions";

function buildBlockStatusEmailHtml(blocked, greeting) {
  const title = blocked ? "Tài khoản của bạn đã tạm bị khoá" : "Tài khoản của bạn đã được mở lại";
  const color = blocked ? "#b91c1c" : "#15803d";
  const bodyText = blocked
    ? "Chúng tôi xin thông báo tài khoản của bạn tại Mạng Lưới Tri Thức Việt Nam hiện đang tạm khoá nên chưa thể đăng nhập được. Nếu bạn cho rằng đây là một sự nhầm lẫn, xin vui lòng liên hệ với chúng tôi để được hỗ trợ kiểm tra lại sớm nhất."
    : "Chúng tôi xin thông báo tài khoản của bạn tại Mạng Lưới Tri Thức Việt Nam đã được mở lại. Bạn có thể đăng nhập và sử dụng bình thường trở lại. Cảm ơn bạn đã kiên nhẫn chờ đợi.";

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
            <p style="font-size:16px;color:${color};margin:0 0 14px;font-weight:700;">${title}</p>
            <p style="font-size:14px;color:#334155;margin:0 0 20px;line-height:1.7;">${bodyText}</p>
            ${!blocked ? `<div style="text-align:center;margin-top:12px;"><a href="https://wvn.vn/dang-nhap.html" style="display:inline-block;background:#0284c7;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:10px 22px;border-radius:8px;">Đăng Nhập Ngay</a></div>` : ""}
            <p style="font-size:13px;color:#94a3b8;margin:20px 0 0;">Trân trọng,<br>Mạng Lưới Tri Thức Việt Nam</p>
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
          subject: blocked ? "Thông báo về tài khoản của bạn" : "Tài khoản của bạn đã được mở lại",
          html: buildBlockStatusEmailHtml(blocked, greeting)
        });
      } catch (err) {
        context.log.error("Gửi email báo chặn/bỏ chặn thất bại:", err?.response?.body || err.message);
        warning = blocked ? "Đã chặn tài khoản, nhưng gửi email báo thất bại." : "Đã bỏ chặn tài khoản, nhưng gửi email báo thất bại.";
      }
    } else {
      context.log.error("Thiếu SENDGRID_API_KEY hoặc SENDGRID_FROM_EMAIL — bỏ qua gửi email.");
    }

    context.res.status = 200;
    context.res.body = { success: true, warning };
  } catch (err) {
    context.log.error("Lỗi chặn/bỏ chặn thành viên:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
