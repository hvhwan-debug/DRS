const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { deleteBlob } = require("../_shared/blobStorage");

const GRADES_TABLE = "Grades";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const body = req.body || {};
  const parentEmail = String(body.parentEmail || "").trim().toLowerCase();
  const id = String(body.id || "").trim();
  if (!parentEmail || !id) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu thông tin." };
    return;
  }

  try {
    const gradesTable = await getTableClient(GRADES_TABLE);
    let entity;
    try {
      entity = await gradesTable.getEntity(parentEmail, id);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Không tìm thấy bản ghi điểm này." };
        return;
      }
      throw err;
    }

    try {
      const attachments = JSON.parse(entity.attachmentsJson || "[]");
      for (const att of attachments) {
        if (att && att.blobName) await deleteBlob(att.blobName);
      }
    } catch (e) { /* bỏ qua nếu lỗi parse */ }

    await gradesTable.deleteEntity(parentEmail, id);
    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi xoá điểm:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
