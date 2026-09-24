const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { getAttachmentSasUrl } = require("../_shared/blobStorage");

const DONATIONS_TABLE = "Donations";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  try {
    const donationsTable = await getTableClient(DONATIONS_TABLE);
    const donations = [];
    for await (const entity of donationsTable.listEntities()) {
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
        // Không có ảnh đính kèm hoặc lỗi tạo link — bỏ qua
      }

      donations.push({
        id: entity.rowKey,
        donorName: entity.donorName,
        donorEmail: entity.donorEmail || "",
        amount: entity.amount,
        method: entity.method || "",
        transactionCode: entity.transactionCode || "",
        note: entity.note || "",
        attachments,
        donatedAt: entity.donatedAt,
        recordedAt: entity.recordedAt
      });
    }
    donations.sort((a, b) => new Date(b.donatedAt) - new Date(a.donatedAt));

    context.res.status = 200;
    context.res.body = { success: true, donations };
  } catch (err) {
    context.log.error("Lỗi lấy danh sách quyên góp:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
