const nodemailer = require("nodemailer");

// Gửi email qua SMTP của Microsoft 365 (Outlook/Exchange Online) thay cho SendGrid.
// Cấu hình qua Application Settings (Azure Function App):
//   SMTP_USER      — địa chỉ email @wvn.vn dùng để đăng nhập/gửi (vd. noreply@wvn.vn hoặc hotro@wvn.vn)
//   SMTP_PASS      — mật khẩu ứng dụng (app password) của email đó — KHÔNG dùng mật khẩu đăng nhập
//                    thường nếu tài khoản có bật xác thực 2 lớp (MFA)
//   SMTP_FROM_NAME — (tuỳ chọn) tên hiển thị mặc định, mặc định "Mạng Lưới Tri Thức Việt Nam"
// LƯU Ý: hộp thư @wvn.vn phải được bật "SMTP AUTH" trong Exchange Admin Center (Microsoft 365 mặc
// định tắt SMTP AUTH cho từng hộp thư từ 2022) thì mới gửi được — nếu không sẽ báo lỗi xác thực.
const SMTP_HOST = process.env.SMTP_HOST || "smtp.office365.com";
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;

let cachedTransporter = null;
function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;
  cachedTransporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false, // Office 365 dùng STARTTLS trên port 587, không phải SSL trực tiếp
    auth: { user, pass }
  });
  return cachedTransporter;
}

// attachments: mảng { content (base64 string), filename, type } — giữ nguyên hình dạng cũ (kiểu
// SendGrid) để không phải sửa lại chỗ gọi; hàm này tự chuyển sang định dạng nodemailer cần.
async function sendEmail({ to, from, fromName, replyTo, subject, html, attachments }) {
  const transporter = getTransporter();
  if (!transporter) {
    throw new Error("Thiếu SMTP_USER hoặc SMTP_PASS trong Application settings.");
  }
  const fromEmail = from || process.env.SMTP_USER;
  const displayName = fromName || process.env.SMTP_FROM_NAME || "Mạng Lưới Tri Thức Việt Nam";

  const mailOptions = {
    from: `"${displayName}" <${fromEmail}>`,
    to,
    subject,
    html
  };
  if (replyTo) mailOptions.replyTo = replyTo;
  if (Array.isArray(attachments) && attachments.length > 0) {
    mailOptions.attachments = attachments.map(a => ({
      filename: a.filename,
      content: a.content,
      encoding: "base64",
      contentType: a.type || "application/octet-stream"
    }));
  }

  await transporter.sendMail(mailOptions);
}

module.exports = { sendEmail };
