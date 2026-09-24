const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { getAttachmentSasUrl } = require("../_shared/blobStorage");

const TUITION_TABLE = "TuitionPayments";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  try {
    const tuitionTable = await getTableClient(TUITION_TABLE);
    const payments = [];
    for await (const entity of tuitionTable.listEntities()) {
      let attachments = [];
      try {
        const rawAttachments = JSON.parse(entity.attachmentsJson || "[]");
        attachments = await Promise.all(
          rawAttachments.map(async (att) => ({
            filename: att.filename,
            url: await getAttachmentSasUrl(att.blobName)
          }))
        );
      } catch (e) {}

      payments.push({
        id: entity.rowKey,
        parentEmail: entity.partitionKey,
        studentName: entity.studentName,
        program: entity.program,
        amount: entity.amount,
        period: entity.period || "",
        method: entity.method || "",
        note: entity.note || "",
        attachments,
        confirmationStatus: entity.confirmationStatus || "pending",
        memberFeedback: entity.memberFeedback || "",
        paidAt: entity.paidAt,
        recordedAt: entity.recordedAt
      });
    }
    payments.sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt));

    context.res.status = 200;
    context.res.body = { success: true, payments };
  } catch (err) {
    context.log.error("Lỗi lấy danh sách học phí:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
