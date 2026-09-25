const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { getAttachmentSasUrl } = require("../_shared/blobStorage");

const INVOICES_TABLE = "Invoices";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  try {
    const invoicesTable = await getTableClient(INVOICES_TABLE);
    const invoices = [];
    for await (const entity of invoicesTable.listEntities()) {
      let items = [];
      try { items = JSON.parse(entity.itemsJson || "[]"); } catch (e) { /* bỏ qua nếu lỗi parse */ }
      invoices.push({
        id: entity.rowKey,
        parentEmail: entity.partitionKey,
        invoiceNumber: entity.invoiceNumber,
        studentName: entity.studentName || "",
        program: entity.program || "",
        items,
        totalAmount: Number(entity.totalAmount) || 0,
        issueDate: entity.issueDate,
        note: entity.note || "",
        status: entity.status || "unpaid",
        receiptUrl: entity.receiptBlobName ? await getAttachmentSasUrl(entity.receiptBlobName, 60) : null,
        paymentNote: entity.paymentNote || "",
        submittedAt: entity.submittedAt || null,
        paidAt: entity.paidAt || null,
        rejectReason: entity.rejectReason || "",
        createdAt: entity.createdAt
      });
    }
    invoices.sort((a, b) => new Date(b.issueDate) - new Date(a.issueDate));

    context.res.status = 200;
    context.res.body = { success: true, invoices };
  } catch (err) {
    context.log.error("Lỗi lấy danh sách hoá đơn:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
