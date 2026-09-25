const { getTableClient } = require("../_shared/tableStorage");

const TOKENS_TABLE = "PublicConfirmTokens";
const DONATIONS_TABLE = "Donations";
const GRADES_TABLE = "Grades";
const TUITION_TABLE = "TuitionPayments";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  const body = req.body || {};
  const token = String(body.token || "").trim();
  const action = String(body.action || "").trim(); // 'confirm' | 'reject'
  const feedback = String(body.feedback || "").trim();

  if (!token || !["confirm", "reject"].includes(action)) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Yêu cầu không hợp lệ." };
    return;
  }
  if (action === "reject" && !feedback) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Vui lòng nhập lý do từ chối." };
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
    const tableName = { donation: DONATIONS_TABLE, grade: GRADES_TABLE, tuition: TUITION_TABLE }[type];
    if (!tableName) {
      context.res.status = 400;
      context.res.body = { success: false, message: "Loại xác nhận không hợp lệ." };
      return;
    }

    const table = await getTableClient(tableName);
    const confirmationStatus = action === "confirm" ? "confirmed" : "rejected";
    await table.updateEntity({
      partitionKey: recordPartitionKey,
      rowKey: recordId,
      confirmationStatus,
      memberFeedback: action === "reject" ? feedback : "",
      confirmedAt: new Date().toISOString()
    }, "Merge");

    context.res.status = 200;
    context.res.body = { success: true, confirmationStatus };
  } catch (err) {
    if (err.statusCode === 404) {
      context.res.status = 404;
      context.res.body = { success: false, message: "Không tìm thấy bản ghi (có thể đã bị xoá)." };
      return;
    }
    context.log.error("Lỗi xác nhận công khai:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
