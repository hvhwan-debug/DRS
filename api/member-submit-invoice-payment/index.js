const { getTableClient } = require("../_shared/tableStorage");
const { uploadAttachments } = require("../_shared/blobStorage");
const { getMemberDisplayName, buildGreeting } = require("../_shared/memberName");
const { sendTrackedEmail } = require("../_shared/sendTrackedEmail");

const SESSION_TABLE = "AuthSessions";
const INVOICES_TABLE = "Invoices";
const NOTIFY_TO_EMAIL = process.env.NOTIFY_TO_EMAIL || "hotro@wvn.vn";

function getMemberToken(req) {
  const header = req.headers && (req.headers["x-member-token"] || req.headers["X-Member-Token"]);
  return header ? header.trim() : null;
}

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  const token = getMemberToken(req);
  if (!token) {
    context.res.status = 401;
    context.res.body = { success: false, message: "Chưa đăng nhập." };
    return;
  }

  try {
    const sessionTable = await getTableClient(SESSION_TABLE);
    let session;
    try {
      session = await sessionTable.getEntity("session", token);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 401;
        context.res.body = { success: false, message: "Phiên đăng nhập không hợp lệ." };
        return;
      }
      throw err;
    }
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      context.res.status = 401;
      context.res.body = { success: false, message: "Phiên đăng nhập đã hết hạn." };
      return;
    }

    const email = session.email;
    const body = req.body || {};
    const invoiceId = String(body.invoiceId || "").trim();
    const note = String(body.note || "").trim();
    const receipt = body.receipt; // { filename, content(base64), type }

    if (!invoiceId || !receipt || !receipt.content) {
      context.res.status = 400;
      context.res.body = { success: false, message: "Vui lòng đính kèm ảnh/biên lai thanh toán." };
      return;
    }

    const invoicesTable = await getTableClient(INVOICES_TABLE);
    let invoice;
    try {
      invoice = await invoicesTable.getEntity(email, invoiceId);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Không tìm thấy hoá đơn này." };
        return;
      }
      throw err;
    }

    if (invoice.status === "paid") {
      context.res.status = 409;
      context.res.body = { success: false, message: "Hoá đơn này đã được xác nhận thanh toán." };
      return;
    }
    if (invoice.status === "pending_review") {
      context.res.status = 409;
      context.res.body = { success: false, message: "Hoá đơn này đang chờ đội ngũ duyệt biên lai, vui lòng đợi." };
      return;
    }

    const uploaded = await uploadAttachments([{ filename: receipt.filename || "bien-lai.jpg", content: receipt.content, type: receipt.type }]);
    if (uploaded.length === 0) {
      context.res.status = 500;
      context.res.body = { success: false, message: "Tải ảnh biên lai thất bại, vui lòng thử lại." };
      return;
    }

    await invoicesTable.updateEntity({
      partitionKey: email,
      rowKey: invoiceId,
      status: "pending_review",
      receiptBlobName: uploaded[0].blobName,
      paymentNote: note,
      submittedAt: new Date().toISOString(),
      rejectReason: ""
    }, "Merge");

    // Báo cho đội ngũ có biên lai mới cần duyệt (best-effort)
    await sendTrackedEmail(context, {
      to: NOTIFY_TO_EMAIL,
      subject: `Biên lai thanh toán mới: ${invoice.invoiceNumber}`,
      type: "other",
      eyebrow: "Cần Duyệt Thanh Toán",
      title: "Có biên lai thanh toán mới",
      bodyHtml: `
        <p style="margin:0 0 12px;">Thành viên <strong>${email}</strong> vừa gửi biên lai thanh toán cho hoá đơn <strong>${invoice.invoiceNumber}</strong> (${Number(invoice.totalAmount).toLocaleString("vi-VN")}đ).</p>
        <p style="margin:0;">Vào trang quản trị, mục "Hoá Đơn" để xem và duyệt.</p>`
    });

    // Báo lại cho chính thành viên đã ghi nhận
    const displayName = await getMemberDisplayName(email);
    const greeting = buildGreeting(displayName);
    await sendTrackedEmail(context, {
      to: email,
      subject: `Đã nhận biên lai thanh toán: ${invoice.invoiceNumber}`,
      type: "invoice",
      eyebrow: "Hoá Đơn",
      title: "Đã nhận biên lai thanh toán",
      bodyHtml: `
        <p style="margin:0 0 16px;">${greeting}</p>
        <p style="margin:0;">Chúng tôi đã nhận được biên lai thanh toán cho hoá đơn <strong>${invoice.invoiceNumber}</strong>. Đội ngũ sẽ kiểm tra và xác nhận trong thời gian sớm nhất.</p>`
    });

    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi gửi biên lai thanh toán:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
