const { TableClient } = require("@azure/data-tables");
const { sendEmail } = require("../_shared/mailer");

// Escape đơn giản để tránh chèn HTML/script độc hại từ dữ liệu người dùng vào email
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// (Gửi email dùng chung qua ../_shared/mailer.js — SMTP Microsoft 365, thay cho SendGrid trước đây)

module.exports = async function (context, req) {
  try {
    const { name, email, phone, subject, message } = (req.body || {});

    // Validate cơ bản phía server (không chỉ tin vào validate ở trình duyệt)
    if (!name || !email || !subject || !message) {
      context.res = { status: 400, jsonBody: { error: "Thiếu thông tin bắt buộc." } };
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      context.res = { status: 400, jsonBody: { error: "Email không hợp lệ." } };
      return;
    }

    const timestamp = new Date().toISOString();

    // ====== 1. LƯU VÀO AZURE TABLE STORAGE ======
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (connectionString) {
      try {
        const tableClient = TableClient.fromConnectionString(connectionString, "ContactSubmissions");
        try {
          await tableClient.createTable();
        } catch (e) {
          // Bảng đã tồn tại từ trước -> bỏ qua lỗi này
        }
        await tableClient.createEntity({
          partitionKey: "contact",
          rowKey: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name,
          email,
          phone: phone || "",
          subject,
          message,
          createdAt: timestamp
        });
      } catch (storageErr) {
        // Không chặn việc gửi email nếu lưu trữ lỗi, nhưng ghi log lại
        context.log.error("Lỗi lưu Table Storage:", storageErr.message);
      }
    } else {
      context.log.warn("Chưa cấu hình AZURE_STORAGE_CONNECTION_STRING -> bỏ qua bước lưu trữ.");
    }

    // ====== 2. GỬI EMAIL QUA SMTP (Microsoft 365) ======
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      context.log.error("Thiếu cấu hình SMTP_USER hoặc SMTP_PASS.");
      context.res = { status: 500, jsonBody: { error: "Máy chủ chưa cấu hình gửi email." } };
      return;
    }
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

    const safeName = escapeHtml(name);
    const safeSubject = escapeHtml(subject);
    const safeMessage = escapeHtml(message).replace(/\n/g, "<br>");
    const logoUrl = "https://wvn.vn/images/logo-wvn.png";

    const autoReplyHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color:#0f172a;">
        <div style="text-align:center; padding: 20px 0;">
          <img src="${logoUrl}" alt="Mạng Lưới Tri Thức Việt Nam" style="height: 56px;">
        </div>
        <div style="background:#0284c7; color:#fff; padding: 16px 24px; border-radius: 10px 10px 0 0;">
          <h2 style="margin:0; font-size:18px;">Cảm ơn bạn đã liên hệ!</h2>
        </div>
        <div style="border:1px solid #e2e8f0; border-top:none; padding: 24px; border-radius: 0 0 10px 10px;">
          <p>Xin chào <strong>${safeName}</strong>,</p>
          <p>Chúng tôi đã nhận được liên hệ của bạn với nội dung:</p>
          <table style="width:100%; border-collapse: collapse; margin: 16px 0; font-size:14px;">
            <tr><td style="padding:6px 0; color:#64748b; width:110px;">Chủ đề</td><td style="padding:6px 0;"><strong>${safeSubject}</strong></td></tr>
            <tr><td style="padding:6px 0; color:#64748b; vertical-align:top;">Nội dung</td><td style="padding:6px 0;">${safeMessage}</td></tr>
          </table>
          <p>Đội ngũ của chúng tôi sẽ phản hồi trong vòng 1-2 ngày làm việc (Thứ 2 - Thứ 6, 8:00 - 17:30 giờ Hà Nội).</p>
          <p>Cần hỗ trợ gấp? Liên hệ: <a href="mailto:hotro@wvn.vn" style="color:#0284c7;">hotro@wvn.vn</a></p>
          <hr style="border:none; border-top:1px solid #e2e8f0; margin: 24px 0;">
          <p style="color:#94a3b8; font-size:12px;">Đây là email tự động, vui lòng không phản hồi trực tiếp email này.</p>
        </div>
      </div>`;

    const adminHtml = `
      <div style="font-family: Arial, sans-serif; color:#0f172a;">
        <h3>📩 Liên hệ mới từ website</h3>
        <p><strong>Họ tên:</strong> ${safeName}</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p><strong>Điện thoại:</strong> ${escapeHtml(phone) || "Không cung cấp"}</p>
        <p><strong>Chủ đề:</strong> ${safeSubject}</p>
        <p><strong>Nội dung:</strong><br>${safeMessage}</p>
        <p style="color:#94a3b8; font-size:12px;">Gửi lúc: ${timestamp}</p>
      </div>`;

    const emailTasks = [
      sendEmail({
        from: process.env.SMTP_USER,
        fromName: "Mạng Lưới Tri Thức Việt Nam",
        to: email,
        subject: "Cảm ơn bạn đã liên hệ - Mạng Lưới Tri Thức Việt Nam",
        html: autoReplyHtml
      })
    ];

    if (ADMIN_EMAIL) {
      emailTasks.push(
        sendEmail({
          from: process.env.SMTP_USER,
          fromName: "Website DRS - Thông báo liên hệ",
          to: ADMIN_EMAIL,
          subject: `[Liên hệ mới] ${subject} - ${name}`,
          html: adminHtml
        })
      );
    }

    await Promise.all(emailTasks);

    context.res = { status: 200, jsonBody: { success: true } };
  } catch (err) {
    context.log.error(err);
    context.res = { status: 500, jsonBody: { error: "Đã có lỗi xảy ra khi gửi liên hệ." } };
  }
};
