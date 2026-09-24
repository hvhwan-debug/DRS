const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { uploadAttachments } = require("../_shared/blobStorage");

const GRADES_TABLE = "Grades";
const ASSESSMENT_TYPES = ["Đánh giá đầu vào", "Buổi học", "Đánh giá đầu ra"];

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
    let attachmentWarning = null;
    if (Array.isArray(body.attachments) && body.attachments.length > 0) {
      try {
        uploadedAttachments = await uploadAttachments(body.attachments);
      } catch (err) {
        context.log.error("Lưu ảnh bài làm vào Blob Storage thất bại:", err.message);
        attachmentWarning = "Đã lưu điểm/nhận xét, nhưng KHÔNG lưu được ảnh (" + err.message + "). Ảnh có thể quá lớn hoặc sai định dạng — thử lại với ảnh nhỏ hơn.";
      }
    }

    const gradesTable = await getTableClient(GRADES_TABLE);
    await gradesTable.createEntity({
      partitionKey: parentEmail,
      rowKey: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      studentName,
      program,
      assessmentType,
      term,
      score,
      comment,
      attachmentsJson: JSON.stringify(uploadedAttachments),
      recordedAt: new Date().toISOString()
    });

    context.res.status = 200;
    context.res.body = { success: true, warning: attachmentWarning };
  } catch (err) {
    context.log.error("Lỗi thêm điểm:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
