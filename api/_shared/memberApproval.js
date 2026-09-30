// Phê duyệt tài khoản thành viên tự đăng ký.
// approvalStatus trên bảng Members: "pending" (chờ duyệt) | "approved" | "rejected".
// Tài khoản tạo trước khi có tính năng này không có trường approvalStatus -> coi như đã duyệt,
// để thành viên cũ vẫn đăng nhập bình thường.
const PENDING_MESSAGE = "Tài khoản của bạn đang chờ đội ngũ phê duyệt. Chúng tôi sẽ gửi email ngay khi tài khoản được kích hoạt.";
const REJECTED_MESSAGE = "Tài khoản của bạn chưa được phê duyệt. Vui lòng liên hệ hotro@wvn.vn để được hỗ trợ.";

function getApprovalStatus(member) {
  const s = String((member && member.approvalStatus) || "").toLowerCase();
  return s === "pending" || s === "rejected" ? s : "approved";
}

module.exports = { getApprovalStatus, PENDING_MESSAGE, REJECTED_MESSAGE };
