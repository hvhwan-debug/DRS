const sgMail = require("@sendgrid/mail");
const { getTableClient } = require("../_shared/tableStorage");

const OTP_TABLE = "AuthOtpCodes";
const OTP_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 45; // chặn spam bấm gửi lại liên tục

function buildOtpEmailHtml(code) {
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
            <p style="font-size:15px;color:#0f172a;margin:0 0 16px;">Mã đăng nhập khu vực thành viên của bạn là:</p>
            <div style="text-align:center;margin:24px 0;">
              <span style="display:inline-block;font-size:34px;font-weight:800;letter-spacing:8px;color:#0369a1;background:#f0f9ff;border:1px dashed #7dd3fc;border-radius:10px;padding:14px 24px;">${code}</span>
            </div>
            <p style="font-size:13px;color:#64748b;margin:0 0 6px;">Mã có hiệu lực trong ${OTP_TTL_MINUTES} phút. Không chia sẻ mã này với bất kỳ ai.</p>
            <p style="font-size:13px;color:#64748b;margin:0;">Nếu bạn không yêu cầu đăng nhập, hãy bỏ qua email này.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL;
  if (!apiKey || !fromEmail) {
    context.log.error("Thiếu SENDGRID_API_KEY hoặc SENDGRID_FROM_EMAIL.");
    context.res.status = 500;
    context.res.body = { success: false, message: "Hệ thống gửi email chưa được cấu hình." };
    return;
  }

  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!emailValid) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Email không hợp lệ." };
    return;
  }

  try {
    const table = await getTableClient(OTP_TABLE);

    // Chặn spam: nếu vừa gửi mã cách đây chưa tới thời gian nghỉ thì từ chối
    try {
      const existing = await table.getEntity("otp", email);
      const lastSentAt = existing.lastSentAt ? new Date(existing.lastSentAt).getTime() : 0;
      if (Date.now() - lastSentAt < RESEND_COOLDOWN_SECONDS * 1000) {
        context.res.status = 429;
        context.res.body = { success: false, message: "Bạn vừa yêu cầu mã, vui lòng đợi ít phút rồi thử lại." };
        return;
      }
    } catch (err) {
      // 404 = chưa có mã trước đó, tiếp tục bình thường
      if (err.statusCode !== 404) throw err;
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();

    await table.upsertEntity({
      partitionKey: "otp",
      rowKey: email,
      code,
      expiresAt,
      attempts: 0,
      lastSentAt: new Date().toISOString()
    }, "Replace");

    sgMail.setApiKey(apiKey);
    await sgMail.send({
      to: email,
      from: { email: fromEmail, name: "Mạng Lưới Tri Thức Việt Nam" },
      subject: `Mã đăng nhập của bạn: ${code}`,
      html: buildOtpEmailHtml(code)
    });

    context.res.status = 200;
    context.res.body = { success: true, message: "Đã gửi mã xác nhận tới email của bạn." };
  } catch (err) {
    context.log.error("Lỗi gửi mã OTP:", err?.response?.body || err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Không thể gửi mã lúc này, vui lòng thử lại sau." };
  }
};
