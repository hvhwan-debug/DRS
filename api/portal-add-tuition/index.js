const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { uploadAttachments } = require("../_shared/blobStorage");
const { getMemberDisplayName, buildGreeting } = require("../_shared/memberName");
const { createConfirmToken } = require("../_shared/confirmToken");
const { sendTrackedEmail } = require("../_shared/sendTrackedEmail");
const { SITE_URL } = require("../_shared/emailTemplate");

const TUITION_TABLE = "TuitionPayments";

function buildTuitionBodyHtml(studentName, program, amount, period, expectedAmount) {
  const balance = expectedAmount != null ? amount - expectedAmount : 0;
  let balanceHtml = "";
  if (expectedAmount != null && balance !== 0) {
    if (balance < 0) {
      balanceHtml = `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px 16px;margin-bottom:18px;text-align:center;">
        <p style="font-size:13px;color:#991b1b;margin:0;">Còn <strong>thiếu ${Math.abs(balance).toLocaleString("vi-VN")}đ</strong> so với số tiền cần đóng kỳ này (${expectedAmount.toLocaleString("vi-VN")}đ).</p>
      </div>`;
    } else {
      balanceHtml = `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:12px 16px;margin-bottom:18px;text-align:center;">
        <p style="font-size:13px;color:#15803d;margin:0;">Bạn đã đóng <strong>dư ${balance.toLocaleString("vi-VN")}đ</strong> so với số tiền cần đóng kỳ này (${expectedAmount.toLocaleString("vi-VN")}đ) — sẽ được cấn trừ cho kỳ sau.</p>
      </div>`;
    }
  }
  return `
    <p style="margin:0 0 4px;">Chúng tôi vừa ghi nhận khoản học phí cho:</p>
    <p style="margin:0 0 18px;font-weight:700;color:#0f172a;font-size:16px;">${studentName} — ${program || ""}</p>
    <div style="text-align:center;margin:18px 0;">
      <span style="display:inline-block;font-size:22px;font-weight:800;color:#15803d;background:#f0fdf4;border:1px dashed #86efac;border-radius:10px;padding:10px 24px;">${Number(amount).toLocaleString("vi-VN")}đ</span>
    </div>
    ${period ? `<p style="font-size:13px;color:#64748b;margin:0 0 18px;text-align:center;">Kỳ học phí: <strong>${period}</strong></p>` : ""}
    ${balanceHtml}
    <p style="font-size:13px;color:#64748b;margin:18px 0 0;text-align:center;">Thông tin trên có chính xác không?</p>`;
}

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const body = req.body || {};
  const parentEmail = String(body.parentEmail || "").trim().toLowerCase();
  const studentName = String(body.studentName || "").trim();
  const program = String(body.program || "").trim();
  const amount = Number(body.amount);
  const expectedAmountRaw = body.expectedAmount;
  const expectedAmount = expectedAmountRaw !== undefined && expectedAmountRaw !== null && expectedAmountRaw !== ""
    ? Number(expectedAmountRaw)
    : amount; // Nếu không nhập, mặc định coi như đóng đủ (không thiếu/thừa)
  const period = String(body.period || "").trim();
  const method = String(body.method || "").trim();
  const note = String(body.note || "").trim();
  const paidAt = body.paidAt ? new Date(body.paidAt).toISOString() : new Date().toISOString();

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail);
  if (!emailValid || !studentName || !amount || amount <= 0) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Vui lòng nhập đủ email phụ huynh, tên học sinh và số tiền hợp lệ." };
    return;
  }
  if (isNaN(expectedAmount) || expectedAmount < 0) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Số tiền cần đóng không hợp lệ." };
    return;
  }

  try {
    let uploadedAttachments = [];
    let warning = null;
    if (Array.isArray(body.attachments) && body.attachments.length > 0) {
      try {
        uploadedAttachments = await uploadAttachments(body.attachments);
      } catch (err) {
        context.log.error("Lưu ảnh biên lai học phí thất bại:", err.message);
        warning = "Đã lưu học phí, nhưng KHÔNG lưu được ảnh biên lai.";
      }
    }

    const tuitionTable = await getTableClient(TUITION_TABLE);
    const rowKey = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await tuitionTable.createEntity({
      partitionKey: parentEmail,
      rowKey,
      studentName,
      program,
      amount,
      expectedAmount,
      period,
      method,
      note,
      attachmentsJson: JSON.stringify(uploadedAttachments),
      paidAt,
      recordedAt: new Date().toISOString()
    });

    // Email dùng khung giao diện thống nhất toàn hệ thống; tự chuyển bản premium nếu là thành viên VIP.
    const confirmToken = await createConfirmToken("tuition", parentEmail, rowKey);
    const displayName = await getMemberDisplayName(parentEmail);
    const greeting = buildGreeting(displayName);
    const confirmUrl = `https://wvn.vn/xac-nhan.html?type=tuition&token=${confirmToken}`;
    const emailResult = await sendTrackedEmail(context, {
      to: parentEmail,
      subject: `Xác nhận học phí cho ${studentName}`,
      type: "tuition",
      eyebrow: "Xác Nhận Học Phí",
      title: "Khoản học phí mới",
      bodyHtml: `<p style="margin:0 0 16px;">${greeting}</p>` + buildTuitionBodyHtml(studentName, program, amount, period, expectedAmount),
      ctas: [
        { label: "✓ Xác nhận đúng", href: `${confirmUrl}&action=confirm`, style: "primary" },
        { label: "✗ Báo sai / Cần sửa", href: confirmUrl, style: "danger" }
      ],
      footerNote: `Hoặc đăng nhập vào <a href="${SITE_URL}" style="color:#0284c7;">khu vực thành viên</a> để xem chi tiết đầy đủ.`
    });
    if (!emailResult.success) {
      warning = warning ? warning + " Đồng thời gửi email báo cũng thất bại." : "Đã lưu học phí, nhưng gửi email báo thất bại.";
    }

    context.res.status = 200;
    context.res.body = { success: true, warning };
  } catch (err) {
    context.log.error("Lỗi thêm học phí:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
