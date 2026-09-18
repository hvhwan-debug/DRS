const sgMail = require("@sendgrid/mail");

// ===== Tên hiển thị cho từng loại biểu mẫu =====
const FORM_TITLES = {
  contact: "Liên hệ mới từ website",
  volunteer: "Đăng ký tình nguyện viên mới",
  item: "Đăng ký gây quỹ hiện vật mới",
  donor: "Đăng ký trở thành nhà tài trợ mới",
  support: "Yêu cầu kết nối hỗ trợ mới",
  newsletter: "Đăng ký nhận bản tin mới"
};

// ===== Nhãn tiếng Việt cho từng trường dữ liệu (áp dụng cho mọi form) =====
const FIELD_LABELS = {
  fullname: "Họ và tên",
  fullName: "Họ và tên",
  name: "Họ và tên",
  email: "Email",
  phone: "Số điện thoại",
  subject: "Chủ đề",
  message: "Nội dung",
  loai_hien_vat: "Loại hiện vật",
  so_luong: "Số lượng ước tính",
  hinh_thuc_gui: "Hình thức gửi",
  ghi_chu: "Ghi chú",
  hinh_thuc: "Hình thức tham gia",
  thoi_gian: "Thời gian rảnh",
  muc_tai_tro: "Mức tài trợ",
  needType: "Loại hỗ trợ cần thiết",
  relation: "Vai trò liên hệ",
  address: "Địa chỉ hiện tại",
  detail: "Mô tả hoàn cảnh"
};

// Các trường ẩn / kỹ thuật không hiển thị trong email
const SKIP_FIELDS = new Set(["_subject", "_captcha", "_honey", "_template", "formType"]);

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function buildRowsHtml(data) {
  return Object.entries(data)
    .filter(([key, value]) => !SKIP_FIELDS.has(key) && value !== undefined && value !== "")
    .map(([key, value]) => {
      const label = FIELD_LABELS[key] || key;
      return `
        <tr>
          <td style="padding:10px 14px;font-weight:600;color:#0f172a;background:#f8fafc;border-bottom:1px solid #e2e8f0;width:180px;font-size:13px;vertical-align:top;">${escapeHtml(label)}</td>
          <td style="padding:10px 14px;color:#334155;border-bottom:1px solid #e2e8f0;font-size:13px;white-space:pre-wrap;">${escapeHtml(value)}</td>
        </tr>`;
    })
    .join("");
}

function buildEmailHtml(title, rowsHtml) {
  return `<!DOCTYPE html>
<html lang="vi">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 28px rgba(15,23,42,0.10);">

          <tr>
            <td style="background:linear-gradient(135deg,#0f172a 0%,#1e3a8a 50%,#0284c7 100%);padding:28px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                <td style="vertical-align:middle;">
                  <div style="width:38px;height:38px;background:rgba(255,255,255,0.15);border-radius:10px;display:inline-block;text-align:center;line-height:38px;font-size:18px;">📖</div>
                </td>
                <td style="padding-left:12px;vertical-align:middle;">
                  <div style="color:#ffffff;font-size:17px;font-weight:800;line-height:1.3;">Mạng Lưới Tri Thức Việt Nam</div>
                  <div style="color:#bfdbfe;font-size:11px;font-weight:600;letter-spacing:0.2px;">WISDOM VIETNAM NETWORK | DR SOLUTIONS</div>
                </td>
              </tr></table>
            </td>
          </tr>

          <tr>
            <td style="padding:28px 32px 6px;">
              <span style="display:inline-block;background:#e0f2fe;color:#0369a1;font-size:11px;font-weight:700;letter-spacing:0.4px;padding:5px 12px;border-radius:999px;">THÔNG BÁO TỰ ĐỘNG TỪ WEBSITE</span>
              <h1 style="font-size:20px;line-height:1.35;color:#0f172a;margin:14px 0 6px;font-weight:800;">${escapeHtml(title)}</h1>
              <p style="font-size:13px;color:#64748b;margin:0 0 22px;line-height:1.6;">Có người vừa gửi thông tin qua biểu mẫu trên website <strong>wvn.vn</strong>. Chi tiết bên dưới:</p>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 26px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
                ${rowsHtml}
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 30px;">
              <a href="https://wvn.vn" style="display:inline-block;background:linear-gradient(135deg,#0284c7 0%,#2563eb 100%);color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;padding:11px 22px;border-radius:8px;">Mở website wvn.vn →</a>
            </td>
          </tr>

          <tr>
            <td style="background:#f8fafc;padding:18px 32px;border-top:1px solid #e2e8f0;">
              <div style="font-size:11px;color:#94a3b8;line-height:1.6;">
                Đây là email tự động từ hệ thống website Mạng Lưới Tri Thức Việt Nam — vui lòng không trả lời trực tiếp email này.<br>
                Doanh nghiệp xã hội phi lợi nhuận đồng hành vì cơ hội học tập công bằng cho trẻ em vùng cao.
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = async function (context, req) {
  context.res = {
    headers: { "Content-Type": "application/json" }
  };

  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL;
  const toEmail = process.env.NOTIFY_TO_EMAIL || "hotro@wvn.vn";

  if (!apiKey || !fromEmail) {
    context.log.error("Thiếu SENDGRID_API_KEY hoặc SENDGRID_FROM_EMAIL trong Application settings.");
    context.res.status = 500;
    context.res.body = { success: false, message: "Hệ thống gửi email chưa được cấu hình." };
    return;
  }

  const body = req.body || {};
  const formType = body.formType || "contact";
  const data = body.data || {};

  // Honeypot chống spam đơn giản (nếu form có field ẩn _honey bị điền thì bỏ qua âm thầm)
  if (data._honey) {
    context.res.status = 200;
    context.res.body = { success: true };
    return;
  }

  const title = FORM_TITLES[formType] || "Thông báo mới từ website";
  const rowsHtml = buildRowsHtml(data);
  const html = buildEmailHtml(title, rowsHtml);

  sgMail.setApiKey(apiKey);

  const msg = {
    to: toEmail,
    from: { email: fromEmail, name: "Website Mạng Lưới Tri Thức Việt Nam" },
    replyTo: data.email || undefined,
    subject: `[WVN Website] ${title}`,
    html
  };

  try {
    await sgMail.send(msg);
    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    context.log.error("Gửi email SendGrid thất bại:", err?.response?.body || err.message);
    context.res.status = 502;
    context.res.body = { success: false, message: "Gửi email thất bại, vui lòng thử lại sau." };
  }
};
