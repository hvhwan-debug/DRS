const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin, getAdminIdentity } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");
const { sendTrackedEmail } = require("../_shared/sendTrackedEmail");
const { SITE_URL } = require("../_shared/emailTemplate");
const { INTERACTIONS_TABLE, CRM_TABLE, CRM_PARTITION, clean, cleanDate, isValidStudentId } = require("../_shared/crm");

// Gửi email cho phụ huynh ngay từ CRM, bằng khung email thương hiệu chung của hệ thống (có nhật
// ký ở mục Lịch Sử Email). Email chỉ gửi tới đúng email tài khoản phụ huynh của học sinh đó (lấy
// từ dữ liệu, không nhận địa chỉ do trình duyệt gửi lên). Gửi thành công -> tự ghi vào lịch sử chăm sóc.

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireAdmin(context, req, "students"))) return;

  const b = req.body || {};
  const studentId = clean(b.studentId, 80);
  const subject = clean(b.subject, 150);
  const message = clean(b.message, 5000);
  if (!isValidStudentId(studentId) || !subject || !message) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Nhập tiêu đề và nội dung email." };
    return;
  }

  try {
    // Tìm học sinh để lấy email phụ huynh
    const students = await getTableClient("Students");
    let student = null;
    for await (const e of students.listEntities({ queryOptions: { filter: `RowKey eq '${studentId}'` } })) { student = e; break; }
    if (!student && /^lead-/.test(studentId)) {
      const { buildParentDirectory } = require("../_shared/parentDirectory");
      const { leadIdFor } = require("../_shared/crm");
      const dir = await buildParentDirectory();
      for (const [ck, c] of Object.entries(dir.children || {})) if (leadIdFor(ck) === studentId) { student = { partitionKey: c.email, studentName: c.childName, rowKey: studentId }; break; }
    }
    if (!student) { context.res.status = 404; context.res.body = { success: false, message: "Không tìm thấy học sinh." }; return; }
    const to = String(student.partitionKey || "").toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { context.res.status = 400; context.res.body = { success: false, message: "Học sinh này chưa có email phụ huynh hợp lệ." }; return; }

    const who = (await getAdminIdentity(req)) || {};
    const bodyHtml = escapeHtml(message).split(/\n{2,}/).map(p => `<p style="margin:0 0 14px;">${p.replace(/\n/g, "<br>")}</p>`).join("")
      + (who.displayName ? `<p style="margin:18px 0 0;color:#64748b;font-size:13px;">${escapeHtml(who.displayName)}<br>Tri thức Việt</p>` : "");

    const result = await sendTrackedEmail(context, {
      to, subject, type: "crm",
      eyebrow: "Thông Tin Học Tập",
      title: subject,
      bodyHtml,
      ctas: b.includePortalLink === false ? [] : [{ label: "Xem Trang Thành Viên", href: SITE_URL, style: "primary" }]
    });
    if (!result || !result.success) {
      context.res.status = 502;
      context.res.body = { success: false, message: "Gửi email thất bại. Kiểm tra cấu hình gửi thư hoặc thử lại sau." };
      return;
    }

    // Ghi lịch sử chăm sóc + hẹn liên hệ tiếp (nếu có)
    const now = new Date();
    const interaction = {
      partitionKey: studentId, rowKey: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      type: "email", content: `Đã gửi email: "${subject}"`, outcome: "",
      happenedAt: now.toISOString(), createdBy: who.displayName || "", createdAt: now.toISOString()
    };
    await (await getTableClient(INTERACTIONS_TABLE)).createEntity(interaction);
    const nextFollowUp = cleanDate(b.nextFollowUp);
    if (b.nextFollowUp !== undefined) {
      await (await getTableClient(CRM_TABLE)).upsertEntity({ partitionKey: CRM_PARTITION, rowKey: studentId, nextFollowUp, followUpNote: nextFollowUp ? "Kiểm tra phản hồi email" : "", updatedAt: now.toISOString(), updatedBy: who.displayName || "" }, "Merge");
    }
    await logAdminActivity(req, "CRM: gửi email phụ huynh", `${to} - ${subject}`);

    context.res.status = 200;
    context.res.body = { success: true, to, interaction: { id: interaction.rowKey, type: "email", content: interaction.content, outcome: "", happenedAt: interaction.happenedAt, createdBy: interaction.createdBy } };
  } catch (err) {
    context.log.error("Lỗi gửi email CRM:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
