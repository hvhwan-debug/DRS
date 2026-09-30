const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");

const TABLE = "ContactMessages";

// Tin nhắn liên hệ (form Liên Hệ) — KHÔNG phải đơn đăng ký cần duyệt, chỉ cần biết Mới hay Đã trả
// lời. Dùng chung quyền "registrations" với đơn đăng ký để không phải thêm mục quyền mới cho tài
// khoản nhân viên.
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireAdmin(context, req, "registrations"))) return;

  try {
    const table = await getTableClient(TABLE);
    const messages = [];
    for await (const e of table.listEntities({ queryOptions: { filter: "PartitionKey eq 'message'" } })) {
      messages.push({
        id: e.rowKey, name: e.name || "", email: e.email || "", phone: e.phone || "",
        subject: e.subject || "", message: e.message || "", status: e.status || "Mới",
        submittedAt: e.submittedAt || null
      });
    }
    messages.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    context.res.status = 200;
    context.res.body = { success: true, messages };
  } catch (err) {
    context.log.error("Lỗi lấy danh sách liên hệ:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
