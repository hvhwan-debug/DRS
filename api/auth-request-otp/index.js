const { getTableClient } = require("../_shared/tableStorage");
const { sendTrackedEmail } = require("../_shared/sendTrackedEmail");

const OTP_TABLE = "AuthOtpCodes";
const OTP_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 45; // chặn spam bấm gửi lại liên tục

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

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

    // Email dùng khung giao diện thống nhất toàn hệ thống.
    const emailResult = await sendTrackedEmail(context, {
      to: email,
      subject: `Mã đăng nhập của bạn: ${code}`,
      type: "otp",
      eyebrow: "Đăng Nhập Khu Vực Thành Viên",
      title: "Mã xác nhận đăng nhập",
      bodyHtml: `
        <p style="margin:0 0 16px;">Mã đăng nhập khu vực thành viên của bạn là:</p>
        <div style="text-align:center;margin:24px 0;">
          <span style="display:inline-block;font-size:34px;font-weight:800;letter-spacing:8px;color:#0369a1;background:#f0f9ff;border:1px dashed #7dd3fc;border-radius:10px;padding:14px 24px;">${code}</span>
        </div>
        <p style="font-size:13px;color:#64748b;margin:0 0 6px;">Mã có hiệu lực trong ${OTP_TTL_MINUTES} phút. Không chia sẻ mã này với bất kỳ ai.</p>
        <p style="font-size:13px;color:#64748b;margin:0;">Nếu bạn không yêu cầu đăng nhập, hãy bỏ qua email này.</p>`
    });

    if (!emailResult.success) {
      context.log.error("Lỗi gửi mã OTP:", emailResult.errorMessage);
      context.res.status = 500;
      context.res.body = { success: false, message: "Không thể gửi mã lúc này, vui lòng thử lại sau." };
      return;
    }

    context.res.status = 200;
    context.res.body = { success: true, message: "Đã gửi mã xác nhận tới email của bạn." };
  } catch (err) {
    context.log.error("Lỗi gửi mã OTP:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Không thể gửi mã lúc này, vui lòng thử lại sau." };
  }
};
