const sgMail = require("@sendgrid/mail");
const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { uploadAttachments } = require("../_shared/blobStorage");

const DONATIONS_TABLE = "Donations";
const TRANSACTIONS_TABLE = "Transactions"; // Bảng dùng chung với trang Tra Cứu Sao Kê

function buildDonationEmailHtml(donationType, amount, itemDescription) {
  const valueHtml = donationType === "item"
    ? `<p style="font-size:16px;color:#0f172a;margin:0;font-weight:700;">${itemDescription}</p>`
    : `<span style="display:inline-block;font-size:22px;font-weight:800;color:#15803d;background:#f0fdf4;border:1px dashed #86efac;border-radius:10px;padding:10px 24px;">${Number(amount).toLocaleString("vi-VN")}đ</span>`;

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
            <p style="font-size:15px;color:#0f172a;margin:0 0 18px;">Chúng tôi vừa ghi nhận một khoản quyên góp ${donationType === "item" ? "hiện vật" : "bằng tiền"} từ bạn:</p>
            <div style="text-align:center;margin:18px 0;">${valueHtml}</div>
            <p style="font-size:13px;color:#64748b;margin:18px 0 6px;">Cảm ơn sự đồng hành của bạn cùng Mạng Lưới Tri Thức Việt Nam! Đăng nhập vào khu vực thành viên để xem chi tiết đầy đủ.</p>
            <div style="text-align:center;margin-top:16px;">
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

  const body = req.body || {};
  const donationType = body.donationType === "item" ? "item" : "cash"; // 'cash' (tiền) | 'item' (hiện vật)
  const donorName = String(body.donorName || "").trim();
  const donorEmail = String(body.donorEmail || "").trim().toLowerCase();
  const amountRaw = body.amount;
  const amount = amountRaw !== undefined && amountRaw !== null && amountRaw !== "" ? Number(amountRaw) : null;
  const itemDescription = String(body.itemDescription || "").trim();
  const method = String(body.method || "").trim();
  const note = String(body.note || "").trim();
  const transactionCode = String(body.transactionCode || "").trim().toUpperCase();
  const donatedAt = body.donatedAt ? new Date(body.donatedAt).toISOString() : new Date().toISOString();

  if (!donorName) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Vui lòng nhập tên người quyên góp." };
    return;
  }
  if (donationType === "cash" && (!amount || amount <= 0)) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Vui lòng nhập số tiền hợp lệ cho quyên góp bằng tiền." };
    return;
  }
  if (donationType === "item" && !itemDescription) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Vui lòng mô tả hiện vật đã nhận." };
    return;
  }
  if (amount !== null && (isNaN(amount) || amount < 0)) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Số tiền / giá trị ước tính không hợp lệ." };
    return;
  }

  try {
    // Lưu ảnh biên lai/minh chứng hoặc ảnh hiện vật (nếu có) lên Blob Storage riêng tư
    let uploadedAttachments = [];
    let warning = null;
    if (Array.isArray(body.attachments) && body.attachments.length > 0) {
      try {
        uploadedAttachments = await uploadAttachments(body.attachments);
      } catch (err) {
        context.log.error("Lưu ảnh quyên góp vào Blob Storage thất bại:", err.message);
        warning = "Đã lưu quyên góp, nhưng KHÔNG lưu được ảnh (" + err.message + "). Ảnh có thể quá lớn hoặc sai định dạng — thử lại với ảnh nhỏ hơn.";
      }
    }

    const donationsTable = await getTableClient(DONATIONS_TABLE);
    await donationsTable.createEntity({
      partitionKey: "donation",
      rowKey: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      donationType,
      donorName,
      donorEmail,
      amount,
      itemDescription,
      method,
      note,
      transactionCode: donationType === "cash" ? transactionCode : "",
      attachmentsJson: JSON.stringify(uploadedAttachments),
      donatedAt,
      recordedAt: new Date().toISOString()
    });

    // Nếu là quyên góp bằng tiền và có mã giao dịch, đồng bộ sang bảng Transactions để tra cứu ở trang Sao Kê
    // (hiện vật không có giao dịch ngân hàng nên không đồng bộ — best-effort, không chặn phản hồi thành công nếu lỗi)
    if (donationType === "cash" && transactionCode) {
      try {
        const txTable = await getTableClient(TRANSACTIONS_TABLE);
        await txTable.upsertEntity({
          partitionKey: "TX",
          rowKey: transactionCode,
          fullName: donorName,
          date: donatedAt,
          content: note || "Quyên góp ủng hộ chương trình",
          amount
        }, "Replace");
      } catch (err) {
        context.log.error("Đồng bộ sang bảng Transactions thất bại:", err.message);
      }
    }

    // Gửi email báo cho người quyên góp nếu có email (best-effort — không chặn phản hồi thành công nếu gửi lỗi)
    if (donorEmail) {
      const apiKey = process.env.SENDGRID_API_KEY;
      const fromEmail = process.env.SENDGRID_FROM_EMAIL;
      if (apiKey && fromEmail) {
        try {
          sgMail.setApiKey(apiKey);
          await sgMail.send({
            to: donorEmail,
            from: { email: fromEmail, name: "Mạng Lưới Tri Thức Việt Nam" },
            subject: "Xác nhận đã ghi nhận quyên góp của bạn",
            html: buildDonationEmailHtml(donationType, amount, itemDescription)
          });
        } catch (err) {
          context.log.error("Gửi email báo quyên góp thất bại:", err?.response?.body || err.message);
          warning = warning ? warning + " Đồng thời gửi email báo cũng thất bại." : "Đã lưu quyên góp, nhưng gửi email báo cho người quyên góp thất bại.";
        }
      } else {
        context.log.error("Thiếu SENDGRID_API_KEY hoặc SENDGRID_FROM_EMAIL — bỏ qua gửi email.");
      }
    }

    context.res.status = 200;
    context.res.body = { success: true, warning };
  } catch (err) {
    context.log.error("Lỗi thêm quyên góp:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
