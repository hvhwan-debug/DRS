const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { getAttachmentSasUrl } = require("../_shared/blobStorage");

const GRADES_TABLE = "Grades";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  try {
    const gradesTable = await getTableClient(GRADES_TABLE);
    const grades = [];
    for await (const entity of gradesTable.listEntities()) {
      let attachments = [];
      try {
        const rawAttachments = JSON.parse(entity.attachmentsJson || "[]");
        attachments = await Promise.all(
          rawAttachments.map(async (att) => ({
            filename: att.filename,
            url: await getAttachmentSasUrl(att.blobName)
          }))
        );
      } catch (e) {
        // Không có ảnh đính kèm — bỏ qua
      }

      grades.push({
        id: entity.rowKey,
        parentEmail: entity.partitionKey,
        studentName: entity.studentName,
        program: entity.program,
        assessmentType: entity.assessmentType || "Buổi học",
        term: entity.term,
        score: entity.score !== undefined && entity.score !== null ? entity.score : null,
        comment: entity.comment || "",
        attachments,
        confirmationStatus: entity.confirmationStatus || "pending",
        memberFeedback: entity.memberFeedback || "",
        recordedAt: entity.recordedAt
      });
    }
    grades.sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt));

    context.res.status = 200;
    context.res.body = { success: true, grades };
  } catch (err) {
    context.log.error("Lỗi lấy bảng điểm:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
