const { getTableClient } = require("./tableStorage");

const ACTIVITY_LOG_TABLE = "AdminActivityLog";

function getAdminName(req) {
  const raw = req.headers && (req.headers["x-admin-name"] || req.headers["X-Admin-Name"]);
  if (!raw) return "Không rõ";
  try {
    return decodeURIComponent(raw).trim().slice(0, 100) || "Không rõ";
  } catch (e) {
    return String(raw).trim().slice(0, 100) || "Không rõ";
  }
}

// Ghi 1 dòng nhật ký thao tác — best-effort, KHÔNG BAO GIỜ throw để không làm hỏng hành động
// chính đang thực hiện (xoá/duyệt/sửa...) chỉ vì ghi log lỗi.
async function logAdminActivity(req, action, details) {
  try {
    const adminName = getAdminName(req);
    const table = await getTableClient(ACTIVITY_LOG_TABLE);
    const now = new Date();
    await table.createEntity({
      partitionKey: now.toISOString().slice(0, 10), // theo ngày, dễ dọn dữ liệu cũ sau này nếu cần
      rowKey: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      adminName,
      action,
      details: details || "",
      createdAt: now.toISOString()
    });
  } catch (e) {
    // best-effort — im lặng bỏ qua, không chặn thao tác chính
  }
}

module.exports = { logAdminActivity, getAdminName, ACTIVITY_LOG_TABLE };
