const { logFamilyEvent, enrollFromRegistration, pointsDeficit } = require("../_shared/linkage");
const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");
const { resetTierLock, recomputeTuitionPoints, getPointsBalance } = require("../_shared/memberTier");

const TUITION_TABLE = "TuitionPayments";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req, "tuition"))) return;

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
    await tuitionTable.deleteEntity(parentEmail, id);
    await logAdminActivity(req, "Xoá học phí", `${parentEmail} - id: ${id}`);

    // Vừa xoá 1 khoản học phí (thường do nhập nhầm) -> xoá mốc khoá hạng để hạng được tính
    // lại NGAY theo đúng tổng học phí còn lại, không giữ hạng cũ (bị đẩy sai do khoản đã xoá).
    // Đồng thời chốt lại điểm tích lũy cho các khoản còn lại (mốc hạng của chúng có thể đã dịch chuyển).
    await resetTierLock(parentEmail);
    await recomputeTuitionPoints(parentEmail);

    // Khoản học phí sinh ra từ việc duyệt hoá đơn (id "invoice-<mã>"): đưa hoá đơn về "Chưa thanh
    // toán" để hoá đơn không còn hiện "Đã thanh toán" trong khi khoản tiền đã bị xoá.
    let invoiceReverted = false;
    if (id.startsWith("invoice-")) {
      try {
        const invoicesTable = await getTableClient("Invoices");
        await invoicesTable.updateEntity({ partitionKey: parentEmail, rowKey: id.slice(8), status: "unpaid", paidAt: "", linkedTuitionPaymentId: "" }, "Merge");
        invoiceReverted = true;
      } catch (e) { /* hoá đơn đã bị xoá trước đó -> bỏ qua */ }
    }

    const bal = await getPointsBalance(parentEmail);
    const deficit = bal.spent - (bal.earned + (bal.adjustment || 0));
    await logFamilyEvent(context, parentEmail, `Một khoản học phí đã bị xoá khỏi hệ thống, điểm tích luỹ được tính lại${deficit > 0 ? `. Thành viên đang thiếu ${deficit.toLocaleString("vi-VN")} điểm so với số điểm đã đổi quà.` : "."}`);
    const warnings = [];
    if (invoiceReverted) warnings.push("Hoá đơn liên quan đã được chuyển về trạng thái Chưa thanh toán.");
    if (deficit > 0) warnings.push(`Lưu ý: thành viên đã dùng nhiều hơn số điểm còn lại ${deficit.toLocaleString("vi-VN")} điểm (điểm khả dụng hiển thị 0). Cân nhắc huỷ bớt yêu cầu đổi quà nếu khoản tiền bị xoá là nhập nhầm.`);

    context.res.status = 200;
    context.res.body = { success: true, warning: warnings.join(" ") || null };
  } catch (err) {
    if (err.statusCode === 404) {
      context.res.status = 404;
      context.res.body = { success: false, message: "Không tìm thấy bản ghi này." };
      return;
    }
    context.log.error("Lỗi xoá học phí:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
