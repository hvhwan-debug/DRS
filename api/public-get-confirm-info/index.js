const { getTableClient } = require("../_shared/tableStorage");

const TOKENS_TABLE = "PublicConfirmTokens";
const DONATIONS_TABLE = "Donations";
const GRADES_TABLE = "Grades";
const TUITION_TABLE = "TuitionPayments";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  const token = String((req.query && req.query.token) || "").trim();
  if (!token) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu mã xác nhận." };
    return;
  }

  try {
    const tokensTable = await getTableClient(TOKENS_TABLE);
    let tokenEntity;
    try {
      tokenEntity = await tokensTable.getEntity("token", token);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Link xác nhận không hợp lệ hoặc đã hết hạn." };
        return;
      }
      throw err;
    }

    const { type, recordPartitionKey, recordId } = tokenEntity;
    let summary = null;

    if (type === "donation") {
      const table = await getTableClient(DONATIONS_TABLE);
      const entity = await table.getEntity(recordPartitionKey, recordId);
      summary = {
        type: "donation",
        title: entity.donationType === "item" ? "Quyên góp hiện vật" : "Quyên góp tiền mặt",
        lines: entity.donationType === "item"
          ? [["Hiện vật", entity.itemDescription || "—"]]
          : [["Số tiền", Number(entity.amount).toLocaleString("vi-VN") + "đ"]],
        confirmationStatus: entity.confirmationStatus || "pending",
        memberFeedback: entity.memberFeedback || ""
      };
    } else if (type === "grade") {
      const table = await getTableClient(GRADES_TABLE);
      const entity = await table.getEntity(recordPartitionKey, recordId);
      summary = {
        type: "grade",
        title: "Điểm / nhận xét học tập",
        lines: [
          ["Học sinh", entity.studentName],
          ["Chương trình", entity.program || "—"],
          ["Loại đánh giá", entity.assessmentType || "—"],
          ["Điểm", entity.score != null ? entity.score + "/10" : "—"],
          ["Nhận xét", entity.comment || "—"]
        ],
        confirmationStatus: entity.confirmationStatus || "pending",
        memberFeedback: entity.memberFeedback || ""
      };
    } else if (type === "tuition") {
      const table = await getTableClient(TUITION_TABLE);
      const entity = await table.getEntity(recordPartitionKey, recordId);
      summary = {
        type: "tuition",
        title: "Học phí",
        lines: [
          ["Học sinh", entity.studentName],
          ["Chương trình", entity.program || "—"],
          ["Số tiền", Number(entity.amount).toLocaleString("vi-VN") + "đ"],
          ["Kỳ học phí", entity.period || "—"]
        ],
        confirmationStatus: entity.confirmationStatus || "pending",
        memberFeedback: entity.memberFeedback || ""
      };
    } else {
      context.res.status = 400;
      context.res.body = { success: false, message: "Loại xác nhận không hợp lệ." };
      return;
    }

    context.res.status = 200;
    context.res.body = { success: true, summary };
  } catch (err) {
    if (err.statusCode === 404) {
      context.res.status = 404;
      context.res.body = { success: false, message: "Không tìm thấy bản ghi (có thể đã bị xoá)." };
      return;
    }
    context.log.error("Lỗi lấy thông tin xác nhận công khai:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
