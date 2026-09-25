const sgMail = require("@sendgrid/mail");
const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { uploadAttachments } = require("../_shared/blobStorage");
const { getMemberDisplayName, buildGreeting } = require("../_shared/memberName");
const { createConfirmToken } = require("../_shared/confirmToken");

const GRADES_TABLE = "Grades";
const ASSESSMENT_TYPES = ["Đánh giá đầu vào", "Buổi học", "Đánh giá đầu ra"];

function buildGradeEmailHtml(studentName, program, assessmentType, score, comment, greeting, confirmToken) {
  const confirmUrl = `https://wvn.vn/xac-nhan.html?type=grade&token=${confirmToken}`;
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
            <p style="font-size:15px;color:#0f172a;margin:0 0 10px;">Con em bạn vừa có điểm/nhận xét học tập mới:</p>
            <p style="font-size:16px;color:#0f172a;margin:0 0 4px;font-weight:700;">${studentName} — ${program || ""}</p>
            <p style="font-size:13px;color:#64748b;margin:0 0 18px;">${assessmentType}</p>
            ${score != null ? `<div style="text-align:center;margin:18px 0;"><span style="display:inline-block;font-size:22px;font-weight:800;color:#0369a1;background:#f0f9ff;border:1px dashed #7dd3fc;border-radius:10px;padding:10px 24px;">${score}/10</span></div>` : ""}
            ${comment ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:18px;"><p style="font-size:13px;color:#475569;margin:0 0 4px;font-weight:700;">Nhận xét của giáo viên:</p><p style="font-size:14px;color:#334155;margin:0;">${comment}</p></div>` : ""}
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
  const assessmentType = String(body.assessmentType || "Buổi học").trim();
  const term = String(body.term || "").trim();
  const scoreRaw = body.score;
  const score = scoreRaw !== undefined && scoreRaw !== null && scoreRaw !== "" ? Number(scoreRaw) : null;
  const comment = String(body.comment || "").trim();

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail);
  if (!emailValid || !studentName) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Vui lòng nhập đủ email phụ huynh và tên học sinh." };
    return;
  }
  if (!ASSESSMENT_TYPES.includes(assessmentType)) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Loại đánh giá không hợp lệ." };
    return;
  }
  if (score !== null && (isNaN(score) || score < 0 || score > 10)) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Điểm số phải là số từ 0 đến 10 (hoặc để trống nếu chỉ ghi nhận xét)." };
    return;
  }

  try {
    // Lưu ảnh bài làm của học sinh (nếu có) lên Blob Storage riêng tư
    let uploadedAttachments = [];
    let warning = null;
    if (Array.isArray(body.attachments) && body.attachments.length > 0) {
      try {
        uploadedAttachments = await uploadAttachments(body.attachments);
      } catch (err) {
        context.log.error("Lưu ảnh bài làm vào Blob Storage thất bại:", err.message);
        warning = "Đã lưu điểm/nhận xét, nhưng KHÔNG lưu được ảnh (" + err.message + "). Ảnh có thể quá lớn hoặc sai định dạng — thử lại với ảnh nhỏ hơn.";
      }
    }

    const gradesTable = await getTableClient(GRADES_TABLE);
    const rowKey = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await gradesTable.createEntity({
      partitionKey: parentEmail,
      rowKey,
      studentName,
      program,
      assessmentType,
      term,
      score,
      comment,
      attachmentsJson: JSON.stringify(uploadedAttachments),
      recordedAt: new Date().toISOString()
    });

    // Gửi email báo cho phụ huynh (best-effort — không chặn phản hồi thành công nếu gửi lỗi)
    const apiKey = process.env.SENDGRID_API_KEY;
    const fromEmail = process.env.SENDGRID_FROM_EMAIL;
    if (apiKey && fromEmail) {
      try {
        const confirmToken = await createConfirmToken("grade", parentEmail, rowKey);
        const displayName = await getMemberDisplayName(parentEmail);
        const greeting = buildGreeting(displayName);
        sgMail.setApiKey(apiKey);
        await sgMail.send({
          to: parentEmail,
          from: { email: fromEmail, name: "Mạng Lưới Tri Thức Việt Nam" },
          subject: `Điểm/nhận xét mới cho ${studentName}`,
          html: buildGradeEmailHtml(studentName, program, assessmentType, score, comment, greeting, confirmToken)
        });
      } catch (err) {
        context.log.error("Gửi email báo điểm thất bại:", err?.response?.body || err.message);
        warning = warning ? warning + " Đồng thời gửi email báo cũng thất bại." : "Đã lưu điểm/nhận xét, nhưng gửi email báo cho phụ huynh thất bại.";
      }
    } else {
      context.log.error("Thiếu SENDGRID_API_KEY hoặc SENDGRID_FROM_EMAIL — bỏ qua gửi email.");
    }

    context.res.status = 200;
    context.res.body = { success: true, warning };
  } catch (err) {
    context.log.error("Lỗi thêm điểm:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
