const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");
const { deleteBlob } = require("../_shared/blobStorage");
const { CATALOG_TABLE, PARTITION } = require("../_shared/giftCatalog");

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const id = String((req.body && req.body.id) || "").trim();
  if (!id) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu id quà tặng." };
    return;
  }

  try {
    const table = await getTableClient(CATALOG_TABLE);
    let existing = null;
    try {
      existing = await table.getEntity(PARTITION, id);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Không tìm thấy mục quà tặng này." };
        return;
      }
      throw err;
    }

    await table.deleteEntity(PARTITION, id);
    if (existing.imageBlobName) await deleteBlob(existing.imageBlobName);
    await logAdminActivity(req, "Xoá quà tặng", `${existing.name || id}`);

    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi xoá mục quà tặng:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
