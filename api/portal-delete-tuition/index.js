const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");
const { resetTierLock, recomputeTuitionPoints } = require("../_shared/memberTier");

const TUITION_TABLE = "TuitionPayments";

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
    await tuitionTable.deleteEntity(parentEmail, id);
    await logAdminActivity(req, "Xoá học phí", `${parentEmail} - id: ${id}`);

    // Vừa xoá 1 khoản học phí (thường do nhập nhầm) -> xoá mốc khoá hạng để hạng được tính
    // lại NGAY theo đúng tổng học phí còn lại, không giữ hạng cũ (bị đẩy sai do khoản đã xoá).
    // Đồng thời chốt lại điểm tích lũy cho các khoản còn lại (mốc hạng của chúng có thể đã dịch chuyển).
    await resetTierLock(parentEmail);
    await recomputeTuitionPoints(parentEmail);

    context.res.status = 200;
    context.res.body = { success: true };
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
