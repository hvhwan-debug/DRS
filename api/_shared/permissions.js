// Danh sách quyền có thể GÁN cho tài khoản quản trị dạng "Nhân viên" (role: 'staff').
// Tài khoản "Quản trị viên chính" (role: 'super') luôn có TOÀN BỘ quyền, không cần gán —
// và là người DUY NHẤT được quản lý tài khoản/vai trò của người khác.
//
// Mỗi quyền gate CẢ VIỆC XEM lẫn SỬA của cả 1 khu vực chức năng (không tách nhỏ hơn thành
// "xem" và "sửa" riêng) — đúng theo yêu cầu: "chức năng nào không được gán thì không xuất hiện".
const PERMISSIONS = [
  { key: "registrations", label: "Đơn Đăng Ký" },
  { key: "donations", label: "Quyên Góp" },
  { key: "tuition", label: "Học Phí" },
  { key: "invoices", label: "Hoá Đơn" },
  { key: "students", label: "Học Sinh" },
  { key: "schedule", label: "Lịch Học" },
  { key: "attendance", label: "Điểm Danh" },
  { key: "grades", label: "Bảng Điểm" },
  { key: "members", label: "Thành Viên" },
  { key: "gifts", label: "Danh Mục & Yêu Cầu Đổi Quà" },
  { key: "bulkemail", label: "Gửi Email Hàng Loạt" }
];

const PERMISSION_KEYS = PERMISSIONS.map(p => p.key);

function sanitizePermissions(input) {
  if (!Array.isArray(input)) return [];
  return input.filter(k => PERMISSION_KEYS.includes(k));
}

module.exports = { PERMISSIONS, PERMISSION_KEYS, sanitizePermissions };
