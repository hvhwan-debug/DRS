const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { uploadAttachments } = require("../_shared/blobStorage");
const { getMemberDisplayName, buildGreeting } = require("../_shared/memberName");
const { createConfirmToken } = require("../_shared/confirmToken");
const { sendTrackedEmail } = require("../_shared/sendTrackedEmail");
const { SITE_URL } = require("../_shared/emailTemplate");

const GRADES_TABLE = "Grades";
const ASSESSMENT_TYPES = ["Đánh giá đầu vào", "Buổi học", "Đánh giá đầu ra"];

function buildGradeBodyHtml(studentName, program, assessmentType, score, comment) {
  return `
    <p style="margin:0 0 10px;">Con em bạn vừa có điểm/nhận xét học tập mới:</p>
    <p style="margin:0 0 4px;font-weight:700;color:#0f172a;font-size:16px;">${studentName} — ${program || ""}</p>
    <p style="font-size:13px;color:#64748b;margin:0 0 18px;">${assessmentType}</p>
    ${score != null ? `<div style="text-align:center;margin:18px 0;"><span style="display:inline-block;font-size:22px;font-weight:800;color:#0369a1;background:#f0f9ff;border:1px dashed #7dd3fc;border-radius:10px;padding:10px 24px;">${score}/10</span></div>` : ""}
    ${comment ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:18px;"><p style="font-size:13px;color:#475569;margin:0 0 4px;font-weight:700;">Nhận xét của giáo viên:</p><p style="font-size:14px;color:#334155;margin:0;">${comment}</p></div>` : ""}
    <p style="font-size:13px;color:#64748b;margin:18px 0 0;text-align:center;">Thông tin trên có chính xác không?</p>`;
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
    // Email dùng khung giao diện thống nhất; tự chuyển bản premium nếu phụ huynh là thành viên VIP.
    const confirmToken = await createConfirmToken("grade", parentEmail, rowKey);
    const displayName = await getMemberDisplayName(parentEmail);
    const greeting = buildGreeting(displayName);
    const confirmUrl = `https://wvn.vn/xac-nhan.html?type=grade&token=${confirmToken}`;
    const emailResult = await sendTrackedEmail(context, {
      to: parentEmail,
      subject: `Điểm/nhận xét mới cho ${studentName}`,
      type: "grade",
      eyebrow: "Bảng Điểm",
      title: "Điểm / nhận xét mới",
      bodyHtml: `<p style="margin:0 0 16px;">${greeting}</p>` + buildGradeBodyHtml(studentName, program, assessmentType, score, comment),
      ctas: [
        { label: "✓ Xác nhận đúng", href: `${confirmUrl}&action=confirm`, style: "primary" },
        { label: "✗ Báo sai / Cần sửa", href: confirmUrl, style: "danger" }
      ],
      footerNote: `Hoặc đăng nhập vào <a href="${SITE_URL}" style="color:#0284c7;">khu vực thành viên</a> để xem chi tiết đầy đủ.`
    });
    if (!emailResult.success) {
      warning = warning ? warning + " Đồng thời gửi email báo cũng thất bại." : "Đã lưu điểm/nhận xét, nhưng gửi email báo cho phụ huynh thất bại.";
    }

    context.res.status = 200;
    context.res.body = { success: true, warning };
  } catch (err) {
    context.log.error("Lỗi thêm điểm:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
