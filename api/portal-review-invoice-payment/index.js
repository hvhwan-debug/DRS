const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { getMemberDisplayName, buildGreeting } = require("../_shared/memberName");
const { sendTrackedEmail } = require("../_shared/sendTrackedEmail");
const { SITE_URL } = require("../_shared/emailTemplate");

const INVOICES_TABLE = "Invoices";
const TUITION_TABLE = "TuitionPayments";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const body = req.body || {};
  const parentEmail = String(body.parentEmail || "").trim().toLowerCase();
  const id = String(body.id || "").trim();
  const action = String(body.action || "").trim(); // 'approve' | 'reject'
  const reason = String(body.reason || "").trim();

  if (!parentEmail || !id || !["approve", "reject"].includes(action)) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu thông tin hoặc hành động không hợp lệ." };
    return;
  }

  try {
    const invoicesTable = await getTableClient(INVOICES_TABLE);
    let invoice;
    try {
      invoice = await invoicesTable.getEntity(parentEmail, id);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Không tìm thấy hoá đơn này." };
        return;
      }
      throw err;
    }

    if (invoice.status !== "pending_review") {
      context.res.status = 409;
      context.res.body = { success: false, message: "Hoá đơn này hiện không ở trạng thái chờ duyệt." };
      return;
    }

    const displayName = await getMemberDisplayName(parentEmail);
    const greeting = buildGreeting(displayName);

    if (action === "approve") {
      // Tạo khoản học phí tương ứng -> tự động cộng vào tổng học phí đã đóng -> tự động lên điểm/hạng
      // (điểm tích lũy và hạng thành viên đều tính từ TỔNG học phí trong bảng TuitionPayments).
      const tuitionTable = await getTableClient(TUITION_TABLE);
      const tuitionRowKey = `invoice-${id}`;
      await tuitionTable.upsertEntity({
        partitionKey: parentEmail,
        rowKey: tuitionRowKey,
        studentName: invoice.studentName || "",
        program: invoice.program || "",
        amount: Number(invoice.totalAmount) || 0,
        period: invoice.invoiceNumber,
        note: `Thanh toán hoá đơn ${invoice.invoiceNumber}`,
        attachmentsJson: invoice.receiptBlobName ? JSON.stringify([{ filename: "bien-lai.jpg", blobName: invoice.receiptBlobName }]) : "[]",
        paidAt: new Date().toISOString(),
        recordedAt: new Date().toISOString()
      }, "Merge");

      await invoicesTable.updateEntity({
        partitionKey: parentEmail,
        rowKey: id,
        status: "paid",
        paidAt: new Date().toISOString(),
        linkedTuitionPaymentId: tuitionRowKey
      }, "Merge");

      const emailResult = await sendTrackedEmail(context, {
        to: parentEmail,
        subject: `Đã xác nhận thanh toán hoá đơn ${invoice.invoiceNumber}`,
        type: "invoice",
        eyebrow: "Hoá Đơn",
        title: "Thanh toán đã được xác nhận",
        bodyHtml: `
          <p style="margin:0 0 16px;">${greeting}</p>
          <p style="margin:0;">Thanh toán cho hoá đơn <strong>${invoice.invoiceNumber}</strong> (${Number(invoice.totalAmount).toLocaleString("vi-VN")}đ) đã được xác nhận. Khoản này đã được cộng vào tổng học phí và điểm tích lũy của bạn.</p>`,
        ctas: [{ label: "Xem Trong Trang Thành Viên", href: SITE_URL, style: "primary" }]
      });

      context.res.status = 200;
      context.res.body = { success: true, warning: emailResult.success ? null : "Đã duyệt thanh toán, nhưng gửi email báo thất bại." };
    } else {
      await invoicesTable.updateEntity({
        partitionKey: parentEmail,
        rowKey: id,
        status: "unpaid",
        rejectReason: reason
      }, "Merge");

      const emailResult = await sendTrackedEmail(context, {
        to: parentEmail,
        subject: `Cần bổ sung lại biên lai cho hoá đơn ${invoice.invoiceNumber}`,
        type: "invoice",
        eyebrow: "Hoá Đơn",
        title: "Cần gửi lại biên lai thanh toán",
        bodyHtml: `
          <p style="margin:0 0 16px;">${greeting}</p>
          <p style="margin:0 0 10px;">Biên lai thanh toán cho hoá đơn <strong>${invoice.invoiceNumber}</strong> chưa hợp lệ.${reason ? ` Lý do: <strong>${reason}</strong>.` : ""}</p>
          <p style="margin:0;">Vui lòng đăng nhập và gửi lại biên lai chính xác.</p>`,
        ctas: [{ label: "Gửi Lại Biên Lai", href: SITE_URL, style: "primary" }]
      });

      context.res.status = 200;
      context.res.body = { success: true, warning: emailResult.success ? null : "Đã từ chối biên lai, nhưng gửi email báo thất bại." };
    }
  } catch (err) {
    context.log.error("Lỗi duyệt thanh toán hoá đơn:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
