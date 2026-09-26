const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { deleteBlob } = require("../_shared/blobStorage");

const DONATIONS_TABLE = "Donations";
const TRANSACTIONS_TABLE = "Transactions";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const id = String((req.body && req.body.id) || "").trim();
  if (!id) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu thông tin." };
    return;
  }

  try {
    const donationsTable = await getTableClient(DONATIONS_TABLE);
    let entity;
    try {
      entity = await donationsTable.getEntity("donation", id);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Không tìm thấy khoản quyên góp này." };
        return;
      }
      throw err;
    }

    // Dọn file đính kèm (best-effort)
    try {
      const attachments = JSON.parse(entity.attachmentsJson || "[]");
      for (const att of attachments) {
        if (att && att.blobName) await deleteBlob(att.blobName);
      }
    } catch (e) { /* bỏ qua nếu lỗi parse */ }

    // Dọn luôn bản ghi Transactions liên kết (dùng cho trang Tra Cứu Sao Kê công khai) nếu có
    if (entity.transactionCode) {
      try {
        const txTable = await getTableClient(TRANSACTIONS_TABLE);
        await txTable.deleteEntity("TX", entity.transactionCode);
      } catch (e) { /* best-effort — có thể chưa từng đồng bộ hoặc đã bị xoá trước đó */ }
    }

    await donationsTable.deleteEntity("donation", id);
    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi xoá quyên góp:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
