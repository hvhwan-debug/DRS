const sgMail = require("@sendgrid/mail");
const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { uploadAttachments } = require("../_shared/blobStorage");
const { getMemberDisplayName, buildGreeting } = require("../_shared/memberName");
const { createConfirmToken } = require("../_shared/confirmToken");

const TUITION_TABLE = "TuitionPayments";

function buildTuitionEmailHtml(studentName, program, amount, period, greeting, confirmToken) {
  const confirmUrl = `https://wvn.vn/xac-nhan.html?type=tuition&token=${confirmToken}`;
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
            <p style="font-size:15px;color:#0f172a;margin:0 0 4px;">Chúng tôi vừa ghi nhận khoản học phí cho:</p>
            <p style="font-size:16px;color:#0f172a;margin:0 0 18px;font-weight:700;">${studentName} — ${program || ""}</p>
            <div style="text-align:center;margin:18px 0;">
              <span style="display:inline-block;font-size:22px;font-weight:800;color:#15803d;background:#f0fdf4;border:1px dashed #86efac;border-radius:10px;padding:10px 24px;">${Number(amount).toLocaleString("vi-VN")}đ</span>
            </div>
            ${period ? `<p style="font-size:13px;color:#64748b;margin:0 0 18px;text-align:center;">Kỳ học phí: <strong>${period}</strong></p>` : ""}
            <p style="font-size:13px;color:#64748b;margin:18px 0 14px;text-align:center;">Thông tin trên có chính xác không?</p>
            <div style="text-align:center;margin-bottom:8px;">
              <a href="${confirmUrl}&action=confirm" style="display:inline-block;background:#15803d;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 22px;border-radius:8px;margin:0 6px 10px;">✓ Xác nhận đúng</a>
              <a href="${confirmUrl}" style="display:inline-block;background:#ffffff;color:#b91c1c;text-decoration:none;font-weight:700;font-size:14px;padding:11px 22px;border-radius:8px;border:1.5px solid #fecaca;margin:0 6px 10px;">✗ Báo sai / Cần sửa</a>
            </div>
            <p style="font-size:12px;color:#94a3b8;margin:16px 0 0;text-align:center;">Hoặc đăng nhập vào <a href="https://wvn.vn/thanh-vien-index.html" style="color:#0284c7;">khu vực thành viên</a> để xem chi tiết đầy đủ.</p>
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
  const parentEmail = String(body.parentEmail || "").trim().toLowerCase();
  const studentName = String(body.studentName || "").trim();
  const program = String(body.program || "").trim();
  const amount = Number(body.amount);
  const period = String(body.period || "").trim();
  const method = String(body.method || "").trim();
  const note = String(body.note || "").trim();
  const paidAt = body.paidAt ? new Date(body.paidAt).toISOString() : new Date().toISOString();

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail);
  if (!emailValid || !studentName || !amount || amount <= 0) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Vui lòng nhập đủ email phụ huynh, tên học sinh và số tiền hợp lệ." };
    return;
  }

  try {
    let uploadedAttachments = [];
    let warning = null;
    if (Array.isArray(body.attachments) && body.attachments.length > 0) {
      try {
        uploadedAttachments = await uploadAttachments(body.attachments);
      } catch (err) {
        context.log.error("Lưu ảnh biên lai học phí thất bại:", err.message);
        warning = "Đã lưu học phí, nhưng KHÔNG lưu được ảnh biên lai.";
      }
    }

    const tuitionTable = await getTableClient(TUITION_TABLE);
    const rowKey = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await tuitionTable.createEntity({
      partitionKey: parentEmail,
      rowKey,
      studentName,
      program,
      amount,
      period,
      method,
      note,
      attachmentsJson: JSON.stringify(uploadedAttachments),
      paidAt,
      recordedAt: new Date().toISOString()
    });

    const apiKey = process.env.SENDGRID_API_KEY;
    const fromEmail = process.env.SENDGRID_FROM_EMAIL;
    if (apiKey && fromEmail) {
      try {
        const confirmToken = await createConfirmToken("tuition", parentEmail, rowKey);
        const displayName = await getMemberDisplayName(parentEmail);
        const greeting = buildGreeting(displayName);
        sgMail.setApiKey(apiKey);
        await sgMail.send({
          to: parentEmail,
          from: { email: fromEmail, name: "Mạng Lưới Tri Thức Việt Nam" },
          subject: `Xác nhận học phí cho ${studentName}`,
          html: buildTuitionEmailHtml(studentName, program, amount, period, greeting, confirmToken)
        });
      } catch (err) {
        context.log.error("Gửi email báo học phí thất bại:", err?.response?.body || err.message);
        warning = warning ? warning + " Đồng thời gửi email báo cũng thất bại." : "Đã lưu học phí, nhưng gửi email báo thất bại.";
      }
    }

    context.res.status = 200;
    context.res.body = { success: true, warning };
  } catch (err) {
    context.log.error("Lỗi thêm học phí:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
