const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { uploadAttachments } = require("../_shared/blobStorage");

const DONATIONS_TABLE = "Donations";
const TRANSACTIONS_TABLE = "Transactions";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const body = req.body || {};
  const id = String(body.id || "").trim();
  const donationType = body.donationType === "item" ? "item" : "cash";
  const donorName = String(body.donorName || "").trim();
  const donorEmail = String(body.donorEmail || "").trim().toLowerCase();
  const amountRaw = body.amount;
  const amount = amountRaw !== undefined && amountRaw !== null && amountRaw !== "" ? Number(amountRaw) : null;
  const itemDescription = String(body.itemDescription || "").trim();
  const method = String(body.method || "").trim();
  const note = String(body.note || "").trim();
  const transactionCode = String(body.transactionCode || "").trim().toUpperCase();
  const donatedAt = body.donatedAt ? new Date(body.donatedAt).toISOString() : undefined;

  if (!id || !donorName) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu thông tin cần thiết." };
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

  try {
    const donationsTable = await getTableClient(DONATIONS_TABLE);
    let entity;
    try {
      entity = await donationsTable.getEntity("donation", id);
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
        context.log.error("Lưu ảnh vào Blob Storage thất bại:", err.message);
        warning = "Đã cập nhật quyên góp, nhưng KHÔNG lưu được ảnh mới.";
      }
    }

    const update = {
      partitionKey: "donation",
      rowKey: id,
      donationType,
      donorName,
      donorEmail,
      amount,
      itemDescription,
      method,
      note,
      transactionCode: donationType === "cash" ? transactionCode : "",
      attachmentsJson,
      confirmationStatus: "pending",
      memberFeedback: ""
    };
    if (donatedAt) update.donatedAt = donatedAt;

    await donationsTable.updateEntity(update, "Merge");

    if (donationType === "cash" && transactionCode) {
      try {
        const txTable = await getTableClient(TRANSACTIONS_TABLE);
        await txTable.upsertEntity({
          partitionKey: "TX",
          rowKey: transactionCode,
          fullName: donorName,
          date: donatedAt || entity.donatedAt,
          content: note || "Quyên góp ủng hộ chương trình",
          amount
        }, "Replace");
      } catch (err) {
        context.log.error("Đồng bộ sang bảng Transactions thất bại:", err.message);
      }
    }

    context.res.status = 200;
    context.res.body = { success: true, warning };
  } catch (err) {
    context.log.error("Lỗi sửa quyên góp:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
