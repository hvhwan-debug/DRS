const { getTableClient } = require("./tableStorage");
const { getAttachmentSasUrl } = require("./blobStorage");

const CATALOG_TABLE = "GiftCatalog";
const PARTITION = "gift";

// Danh mục quà tặng ban đầu — dùng để "gieo" (seed) bảng GiftCatalog lần đầu tiên nếu bảng
// còn trống, để không phá vỡ các bản ghi GiftRedemptions cũ đang tham chiếu đúng các id này.
const SEED_ITEMS = [
  { id: "but-may", name: "Bút máy cao cấp", cost: 5000000, icon: "fa-pen-fancy" },
  { id: "vo-o-ly", name: "Bộ vở ô ly (10 quyển)", cost: 10000000, icon: "fa-book" },
  { id: "balo", name: "Balo học sinh", cost: 20000000, icon: "fa-bag-shopping" },
  { id: "buoi-hoc-mien-phi", name: "1 buổi học miễn phí", cost: 35000000, icon: "fa-chalkboard-user" },
  { id: "bo-dung-cu", name: "Bộ dụng cụ học tập cao cấp", cost: 50000000, icon: "fa-box-open" },
  { id: "khoa-hoc-mien-phi", name: "Miễn phí học phí 1 kỳ", cost: 80000000, icon: "fa-graduation-cap" }
];

async function seedIfEmpty(table) {
  for await (const _entity of table.listEntities({ queryOptions: { filter: `PartitionKey eq '${PARTITION}'` } })) {
    return; // đã có ít nhất 1 mục -> không seed nữa
  }
  let order = 0;
  for (const item of SEED_ITEMS) {
    await table.createEntity({
      partitionKey: PARTITION,
      rowKey: item.id,
      name: item.name,
      cost: item.cost,
      icon: item.icon,
      imageBlobName: "",
      active: true,
      order: order++,
      createdAt: new Date().toISOString()
    });
  }
}

function toPublicItem(entity, imageUrl) {
  return {
    id: entity.rowKey,
    name: entity.name,
    cost: Number(entity.cost) || 0,
    icon: entity.icon || "fa-gift",
    imageUrl: imageUrl || null,
    active: entity.active !== false,
    order: entity.order != null ? Number(entity.order) : 0
  };
}

// Danh mục quà đang bật (active) — dùng cho phía thành viên. imageExpiryMinutes dài hơn ảnh đính
// kèm cá nhân vì đây là ảnh minh hoạ quà tặng, không nhạy cảm, chỉ cần đủ sống qua 1 phiên xem trang.
async function listActiveGiftCatalog(imageExpiryMinutes = 120) {
  const table = await getTableClient(CATALOG_TABLE);
  await seedIfEmpty(table);
  const items = [];
  for await (const entity of table.listEntities({ queryOptions: { filter: `PartitionKey eq '${PARTITION}' and active eq true` } })) {
    const imageUrl = entity.imageBlobName ? await getAttachmentSasUrl(entity.imageBlobName, imageExpiryMinutes) : null;
    items.push(toPublicItem(entity, imageUrl));
  }
  items.sort((a, b) => (a.order - b.order) || (a.cost - b.cost));
  return items;
}

// Toàn bộ danh mục (kể cả đã ẩn) — dùng cho trang quản trị.
async function listAllGiftCatalog(imageExpiryMinutes = 60) {
  const table = await getTableClient(CATALOG_TABLE);
  await seedIfEmpty(table);
  const items = [];
  for await (const entity of table.listEntities({ queryOptions: { filter: `PartitionKey eq '${PARTITION}'` } })) {
    const imageUrl = entity.imageBlobName ? await getAttachmentSasUrl(entity.imageBlobName, imageExpiryMinutes) : null;
    items.push(toPublicItem(entity, imageUrl));
  }
  items.sort((a, b) => (a.order - b.order) || (a.cost - b.cost));
  return items;
}

// Tra cứu 1 mục quà theo id — dùng khi thành viên gửi yêu cầu đổi quà (chỉ tin dữ liệu từ bảng,
// không tin cost/name mà client gửi lên).
async function findGift(giftId) {
  const table = await getTableClient(CATALOG_TABLE);
  try {
    const entity = await table.getEntity(PARTITION, giftId);
    if (entity.active === false) return null; // quà đã ẩn -> coi như không tồn tại để đổi
    return toPublicItem(entity, null);
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

module.exports = { listActiveGiftCatalog, listAllGiftCatalog, findGift, CATALOG_TABLE, PARTITION };
