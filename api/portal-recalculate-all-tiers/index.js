const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { resetTierLock, recomputeTuitionPoints } = require("../_shared/memberTier");

const PROFILES_TABLE = "MemberProfiles";
const TUITION_TABLE = "TuitionPayments";

// Dọn 1 LẦN cho TOÀN BỘ hệ thống:
// 1) Xoá mốc khoá hạng bảo lưu (tierLockedName) đang bị "kẹt" từ dữ liệu test/nhập nhầm trước khi
//    có cơ chế tự xoá khoá khi sửa/xoá học phí (xem portal-edit-tuition, portal-delete-tuition).
// 2) Chốt lại (backfill) điểm tích lũy (pointsEarned) cho MỌI khoản học phí của MỌI phụ huynh theo
//    đúng thứ tự thời gian — cần thiết vì điểm giờ được tính lũy kế theo hạng tại từng thời điểm
//    đóng thay vì "tổng học phí × hạng hiện tại" (cách cũ khiến điểm bị tính lại sai/co lại mỗi khi
//    hạng hiện tại đổi). Chạy cho MỌI phụ huynh có học phí, không chỉ những người đang bị khoá hạng.
// Chạy lại nhiều lần vẫn an toàn (không có gì thay đổi thêm nếu dữ liệu đã đúng).
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  try {
    let lockCount = 0;
    const profilesTable = await getTableClient(PROFILES_TABLE);
    const profileIterator = profilesTable.listEntities({ queryOptions: { filter: "PartitionKey eq 'profile'" } });
    for await (const entity of profileIterator) {
      if (entity.tierLockedName) {
        await resetTierLock(entity.rowKey);
        lockCount++;
      }
    }

    const tuitionTable = await getTableClient(TUITION_TABLE);
    const emails = new Set();
    const tuitionIterator = tuitionTable.listEntities();
    for await (const entity of tuitionIterator) {
      if (entity.partitionKey) emails.add(entity.partitionKey);
    }
    let pointsCount = 0;
    for (const email of emails) {
      await recomputeTuitionPoints(email);
      pointsCount++;
    }

    context.res.status = 200;
    context.res.body = { success: true, count: lockCount, pointsCount };
  } catch (err) {
    context.log.error("Lỗi tính lại hạng hàng loạt:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
