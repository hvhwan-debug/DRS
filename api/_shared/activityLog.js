const { getTableClient } = require("./tableStorage");
const { getAdminIdentity } = require("./adminAuth");

const ACTIVITY_LOG_TABLE = "AdminActivityLog";

// Ghi 1 dòng nhật ký thao tác — best-effort, KHÔNG BAO GIỜ throw để không làm hỏng hành động
// chính đang thực hiện (xoá/duyệt/sửa...) chỉ vì ghi log lỗi.
// Tên người thao tác lấy từ PHIÊN ĐĂNG NHẬP ĐÃ XÁC THỰC (tài khoản riêng từng người) — không còn
// dựa vào tên do client tự nhập/tự gửi lên như trước, nên không thể bị gõ sai hay giả mạo.
async function logAdminActivity(req, action, details) {
  try {
    const identity = await getAdminIdentity(req);
    const adminName = identity ? identity.displayName : "Không rõ";
    const table = await getTableClient(ACTIVITY_LOG_TABLE);
    const now = new Date();
    await table.createEntity({
      partitionKey: now.toISOString().slice(0, 10), // theo ngày, dễ dọn dữ liệu cũ sau này nếu cần
      rowKey: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      adminName,
      adminEmail: (identity && identity.email) || "",
      action,
      details: details || "",
      createdAt: now.toISOString()
    });
  } catch (e) {
    // best-effort — im lặng bỏ qua, không chặn thao tác chính
  }
}

module.exports = { logAdminActivity, ACTIVITY_LOG_TABLE };
