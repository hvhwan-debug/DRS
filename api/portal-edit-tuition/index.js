const { logFamilyEvent, enrollFromRegistration, pointsDeficit } = require("../_shared/linkage");
const { logAdminActivity, summarizeBody } = require("../_shared/activityLog");
const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { uploadAttachments } = require("../_shared/blobStorage");
const { resetTierLock, recomputeTuitionPoints } = require("../_shared/memberTier");

const TUITION_TABLE = "TuitionPayments";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req, "tuition"))) return;

  const body = req.body || {};
  const parentEmail = String(body.parentEmail || "").trim().toLowerCase();
  const id = String(body.id || "").trim();
  const studentName = String(body.studentName || "").trim();
  const program = String(body.program || "").trim();
  const amount = Number(body.amount);
  const expectedAmountRaw = body.expectedAmount;
  const expectedAmount = expectedAmountRaw !== undefined && expectedAmountRaw !== null && expectedAmountRaw !== ""
    ? Number(expectedAmountRaw)
    : amount;
  const period = String(body.period || "").trim();
  const method = String(body.method || "").trim();
  const note = String(body.note || "").trim();
  const paidAt = body.paidAt ? new Date(body.paidAt).toISOString() : undefined;

  if (!parentEmail || !id || !studentName || !amount || amount <= 0) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu thông tin cần thiết hoặc số tiền không hợp lệ." };
    return;
  }

  try {
    const tuitionTable = await getTableClient(TUITION_TABLE);
    let entity;
    try {
      entity = await tuitionTable.getEntity(parentEmail, id);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Không tìm thấy bản ghi." };
        return;
      }
      throw err;
    }

    let attachmentsJson = entity.attachmentsJson;
    let warning = null;
    if (Array.isArray(body.attachments) && body.attachments.length > 0) {
      try {
        const uploaded = await uploadAttachments(body.attachments);
        attachmentsJson = JSON.stringify(uploaded);
      } catch (err) {
        context.log.error("Lưu ảnh mới thất bại:", err.message);
        warning = "Đã cập nhật học phí, nhưng KHÔNG lưu được ảnh mới.";
      }
    }

    const update = {
      partitionKey: parentEmail,
      rowKey: id,
      studentName,
      program,
      amount,
      expectedAmount,
      period,
      method,
      note,
      attachmentsJson,
      confirmationStatus: "pending",
      memberFeedback: ""
    };
    if (paidAt) update.paidAt = paidAt;

    await tuitionTable.updateEntity(update, "Merge");

    // Vừa sửa 1 khoản học phí (thường là do nhập nhầm) -> xoá mốc khoá hạng để hạng được
    // tính lại NGAY theo đúng tổng học phí đã sửa, không giữ hạng cũ (có thể sai) thêm 12 tháng.
    // Đồng thời chốt lại điểm tích lũy cho TOÀN BỘ khoản học phí (không chỉ khoản vừa sửa) —
    // vì sửa 1 khoản có thể làm dịch chuyển mốc hạng của các khoản đóng sau nó.
    await resetTierLock(parentEmail);
    await recomputeTuitionPoints(parentEmail);
    if (id.startsWith("invoice-") && Number(entity.amount) !== amount) {
      const note = `Khoản này đến từ hoá đơn đã thanh toán; số tiền mới (${amount.toLocaleString("vi-VN")}đ) khác tổng hoá đơn (${(Number(entity.amount) || 0).toLocaleString("vi-VN")}đ). Kiểm tra lại hoá đơn nếu cần.`;
      warning = warning ? warning + " " + note : note;
    }

    // Liên kết: khoản đã sửa quay về "chờ xác nhận" -> phụ huynh phải được báo để xác nhận lại
    try {
      const { createConfirmToken } = require("../_shared/confirmToken");
      const { sendTrackedEmail } = require("../_shared/sendTrackedEmail");
      const { getMemberDisplayName, getMemberGender, buildGreeting } = require("../_shared/memberName");
      const confirmToken = await createConfirmToken("tuition", parentEmail, id);
      const confirmUrl = `https://wvn.vn/xac-nhan.html?type=tuition&token=${confirmToken}`;
      const greeting = buildGreeting(await getMemberDisplayName(parentEmail), await getMemberGender(parentEmail));
      const r = await sendTrackedEmail(context, {
        to: parentEmail, subject: `Cập nhật học phí của ${studentName} — vui lòng xác nhận lại`, type: "tuition",
        eyebrow: "Xác Nhận Học Phí", title: "Khoản học phí đã được cập nhật",
        bodyHtml: `<p style="margin:0 0 16px;">${greeting}</p><p style="margin:0 0 12px;">Trung tâm vừa cập nhật khoản học phí của <strong>${studentName}</strong>${program ? " (" + program + ")" : ""}:</p>
          <p style="margin:0 0 12px;font-size:18px;font-weight:800;">${amount.toLocaleString("vi-VN")}đ${period ? ` <span style="font-weight:500;color:#64748b;font-size:14px;">· ${period}</span>` : ""}</p>
          <p style="margin:0;">Điểm tích luỹ sẽ được tính theo số tiền mới sau khi anh/chị xác nhận.</p>`,
        ctas: [{ label: "✓ Xác nhận đúng", href: `${confirmUrl}&action=confirm`, style: "primary" }, { label: "✗ Báo sai / Cần sửa", href: confirmUrl, style: "danger" }]
      });
      if (!r.success) warning = (warning ? warning + " " : "") + "Gửi email xác nhận lại thất bại.";
    } catch (e) { context.log.warn("Email sửa học phí:", e.message); }
    await logFamilyEvent(context, parentEmail, `Học phí được sửa thành ${amount.toLocaleString("vi-VN")}đ${period ? " (" + period + ")" : ""}, chờ phụ huynh xác nhận lại.`, { studentName });

    await logAdminActivity(req, "Sửa học phí", summarizeBody(req.body));
    context.res.status = 200;
    context.res.body = { success: true, warning };
  } catch (err) {
    context.log.error("Lỗi sửa học phí:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
