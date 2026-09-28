const { getTableClient } = require("./tableStorage");
const { getAdminIdentity } = require("./adminAuth");

const ACTIVITY_LOG_TABLE = "AdminActivityLog";

// Ghi 1 dòng nhật ký thao tác — best-effort, KHÔNG BAO GIỜ throw để không làm hỏng hành động
// chính đang thực hiện (xoá/duyệt/sửa...) chỉ vì ghi log lỗi.
// Tên người thao tác lấy từ PHIÊN ĐĂNG NHẬP ĐÃ XÁC THỰC (tài khoản riêng từng người) — không còn
// dựa vào tên do client tự nhập/tự gửi lên như trước, nên không thể bị gõ sai hay giả mạo.
async function logAdminActivity(req, action, details, actorOverride) {
  try {
    const identity = actorOverride || await getAdminIdentity(req);
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

// Tóm tắt nội dung 1 yêu cầu để ghi nhật ký: chỉ lấy các trường dễ tra cứu, KHÔNG ghi mật khẩu/token/tệp đính kèm.
const SUMMARY_KEYS = [
  ["email", ""], ["parentEmail", ""], ["studentName", "HS"], ["donorName", "Người góp"], ["fullName", ""], ["displayName", ""],
  ["program", ""], ["title", ""], ["name", ""], ["subject", "Tiêu đề"], ["status", "Trạng thái"], ["amount", "Số tiền"],
  ["invoiceNumber", "Số HĐ"], ["date", "Ngày"], ["id", "id"]
];
function summarizeBody(body) {
  const b = body || {};
  const parts = [];
  for (const [k, label] of SUMMARY_KEYS) {
    let v = b[k];
    if (v == null || v === "" || typeof v === "object") continue;
    v = String(v);
    if (k === "amount" && /^\d+(\.\d+)?$/.test(v)) v = Number(v).toLocaleString("vi-VN") + "đ";
    if (v.length > 80) v = v.slice(0, 77) + "…";
    parts.push(label ? `${label}: ${v}` : v);
    if (parts.length >= 5) break;
  }
  if (Array.isArray(b.recipients)) parts.push(`${b.recipients.length} người nhận`);
  if (Array.isArray(b.records)) parts.push(`${b.records.length} dòng`);
  return parts.join(" - ");
}

module.exports = { logAdminActivity, summarizeBody, ACTIVITY_LOG_TABLE };
