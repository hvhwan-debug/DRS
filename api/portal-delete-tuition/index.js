const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { deleteBlob } = require("../_shared/blobStorage");

const TUITION_TABLE = "TuitionPayments";
const INVOICES_TABLE = "Invoices";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const body = req.body || {};
  const parentEmail = String(body.parentEmail || "").trim().toLowerCase();
  const id = String(body.id || "").trim();
  if (!parentEmail || !id) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu thông tin." };
    return;
  }

  try {
    const tuitionTable = await getTableClient(TUITION_TABLE);
    let entity;
    try {
      entity = await tuitionTable.getEntity(parentEmail, id);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Không tìm thấy khoản học phí này." };
        return;
      }
      throw err;
    }

    try {
      const attachments = JSON.parse(entity.attachmentsJson || "[]");
      for (const att of attachments) {
        if (att && att.blobName) await deleteBlob(att.blobName);
      }
    } catch (e) { /* bỏ qua nếu lỗi parse */ }

    await tuitionTable.deleteEntity(parentEmail, id);

    // Khoản học phí này được tạo tự động khi admin duyệt biên lai 1 hoá đơn (rowKey dạng "invoice-<id>")
    // -> xoá đi thì đưa hoá đơn đó về lại "chưa thanh toán" để không bị lệch trạng thái.
    let warning = null;
    if (id.startsWith("invoice-")) {
      const invoiceId = id.slice("invoice-".length);
      try {
        const invoicesTable = await getTableClient(INVOICES_TABLE);
        await invoicesTable.updateEntity({
          partitionKey: parentEmail,
          rowKey: invoiceId,
          status: "unpaid",
          paidAt: "",
          linkedTuitionPaymentId: ""
        }, "Merge");
        warning = "Đã xoá khoản học phí. Hoá đơn liên kết đã được đưa về trạng thái 'Chưa thanh toán'.";
      } catch (e) {
        context.log.error("Lỗi cập nhật lại hoá đơn liên kết:", e.message);
      }
    }

    context.res.status = 200;
    context.res.body = { success: true, warning };
  } catch (err) {
    context.log.error("Lỗi xoá học phí:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
