const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { getMemberDisplayName, buildGreeting } = require("../_shared/memberName");
const { sendTrackedEmail } = require("../_shared/sendTrackedEmail");
const { SITE_URL } = require("../_shared/emailTemplate");

const INVOICES_TABLE = "Invoices";

function generateInvoiceNumber(issueDate) {
  const d = issueDate ? new Date(issueDate) : new Date();
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `HD${ym}-${suffix}`;
}

function buildInvoiceEmailBody(inv, greeting) {
  const rowsHtml = inv.items.map(it => `
    <tr>
      <td style="padding:8px 6px; border-bottom:1px solid #e2e8f0;">${it.description}</td>
      <td style="padding:8px 6px; border-bottom:1px solid #e2e8f0; text-align:center;">${it.quantity}</td>
      <td style="padding:8px 6px; border-bottom:1px solid #e2e8f0; text-align:right;">${Number(it.unitPrice).toLocaleString("vi-VN")}đ</td>
    </tr>`).join("");
  return `
    <p style="margin:0 0 16px;">${greeting}</p>
    <p style="margin:0 0 10px;">Chúng tôi vừa lập một hoá đơn mới cho bạn${inv.studentName ? ` — học sinh <strong>${inv.studentName}</strong>` : ""}:</p>
    <p style="margin:0 0 14px; font-size:13px; color:#64748b;">Số hoá đơn: <strong>${inv.invoiceNumber}</strong> — Ngày lập: <strong>${new Date(inv.issueDate).toLocaleDateString("vi-VN")}</strong></p>
    <table style="width:100%; border-collapse:collapse; margin-bottom:14px;">
      <thead><tr style="font-size:12px; color:#64748b; text-align:left;"><th style="padding:6px;">Mô tả</th><th style="padding:6px; text-align:center;">SL</th><th style="padding:6px; text-align:right;">Đơn giá</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div style="text-align:right; font-size:16px; font-weight:800; color:#15803d; margin-bottom:10px;">Tổng cộng: ${inv.totalAmount.toLocaleString("vi-VN")}đ</div>
    <p style="font-size:13px; color:#64748b; margin:0;">Xem đầy đủ hoá đơn trong khu vực thành viên, mục "Hoá Đơn".</p>`;
}

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const body = req.body || {};
  const parentEmail = String(body.parentEmail || "").trim().toLowerCase();
  const studentName = String(body.studentName || "").trim();
  const program = String(body.program || "").trim();
  const note = String(body.note || "").trim();
  const issueDate = body.issueDate ? new Date(body.issueDate).toISOString() : new Date().toISOString();

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail);
  if (!emailValid) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Vui lòng nhập đúng email phụ huynh." };
    return;
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = rawItems
    .map(it => ({
      description: String((it && it.description) || "").trim(),
      quantity: Number(it && it.quantity) || 0,
      unitPrice: Number(it && it.unitPrice) || 0
    }))
    .filter(it => it.description && it.quantity > 0 && it.unitPrice >= 0);

  if (items.length === 0) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Hoá đơn cần ít nhất 1 khoản hợp lệ (mô tả, số lượng > 0)." };
    return;
  }

  const totalAmount = items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0);

  try {
    const invoicesTable = await getTableClient(INVOICES_TABLE);
    const rowKey = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const invoiceNumber = generateInvoiceNumber(issueDate);

    await invoicesTable.createEntity({
      partitionKey: parentEmail,
      rowKey,
      invoiceNumber,
      studentName,
      program,
      itemsJson: JSON.stringify(items),
      totalAmount,
      issueDate,
      note,
      createdAt: new Date().toISOString()
    });

    const invoiceForEmail = { invoiceNumber, studentName, program, items, totalAmount, issueDate };
    const displayName = await getMemberDisplayName(parentEmail);
    const greeting = buildGreeting(displayName);
    const emailResult = await sendTrackedEmail(context, {
      to: parentEmail,
      subject: `Hoá đơn mới: ${invoiceNumber}`,
      type: "invoice",
      eyebrow: "Hoá Đơn Mới",
      title: `Hoá đơn ${invoiceNumber}`,
      bodyHtml: buildInvoiceEmailBody(invoiceForEmail, greeting),
      ctas: [{ label: "Xem Hoá Đơn Trong Trang Thành Viên", href: SITE_URL, style: "primary" }]
    });

    context.res.status = 200;
    context.res.body = {
      success: true,
      invoice: { id: rowKey, invoiceNumber, parentEmail, studentName, program, items, totalAmount, issueDate, note },
      warning: emailResult.success ? null : "Đã lập hoá đơn, nhưng gửi email báo thất bại."
    };
  } catch (err) {
    context.log.error("Lỗi lập hoá đơn:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
