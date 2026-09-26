const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { resetTierLock } = require("../_shared/memberTier");

const PROFILES_TABLE = "MemberProfiles";

// Dọn 1 LẦN cho TẤT CẢ hồ sơ đang có mốc khoá hạng bảo lưu (tierLockedName) — dùng để xử lý dứt
// điểm các hạng bị "kẹt" từ dữ liệu test/nhập nhầm trước khi có cơ chế tự xoá khoá khi sửa/xoá học
// phí (xem portal-edit-tuition, portal-delete-tuition). Không cần bấm từng thành viên một
// (portal-recalculate-tier) — endpoint này quét toàn bộ MemberProfiles và xoá khoá cho MỌI hồ sơ
// đang có, để lần đọc tiếp theo (member-data / email) tự tính lại đúng theo tổng học phí hiện tại.
// Chạy lại nhiều lần vẫn an toàn (không có gì để xoá thêm nếu đã dọn sạch).
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  try {
    const profilesTable = await getTableClient(PROFILES_TABLE);
    let count = 0;
    const iterator = profilesTable.listEntities({ queryOptions: { filter: "PartitionKey eq 'profile'" } });
    for await (const entity of iterator) {
      if (entity.tierLockedName) {
        await resetTierLock(entity.rowKey);
        count++;
      }
    }
    context.res.status = 200;
    context.res.body = { success: true, count };
  } catch (err) {
    context.log.error("Lỗi tính lại hạng hàng loạt:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
