const { requireAdmin } = require("../_shared/adminAuth");
const { resetTierLock, getTotalTuitionPaid, getTierByTotal } = require("../_shared/memberTier");

// Dùng khi 1 thành viên đang bị "kẹt" ở hạng cũ (mốc khoá bảo lưu 12 tháng được tạo ra từ dữ liệu
// test/nhập nhầm trước đây, trước khi có cơ chế tự xoá khoá khi sửa/xoá học phí) — admin bấm 1 nút
// để xoá mốc khoá và buộc tính lại NGAY theo đúng tổng học phí hiện tại, không cần chờ sửa/xoá thêm
// 1 khoản học phí nào khác mới kích hoạt việc tính lại.
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
    await resetTierLock(email);
    const totalPaid = await getTotalTuitionPaid(email);
    const tier = getTierByTotal(totalPaid);
    context.res.status = 200;
    context.res.body = { success: true, totalPaid, tierName: tier.name };
  } catch (err) {
    context.log.error("Lỗi tính lại hạng:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
