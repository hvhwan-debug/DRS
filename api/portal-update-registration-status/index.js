const sgMail = require("@sendgrid/mail");
const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");

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

function buildStatusEmailHtml(formTitle, status, reason) {
  return `<!DOCTYPE html>
<html lang="vi">
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 28px rgba(15,23,42,0.10);">
          <tr><td bgcolor="#0f172a" style="background-color:#0f172a;background:linear-gradient(135deg,#0f172a 0%,#1e3a8a 50%,#0284c7 100%);padding:28px 32px;text-align:center;">
            <img src="https://wvn.vn/images/logo-wvn.png" alt="WVN" width="56" style="display:block;height:auto;margin:0 auto 10px;">
            <div style="color:#ffffff;font-size:17px;font-weight:800;">Mạng Lưới Tri Thức Việt Nam</div>
          </td></tr>
          <tr><td style="padding:32px;">
            <p style="font-size:15px;color:#0f172a;margin:0 0 10px;">Đơn đăng ký của bạn vừa được cập nhật trạng thái:</p>
            <p style="font-size:16px;color:#0f172a;margin:0 0 18px;font-weight:700;">${formTitle}</p>
            <div style="text-align:center;margin:20px 0;">
              <span style="display:inline-block;font-size:18px;font-weight:800;color:${statusColor(status)};background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 22px;">${status}</span>
            </div>
            ${reason ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px 16px;margin-bottom:18px;">
              <p style="font-size:13px;color:#991b1b;margin:0 0 4px;font-weight:700;">Lý do:</p>
              <p style="font-size:14px;color:#7f1d1d;margin:0;">${reason}</p>
            </div>` : ''}
            <p style="font-size:13px;color:#64748b;margin:0 0 6px;">Đăng nhập vào khu vực thành viên để xem chi tiết đầy đủ.</p>
            <div style="text-align:center;margin-top:20px;">
              <a href="https://wvn.vn/thanh-vien-index.html" style="display:inline-block;background:#0284c7;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:10px 22px;border-radius:8px;">Xem Trong Trang Thành Viên</a>
            </div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
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
    let emailWarning = null;
    const apiKey = process.env.SENDGRID_API_KEY;
    const fromEmail = process.env.SENDGRID_FROM_EMAIL;
    if (apiKey && fromEmail) {
      try {
        sgMail.setApiKey(apiKey);
        await sgMail.send({
          to: email,
          from: { email: fromEmail, name: "Mạng Lưới Tri Thức Việt Nam" },
          subject: `Cập nhật trạng thái đơn đăng ký: ${status}`,
          html: buildStatusEmailHtml(formTitle, status, status === "Từ chối" ? reason : null)
        });
      } catch (err) {
        context.log.error("Gửi email thông báo trạng thái thất bại:", err?.response?.body || err.message);
        emailWarning = "Đã cập nhật trạng thái, nhưng gửi email thông báo thất bại.";
      }
    } else {
      context.log.error("Thiếu SENDGRID_API_KEY hoặc SENDGRID_FROM_EMAIL — bỏ qua gửi email.");
    }

    context.res.status = 200;
    context.res.body = { success: true, warning: emailWarning };
  } catch (err) {
    context.log.error("Lỗi cập nhật trạng thái đăng ký:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
