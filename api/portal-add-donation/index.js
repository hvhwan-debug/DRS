const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { uploadAttachments } = require("../_shared/blobStorage");

const DONATIONS_TABLE = "Donations";
const TRANSACTIONS_TABLE = "Transactions"; // Bảng dùng chung với trang Tra Cứu Sao Kê

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const body = req.body || {};
  const donationType = body.donationType === "item" ? "item" : "cash"; // 'cash' (tiền) | 'item' (hiện vật)
  const donorName = String(body.donorName || "").trim();
  const donorEmail = String(body.donorEmail || "").trim().toLowerCase();
  const amountRaw = body.amount;
  const amount = amountRaw !== undefined && amountRaw !== null && amountRaw !== "" ? Number(amountRaw) : null;
  const itemDescription = String(body.itemDescription || "").trim();
  const method = String(body.method || "").trim();
  const note = String(body.note || "").trim();
  const transactionCode = String(body.transactionCode || "").trim().toUpperCase();
  const donatedAt = body.donatedAt ? new Date(body.donatedAt).toISOString() : new Date().toISOString();

  if (!donorName) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Vui lòng nhập tên người quyên góp." };
    return;
  }
  if (donationType === "cash" && (!amount || amount <= 0)) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Vui lòng nhập số tiền hợp lệ cho quyên góp bằng tiền." };
    return;
  }
  if (donationType === "item" && !itemDescription) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Vui lòng mô tả hiện vật đã nhận." };
    return;
  }
  if (amount !== null && (isNaN(amount) || amount < 0)) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Số tiền / giá trị ước tính không hợp lệ." };
    return;
  }

  try {
    // Lưu ảnh biên lai/minh chứng hoặc ảnh hiện vật (nếu có) lên Blob Storage riêng tư
    let uploadedAttachments = [];
    let attachmentWarning = null;
    if (Array.isArray(body.attachments) && body.attachments.length > 0) {
      try {
        uploadedAttachments = await uploadAttachments(body.attachments);
      } catch (err) {
        context.log.error("Lưu ảnh quyên góp vào Blob Storage thất bại:", err.message);
        attachmentWarning = "Đã lưu quyên góp, nhưng KHÔNG lưu được ảnh (" + err.message + "). Ảnh có thể quá lớn hoặc sai định dạng — thử lại với ảnh nhỏ hơn.";
      }
    }

    const donationsTable = await getTableClient(DONATIONS_TABLE);
    await donationsTable.createEntity({
      partitionKey: "donation",
      rowKey: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      donationType,
      donorName,
      donorEmail,
      amount,
      itemDescription,
      method,
      note,
      transactionCode: donationType === "cash" ? transactionCode : "",
      attachmentsJson: JSON.stringify(uploadedAttachments),
      donatedAt,
      recordedAt: new Date().toISOString()
    });

    // Nếu là quyên góp bằng tiền và có mã giao dịch, đồng bộ sang bảng Transactions để tra cứu ở trang Sao Kê
    // (hiện vật không có giao dịch ngân hàng nên không đồng bộ — best-effort, không chặn phản hồi thành công nếu lỗi)
    if (donationType === "cash" && transactionCode) {
      try {
        const txTable = await getTableClient(TRANSACTIONS_TABLE);
        await txTable.upsertEntity({
          partitionKey: "TX",
          rowKey: transactionCode,
          fullName: donorName,
          date: donatedAt,
          content: note || "Quyên góp ủng hộ chương trình",
          amount
        }, "Replace");
      } catch (err) {
        context.log.error("Đồng bộ sang bảng Transactions thất bại:", err.message);
      }
    }

    context.res.status = 200;
    context.res.body = { success: true, warning: attachmentWarning };
  } catch (err) {
    context.log.error("Lỗi thêm quyên góp:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
