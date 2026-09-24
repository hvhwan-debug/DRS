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
  const id = String(body.id || "").trim();
  const studentName = String(body.studentName || "").trim();
  const program = String(body.program || "").trim();
  const assessmentType = String(body.assessmentType || "Buổi học").trim();
  const term = String(body.term || "").trim();
  const scoreRaw = body.score;
  const score = scoreRaw !== undefined && scoreRaw !== null && scoreRaw !== "" ? Number(scoreRaw) : null;
  const comment = String(body.comment || "").trim();

  if (!parentEmail || !id || !studentName) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu thông tin cần thiết." };
    return;
  }
  if (!ASSESSMENT_TYPES.includes(assessmentType)) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Loại đánh giá không hợp lệ." };
    return;
  }
  if (score !== null && (isNaN(score) || score < 0 || score > 10)) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Điểm số phải là số từ 0 đến 10." };
    return;
  }

  try {
    const gradesTable = await getTableClient(GRADES_TABLE);
    let entity;
    try {
      entity = await gradesTable.getEntity(parentEmail, id);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Không tìm thấy bản ghi." };
        return;
      }
      throw err;
    }

    if (entity.confirmationStatus === "confirmed") {
      context.res.status = 403;
      context.res.body = { success: false, message: "Dữ liệu đã được thành viên xác nhận, không thể sửa nữa." };
      return;
    }

    let attachmentsJson = entity.attachmentsJson;
    let warning = null;
    if (Array.isArray(body.attachments) && body.attachments.length > 0) {
      try {
        const uploaded = await uploadAttachments(body.attachments);
        attachmentsJson = JSON.stringify(uploaded);
      } catch (err) {
        context.log.error("Lưu ảnh bài làm vào Blob Storage thất bại:", err.message);
        warning = "Đã cập nhật điểm/nhận xét, nhưng KHÔNG lưu được ảnh mới.";
      }
    }

    await gradesTable.updateEntity({
      partitionKey: parentEmail,
      rowKey: id,
      studentName,
      program,
      assessmentType,
      term,
      score,
      comment,
      attachmentsJson,
      // Dữ liệu vừa sửa lại -> cần thành viên xác nhận lại từ đầu
      confirmationStatus: "pending",
      memberFeedback: ""
    }, "Merge");

    context.res.status = 200;
    context.res.body = { success: true, warning };
  } catch (err) {
    context.log.error("Lỗi sửa điểm:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
