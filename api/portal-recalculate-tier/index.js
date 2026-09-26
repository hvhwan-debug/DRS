const { requireAdmin } = require("../_shared/adminAuth");
const { resetTierLock, recomputeTuitionPoints, getTotalTuitionPaidRolling12Months, getTierByTotal } = require("../_shared/memberTier");

// Hạng giờ tính SỐNG theo chu kỳ trượt 12 tháng (không còn cơ chế khoá thủ công), nên bản thân hạng
// không thể bị "kẹt" nữa. Nút này giờ chủ yếu dùng để CHỐT LẠI (backfill) điểm tích lũy theo đúng
// ledger cho 1 thành viên cụ thể (vd. dữ liệu học phí của họ vừa được admin sửa/xoá) mà không cần
// đợi lần thêm/sửa/xoá học phí tiếp theo mới kích hoạt việc chốt lại.
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const body = req.body || {};
  const email = String(body.parentEmail || body.email || "").trim().toLowerCase();
  if (!email) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu email." };
    return;
  }

  try {
    await resetTierLock(email); // no-op, giữ lại để tương thích ngược
    const earnedPoints = await recomputeTuitionPoints(email);
    const totalPaid12mo = await getTotalTuitionPaidRolling12Months(email);
    const tier = getTierByTotal(totalPaid12mo);
    context.res.status = 200;
    context.res.body = { success: true, totalPaid: totalPaid12mo, tierName: tier.name, earnedPoints };
  } catch (err) {
    context.log.error("Lỗi tính lại hạng:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
