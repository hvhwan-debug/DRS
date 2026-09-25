const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { getMemberDisplayName, buildGreeting } = require("../_shared/memberName");
const { sendTrackedEmail } = require("../_shared/sendTrackedEmail");
const { SITE_URL } = require("../_shared/emailTemplate");

const REGISTRATIONS_TABLE = "Registrations";
const ALLOWED_STATUSES = ["Đã ghi nhận - Chờ xử lý", "Đã duyệt", "Từ chối"];

const FORM_TITLES = {
  contact: "Liên hệ",
  volunteer: "Đăng ký tình nguyện viên",
  item: "Đăng ký gây quỹ hiện vật",
  donor: "Đăng ký trở thành nhà tài trợ",
  support: "Yêu cầu kết nối hỗ trợ",
  newsletter: "Đăng ký nhận bản tin",
  luyen_chu_phu_huynh: "Đăng ký Luyện Chữ Đẹp — Phụ huynh",
  luyen_chu_tinh_nguyen: "Đăng ký Luyện Chữ Đẹp — Tình nguyện viên",
  luyen_chu_tai_tro: "Đăng ký Luyện Chữ Đẹp — Nhà tài trợ",
  tien_tieu_hoc: "Đăng ký Chương Trình Tiền Tiểu Học"
};

function statusColor(status) {
  if (status === "Đã duyệt") return "#15803d";
  if (status === "Từ chối") return "#b91c1c";
  return "#a16207";
}

function buildStatusBodyHtml(formTitle, status, reason) {
  return `
    <p style="margin:0 0 10px;">Đơn đăng ký của bạn vừa được cập nhật trạng thái:</p>
    <p style="margin:0 0 18px;font-weight:700;color:#0f172a;font-size:16px;">${formTitle}</p>
    <div style="text-align:center;margin:20px 0;">
      <span style="display:inline-block;font-size:18px;font-weight:800;color:${statusColor(status)};background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 22px;">${status}</span>
    </div>
    ${reason ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px 16px;margin-bottom:8px;">
      <p style="font-size:13px;color:#991b1b;margin:0 0 4px;font-weight:700;">Lý do:</p>
      <p style="font-size:14px;color:#7f1d1d;margin:0;">${reason}</p>
    </div>` : ''}`;
}

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const email = String((req.body && req.body.email) || "").trim();
  const id = String((req.body && req.body.id) || "").trim();
  const status = String((req.body && req.body.status) || "").trim();
  const reason = String((req.body && req.body.reason) || "").trim();

  if (!email || !id || !status) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu thông tin cần thiết." };
    return;
  }
  if (!ALLOWED_STATUSES.includes(status)) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Trạng thái không hợp lệ." };
    return;
  }
  if (status === "Từ chối" && !reason) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Vui lòng nhập lý do từ chối." };
    return;
  }

  try {
    const regTable = await getTableClient(REGISTRATIONS_TABLE);

    let formTitle = "Đơn đăng ký";
    try {
      const entity = await regTable.getEntity(email, id);
      formTitle = FORM_TITLES[entity.formType] || entity.formType || formTitle;
    } catch (e) {
      // Nếu không đọc được formType thì vẫn tiếp tục cập nhật, chỉ dùng tiêu đề mặc định
    }

    await regTable.updateEntity({
      partitionKey: email,
      rowKey: id,
      status,
      rejectionReason: status === "Từ chối" ? reason : ""
    }, "Merge");

    // Gửi email báo cho người đăng ký (best-effort — không chặn phản hồi thành công nếu gửi lỗi)
    // Email dùng khung giao diện thống nhất; tự chuyển bản premium nếu người đăng ký là thành viên VIP.
    const displayName = await getMemberDisplayName(email);
    const greeting = buildGreeting(displayName);
    const emailResult = await sendTrackedEmail(context, {
      to: email,
      subject: `Cập nhật trạng thái đơn đăng ký: ${status}`,
      type: "status",
      eyebrow: "Cập Nhật Đơn Đăng Ký",
      title: "Trạng thái đơn đăng ký",
      bodyHtml: `<p style="margin:0 0 16px;">${greeting}</p>` + buildStatusBodyHtml(formTitle, status, status === "Từ chối" ? reason : null),
      ctas: [{ label: "Xem Trong Trang Thành Viên", href: SITE_URL, style: "primary" }]
    });
    const emailWarning = emailResult.success ? null : "Đã cập nhật trạng thái, nhưng gửi email thông báo thất bại.";

    context.res.status = 200;
    context.res.body = { success: true, warning: emailWarning };
  } catch (err) {
    context.log.error("Lỗi cập nhật trạng thái đăng ký:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
