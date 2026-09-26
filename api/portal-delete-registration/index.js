const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");
const { deleteBlob } = require("../_shared/blobStorage");

const REGISTRATIONS_TABLE = "Registrations";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const body = req.body || {};
  const email = String(body.email || "").trim().toLowerCase();
  const id = String(body.id || "").trim();
  if (!email || !id) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu thông tin." };
    return;
  }

  try {
    const regTable = await getTableClient(REGISTRATIONS_TABLE);
    let entity;
    try {
      entity = await regTable.getEntity(email, id);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Không tìm thấy đơn đăng ký này." };
        return;
      }
      throw err;
    }

    // Dọn luôn file đính kèm trong Blob Storage (best-effort — không chặn việc xoá bản ghi chính)
    try {
      const attachments = JSON.parse(entity.attachmentsJson || "[]");
      for (const att of attachments) {
        if (att && att.blobName) await deleteBlob(att.blobName);
      }
    } catch (e) { /* bỏ qua nếu attachmentsJson lỗi hoặc không có */ }

    await regTable.deleteEntity(email, id);
    await logAdminActivity(req, "Xoá đơn đăng ký", `${email} - ${entity.formTitle || ""}`);
    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi xoá đơn đăng ký:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
