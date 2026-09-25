const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { uploadGiftImage, deleteBlob, getAttachmentSasUrl } = require("../_shared/blobStorage");
const { CATALOG_TABLE, PARTITION } = require("../_shared/giftCatalog");

function slugify(name) {
  return String(name || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // bỏ dấu tiếng Việt
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "qua-tang";
}

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const body = req.body || {};
  const id = String(body.id || "").trim();
  const name = String(body.name || "").trim();
  const cost = Number(body.cost);
  const icon = String(body.icon || "fa-gift").trim();
  const active = body.active !== false;
  const orderRaw = body.order;
  const order = orderRaw !== undefined && orderRaw !== null && orderRaw !== "" ? Number(orderRaw) : 0;
  const removeImage = !!body.removeImage;
  const image = body.image && body.image.content ? body.image : null;

  if (!name || !cost || cost <= 0) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Vui lòng nhập đủ tên quà và mốc học phí hợp lệ (lớn hơn 0)." };
    return;
  }

  try {
    const table = await getTableClient(CATALOG_TABLE);

    let existing = null;
    if (id) {
      try {
        existing = await table.getEntity(PARTITION, id);
      } catch (err) {
        if (err.statusCode !== 404) throw err;
      }
    }

    let rowKey = id;
    if (!existing) {
      // Tạo mới -> sinh id từ tên, đảm bảo không trùng
      let candidate = slugify(name);
      let suffix = 0;
      while (true) {
        const tryKey = suffix === 0 ? candidate : `${candidate}-${suffix}`;
        try {
          await table.getEntity(PARTITION, tryKey);
          suffix++; // đã tồn tại -> thử id khác
        } catch (err) {
          if (err.statusCode === 404) { rowKey = tryKey; break; }
          throw err;
        }
      }
    }

    let imageBlobName = existing ? (existing.imageBlobName || "") : "";
    if (image) {
      const newBlobName = await uploadGiftImage(image);
      if (imageBlobName) await deleteBlob(imageBlobName); // thay ảnh mới -> xoá ảnh cũ
      imageBlobName = newBlobName || "";
    } else if (removeImage && imageBlobName) {
      await deleteBlob(imageBlobName);
      imageBlobName = "";
    }

    await table.upsertEntity({
      partitionKey: PARTITION,
      rowKey,
      name,
      cost,
      icon,
      imageBlobName,
      active,
      order,
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, "Replace");

    const imageUrl = imageBlobName ? await getAttachmentSasUrl(imageBlobName, 60) : null;

    context.res.status = 200;
    context.res.body = {
      success: true,
      item: { id: rowKey, name, cost, icon, imageUrl, active, order }
    };
  } catch (err) {
    context.log.error("Lỗi lưu mục quà tặng:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
