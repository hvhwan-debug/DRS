const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { uploadAttachments } = require("../_shared/blobStorage");
const { buildGreeting } = require("../_shared/memberName");
const { createConfirmToken } = require("../_shared/confirmToken");
const { sendTrackedEmail } = require("../_shared/sendTrackedEmail");
const { SITE_URL } = require("../_shared/emailTemplate");

const DONATIONS_TABLE = "Donations";
const TRANSACTIONS_TABLE = "Transactions"; // Bảng dùng chung với trang Tra Cứu Sao Kê

function buildDonationBodyHtml(donationType, amount, itemDescription) {
  const valueHtml = donationType === "item"
    ? `<p style="font-size:16px;color:#0f172a;margin:0;font-weight:700;">${itemDescription}</p>`
    : `<span style="display:inline-block;font-size:22px;font-weight:800;color:#15803d;background:#f0fdf4;border:1px dashed #86efac;border-radius:10px;padding:10px 24px;">${Number(amount).toLocaleString("vi-VN")}đ</span>`;
  return `
    <p style="margin:0 0 18px;">Chúng tôi vừa ghi nhận một khoản quyên góp ${donationType === "item" ? "hiện vật" : "bằng tiền"} từ bạn:</p>
    <div style="text-align:center;margin:18px 0;">${valueHtml}</div>
    <p style="font-size:13px;color:#64748b;margin:18px 0 0;text-align:center;">Thông tin trên có chính xác không?</p>`;
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

    const rowKey = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const donationsTable = await getTableClient(DONATIONS_TABLE);
    await donationsTable.createEntity({
      partitionKey: "donation",
      rowKey,
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
    // Email dùng khung giao diện thống nhất; tự chuyển bản premium nếu người quyên góp là thành viên VIP.
    if (donorEmail) {
      const confirmToken = await createConfirmToken("donation", "donation", rowKey);
      const greeting = buildGreeting(donorName);
      const confirmUrl = `https://wvn.vn/xac-nhan.html?type=donation&token=${confirmToken}`;
      const emailResult = await sendTrackedEmail(context, {
        to: donorEmail,
        subject: "Xác nhận đã ghi nhận quyên góp của bạn",
        type: "donation",
        eyebrow: "Xác Nhận Quyên Góp",
        title: "Cảm ơn tấm lòng của bạn",
        bodyHtml: `<p style="margin:0 0 16px;">${greeting}</p>` + buildDonationBodyHtml(donationType, amount, itemDescription),
        ctas: [
          { label: "✓ Xác nhận đúng", href: `${confirmUrl}&action=confirm`, style: "primary" },
          { label: "✗ Báo sai / Cần sửa", href: confirmUrl, style: "danger" }
        ],
        footerNote: `Hoặc đăng nhập vào <a href="${SITE_URL}" style="color:#0284c7;">khu vực thành viên</a> để xem chi tiết đầy đủ.`
      });
      if (!emailResult.success) {
        warning = warning ? warning + " Đồng thời gửi email báo cũng thất bại." : "Đã lưu quyên góp, nhưng gửi email báo cho người quyên góp thất bại.";
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
